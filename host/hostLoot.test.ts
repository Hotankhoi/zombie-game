import { describe, expect, it } from 'vitest';
import { GameMsg, encodeGame } from '@net/gameCodec';
import { applyLootPatch, decodeLoot, encodeLoot, isLootPacket, isValidReplica } from '@net/lootCodec';
import { chestLocations, type ChestLocation } from '@shared/mapgen/chests';
import { generateChunk, worldSeedForRoom } from '@shared/mapgen/world';
import { hasLineOfSight } from '@shared/sim/collision';
import type { MapSource } from '@shared/sim/grid';
import { MapgenSource } from '@shared/sim/mapgenSource';
import type { PeerId } from '@shared/types';
import { LootMessage, type LootAction, type LootReplicaWire, type LootReply } from '@shared/types/loot';
import { ownerIdOf } from '@net/playerKey';
import { BACKUP_EVERY, HostServer } from './hostServer';
import { WORLD_BACKUP_MSG, decodeBackupPart } from '@net/worldBackup';
import { LOOT_RESEND_TICKS, termEpoch } from './hostLoot';

const seed = worldSeedForRoom('LOOTHOST');
/** playerKey cố định cho test (22 ký tự base64url). */
export const testKey = (id: string) => `k${id}`.padEnd(22, '0').slice(0, 22);
const own = (id: string) => ownerIdOf(testKey(id));

/** Máy khách loot tối giản để thử host: giữ replica, ACK, ghi kết quả theo requestId. */
class RawPeer {
  replica: LootReplicaWire | null = null;
  term: string | null = null;
  replies = new Map<string, LootReply>();
  /** Không ACK (giả lập máy chậm). */
  mute = false;
  acks = 0;
  key: string;
  private n = 0;
  constructor(
    readonly id: PeerId,
    private host: HostServer,
  ) {
    this.key = testKey(id);
  }
  receive(data: Uint8Array) {
    const p = decodeLoot(data);
    if (!p) return;
    if (p.type === LootMessage.Replica) {
      const next = 'patch' in p ? this.replica && applyLootPatch(this.replica, p.patch) : p.state;
      if (!next || !isValidReplica(next, seed)) return;
      this.replica = next;
      const fresh = p.term !== this.term;
      this.term = p.term;
      if (fresh) this.send({ type: 'claim', key: this.key, resume: false }, 'claim');
      if (!this.mute) {
        this.acks++;
        this.host.receive(
          this.id,
          encodeLoot({ type: LootMessage.Ack, term: p.term, revision: next.revision }),
        );
      }
    } else if (p.type === LootMessage.Reply) this.replies.set(p.requestId, p);
  }
  send(action: LootAction, requestId = `r${++this.n}`): string {
    this.host.receive(
      this.id,
      encodeLoot({ type: LootMessage.Request, term: this.term ?? 'none', requestId, action }),
    );
    return requestId;
  }
  bag(): number {
    return items(this.replica!.inventories.find((e) => e.id === ownerIdOf(this.key))!.state.slots);
  }
}

const items = (slots: readonly ({ quantity: number } | null)[]) =>
  slots.reduce((n, s) => n + (s?.quantity ?? 0), 0);

function admit(host: HostServer, ids: PeerId[]) {
  for (const id of ids)
    host.receive(
      id,
      encodeGame({ type: GameMsg.Input, inputs: [{ seq: 1, moveX: 0, moveY: 0, aim: 0, buttons: 0 }] }),
    );
}

function setup(ids: PeerId[], map: MapSource = new MapgenSource(seed)) {
  const host = new HostServer({ seed, map, zombieCount: 0 });
  const peers = new Map(ids.map((id) => [id, new RawPeer(id, host)]));
  let tick = 0;
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      for (const o of host.tick()) if (isLootPacket(o.data)) peers.get(o.to)?.receive(o.data);
      tick++;
    }
  };
  // vào trận = gửi input lần đầu
  admit(host, ids);
  step(3); // bản đầy đủ → claim → xác nhận
  const chest = chestLocations(generateChunk(seed, 0, 0))[0]!;
  const place = (id: PeerId, x: number, y: number) => {
    const p = host.world.players.get(id)!;
    p.x = x;
    p.y = y;
  };
  for (const id of ids) place(id, chest.x, chest.y);
  return {
    host,
    peers,
    step,
    chest,
    place,
    get tick() {
      return tick;
    },
  };
}

