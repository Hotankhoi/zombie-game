import { describe, expect, it } from 'vitest';
import { arenaMap } from '@shared/sim/grid';
import { testZombie } from '@shared/sim/testMaps';
import { Btn } from '@shared/sim/input';
import { SimWorld, type WorldState } from '@shared/sim/world';
import type { ZombieState } from '@shared/sim/zombie';
import {
  BackupParts,
  decodeBackup,
  decodeBackupPart,
  encodeBackup,
  encodeBackupPart,
  mergeBackup,
  WORLD_BACKUP_MSG,
} from './worldBackup';

function played(ticks = 120): SimWorld {
  const w = new SimWorld({ seed: 'bk', map: arenaMap(), zombieCount: 30 });
  w.addPlayer('a');
  w.addPlayer('b');
  const input = { seq: 0, moveX: 1, moveY: 0, aim: 10, buttons: Btn.Attack | Btn.Sprint };
  for (let t = 0; t < ticks; t++) w.step(new Map([['a', input]]));
  return w;
}

const zombie = (id: number, x: number, y: number, extra: Partial<ZombieState> = {}): ZombieState =>
  testZombie(id, x, y, extra);

describe('worldBackup', () => {
  it('mã hóa/giải mã giữ đủ trạng thái (vị trí zombie sai ≤ 1/64 ô), gói hỏng → null', () => {
    const s = played().state();
    const buf = encodeBackup(s);
    expect(buf[0]).toBe(WORLD_BACKUP_MSG);
    const d = decodeBackup(buf)!;
    expect(d.tick).toBe(s.tick);
    expect(d.rngState).toBe(s.rngState);
    expect(d.nextZombieId).toBe(s.nextZombieId);
    // mọi số của người chơi ghi f32, trừ vị trí (f64)
    const f32 = (p: (typeof s.players)[number]) =>
      Object.fromEntries(
        Object.entries(p).map(([k, v]) => [
          k,
          typeof v === 'number' && k !== 'x' && k !== 'y' ? Math.fround(v) : v,
        ]),
      );
    expect(d.players).toEqual(s.players.map(f32));
    expect(d.zombies.map((z) => z.id)).toEqual(s.zombies.map((z) => z.id));
    for (let i = 0; i < s.zombies.length; i++) {
      expect(Math.abs(d.zombies[i]!.x - s.zombies[i]!.x)).toBeLessThanOrEqual(1 / 64 + 1e-9);
      expect(Math.abs(d.zombies[i]!.hp - s.zombies[i]!.hp)).toBeLessThanOrEqual(0.05 + 1e-9);
      expect(d.zombies[i]!.mode).toBe(s.zombies[i]!.mode);
      expect(d.zombies[i]!.target).toBe(s.zombies[i]!.target);
    }
    expect(d.openDoors).toEqual(s.openDoors);
    expect(d.flowTargets).toEqual(s.flowTargets);
    for (let n = 1; n < buf.length; n++) expect(decodeBackup(buf.subarray(0, n))).toBeNull();
  });

  it('chia mẩu: ghép đủ mẩu = y hệt cả gói; mỗi zombie đúng 1 mẩu; phần chung chỉ ở mẩu 0', () => {
    const s = played().state();
    s.openDoors = [{ x: 3, y: 4 }];
    s.brokenWalls = [{ x: 9, y: 9 }];
    const N = 7;
    const bufs = Array.from({ length: N }, (_, k) => encodeBackupPart(s, k, N));
    const whole = decodeBackup(encodeBackup(s))!;
    const store = new BackupParts();
    // nhận lộn thứ tự
    for (const k of [3, 6, 0, 1, 5, 2, 4]) expect(store.receive(bufs[k]!)).toBe(true);
    expect(store.have).toBe(N);
    expect(store.assemble()).toEqual(whole);
    for (let k = 1; k < N; k++) {
      const p = decodeBackupPart(bufs[k]!)!;
      expect(p.part).toBe(k);
      expect(p.state.openDoors).toEqual([]);
      expect(p.state.brokenWalls).toEqual([]);
      expect(p.state.zombies.every((z) => z.id % N === k)).toBe(true);
      expect(p.state.players).toHaveLength(s.players.length);
    }
  });

  it('chưa có mẩu 0 → chưa có bản lưu; thiếu mẩu khác → ghép phần đang có; mẩu mới thay mẩu cũ', () => {
    const s = played().state();
    const N = 4;
    const store = new BackupParts();
    store.receive(encodeBackupPart(s, 1, N));
    expect(store.assemble()).toBeNull();
    store.receive(encodeBackupPart(s, 0, N));
    const got = store.assemble()!;
    expect(got.zombies.map((z) => z.id)).toEqual(s.zombies.filter((z) => z.id % N <= 1).map((z) => z.id));
    // mẩu 1 mới hơn (zombie đã chết hết) thay mẩu cũ
    store.receive(encodeBackupPart({ ...s, zombies: s.zombies.filter((z) => z.id % N !== 1) }, 1, N));
    expect(store.assemble()!.zombies.every((z) => z.id % N === 0)).toBe(true);
    // gói dư rác cuối = hỏng
    const buf = encodeBackupPart(s, 2, N);
    expect(decodeBackupPart(Uint8Array.from([...buf, 0]))).toBeNull();
    expect(decodeBackupPart(buf)).not.toBeNull();
  });

  it('zombie gọn: dự phòng đúng khi rất xa gốc (f32), máu lớn, id lớn, đích riêng, xác đồng đội', () => {
    const s = played(1).state();
    const base = s.players[0]!;
    s.zombies = [
      zombie(3, base.x + 5.3, base.y - 2.2, { goalX: base.x + 9.1, goalY: base.y, hp: 2.34 }),
      zombie(4_000_000_000, base.x + 5000.125, base.y + 1, {
        hp: 99_999.5,
        turnedFrom: 'a',
        mode: 'chase',
        target: 'b',
      }),
    ];
    const d = decodeBackup(encodeBackup(s))!;
    const [a, b] = d.zombies;
    expect(a!.id).toBe(3);
    expect(Math.abs(a!.goalX - (base.x + 9.1))).toBeLessThanOrEqual(1 / 64);
    expect(a!.hp).toBeCloseTo(2.3, 5);
    expect(b!.id).toBe(4_000_000_000);
    expect(b!.x).toBe(Math.fround(base.x + 5000.125));
    expect(b!.hp).toBe(99_999.5);
    expect(b!.turnedFrom).toBe('a');
    expect([b!.mode, b!.target]).toEqual(['chase', 'b']);
    expect(a!.turnedFrom).toBeNull();
  });

  it('200 zombie ≈ 6 KB mỗi 10 giây (~0.6 KB/s)', () => {
    const s = played(1).state();
    s.zombies = Array.from({ length: 200 }, (_, i) => zombie(i, i, i));
    expect(encodeBackup(s).length).toBeLessThan(200 * 30 + 400);
  });

  it('dựng lại SimWorld từ bản lưu chạy tiếp được, đủ số zombie', () => {
    const d = decodeBackup(encodeBackup(played().state()))!;
    const w = new SimWorld({ seed: 'x', map: arenaMap(), zombieCount: 30, restore: d });
    for (let t = 0; t < 50; t++) w.step(new Map());
    expect(w.zombies).toHaveLength(30);
  });

  it('ghép: trong vùng theo snapshot (chết thì bỏ, mới thì thêm id mới), ngoài vùng giữ bản lưu', () => {
    const backup: WorldState = {
      tick: 100,
      rngState: 7,
      nextZombieId: 70000,
      players: [
        { ...played(1).players.get('a')!, x: 10, y: 10 },
        { ...played(1).players.get('b')!, x: 50, y: 50 },
      ],
      zombies: [
        zombie(65537, 12, 12, { hp: 40 }), // trong vùng, còn sống (snapshot có id 1)
        zombie(2, 13, 13), // trong vùng, snapshot không có → đã chết
        zombie(3, 200, 200, { hp: 10, mode: 'chase', target: 'b' }), // ngoài vùng
      ],
      openDoors: [
        { x: 11, y: 11 },
        { x: 300, y: 300 },
      ],
      flowTargets: [],
      flowDirty: false,
    };
    const fresh: WorldState = {
      tick: 150,
      rngState: 1,
      nextZombieId: 9,
      players: [{ ...backup.players[0]!, x: 14, y: 10 }],
      zombies: [zombie(1, 15, 15, { mode: 'chase', target: 'a' }), zombie(8, 9, 9)],
      openDoors: [{ x: 12, y: 10 }],
      flowTargets: [],
      flowDirty: true,
    };
    const m = mergeBackup(backup, fresh, { x: 14, y: 10, radius: 32 }, new Set(['a']))!;
    expect(m.tick).toBe(150);
    expect(m.players.map((p) => [p.id, p.x])).toEqual([['a', 14]]);
    const byId = new Map(m.zombies.map((z) => [z.id, z]));
    expect(byId.get(65537)).toMatchObject({ x: 15, y: 15, hp: 40, mode: 'chase', target: 'a' });
    expect(byId.has(2)).toBe(false);
    // người b đã rời → zombie đang đuổi b quay về lang thang
    expect(byId.get(3)).toMatchObject({ hp: 10, mode: 'wander', target: null });
    expect(byId.get(70000)).toMatchObject({ x: 9, y: 9 });
    expect(m.nextZombieId).toBe(70001);
    expect(m.openDoors).toEqual([
      { x: 300, y: 300 },
      { x: 12, y: 10 },
    ]);
    expect(m.flowTargets).toEqual([{ x: 14, y: 10 }]);
  });

  it('ghép: giữ máu đã mất, zombie nấp, zombie ngoài vùng gửi đủ, cửa phá, vũng, đợt tràn, xác', () => {
    const base = played(1).state();
    const a = { ...base.players.find((p) => p.id === 'a')!, x: 10, y: 10 };
    const backup: WorldState = {
      ...base,
      tick: 100,
      nextZombieId: 50,
      players: [a],
      zombies: [
        zombie(1, 12, 12, { hp: 80 }), // snapshot biết máu 30 (sự kiện hit) → 30
        zombie(2, 13, 13, { hidden: true }), // đang nấp: snapshot không gửi → vẫn còn
        zombie(3, 25, 10), // trong vùng quan tâm nhưng ngoài vùng gửi đủ (quá ngân sách) → vẫn còn
        zombie(4, 11, 11), // trong vùng gửi đủ, snapshot không có → đã chết
      ],
      openDoors: [],
      pools: [
        { id: 5, kind: 'poison', x: 3, y: 3, radius: 1, ttl: 10, armIn: 0, dps: 5 },
        { id: 6, kind: 'acid', x: 4, y: 4, radius: 1, ttl: 1, armIn: 0, dps: 5 }, // hết hạn khi ghép
      ],
      nextPoolId: 7,
      brokenDoors: [{ x: 40, y: 40 }],
      noises: [],
      horde: {
        number: 1,
        active: true,
        startTick: 0,
        endTick: 9999,
        quota: 150,
        spawned: 90,
        bosses: 1,
        bossesSpawned: 0,
        spawnBudget: 0,
        survived: null,
        kills: { a: 12 },
        downs: {},
      },
      corpses: [{ player: 'c', x: 5, y: 5, turnIn: 6 }],
    };
    const fresh: WorldState = {
      ...base,
      tick: 140, // 2 giây sau bản lưu
      nextZombieId: 9,
      players: [{ ...a, x: 11 }],
      zombies: [zombie(1, 12.5, 12, { hp: 30 })],
      openDoors: [],
      corpses: [{ player: 'd', x: 7, y: 7, turnIn: 3 }],
    };
    const area = { x: 11, y: 10, radius: 32, zombieRadius: 8 };
    const m = mergeBackup(backup, fresh, area, new Set(['a']))!;
    const byId = new Map(m.zombies.map((z) => [z.id, z]));
    expect(byId.get(1)).toMatchObject({ x: 12.5, hp: 30 });
    expect(byId.has(2)).toBe(true);
    expect(byId.has(3)).toBe(true);
    expect(byId.has(4)).toBe(false);
    expect(m.pools!.map((p) => [p.id, p.ttl])).toEqual([[5, 8]]);
    expect(m.nextPoolId).toBe(7);
    expect(m.brokenDoors).toEqual([{ x: 40, y: 40 }]);
    expect(m.horde).toMatchObject({ number: 1, active: true, kills: { a: 12 } });
    expect(m.corpses!.map((c) => [c.player, c.turnIn])).toEqual([
      ['d', 3],
      ['c', 4],
    ]);
  });

  it('snapshot cũ hơn bản lưu (mất gói) → không lùi về snapshot, dùng bản lưu', () => {
    const s = played(40).state();
    const older = { ...played(10).state(), players: s.players.map((p) => ({ ...p, x: p.x - 5 })) };
    const m = mergeBackup(s, older, { x: 0, y: 0, radius: 32 }, new Set(['a', 'b']))!;
    expect(m.tick).toBe(s.tick);
    expect(m.players.map((p) => p.x)).toEqual(s.players.map((p) => p.x));
    expect(m.zombies).toHaveLength(s.zombies.length);
  });

  it('tường vỡ + tường đang bị húc dở có trong bản lưu; ghép gộp tường vỡ của cả hai bên', () => {
    const s = played(5).state();
    s.brokenWalls = [
      { x: 3, y: -4 },
      { x: -100000, y: 7 },
    ];
    s.wallDamage = [{ x: 5, y: 5, hp: 42.5 }];
    const d = decodeBackup(encodeBackup(s))!;
    expect(d.brokenWalls).toEqual(s.brokenWalls);
    expect(d.wallDamage).toEqual(s.wallDamage);
    const fresh = {
      ...played(10).state(),
      brokenWalls: [
        { x: 3, y: -4 },
        { x: 9, y: 9 },
      ],
    };
    const m = mergeBackup(d, fresh, { x: 0, y: 0, radius: 32 }, new Set(['a', 'b']))!;
    expect(m.brokenWalls).toEqual([
      { x: 3, y: -4 },
      { x: -100000, y: 7 },
      { x: 9, y: 9 },
    ]);
    expect(m.wallDamage).toEqual([{ x: 5, y: 5, hp: 42.5 }]);
  });

  it('bản lưu khác phiên bản bố cục → bỏ qua (null), không đọc lệch', () => {
    const buf = encodeBackup(played(5).state());
    buf[1] = (buf[1]! + 1) & 255;
    expect(decodeBackup(buf)).toBeNull();
  });

  it('không có bản lưu → dùng snapshot; không có snapshot → bản lưu (lọc người đã rời)', () => {
    const s = played(10).state();
    expect(mergeBackup(null, s, null, new Set(['a']))).toBe(s);
    const only = mergeBackup(s, null, null, new Set(['a']))!;
    expect(only.players.map((p) => p.id)).toEqual(['a']);
  });
});
