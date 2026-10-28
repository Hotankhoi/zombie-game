import { describe, expect, it } from 'vitest';
import { GameMsg, encodeGame } from '@net/gameCodec';
import { decodeLoot, encodeLoot, isLootPacket } from '@net/lootCodec';
import { ownerIdOf } from '@net/playerKey';
import { chestLocations } from '@shared/mapgen/chests';
import { CHUNK_SIZE, generateChunk, worldSeedForRoom } from '@shared/mapgen/world';
import { buildSave, parseSave, restoreSave, type SaveFile } from '@shared/save/save';
import { MapgenSource } from '@shared/sim/mapgenSource';
import { testZombie } from '@shared/sim/testMaps';
import { LootMessage } from '@shared/types/loot';
import type { PeerId } from '@shared/types';
import { HostServer, type Outgoing, type SaveParts } from './hostServer';
import { TestMatch } from './testMatch';

const ROOM = 'SAVE01';
const SEED = worldSeedForRoom(ROOM);
const KEYS: Record<PeerId, string> = { pa: 'A'.repeat(22), pb: 'B'.repeat(22) };
let req = 0;

/** Trả lời mọi replica loot host gửi (ACK) — như máy khách thật, để loot được "mọi người xác nhận". */
function ack(server: HostServer, out: Outgoing[]): void {
  for (const o of out) {
    if (!isLootPacket(o.data)) continue;
    const p = decodeLoot(o.data);
    if (p?.type !== LootMessage.Replica) continue;
    const revision = 'patch' in p ? p.patch.revision : p.state.revision;
    server.receive(o.to, encodeLoot({ type: LootMessage.Ack, term: p.term, revision }));
  }
}
const input = (seq: number, moveX = 0) =>
  encodeGame({ type: GameMsg.Input, inputs: [{ seq, moveX, moveY: 0, aim: 0, buttons: 0 }] });
function step(server: HostServer, n = 1, move = 0): void {
  for (let i = 0; i < n; i++) {
    for (const id of Object.keys(KEYS)) server.receive(id, input(server.world.tick + 2, move));
    ack(server, server.tick());
  }
}
function join(server: HostServer, id: PeerId): void {
  server.receive(id, input(1));
  const action = { type: 'claim' as const, key: KEYS[id]!, resume: false };
  server.receive(
    id,
    encodeLoot({ type: LootMessage.Request, term: server.loot.term, requestId: 'c' + ++req, action }),
  );
}
const fresh = (saved?: ReturnType<typeof restoreSave>) =>
  new HostServer({
    seed: SEED,
    map: new MapgenSource(SEED),
    zombieCount: 0,
    ...(saved ? { saved: saved.world, loot: { restore: saved.loot } } : {}),
  });