function chestTotal(r: LootReplicaWire, c: ChestLocation, fallback: number) {
  const stored = r.chests.find((x) => x.id === c.id);
  return stored ? items(stored.slots) : fallback;
}

describe('HostLoot – loot trong HostServer', () => {
  it('người vào trận nhận bản đầy đủ (term có số lần lên host), túi có dao; term khác nhau mỗi lần lên host', () => {
    const { host, peers } = setup(['a', 'b']);
    const a = peers.get('a')!;
    expect(a.term).toBe(host.loot.term);
    expect(termEpoch(a.term)).toBe(1);
    expect(a.replica!.inventories.map((e) => e.id).sort()).toEqual([own('a'), own('b')].sort());
    expect(a.replies.get('claim')).toMatchObject({ ok: true });
    // replica chỉ có ownerId, không có playerKey
    expect(JSON.stringify(a.replica)).not.toContain(a.key);
    expect(a.bag()).toBe(1);
    const other = new HostServer({ seed, map: new MapgenSource(seed), zombieCount: 0, loot: { epoch: 4 } });
    expect(other.loot.term).not.toBe(host.loot.term);
    expect(termEpoch(other.loot.term)).toBe(4);
  });

  it('mở + lấy: kết quả chỉ tới SAU khi mọi người trong trận ACK; phần đổi tới mọi người; đồ bảo toàn', () => {
    const { host, peers, step, chest } = setup(['a', 'b']);
    const a = peers.get('a')!;
    const b = peers.get('b')!;
    b.mute = true;
    const r1 = a.send({
      type: 'open',
      chestId: chest.id,
      expectedChestRevision: 0,
      expectedInventoryRevision: 1,
    });
    step();
    expect(a.replies.has(r1)).toBe(false); // b chưa ACK
    b.mute = false;
    step(LOOT_RESEND_TICKS + 2); // host gửi lại bản đầy đủ cho b → b ACK
    expect(a.replies.get(r1)).toMatchObject({ ok: true, chest: { opened: true } });
    const opened = a.replies.get(r1)!.chest!;
    const total = items(opened.slots) + a.bag() + b.bag();
    const r2 = a.send({
      type: 'takeAll',
      chestId: chest.id,
      expectedChestRevision: opened.revision,
      expectedInventoryRevision: a.replies.get(r1)!.inventory!.revision,
    });
    step();
    step();
    expect(a.replies.get(r2)).toMatchObject({ ok: true });
    expect(b.replica!.revision).toBe(host.loot.authority.currentRevision());
    expect(items(b.replica!.chests.find((c) => c.id === chest.id)!.slots)).toBe(0);
    expect(a.bag() + b.bag()).toBe(total);
  });

  it('hai người cùng lấy 1 rương cùng lúc: chỉ 1 thành công, người kia nhận stale_revision + trạng thái mới', () => {
    const { peers, step, chest } = setup(['a', 'b']);
    const a = peers.get('a')!;
    const b = peers.get('b')!;
    const open = a.send({
      type: 'open',
      chestId: chest.id,
      expectedChestRevision: 0,
      expectedInventoryRevision: 1,
    });
    step(2);
    const rev = a.replies.get(open)!.chest!.revision;
    const total = items(a.replies.get(open)!.chest!.slots) + a.bag() + b.bag();
    const ra = a.send({
      type: 'takeAll',
      chestId: chest.id,
      expectedChestRevision: rev,
      expectedInventoryRevision: 1,
    });
    const rb = b.send({
      type: 'takeAll',
      chestId: chest.id,
      expectedChestRevision: rev,
      expectedInventoryRevision: 1,
    });
    step(2);
    expect(a.replies.get(ra)!.ok).toBe(true);
    const lost = b.replies.get(rb)!;
    expect(lost).toMatchObject({ ok: false, error: 'stale_revision' });
    expect(items(lost.chest!.slots)).toBe(0);
    expect(lost.inventory!.revision).toBe(1);
    expect(a.bag() + b.bag() + chestTotal(a.replica!, chest, 0)).toBe(total);
  });

  it('yêu cầu lặp (cùng requestId) không làm lại, gửi lại đúng kết quả cũ; revision cũ/lượng sai không đổi gì', () => {
    const { host, peers, step, chest } = setup(['a']);
    const a = peers.get('a')!;
    const open = {
      type: 'open',
      chestId: chest.id,
      expectedChestRevision: 0,
      expectedInventoryRevision: 1,
    } as const;
    a.send(open, 'same');
    step(2);
    const first = a.replies.get('same')!;
    const slot = first.chest!.slots.findIndex((s) => s !== null);
    const take = {
      ...open,
      type: 'take',
      slot,
      quantity: 1,
      expectedChestRevision: first.chest!.revision,
    } as const;
    a.send(take, 'take1');
    step(2);
    const rev = host.loot.authority.currentRevision();
    a.send(take, 'take1');
    a.send(take, 'take1');
    step();
    expect(host.loot.authority.currentRevision()).toBe(rev);
    expect(host.loot.stats.duplicates).toBe(2);
    expect(a.replies.get('take1')!.ok).toBe(true);
    // cùng nội dung nhưng requestId mới → revision cũ, bị từ chối
    a.send(take, 'take2');
    const after = a.replies.get('take1')!;
    const fresh = {
      expectedChestRevision: after.chest!.revision,
      expectedInventoryRevision: after.inventory!.revision,
    };
    a.send({ ...take, ...fresh, quantity: 60 }, 'big');
    a.send({ ...take, slot: 5, quantity: 1, expectedChestRevision: 99 }, 'old');
    step();
    expect(a.replies.get('take2')).toMatchObject({ ok: false, error: 'stale_revision' });
    expect(a.replies.get('big')!.ok).toBe(false); // lượng sai (hoặc ô đã hết)
    expect(a.replies.get('old')).toMatchObject({ ok: false, error: 'stale_revision' });
    expect(host.loot.authority.currentRevision()).toBe(rev);
  });

  it('từ chối: ngoài tầm, xuyên tường/cửa đóng, đang gục, chưa vào trận, term cũ; không lộ đồ trong rương', () => {
    const door = doorBetween();
    const { host, peers, step, chest, place } = setup(['a', 'b'], door.map);
    const a = peers.get('a')!;
    const open = {
      type: 'open',
      chestId: chest.id,
      expectedChestRevision: 0,
      expectedInventoryRevision: 1,
    } as const;
    const before = host.loot.authority.currentRevision();
    place('a', chest.x + 5, chest.y);
    const far = a.send(open);
    // trong tầm với nhưng cửa đóng che (map có thêm 1 ô cửa giữa người và rương)
    place('b', door.player.x, door.player.y);
    const blocked = peers.get('b')!.send(open);
    step();
    expect(a.replies.get(far)).toMatchObject({ ok: false, error: 'out_of_reach' });
    expect(a.replies.get(far)!.chest).toBeUndefined();
    expect(peers.get('b')!.replies.get(blocked)).toMatchObject({ ok: false, error: 'blocked' });
    expect(peers.get('b')!.replies.get(blocked)!.chest).toBeUndefined();
    // mở cửa → nhìn thấy → mở rương được
    host.world.doors.set(door.tile.x, door.tile.y, true);
    const through = peers.get('b')!.send({ type: 'view', chestId: chest.id });
    step();
    expect(peers.get('b')!.replies.get(through)!.ok).toBe(true);
    host.world.doors.set(door.tile.x, door.tile.y, false);
    place('a', chest.x, chest.y);
    host.world.players.get('a')!.downedFor = 10;
    const downed = a.send(open);
    step();
    expect(a.replies.get(downed)).toMatchObject({ ok: false, error: 'player_not_up' });
    host.world.players.get('a')!.downedFor = 0;
    // term cũ: bỏ qua, không trả lời
    a.term = '0.old';
    const stale = a.send(open);
    // người không có trong trận (chưa gửi input): bỏ qua
    host.receive(
      'stranger',
      encodeLoot({ type: LootMessage.Request, term: host.loot.term, requestId: 'x', action: open }),
    );
    step();
    expect(a.replies.has(stale)).toBe(false);
    expect(host.loot.authority.currentRevision()).toBe(before);
    expect(host.tick().some((o) => o.to === 'stranger')).toBe(false);
  });

  it('xem (view) không lưu rương; mỗi người chỉ sửa túi của mình; giới hạn tần suất', () => {
    const { host, peers, step, chest } = setup(['a', 'b']);
    const a = peers.get('a')!;
    const v = a.send({ type: 'view', chestId: chest.id });
    step();
    expect(a.replies.get(v)).toMatchObject({ ok: true, chest: { revision: 0, opened: false } });
    expect(host.loot.replica().chests).toHaveLength(0);
    const mv = a.send({ type: 'move', expectedRevision: 1, from: 0, to: 3, quantity: 1 });
    step(2);
    expect(a.replies.get(mv)!.ok).toBe(true);
    expect(host.loot.authority.inventory(own('a'))!.slots[3]).not.toBeNull();
    expect(host.loot.authority.inventory(own('b'))!.slots[0]).not.toBeNull();
    const ids = Array.from({ length: 30 }, () => a.send({ type: 'inventory' }));
    step();
    const limited = ids.filter((id) => a.replies.get(id)?.error === 'rate_limited');
    expect(limited.length).toBeGreaterThanOrEqual(30 - 20);
    expect(ids.filter((id) => a.replies.get(id)?.ok).length).toBeGreaterThan(0);
  });

  it('người rời trận: không còn chặn xác nhận; túi vẫn giữ trong bản lưu', () => {
    const { host, peers, step, chest } = setup(['a', 'b']);
    const a = peers.get('a')!;
    peers.get('b')!.mute = true;
    const r = a.send({
      type: 'open',
      chestId: chest.id,
      expectedChestRevision: 0,
      expectedInventoryRevision: 1,
    });
    step();
    expect(a.replies.has(r)).toBe(false);
    host.removePeer('b');
    step();
    expect(a.replies.get(r)!.ok).toBe(true);
    expect(host.loot.replica().inventories.map((e) => e.id)).toContain(own('b'));
  });
});

