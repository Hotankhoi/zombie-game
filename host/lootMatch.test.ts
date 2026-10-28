import { describe, expect, it } from 'vitest';
import type { LootOutcome } from '@net/clientLoot';
import { generateChest } from '@shared/loot/chest';
import { chestLocations, type ChestLocation } from '@shared/mapgen/chests';
import { generateChunk, worldSeedForRoom } from '@shared/mapgen/world';
import type { LootReplicaWire } from '@shared/types/loot';
import { TestMatch, type MatchNode } from './testMatch';

/**
 * Điều kiện hoàn thành của docs/loot-online-plan.md, chạy trên mạng giả: 4 NetGame thật, trễ 150ms mỗi chiều,
 * mất 5% gói unreliable (loot đi reliable). Mỗi test kiểm tra tổng đồ (mọi túi + mọi rương liên quan) không đổi.
 */
const ROOM = 'LOOTMATCH';
const seed = worldSeedForRoom(ROOM);
const near = [-1, 0, 1].flatMap((cy) =>
  [-1, 0, 1].flatMap((cx) => chestLocations(generateChunk(seed, cx, cy))),
);
const key = (id: string) => `match${id}`.padEnd(22, 'q').slice(0, 22);
const qty = (slots: readonly ({ quantity: number } | null)[] | undefined) =>
  (slots ?? []).reduce((n, s) => n + (s?.quantity ?? 0), 0);

function total(r: LootReplicaWire, list: readonly ChestLocation[] = near): number {
  let n = r.inventories.reduce((a, e) => a + qty(e.state.slots), 0);
  for (const c of list) {
    const stored = r.chests.find((x) => x.id === c.id);
    n += qty(stored ? stored.slots : generateChest(seed, c.id, c.region).slots);
  }
  return n;
}

function start(n = 4) {
  const m = new TestMatch(ROOM, { latencyMs: 150, jitterMs: 0, loss: 0.05 });
  const nodes: MatchNode[] = [];
  for (let i = 0; i < n; i++) nodes.push(m.join(`p${i}`, key(`p${i}`)));
  m.until(() => nodes.every((x) => x.game.loot.ready));
  return { m, nodes };
}

/** Chạy trận tới khi mọi promise xong. */
async function all<T>(m: TestMatch, ps: Promise<T>[], max = 600): Promise<T[]> {
  const out: (T | undefined)[] = ps.map(() => undefined);
  let left = ps.length;
  ps.forEach((p, i) =>
    p.then((v) => {
      out[i] = v;
      left--;
    }),
  );
  for (let i = 0; i < max && left > 0; i++) {
    m.step();
    await Promise.resolve();
  }
  if (left > 0) throw new Error('chưa đủ kết quả');
  return out as T[];
}

