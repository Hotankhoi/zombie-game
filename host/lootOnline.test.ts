import { describe, expect, it } from 'vitest';
import { generateChest } from '@shared/loot/chest';
import { chestLocations } from '@shared/mapgen/chests';
import { generateChunk, worldSeedForRoom } from '@shared/mapgen/world';
import type { LootReplicaWire } from '@shared/types/loot';
import { PLAYER_KEY_STORAGE } from '@net/playerKey';
import { MemStorage, TestMatch, type MatchNode } from './testMatch';

const ROOM = 'LOOTNET';
const seed = worldSeedForRoom(ROOM);
const chests = chestLocations(generateChunk(seed, 0, 0));
const key = (id: string) => `key${id}`.padEnd(22, 'x').slice(0, 22);
const qty = (slots: readonly ({ quantity: number } | null)[] | undefined) =>
  (slots ?? []).reduce((n, s) => n + (s?.quantity ?? 0), 0);

/** Tổng đồ trong mọi túi + các rương đang xét (rương chưa ai đụng = đồ sinh từ seed). */
function total(r: LootReplicaWire, ids = chests.map((c) => c.id)): number {
  let n = r.inventories.reduce((a, e) => a + qty(e.state.slots), 0);
  for (const id of ids) {
    const stored = r.chests.find((c) => c.id === id);
    const loc = chests.find((c) => c.id === id)!;
    n += qty(stored ? stored.slots : generateChest(seed, id, loc.region).slots);
  }
  return n;
}

function start(ids: string[], latencyMs = 0, loss = 0) {
  const m = new TestMatch(ROOM, { latencyMs, jitterMs: 0, loss });
  const nodes = new Map<string, MatchNode>(ids.map((id) => [id, m.join(id, key(id))]));
  m.until(() => [...nodes.values()].every((n) => n.game.loot.ready));
  const chest = chests[0]!;
  for (const id of ids) m.place(id, chest.x, chest.y);
  return { m, nodes, chest };
}

/** Đợi promise xong trong lúc trận vẫn chạy. */
async function run<T>(m: TestMatch, p: Promise<T>, max = 400): Promise<T> {
  let done = false;
  let value: T | undefined;
  void p.then((v) => {
    done = true;
    value = v;
  });
  for (let i = 0; i < max && !done; i++) {
    m.step();
    await Promise.resolve();
  }
  if (!done) throw new Error('chưa có kết quả');
  return value as T;
}