/** Thế giới có đủ thứ cần lưu: ngày giờ, đợt tràn, tường vỡ/đang húc, cửa, zombie đang đuổi, rương đã mở, đồ trên đất. */
function playedWorld(): HostServer {
  const base = new HostServer({
    seed: SEED,
    map: new MapgenSource(SEED),
    zombieCount: 0,
    startTick: 15 * 13200 + 500,
  });
  const s = base.world.state();
  s.brokenWalls = [{ x: 3, y: 7 }];
  s.wallDamage = [{ x: 4, y: 7, hp: 42.5 }];
  s.brokenDoors = [{ x: 9, y: 2 }];
  s.openDoors = [
    { x: 9, y: 2 },
    { x: 11, y: 5 },
  ];
  const host = new HostServer({ seed: SEED, map: new MapgenSource(SEED), zombieCount: 0, restore: s });
  join(host, 'pa');
  join(host, 'pb');
  ack(host, host.tick());
  step(host, 30, 1);
  const pa = host.world.players.get('pa')!;
  host.world.zombies.push(
    testZombie(900, pa.x + 3, pa.y, { mode: 'chase', target: 'pa' }),
    testZombie(901, pa.x - 4, pa.y + 1, { turnedFrom: 'pb' }),
  );
  host.world.horde = {
    number: 1,
    active: false,
    startTick: 1,
    endTick: 2,
    quota: 150,
    spawned: 150,
    bosses: 1,
    bossesSpawned: 1,
    spawnBudget: 0,
    survived: true,
    kills: { pa: 7, pb: 2 },
    downs: { pb: 1 },
  };
  // rương gần điểm xuất phát: pa mở + lấy hết
  const sp = host.world.map.spawn;
  const cx = Math.floor(sp.x / CHUNK_SIZE),
    cy = Math.floor(sp.y / CHUNK_SIZE);
  const chest = [-1, 0, 1]
    .flatMap((dy) => [-1, 0, 1].map((dx) => generateChunk(SEED, cx + dx, cy + dy)))
    .flatMap(chestLocations)[0]!;
  const owner = host.loot.ownerOf('pa')!;
  const a = host.loot.authority;
  const actor = { id: owner, x: chest.x, y: chest.y, canInteract: true };
  const rev = () => ({
    expectedChestRevision: a.chest(chest.id)!.revision,
    expectedInventoryRevision: a.inventory(owner)!.revision,
  });
  expect(a.loot(actor, { type: 'open', chestId: chest.id, ...rev() }, () => true).ok).toBe(true);
  expect(a.loot(actor, { type: 'takeAll', chestId: chest.id, ...rev() }, () => true).ok).toBe(true);
  host.loot.spawnGround({ itemId: 'water', rarity: 'rare', quantity: 2 }, { x: pa.x + 1, y: pa.y });
  step(host, 25);
  return host;
}

describe('lưu game (GĐ 5): lưu → JSON → nạp → mã băm thế giới khớp', () => {
  it('khớp hash thế giới, loot giống hệt; file tất định, không chứa khóa/PeerId', () => {
    const a = playedWorld();
    const parts = a.saveParts()!;
    expect(parts).not.toBeNull();
    const hashA = a.world.hash();
    const lootA = a.loot.replica();
    expect(lootA.chests.length).toBeGreaterThan(0);
    expect(lootA.drops?.length).toBe(1);
    const file = buildSave(parts.world, parts.loot, { room: ROOM, savedAt: '2026-10-28T12:00:00.000Z' });
    const json = JSON.stringify(file);
    expect(json).not.toContain(KEYS.pa);
    expect(json).not.toMatch(/"pa"|"pb"/);
    expect(Object.keys(file.players).sort()).toEqual([ownerIdOf(KEYS.pa!), ownerIdOf(KEYS.pb!)].sort());
    expect(file.map.changes).toEqual([
      { x: 9, y: 2, kind: 'doorBroken' },
      { x: 9, y: 2, kind: 'doorOpen' },
      { x: 11, y: 5, kind: 'doorOpen' },
      { x: 3, y: 7, kind: 'wallBroken' },
      { x: 4, y: 7, kind: 'wallDamaged', hp: 42.5 },
    ]);

    const check = parseSave(json);
    if (!check.ok) throw new Error(check.error);
    const b = fresh(restoreSave(check.save));
    // chưa ai vào: đã có ngày giờ, đợt tràn, tường vỡ, zombie
    expect(b.world.tick).toBe(a.world.tick);
    expect(b.world.isWall(3, 7)).toBe(false);
    expect(b.world.horde?.survived).toBe(true);
    join(b, 'pa');
    join(b, 'pb');
    expect(b.world.hash()).toBe(hashA);
    expect(b.loot.replica()).toEqual(lootA);
    // lưu lại ngay (không chạy tick nào, chỉ ACK bản loot vừa gửi) → đúng file cũ (tất định)
    ack(
      b,
      b.loot.drain().map((o) => ({ ...o, channel: 'reliable' as const })),
    );
    const again = buildSave(b.saveParts()!.world, b.loot.replica(), { room: ROOM, savedAt: file.savedAt });
    expect(JSON.stringify(again)).toBe(json);
  });

  it('người chưa vào lại vẫn có nhân vật ở lần lưu sau; file hỏng/sai bị từ chối', () => {
    const a = playedWorld();
    const p = a.saveParts()!;
    const file = buildSave(p.world, p.loot, { room: ROOM, savedAt: 'x' });
    const b = fresh(restoreSave(file));
    join(b, 'pa');
    ack(b, b.tick());
    const next = b.saveParts()!;
    expect(next.world.players.map((x) => x.id).sort()).toEqual(Object.keys(file.players).sort());

    const bad = (f: Partial<SaveFile> | string) => parseSave(typeof f === 'string' ? f : { ...file, ...f });
    expect(bad('{oops')).toMatchObject({ ok: false });
    expect(bad({ format: 'x' as never })).toMatchObject({ ok: false });
    expect(bad({ saveVersion: 99 })).toMatchObject({ ok: false });
    expect(bad({ mapVersion: 99 })).toMatchObject({ ok: false });
    expect(bad({ seed: 'zombie-world:OTHER' })).toMatchObject({ ok: false });
    expect(bad({ loot: { version: 1, state: { ...file.loot.state, seed: 'nope' } } })).toMatchObject({
      ok: false,
    });
    expect(bad({ map: { version: 1, changes: [{ x: 1.5, y: 0, kind: 'wallBroken' }] } })).toMatchObject({
      ok: false,
    });
    expect(parseSave(JSON.stringify(file))).toMatchObject({ ok: true });
  });
});