describe('HostLoot – playerKey (claim)', () => {
  it('vào lại bằng cùng khóa (PeerId mới) → đúng túi cũ; chưa claim → unknown_player; khóa sai → invalid_key', () => {
    const { host, peers, step, chest } = setup(['a']);
    const a = peers.get('a')!;
    const o = a.send({
      type: 'open',
      chestId: chest.id,
      expectedChestRevision: 0,
      expectedInventoryRevision: 1,
    });
    step(2);
    const all = a.send({
      type: 'takeAll',
      chestId: chest.id,
      expectedChestRevision: a.replies.get(o)!.chest!.revision,
      expectedInventoryRevision: 1,
    });
    step(2);
    expect(a.replies.get(all)!.ok).toBe(true);
    const bag = a.bag();
    host.removePeer('a');
    // tải lại trang: PeerId mới, cùng khóa
    const again = new RawPeer('a2', host);
    again.key = a.key;
    const rawLate = new RawPeer('late', host);
    rawLate.key = 'shortkey'; // không đúng dạng playerKey
    const peersMap = new Map([
      ['a2', again],
      ['late', rawLate],
    ]);
    admit(host, ['a2', 'late']);
    for (let i = 0; i < 3; i++)
      for (const out of host.tick()) if (isLootPacket(out.data)) peersMap.get(out.to)?.receive(out.data);
    expect(again.replies.get('claim')).toMatchObject({ ok: true });
    expect(again.replies.get('claim')!.inventory!.slots.reduce((n, s) => n + (s?.quantity ?? 0), 0)).toBe(
      bag,
    );
    expect(rawLate.replies.get('claim')).toMatchObject({ ok: false, error: 'invalid_key' });
    const unclaimed = rawLate.send({ type: 'inventory' }, 'inv');
    for (let i = 0; i < 3; i++)
      for (const out of host.tick()) if (isLootPacket(out.data)) peersMap.get(out.to)?.receive(out.data);
    expect(rawLate.replies.get(unclaimed)).toMatchObject({ ok: false, error: 'unknown_player' });
  });

  it('2 kết nối cùng khóa: đang dùng → key_in_use; tải lại (resume) hoặc kết nối cũ im 3s → lấy được túi', () => {
    const { host, peers, step } = setup(['a', 'b']);
    const b = peers.get('b')!;
    b.send({ type: 'claim', key: peers.get('a')!.key, resume: false }, 'steal');
    step(3);
    expect(b.replies.get('steal')).toMatchObject({ ok: false, error: 'invalid_key' }); // b đã có túi riêng
    const { host: h2, peers: p2, step: s2 } = setup(['x', 'y']);
    const y = p2.get('y')!;
    const x = p2.get('x')!;
    // y chưa claim gì: thử khóa của x
    h2.loot.removePeer('y');
    h2.loot.admit('y');
    s2(1);
    y.key = x.key;
    y.send({ type: 'claim', key: x.key, resume: false }, 'c1');
    s2(3);
    expect(y.replies.get('c1')).toMatchObject({ ok: false, error: 'key_in_use' });
    y.send({ type: 'claim', key: x.key, resume: true }, 'c2');
    s2(3);
    expect(y.replies.get('c2')).toMatchObject({ ok: true });
    expect(h2.loot.ownerOf('x')).toBeNull(); // x mất túi (tab cũ)
    void host;
  });

  it('phòng đã có 4 túi → người thứ 5 (khóa mới) nhận inventory_limit, túi cũ không bị xóa', () => {
    const { host, peers, step } = setup(['a', 'b', 'c', 'd']);
    host.removePeer('d');
    const e = new RawPeer('e', host);
    peers.set('e', e);
    admit(host, ['e']);
    step(3);
    expect(e.replies.get('claim')).toMatchObject({ ok: false, error: 'inventory_limit' });
    expect(host.loot.replica().inventories).toHaveLength(4);
  });
});