describe('loot online — đồng bộ và đổi host (NetGame thật trên mạng giả)', () => {
  it('người vào sau nhận replica: thấy rương đã lấy hết, có túi riêng; replica không chứa playerKey', async () => {
    const { m, nodes, chest } = start(['a', 'b'], 75);
    const a = nodes.get('a')!.game.loot;
    expect((await run(m, a.open(chest.id))).ok).toBe(true);
    expect((await run(m, a.takeAll(chest.id))).ok).toBe(true);
    const c = m.join('c', key('c'));
    m.until(() => c.game.loot.ready);
    expect(qty(c.game.loot.chest(chest.id)!.slots)).toBe(0);
    expect(c.game.loot.inventory!.slots[0]).toMatchObject({ itemId: 'knife' });
    expect(qty(c.game.loot.inventory!.slots)).toBe(1);
    expect(JSON.stringify(c.game.loot.replica)).not.toContain(key('a'));
    // đi xa rồi quay lại (đổi chunk): rương vẫn rỗng, không sinh lại đồ
    m.place('c', chest.x + 200, chest.y);
    m.step(10);
    m.place('c', chest.x, chest.y);
    const seen = await run(m, c.game.loot.view(chest.id));
    expect(qty(seen.chest!.slots)).toBe(0);
  });

  it('tải lại trang (PeerId mới, cùng playerKey) → đúng túi cũ; tab khác cùng khóa → túi riêng', async () => {
    const { m, nodes, chest } = start(['a', 'h'], 75);
    const a = nodes.get('a')!.game.loot;
    await run(m, a.open(chest.id));
    await run(m, a.takeAll(chest.id));
    const bag = a.inventory!;
    m.leave('a');
    m.step(5);
    const again = m.join('a2', key('a'), true);
    m.until(() => again.game.loot.ready);
    expect(again.game.loot.inventory!.slots).toEqual(bag.slots);
    // tab thứ 2 cùng trình duyệt (cùng khóa, không resume) khi tab kia đang chơi → key_in_use → đổi khóa riêng
    const tab = m.join('a3', key('a'), false);
    let rekeyed = false;
    (tab.game.loot as unknown as { opts: { onKeyInUse: () => string } }).opts.onKeyInUse = () => {
      rekeyed = true;
      return key('a3');
    };
    m.until(() => tab.game.loot.ready);
    expect(rekeyed).toBe(true);
    expect(qty(tab.game.loot.inventory!.slots)).toBe(1);
    expect(again.game.loot.inventory!.slots).toEqual(bag.slots);
  });

  for (const when of [
    'trước khi host nhận',
    'host đã làm, chưa ai nhận bản mới',
    'đã sao chép, chưa báo kết quả',
  ] as const)
    it(`host rời giữa lúc nhặt (${when}): không mất, không nhân đôi đồ; yêu cầu đang chờ → host_changed`, async () => {
      const { m, nodes, chest } = start(['a', 'b', 'h'], 150, 0.05);
      // h phải là host (id lớn nhất không tự lên): đợi đúng máy đang làm host
      const host = m.hostNode()!;
      const players = [...nodes.values()].filter((n) => n !== host);
      const a = players[0]!.game.loot;
      expect((await run(m, a.open(chest.id))).ok).toBe(true);
      const before = total(m.server().loot.replica());
      const rev = m.server().loot.authority.currentRevision();
      const pending = a.takeAll(chest.id);
      if (when !== 'trước khi host nhận') m.until(() => m.server().loot.authority.currentRevision() > rev);
      if (when === 'host đã làm, chưa ai nhận bản mới')
        expect(players.every((n) => n.game.loot.replica!.revision === rev)).toBe(true);
      if (when === 'đã sao chép, chưa báo kết quả')
        m.until(() => players.every((n) => n.game.loot.replica!.revision > rev));
      expect(a.busy).toBe(true); // chưa có kết quả
      m.leave(host.id);
      const outcome = await run(m, pending);
      expect(outcome).toMatchObject({ ok: false, error: 'host_changed' });
      m.until(() => players.every((n) => n.game.loot.ready) && m.hostNode() !== null);
      const after = m.server().loot.replica();
      expect(total(after)).toBe(before);
      // túi mình hiển thị = túi ở host mới
      const mine = after.inventories.find((e) => e.id === a.owner)!.state;
      expect(a.inventory).toEqual(mine);
      if (when === 'đã sao chép, chưa báo kết quả') {
        // mọi người đã có bản mới → host mới giữ giao dịch: rương rỗng, đồ nằm trong túi (dù kết quả chưa từng tới)
        expect(qty(after.chests.find((c) => c.id === chest.id)!.slots)).toBe(0);
        expect(qty(mine.slots)).toBeGreaterThan(1);
      }
      // thử lại: chỉ thành công nếu đồ còn trong rương
      const retry = await run(m, a.takeAll(chest.id));
      const end = m.server().loot.replica();
      expect(total(end)).toBe(before);
      expect(retry.ok || retry.error === 'empty_chest').toBe(true);
    });

  it('host mới là người vừa vào (chưa có bản nào): vẫn giữ đồ của cả đội nhờ thu bản của mọi người', async () => {
    const { m, nodes, chest } = start(['m1', 'm2'], 75);
    const host = m.hostNode()!;
    const other = [...nodes.values()].find((n) => n !== host)!;
    await run(m, other.game.loot.open(chest.id));
    await run(m, other.game.loot.takeAll(chest.id));
    const before = m.server().loot.replica();
    // "a0" có id nhỏ nhất + điểm bằng nhau → được chọn làm host mới; vào rồi host cũ rời ngay
    const fresh = m.join('a0', key('a0'));
    m.step(3);
    m.leave(host.id);
    m.until(() => m.hostNode() === fresh && !m.server().loot.recovering && other.game.loot.ready);
    const after = m.server().loot.replica();
    const bag = (r: LootReplicaWire) => r.inventories.find((e) => e.id === other.game.loot.owner)!.state;
    expect(bag(after)).toEqual(bag(before));
    expect(qty(after.chests.find((c) => c.id === chest.id)!.slots)).toBe(0);
  });
});