describe('lưu game qua NetGame thật (trễ 150 ms + mất 5%)', () => {
  it('host tự gửi bản lưu; trận mới nạp bản lưu → người vào lại có túi + vị trí cũ', () => {
    const saves: SaveFile[] = [];
    const onSave = (parts: SaveParts) =>
      saves.push(buildSave(parts.world, parts.loot, { room: ROOM, savedAt: new Date(0).toISOString() }));
    const m = new TestMatch(ROOM, { latencyMs: 150, jitterMs: 0, loss: 0.05 });
    const nodes = ['n0', 'n1'].map((id, i) => m.join(id, String(i + 3).repeat(22), false, 0, { onSave }));
    m.until(() => nodes.every((n) => n.game.loot.ready));
    const n1 = nodes[1]!;
    m.place(n1.id, 40.25, 12.5);
    m.server().loot.hostUpdate(n1.game.loot.owner, (s) => ({
      ok: true,
      state: {
        ...s,
        slots: s.slots.map((x, i) => (i === 3 ? { itemId: 'rifle', rarity: 'epic', quantity: 1 } : x)),
        revision: s.revision + 1,
      },
    }));
    m.until(
      () => saves.at(-1)?.loot.state.inventories.some((i) => i.state.slots[3]?.itemId === 'rifle') ?? false,
      1400,
    );
    const file = saves.at(-1)!;
    expect(parseSave(JSON.stringify(file)).ok).toBe(true);

    const m2 = new TestMatch(ROOM, { latencyMs: 150, jitterMs: 0, loss: 0.05 });
    const host = m2.join('h2', String(3).repeat(22), false, 0, { saved: restoreSave(file) });
    m2.until(() => host.game.role === 'host');
    const back = m2.join('b2', String(4).repeat(22));
    m2.until(() => back.game.loot.ready && host.game.loot.ready);
    m2.step(10);
    expect(host.game.savedLoad).toBe('loaded');
    expect(back.game.loot.inventory!.slots[3]).toEqual({ itemId: 'rifle', rarity: 'epic', quantity: 1 });
    const p = m2.server().world.players.get('b2')!;
    expect(Math.hypot(p.x - 40.25, p.y - 12.5)).toBeLessThan(0.5);
    expect(m2.server().world.tick).toBeGreaterThan(file.tick);
  });
});