describe('HostLoot – lên thay host cũ (thu bản replica trước khi nhận ghi)', () => {
  /** Thế giới cũ: a mở + lấy hết 1 rương (bản này a và b đều giữ). */
  function oldWorld() {
    const { host, peers, step, chest } = setup(['a', 'b']);
    const a = peers.get('a')!;
    const o = a.send({
      type: 'open',
      chestId: chest.id,
      expectedChestRevision: 0,
      expectedInventoryRevision: 1,
    });
    step(2);
    a.send({
      type: 'takeAll',
      chestId: chest.id,
      expectedChestRevision: a.replies.get(o)!.chest!.revision,
      expectedInventoryRevision: 1,
    });
    step(2);
    return { term: host.loot.term, a: peers.get('a')!.replica!, b: peers.get('b')!.replica!, chest };
  }

  it('chờ bản của mọi người, chọn bản mới nhất (kể cả khi host mới chưa có bản nào), epoch tăng', () => {
    const old = oldWorld();
    const host = new HostServer({
      seed,
      map: new MapgenSource(seed),
      zombieCount: 0,
      loot: { recover: { expected: ['n', 'b'] } },
    });
    const n = new RawPeer('n', host);
    const b = new RawPeer('b', host);
    b.key = testKey('b');
    const peers = new Map([
      ['n', n],
      ['b', b],
    ]);
    admit(host, ['n', 'b']);
    const tickAll = () => {
      for (const o of host.tick()) if (isLootPacket(o.data)) peers.get(o.to)?.receive(o.data);
    };
    // n là người mới (chưa có bản nào): gửi bản rỗng; b gửi bản cũ
    const empty = { version: 1 as const, seed, revision: 0, inventories: [], chests: [] };
    host.receive('n', encodeLoot({ type: LootMessage.Replica, term: '0.none', state: empty }));
    tickAll();
    expect(host.loot.recovering).toBe(true);
    expect(n.term).toBeNull(); // chưa nhận ghi, chưa gửi bản nào
    host.receive('b', encodeLoot({ type: LootMessage.Replica, term: old.term, state: old.b }));
    tickAll();
    expect(host.loot.recovering).toBe(false);
    expect(termEpoch(host.loot.term)).toBe(termEpoch(old.term) + 1);
    expect(n.replica).toEqual(old.b);
    // n (người mới) claim → thêm 1 túi; mọi thứ cũ giữ nguyên
    expect(host.loot.replica().inventories).toHaveLength(old.b.inventories.length + 1);
    tickAll();
    tickAll();
    // b lấy lại đúng túi (cùng khóa)
    expect(b.replies.get('claim')!.inventory).toEqual(
      old.b.inventories.find((e) => e.id === ownerIdOf(testKey('b')))!.state,
    );
    expect(chestTotal(n.replica!, old.chest, -1)).toBe(0); // rương đã lấy không hồi đồ
  });

  it('người trong danh sách không gửi bản → hết 3s vẫn lên với bản tốt nhất đang có; gói thường bị bỏ khi đang thu', () => {
    const old = oldWorld();
    const host = new HostServer({
      seed,
      map: new MapgenSource(seed),
      zombieCount: 0,
      loot: { recover: { expected: ['a', 'gone'], timeoutTicks: 60 } },
    });
    admit(host, ['a']);
    host.receive('a', encodeLoot({ type: LootMessage.Replica, term: old.term, state: old.a }));
    host.receive(
      'a',
      encodeLoot({ type: LootMessage.Request, term: 'x', requestId: 'r', action: { type: 'inventory' } }),
    );
    for (let i = 0; i < 59; i++) host.tick();
    expect(host.loot.recovering).toBe(true);
    host.tick();
    host.tick();
    expect(host.loot.recovering).toBe(false);
    expect(host.loot.replica()).toEqual(old.a);
  });

  it('mẩu 0 của bản sao lưu 125 mang bản loot đầy đủ (đúng term, đúng revision vừa phát)', () => {
    const { host, peers, step } = setup(['a']);
    step(BACKUP_EVERY);
    const parts: ReturnType<typeof decodeBackupPart>[] = [];
    for (let i = 0; i < BACKUP_EVERY; i++)
      for (const o of host.tick()) {
        if (o.data[0] === WORLD_BACKUP_MSG) parts.push(decodeBackupPart(o.data));
        else if (isLootPacket(o.data)) peers.get(o.to)?.receive(o.data);
      }
    const zero = parts.find((p) => p?.part === 0)!;
    expect(parts.filter((p) => p && p.part !== 0).every((p) => p!.loot === null)).toBe(true);
    const block = decodeLoot(zero.loot!);
    expect(block).toMatchObject({ type: LootMessage.Replica, term: host.loot.term });
    expect(block && 'state' in block && block.state).toEqual(host.loot.replica());
  });
});