describe('loot online — 2 tab cùng trình duyệt không cướp túi nhau (lỗi 2A #1)', () => {
  /** Host `h` + tab 1 của trình duyệt (localStorage chung `local`). */
  function browser() {
    const m = new TestMatch(ROOM);
    const local = new MemStorage();
    const h = m.join('h', key('h'));
    const s1 = new MemStorage();
    const t1 = m.join('t1', { local, session: s1 });
    m.until(() => h.game.loot.ready && t1.game.loot.ready);
    const chest = chests[0]!;
    m.place('t1', chest.x, chest.y);
    return { m, local, h, t1, s1, chest };
  }

  it('khóa chỉ được nhớ cho tab sau khi host nhận; tab 2 tải lại trước khi claim xong không lấy túi tab 1', async () => {
    const { m, local, t1, s1, chest } = browser();
    expect(s1.getItem(PLAYER_KEY_STORAGE)).toBe(local.getItem(PLAYER_KEY_STORAGE));
    await run(m, t1.game.loot.open(chest.id));
    await run(m, t1.game.loot.takeAll(chest.id));
    const bag = t1.game.loot.inventory!;
    const owner = t1.game.loot.owner;
    // tab 2 mở, tải lại ngay (chưa kịp claim) → sessionStorage của tab 2 vẫn trống → lần sau không phải "resume"
    const s2 = new MemStorage();
    m.join('t2', { local, session: s2 });
    m.step(2);
    expect(s2.getItem(PLAYER_KEY_STORAGE)).toBeNull();
    m.leave('t2');
    const t2b = m.join('t2b', { local, session: s2 });
    m.until(() => t2b.game.loot.ready);
    expect(t2b.game.loot.owner).not.toBe(owner); // host từ chối khóa chung → tab 2 có khóa + túi riêng
    expect(s2.getItem(PLAYER_KEY_STORAGE)).not.toBe(local.getItem(PLAYER_KEY_STORAGE));
    m.step(20);
    expect(t1.game.loot.ready).toBe(true);
    expect(t1.game.loot.owner).toBe(owner);
    expect(t1.game.loot.inventory!.slots).toEqual(bag.slots);
    expect(m.server().loot.ownerOf('t1')).toBe(owner);
  });

  it('tab 1 ẩn lâu (không input, vẫn gửi điểm host) → tab mới cùng khóa không lấy được túi', () => {
    const { m, local, t1 } = browser();
    const owner = t1.game.loot.owner;
    m.hidden.add('t1');
    m.step(400); // 20 s ẩn
    const t3 = m.join('t3', { local, session: new MemStorage() });
    m.until(() => t3.game.loot.ready);
    expect(t3.game.loot.owner).not.toBe(owner);
    expect(m.server().loot.ownerOf('t1')).toBe(owner);
    m.hidden.delete('t1');
    m.step(10);
    expect(t1.game.loot.ready).toBe(true);
    expect(t1.game.loot.claimError).toBeNull();
  });

  it('tab 1 treo hẳn ≥ 10 s → tab mới lấy được túi; tab 1 được báo ngay "key_taken", không giành lại', () => {
    const { m, local, t1 } = browser();
    const owner = t1.game.loot.owner;
    const events: string[] = [];
    t1.game.loot.changed.on((e) => events.push(e.kind));
    m.frozen.add('t1');
    m.step(220);
    const t4 = m.join('t4', { local, session: new MemStorage() });
    m.until(() => t4.game.loot.ready);
    expect(t4.game.loot.owner).toBe(owner); // cùng khóa chung → lấy lại túi của tab đã treo
    m.frozen.delete('t1');
    m.step(40);
    expect(events).toContain('lost');
    expect(t1.game.loot.claimError).toBe('key_taken');
    expect(t1.game.loot.ready).toBe(false);
    expect(t1.game.loot.inventory).toBeNull();
    // không giành qua lại: túi vẫn ở tab 4
    m.step(100);
    expect(m.server().loot.ownerOf('t4')).toBe(owner);
    expect(t4.game.loot.ready).toBe(true);
  });
});
