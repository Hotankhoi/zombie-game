import { describe, expect, it } from 'vitest';
import { SIM_TICK_MS } from '@shared/types';
import { tickOfDay } from './dayNight';
import { GridMap } from './grid';
import { Btn, radToAim, type PlayerInput } from './input';
import { isAlive } from './player';
import { testZombie } from './testMaps';
import { BOSS, HORDE } from './tuning/horde';
import { DAY } from './tuning/night';
import { SimWorld } from './world';

const TPS = 1000 / SIM_TICK_MS;
const idle: PlayerInput = { seq: 0, moveX: 0, moveY: 0, aim: 0, buttons: 0 };
const nightOf = (day: number) =>
  tickOfDay(day) + Math.ceil((DAY.nightStart * DAY.lengthSec * 1000) / SIM_TICK_MS);

/** Sân trống 90×90 (đủ chỗ sinh zombie đợt tràn cách 20–29 ô), người chơi ở giữa. */
function arena(tick: number, zombieCount = 5) {
  const m = new GridMap(90, 90, { x: 45.5, y: 45.5 });
  m.room(0, 0, 90, 90, { x: -1, y: -1 });
  const w = new SimWorld({ seed: 'horde', map: m, zombieCount });
  w.tick = tick;
  const p = w.addPlayer('a');
  return { w, p };
}

/** Giữ người chơi sống (bất tử) để đo director, không bị zombie cắn chết giữa chừng. */
function run(w: SimWorld, ticks: number, immortal = true) {
  for (let i = 0; i < ticks; i++) {
    w.step(new Map([['a', idle]]));
    if (immortal) for (const p of w.players.values()) p.hp = 100;
  }
}

describe('đợt tràn (GĐ 5)', () => {
  it('chưa tới đêm ngày 15 thì không có; tối hẳn ngày 15 thì đợt 1 bắt đầu', () => {
    const { w } = arena(nightOf(15) - 2);
    run(w, 1);
    expect(w.horde).toBeNull();
    run(w, 2);
    expect(w.horde).toMatchObject({ number: 1, active: true, quota: HORDE.baseCount, bosses: 1 });
    // ban đêm các ngày khác không có đợt tràn
    const other = arena(nightOf(14) + 5).w;
    run(other, 5);
    expect(other.horde).toBeNull();
  });

  it('sinh dồn dần quanh người chơi, không tính vào dân số thường; có Boss sau 30%', () => {
    const { w, p } = arena(nightOf(15), 5);
    run(w, TPS);
    const horde = w.zombies.filter((z) => z.horde);
    expect(horde.length).toBeGreaterThanOrEqual(HORDE.spawnPerSec - 1);
    expect(horde.length).toBeLessThanOrEqual(HORDE.spawnPerSec + 1);
    // dân số thường vẫn giữ nguyên
    expect(w.zombies.filter((z) => !z.horde)).toHaveLength(5);
    expect(w.zombies.some((z) => z.kind === 'boss')).toBe(false);
    run(w, Math.ceil((HORDE.baseCount * HORDE.bossAt) / HORDE.spawnPerSec) * TPS);
    expect(w.zombies.some((z) => z.kind === 'boss' && z.horde)).toBe(true);
    // zombie đợt tràn kéo về phía người chơi
    const d0 = Math.hypot(horde[0]!.x - p.x, horde[0]!.y - p.y);
    expect(d0).toBeLessThan(HORDE.spawnMaxDist + 1);
  });

  it('giết hết → thắng, có bảng thành tích (zombie giết theo người)', () => {
    const { w, p } = arena(nightOf(15), 0);
    run(w, 1);
    const h = w.horde!;
    h.spawned = h.quota; // coi như đã sinh hết, chỉ còn vài con
    h.bossesSpawned = h.bosses;
    w.zombies = [
      testZombie(500, p.x + 0.9, p.y, { horde: true, hp: 1, facing: Math.PI, mode: 'chase', target: 'a' }),
    ];
    w.step(new Map([['a', { ...idle, aim: radToAim(0), buttons: Btn.Attack }]]));
    run(w, 1);
    expect(h.active).toBe(false);
    expect(h.survived).toBe(true);
    expect(h.kills['a']).toBe(1);
    expect(w.hordeRemaining()).toBe(0);
  });

  it('trời sáng hẳn thì đợt tràn kết thúc dù còn zombie; zombie còn lại thành zombie thường', () => {
    const { w } = arena(nightOf(15), 0);
    run(w, 2 * TPS);
    w.tick = w.horde!.endTick;
    run(w, 1);
    expect(w.horde!.active).toBe(false);
    expect(w.horde!.survived).toBe(true);
    expect(w.zombies.every((z) => !z.horde)).toBe(true);
  });

  it('cả đội chết hẳn → thất bại', () => {
    const { w, p } = arena(nightOf(15), 0);
    run(w, 1);
    p.hp = 0;
    p.respawnIn = 3;
    run(w, 1, false);
    expect(w.horde!.active).toBe(false);
    expect(w.horde!.survived).toBe(false);
  });

  it('mỗi đợt mạnh hơn: đợt 2 (ngày 30) nhiều zombie + 2 Boss; tối đa 500', () => {
    const { w } = arena(nightOf(30), 0);
    run(w, 2);
    expect(w.horde).toMatchObject({ number: 2, quota: HORDE.baseCount + HORDE.perHorde, bosses: 2 });
    const late = arena(nightOf(150), 0).w;
    run(late, 2);
    expect(late.horde!.quota).toBe(HORDE.maxCount);
    expect(late.horde!.bosses).toBe(HORDE.maxBosses);
  });

  it('Boss đập đất: người trong tầm mất máu', () => {
    const { w, p } = arena(0, 0);
    w.addPlayer('b').x = p.x + 40;
    const boss = testZombie(9, p.x + 2.8, p.y, {
      kind: 'boss',
      mode: 'chase',
      target: 'a',
      facing: Math.PI,
      biteCd: 9,
    });
    w.zombies.push(boss);
    w.step(new Map());
    expect(p.hp).toBe(100 - BOSS.slamDamage);
    expect(boss.slamCd).toBeGreaterThan(0);
  });

  it('tất định: cùng tick bắt đầu + cùng input → cùng mã băm; state() → restore chạy tiếp khớp', () => {
    const play = () => {
      const { w } = arena(nightOf(15), 10);
      run(w, 5 * TPS);
      return w;
    };
    const a = play();
    expect(play().hash()).toBe(a.hash());
    const b = new SimWorld({ seed: 'x', map: a.map, zombieCount: 10, restore: a.state() });
    expect(b.hash()).toBe(a.hash());
    for (let i = 0; i < 40; i++) {
      a.step(new Map([['a', idle]]));
      b.step(new Map([['a', idle]]));
    }
    expect(b.hash()).toBe(a.hash());
    expect(isAlive(a.players.get('a')!)).toBe(isAlive(b.players.get('a')!));
  });
});
