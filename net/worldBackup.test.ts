import { describe, expect, it } from 'vitest';
import { arenaMap } from '@shared/sim/grid';
import { testZombie } from '@shared/sim/testMaps';
import { Btn } from '@shared/sim/input';
import { SimWorld, type WorldState } from '@shared/sim/world';
import type { ZombieState } from '@shared/sim/zombie';
import { decodeBackup, encodeBackup, mergeBackup, WORLD_BACKUP_MSG } from './worldBackup';

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
  it('mã hóa/giải mã giữ đủ trạng thái (vị trí zombie float32), gói hỏng → null', () => {
    const s = played().state();
    const buf = encodeBackup(s);
    expect(buf[0]).toBe(WORLD_BACKUP_MSG);
    const d = decodeBackup(buf)!;
    expect(d.tick).toBe(s.tick);
    expect(d.rngState).toBe(s.rngState);
    expect(d.nextZombieId).toBe(s.nextZombieId);
    expect(d.players).toEqual(
      s.players.map((p) => ({
        ...p,
        facing: Math.fround(p.facing),
        hp: Math.fround(p.hp),
        stamina: Math.fround(p.stamina),
        staminaIdle: Math.fround(p.staminaIdle),
        attackCd: Math.fround(p.attackCd),
        respawnIn: Math.fround(p.respawnIn),
      })),
    );
    expect(d.zombies.map((z) => z.id)).toEqual(s.zombies.map((z) => z.id));
    for (let i = 0; i < s.zombies.length; i++) {
      expect(d.zombies[i]!.x).toBeCloseTo(s.zombies[i]!.x, 4);
      expect(d.zombies[i]!.mode).toBe(s.zombies[i]!.mode);
      expect(d.zombies[i]!.target).toBe(s.zombies[i]!.target);
    }
    expect(d.openDoors).toEqual(s.openDoors);
    expect(d.flowTargets).toEqual(s.flowTargets);
    for (let n = 1; n < buf.length; n++) expect(decodeBackup(buf.subarray(0, n))).toBeNull();
  });

  it('200 zombie ≈ 10 KB mỗi 10 giây (~1 KB/s)', () => {
    const s = played(1).state();
    s.zombies = Array.from({ length: 200 }, (_, i) => zombie(i, i, i));
    expect(encodeBackup(s).length).toBeLessThan(200 * 53 + 400);
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

  it('không có bản lưu → dùng snapshot; không có snapshot → bản lưu (lọc người đã rời)', () => {
    const s = played(10).state();
    expect(mergeBackup(null, s, null, new Set(['a']))).toBe(s);
    const only = mergeBackup(s, null, null, new Set(['a']))!;
    expect(only.players.map((p) => p.id)).toEqual(['a']);
  });
});