describe('loot online 4 người — trễ 150ms + mất 5% (NetGame thật trên LoopbackHub)', () => {
  it('4 người cùng thấy 1 rương; cùng lấy hết 1 lúc → đúng 1 người thành công, tổng đồ bảo toàn', async () => {
    const { m, nodes } = start();
    const chest = near[0]!;
    for (const n of nodes) m.place(n.id, chest.x, chest.y);
    const [opened] = await all(m, [nodes[0]!.game.loot.open(chest.id)]);
    expect(opened!.ok).toBe(true);
    m.step(10);
    // mọi người thấy cùng một rương (cùng revision, cùng đồ)
    const views = await all(
      m,
      nodes.map((n) => n.game.loot.view(chest.id)),
    );
    for (const v of views) expect(v.chest).toEqual(views[0]!.chest);
    const before = total(m.server().loot.replica());
    const results = await all(
      m,
      nodes.map((n) => n.game.loot.takeAll(chest.id)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    for (const r of results.filter((x) => !x.ok)) expect(r).toMatchObject({ error: 'stale_revision' });
    expect(total(m.server().loot.replica())).toBe(before);
    // ai cũng thấy rương rỗng, túi người thắng có đồ
    m.step(10);
    for (const n of nodes) expect(qty(n.game.loot.chest(chest.id)!.slots)).toBe(0);
  });

  it('2 người lấy cùng 1 ô (take) cùng lúc: 1 thành công, người kia giữ nguyên túi', async () => {
    const { m, nodes } = start(2);
    const chest = near[1]!;
    for (const n of nodes) m.place(n.id, chest.x, chest.y);
    const [o] = await all(m, [nodes[0]!.game.loot.open(chest.id)]);
    m.step(10);
    const slot = o!.chest!.slots.findIndex((s) => s !== null);
    const amount = o!.chest!.slots[slot]!.quantity;
    const before = total(m.server().loot.replica());
    const bags = nodes.map((n) => qty(n.game.loot.inventory!.slots));
    const res = await all(
      m,
      nodes.map((n) => n.game.loot.take(chest.id, slot, amount)),
    );
    expect(res.filter((r) => r.ok)).toHaveLength(1);
    const loser = res.findIndex((r) => !r.ok);
    expect(qty(res[loser]!.inventory!.slots)).toBe(bags[loser]);
    expect(total(m.server().loot.replica())).toBe(before);
  });

  it('túi đầy, lượng sai, yêu cầu lặp, revision cũ: bị từ chối, không mất/nhân đôi đồ', async () => {
    const { m, nodes } = start(2);
    // máy khách (không phải host): mọi gói đi qua mạng trễ
    const p = nodes.find((n) => n !== m.hostNode())!;
    const loot = p.game.loot;
    const before = total(m.server().loot.replica());
    // lấy hết các rương quanh đây tới khi túi đầy
    let full: LootOutcome | null = null;
    for (const c of near) {
      m.place(p.id, c.x, c.y);
      m.step(2);
      const [o] = await all(m, [loot.open(c.id)]);
      if (!o!.ok) continue;
      const [t] = await all(m, [loot.takeAll(c.id)]);
      if (!t!.ok && t!.error === 'inventory_full') {
        full = t!;
        // đồ vẫn nằm nguyên trong rương
        expect(qty(t!.chest!.slots)).toBeGreaterThan(0);
        break;
      }
    }
    expect(full).not.toBeNull();
    expect(total(m.server().loot.replica())).toBe(before);
    const c = full!.chest!;
    const slot = c.slots.findIndex((s) => s !== null);
    // lượng sai: nhiều hơn đang có trong ô
    const [wrong] = await all(m, [loot.take(c.id, slot, c.slots[slot]!.quantity + 1)]);
    expect(wrong!.ok).toBe(false);
    // revision cũ: lệnh panel giữ revision trước đó
    const [stale] = await all(m, [
      loot.command({
        type: 'take',
        chestId: c.id,
        slot,
        quantity: 1,
        expectedChestRevision: c.revision - 1,
        expectedInventoryRevision: loot.inventory!.revision,
      }),
    ]);
    expect(stale).toMatchObject({ ok: false, error: 'stale_revision' });
    // yêu cầu lặp: gói intent gửi 3 lần (mạng gửi trùng) → host làm đúng 1 lần
    const sent: Uint8Array[] = [];
    const opts = (loot as unknown as { opts: { send: (d: Uint8Array) => void } }).opts;
    const send = opts.send;
    opts.send = (d) => {
      sent.push(d);
      send(d);
    };
    const rev = m.server().loot.authority.currentRevision();
    const sorted = loot.sort();
    opts.send = send;
    send(sent[0]!);
    send(sent[0]!);
    const [ok] = await all(m, [sorted]);
    expect(ok!.ok).toBe(true);
    m.step(10);
    expect(m.server().loot.authority.currentRevision()).toBe(rev + 1);
    expect(m.server().loot.stats.duplicates).toBeGreaterThanOrEqual(2);
    expect(total(m.server().loot.replica())).toBe(before);
  });

  it('ngoài tầm, đang gục → bị từ chối, không lộ đồ trong rương ở xa (xuyên tường/cửa đóng: host/hostLoot.test.ts)', async () => {
    const { m, nodes } = start(2);
    const chest = near[2]!;
    const me = nodes.find((n) => n !== m.hostNode())!;
    const loot = me.game.loot;
    m.place(me.id, chest.x + 3, chest.y);
    const [far] = await all(m, [loot.open(chest.id)]);
    expect(far).toMatchObject({ ok: false, error: 'out_of_reach' });
    expect(loot.chest(chest.id)).toBeNull();
    m.place(me.id, chest.x, chest.y);
    m.server().world.players.get(me.id)!.downedFor = 20;
    const [down] = await all(m, [loot.open(chest.id)]);
    expect(down).toMatchObject({ ok: false, error: 'player_not_up' });
  });

  it('host rời khi 2 người đang nhặt cùng rương: không mất/nhân đôi; mọi người về cùng một trạng thái', async () => {
    const { m, nodes } = start(4);
    const chest = near[3]!;
    for (const n of nodes) m.place(n.id, chest.x, chest.y);
    const [o] = await all(m, [nodes[0]!.game.loot.open(chest.id)]);
    expect(o!.ok).toBe(true);
    m.step(10);
    const host = m.hostNode()!;
    const others = nodes.filter((n) => n !== host);
    const before = total(m.server().loot.replica());
    const ps = others.slice(0, 2).map((n) => n.game.loot.takeAll(chest.id));
    m.step(4); // yêu cầu đang trên đường / host vừa làm
    m.leave(host.id);
    const res = await all(m, ps);
    expect(res.every((r) => r.ok || r.error === 'host_changed' || r.error === 'stale_revision')).toBe(true);
    m.until(() => others.every((n) => n.game.loot.ready) && !!m.hostNode() && !m.server().loot.recovering);
    const after = m.server().loot.replica();
    expect(total(after)).toBe(before);
    m.step(20);
    // mọi máy về cùng bản của host mới
    for (const n of others) {
      expect(n.game.loot.replica!.revision).toBe(after.revision);
      const mine = after.inventories.find((e) => e.id === n.game.loot.owner)!.state;
      expect(n.game.loot.inventory).toEqual(mine);
    }
  });
});
