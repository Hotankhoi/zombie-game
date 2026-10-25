import { describe, expect, it } from 'vitest';
import { SIM_TICK_MS } from '@shared/types';
import { GridMap } from './grid';
import { testZombie } from './testMaps';
import { SPECIAL } from './tuning/zombieKinds';
import { SimWorld, keyTile, tileKey } from './world';

const TICKS_PER_SEC = 1000 / SIM_TICK_MS;

/** Sân 20×9 có tường kín ở cột x = 10 (không cửa): người bên phải, zombie bên trái. */
function walledArena() {
  const m = new GridMap(20, 9, { x: 14.5, y: 4.5 });
  m.room(0, 0, 20, 9, { x: -1, y: -1 });
  for (let y = 0; y < 9; y++) m.setWall(10, y);
  return m;
}

function setup(kind: 'giant' | 'normal' | 'boss') {
  const w = new SimWorld({ seed: 'wall', map: walledArena(), zombieCount: 0 });
  w.addPlayer('a');
  w.zombies.push(testZombie(1, 7, 4.5, { kind, mode: 'chase', target: 'a', facing: 0 }));
  return w;
}

function runUntilBroken(w: SimWorld, maxSec: number) {
  const changes: { tick: number; x: number; y: number }[] = [];
  for (let t = 0; t < maxSec * TICKS_PER_SEC; t++) {
    w.step(new Map());
    for (const c of w.mapChanges) changes.push({ tick: w.tick, ...c });
  }
  return changes;
}

describe('khổng lồ phá tường', () => {
  it('khổng lồ đuổi người sau tường kín → húc vỡ tường (ô trống, flow field đi qua được), báo ô đã đổi', () => {
    const w = setup('giant');
    expect(w.blocked(10, 4)).toBe(true);
    const changes = runUntilBroken(w, 8);
    expect(changes.length).toBeGreaterThan(0);
    // mỗi ô chỉ báo đúng 1 lần, đều là tường cột 10 quanh hàng của khổng lồ
    const keys = changes.map((c) => `${c.x},${c.y}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of changes) expect(c.x).toBe(10);
    expect(w.blocked(10, 4)).toBe(false);
    expect(w.isWall(10, 4)).toBe(false);
    expect(w.isWall(10, 0)).toBe(true); // tường xa vẫn còn
    // vỡ sau khoảng wallHp / dps giây húc (cộng thời gian đi tới tường)
    const firstSec = (changes[0]!.tick - 0) / TICKS_PER_SEC;
    expect(firstSec).toBeGreaterThanOrEqual(SPECIAL.wallSmash.wallHp / SPECIAL.wallSmash.dps - 0.1);
    expect(firstSec).toBeLessThan(SPECIAL.wallSmash.wallHp / SPECIAL.wallSmash.dps + 3);
    // khổng lồ qua được bên kia
    const z = w.zombies[0]!;
    expect(z.x).toBeGreaterThan(10);
  });

  it('zombie thường không phá tường; Boss phá nhanh gấp đôi khổng lồ', () => {
    expect(runUntilBroken(setup('normal'), 8)).toHaveLength(0);
    const g = runUntilBroken(setup('giant'), 8)[0]!.tick;
    const b = runUntilBroken(setup('boss'), 8)[0]!.tick;
    expect(b).toBeLessThan(g);
  });

  it('tất định: cùng diễn biến → cùng hash, cùng danh sách ô vỡ', () => {
    const a = setup('giant');
    const b = setup('giant');
    runUntilBroken(a, 6);
    runUntilBroken(b, 6);
    expect(a.hash()).toBe(b.hash());
    expect(a.brokenWallList()).toEqual(b.brokenWallList());
  });

  it('tường vỡ và tường đang bị húc dở có trong state() và dựng lại đúng', () => {
    const w = setup('giant');
    runUntilBroken(w, 4.5); // vừa vỡ vài ô, có thể còn ô đang bị húc
    const s = w.state();
    expect(s.brokenWalls!.length).toBeGreaterThan(0);
    const r = new SimWorld({ seed: 'x', map: walledArena(), zombieCount: 0, restore: s });
    expect(r.brokenWallList()).toEqual(w.brokenWallList());
    expect(r.hash()).toBe(w.hash());
    for (const t of s.brokenWalls!) expect(r.blocked(t.x, t.y)).toBe(false);
  });

  it('khóa ô chính xác cả tọa độ âm và rất xa', () => {
    for (const [x, y] of [
      [0, 0],
      [-1, -1],
      [-32_000_000, 31_999_999],
      [12345, -678],
    ] as const) {
      expect(keyTile(tileKey(x, y))).toEqual({ x, y });
    }
  });
});