/**
 * Map thật + thêm 1 ô cửa (đóng) giữa rương đầu tiên và một chỗ đứng cách rương ~1.9 ô (trong tầm với 2 ô):
 * thử host dùng đúng `world.blocked` (tường + cửa đóng) để xét đường nhìn.
 */
function doorBetween() {
  const base = new MapgenSource(seed);
  const c = chestLocations(generateChunk(seed, 0, 0))[0]!;
  const tx = Math.floor(c.x);
  const ty = Math.floor(c.y);
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    if (base.tileKind(tx + dx, ty + dy) !== 0 || base.tileKind(tx + 2 * dx, ty + 2 * dy) !== 0) continue;
    const tile = { x: tx + dx, y: ty + dy };
    const kind = (x: number, y: number) => (x === tile.x && y === tile.y ? 2 : base.tileKind(x, y));
    const map: MapSource = {
      spawn: base.spawn,
      spawns: base.spawns,
      isWall: (x, y) => kind(x, y) === 1,
      isDoor: (x, y) => kind(x, y) === 2,
      tileKind: kind,
      isRoad: (x, y) => base.isRoad(x, y),
    };
    expect(hasLineOfSight(c, { x: c.x + 1.9 * dx, y: c.y + 1.9 * dy }, () => false)).toBe(true);
    return { map, tile, player: { x: c.x + 1.9 * dx, y: c.y + 1.9 * dy } };
  }
  throw new Error('rương không có 2 ô trống liền kề');
}
