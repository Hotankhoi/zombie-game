import { describe, expect, it } from 'vitest';
import { ZOMBIE_NORMAL as Z } from '@shared/data/zombies';
import { SIM_TICK_MS } from '@shared/types';
import { darknessAt, dayClock, tickOfDay } from './dayNight';
import { arenaMap, GridMap } from './grid';
import { Btn, radToAim, type PlayerInput } from './input';
import { isDowned } from './player';
import { testZombie, twoRoomMap, DOOR } from './testMaps';
import { DAY, NOISE } from './tuning/night';
import { KIND, SPECIAL, ZOMBIE_KINDS } from './tuning/zombieKinds';
import { SimWorld } from './world';
import { canDetect } from './zombie';

const TPS = 1000 / SIM_TICK_MS;
const idle: PlayerInput = { seq: 0, moveX: 0, moveY: 0, aim: 0, buttons: 0 };

/** Sân trống 40×20 không tường trong (để đo tốc độ/tầm nhìn không bị cản). */
function field() {
  const m = new GridMap(40, 20, { x: 5.5, y: 10.5 });
  m.room(0, 0, 40, 20, { x: -1, y: -1 });
  return m;
}

function world(map = field(), tick = 0) {
  const w = new SimWorld({ seed: 'n', map, zombieCount: 0 });
  w.tick = tick;
  return w;
}

const NIGHT_TICK = tickOfDay(1) + Math.round((0.95 * DAY.lengthSec * 1000) / SIM_TICK_MS);

describe('ngày/đêm', () => {
  it('tick 0 = sáng ngày 1; nửa đêm tối hẳn; chuyển mượt lúc chạng vạng', () => {
    const c = dayClock(0);
    expect(c.day).toBe(1);
    expect(c.time).toBeCloseTo(DAY.startAt, 6);
    expect(c.darkness).toBe(0);
    expect(dayClock(NIGHT_TICK).darkness).toBe(1);
    expect(dayClock(NIGHT_TICK).night).toBe(true);
    let prev = 0;
    for (let t = DAY.duskStart; t <= DAY.nightStart; t += 0.005) {
      const d = darknessAt(t);
      expect(d).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = d;
    }
    expect(darknessAt((DAY.dawnStart + DAY.dawnEnd) / 2)).toBeCloseTo(0.5, 5);
  });

  it('đếm ngày: tickOfDay(n) là tick đầu của ngày n', () => {
    for (const d of [2, 5, 15, 16]) {
      expect(dayClock(tickOfDay(d)).day).toBe(d);
      expect(dayClock(tickOfDay(d) - 1).day).toBe(d - 1);
    }
  });

  it('ban đêm zombie đuổi nhanh hơn', () => {
    const run = (tick: number) => {
      const w = world(field(), tick);
      const p = w.addPlayer('p');
      p.x = 21; // trong tầm bỏ đuổi (loseRange)
      const z = testZombie(1, 10, 10.5, { mode: 'chase', target: 'p', facing: 0 });
      w.zombies.push(z);
      w.step(new Map());
      const x0 = z.x;
      for (let i = 0; i < 10; i++) w.step(new Map());
      return z.x - x0;
    };
    expect(run(NIGHT_TICK) / run(0)).toBeCloseTo(1.25, 1);
  });
});

describe('đèn pin', () => {
  it('nhấn F bật/tắt (theo cạnh nhấn, giữ không nháy)', () => {
    const w = world();
    const p = w.addPlayer('p');
    const f = { ...idle, buttons: Btn.Flashlight };
    w.step(new Map([['p', f]]));
    expect(p.flashlight).toBe(true);
    w.step(new Map([['p', f]]));
    expect(p.flashlight).toBe(true);
    w.step(new Map([['p', idle]]));
    w.step(new Map([['p', f]]));
    expect(p.flashlight).toBe(false);
  });

  it('ban đêm: zombie nhìn kém hơn, nhưng thấy người bật đèn từ rất xa (cả sau lưng)', () => {
    const w = world();
    const p = w.addPlayer('p');
    p.x = 20;
    const z = testZombie(1, 10, 10.5, { facing: 0 });
    // ban ngày: thấy ở 6 ô phía trước; ban đêm thì không
    p.x = 16;
    expect(canDetect(z, p, w.blocked, 0)).toBe(true);
    expect(canDetect(z, p, w.blocked, 1)).toBe(false);
    // bật đèn: thấy ở 12 ô, kể cả đứng sau lưng zombie
    p.flashlight = true;
    p.x = 22;
    expect(canDetect(z, p, w.blocked, 1)).toBe(true);
    z.facing = Math.PI;
    expect(canDetect(z, p, w.blocked, 1)).toBe(true);
    // ban ngày đèn không làm lộ thêm
    expect(canDetect(z, p, w.blocked, 0)).toBe(false);
  });
});

describe('tiếng ồn', () => {
  it('mở cửa: zombie lang thang trong bán kính đi tới xem, ngoài bán kính thì không', () => {
    const w = world(twoRoomMap());
    const p = w.addPlayer('p');
    p.x = DOOR.x - 0.5;
    p.y = DOOR.y + 0.5;
    p.facing = 0;
    const near = testZombie(1, DOOR.x - 3, DOOR.y + 3.5, { facing: Math.PI / 2 });
    const far = testZombie(2, 1.5, 1.5, { facing: Math.PI });
    w.zombies.push(near, far);
    w.step(new Map([['p', { ...idle, aim: radToAim(0), buttons: Btn.Interact }]]));
    expect(near.mode).toBe('investigate');
    expect(near.goalX).toBeCloseTo(DOOR.x + 0.5, 5);
    expect(far.mode).toBe('wander');
    expect(Math.hypot(far.x - DOOR.x, far.y - DOOR.y)).toBeGreaterThan(NOISE.doorToggle);
  });

  it('API emitNoise (cho súng của B): zombie đi tới chỗ tiếng ồn rồi thôi', () => {
    const w = world();
    const z = testZombie(1, 10, 10.5, { facing: Math.PI });
    w.zombies.push(z);
    w.emitNoise(15, 10.5, 8);
    w.step(new Map());
    expect(z.mode).toBe('investigate');
    for (let i = 0; i < 5 * TPS && z.mode === 'investigate'; i++) w.step(new Map());
    expect(Math.hypot(z.x - 15, z.y - 10.5)).toBeLessThan(1);
    expect(z.mode).toBe('wander');
  });

  it('chém trúng phát tiếng nhỏ; ám sát thì im lặng', () => {
    const w = world();
    const p = w.addPlayer('p');
    p.x = 10;
    p.y = 10.5;
    const target = testZombie(1, 10.9, 10.5, { facing: 0, hp: 1000 }); // nhìn ra xa: sau lưng → ám sát
    const listener = testZombie(2, 12.5, 12, { facing: Math.PI / 2 });
    w.zombies.push(target, listener);
    w.step(new Map([['p', { ...idle, aim: radToAim(0), buttons: Btn.Attack }]]));
    expect(target.hp).toBe(0);
    w.step(new Map());
    expect(listener.mode).toBe('wander');
  });
});

describe('các loại zombie', () => {
  it('sinh đủ loại theo tỉ lệ, tất định', () => {
    const make = () => new SimWorld({ seed: 'kinds', map: arenaMap(), zombieCount: 400 });
    const a = make();
    const counts = new Map<string, number>();
    for (const z of a.zombies) counts.set(z.kind, (counts.get(z.kind) ?? 0) + 1);
    // Boss chỉ đợt tràn (GĐ 5) sinh ra
    for (const k of ZOMBIE_KINDS) expect(counts.get(k) ?? 0)[k === 'boss' ? 'toBe' : 'toBeGreaterThan'](0);
    expect(counts.get('normal')!).toBeGreaterThan(counts.get('giant')!);
    expect(make().hash()).toBe(a.hash());
    expect(a.zombies.find((z) => z.kind === 'giant')!.hp).toBe(Z.maxHp * KIND.giant.hp);
  });

  it('zombie thét: phát hiện người thì thét, gọi zombie khác trong bán kính lớn', () => {
    const w = world();
    const p = w.addPlayer('p');
    p.x = 14;
    const s = testZombie(1, 10, 10.5, { kind: 'screamer', facing: 0 });
    const other = testZombie(2, 22, 5, { facing: Math.PI / 2 }); // cách ~13 ô: ngoài tầm nhìn, trong tiếng thét
    w.zombies.push(s, other);
    w.step(new Map());
    expect(s.mode).toBe('chase');
    w.step(new Map());
    expect(other.mode).toBe('investigate');
  });

  it('zombie phình chết → vũng độc; người đứng trong vũng mất máu', () => {
    const w = world();
    const p = w.addPlayer('p');
    w.addPlayer('q').x = 30; // có đồng đội → hết máu thì gục
    p.x = 10;
    p.y = 10.5;
    const b = testZombie(1, 10.8, 10.5, {
      kind: 'bloater',
      facing: Math.PI,
      hp: 1,
      mode: 'chase',
      target: 'p',
      biteCd: 9,
    });
    w.zombies.push(b);
    w.step(new Map([['p', { ...idle, aim: radToAim(0), buttons: Btn.Attack }]]));
    expect(w.zombies).toHaveLength(0);
    expect(w.pools).toHaveLength(1);
    expect(w.pools[0]!.kind).toBe('poison');
    const hp0 = p.hp;
    for (let i = 0; i < TPS; i++) w.step(new Map([['p', idle]]));
    expect(hp0 - p.hp).toBeCloseTo(SPECIAL.bloaterPool.dps, 0);
    for (let i = 0; i < 20 * TPS; i++) w.step(new Map([['p', idle]]));
    expect(w.pools).toHaveLength(0);
    expect(isDowned(p) || p.hp < hp0).toBe(true);
  });

  it('zombie phun axit: vũng rơi vào chỗ người đứng, chỉ gây sát thương sau thời gian bay (né được)', () => {
    const w = world();
    const p = w.addPlayer('p');
    p.x = 15;
    const s = testZombie(1, 10, 10.5, { kind: 'spitter', facing: 0, mode: 'chase', target: 'p' });
    w.zombies.push(s);
    w.step(new Map());
    expect(w.pools).toHaveLength(1);
    expect(w.pools[0]).toMatchObject({ kind: 'acid', x: 15 });
    expect(w.pools[0]!.armIn).toBeGreaterThan(0);
    // chạy khỏi vũng trước khi axit rơi xuống → không mất máu
    const hp0 = p.hp;
    for (let i = 0; i < SPECIAL.spit.flightSec * TPS; i++) {
      w.step(new Map([['p', { ...idle, moveY: 1, buttons: Btn.Sprint }]]));
    }
    w.step(new Map([['p', idle]]));
    expect(p.hp).toBe(hp0);
  });

  it('zombie trốn: nằm im, không lộ; người tới gần thì lao ra (tăng tốc) và đuổi', () => {
    const w = world();
    const p = w.addPlayer('p');
    p.x = 20;
    const h = testZombie(1, 10, 10.5, { kind: 'hider', hidden: true });
    w.zombies.push(h);
    for (let i = 0; i < TPS; i++) w.step(new Map());
    expect(h.hidden).toBe(true);
    expect(h.x).toBe(10);
    p.x = 12;
    w.step(new Map());
    expect(h.hidden).toBe(false);
    expect(h.mode).toBe('chase');
    expect(h.burstFor).toBeGreaterThan(0);
  });

  it('khổng lồ phá cửa đóng để tới người; cửa vỡ không đóng lại được', () => {
    const w = world(twoRoomMap());
    const p = w.addPlayer('p');
    p.x = DOOR.x + 3;
    p.y = DOOR.y + 0.5;
    const g = testZombie(1, DOOR.x - 2.5, DOOR.y + 0.5, {
      kind: 'giant',
      mode: 'chase',
      target: 'p',
      facing: 0,
    });
    w.zombies.push(g);
    for (let i = 0; i < 4 * TPS && !w.doors.isOpen(DOOR.x, DOOR.y); i++) w.step(new Map());
    expect(w.doors.isOpen(DOOR.x, DOOR.y)).toBe(true);
    w.zombies = [];
    p.x = DOOR.x - 0.5;
    p.facing = 0;
    w.step(new Map([['p', { ...idle, aim: radToAim(0), buttons: Btn.Interact }]]));
    expect(w.doors.isOpen(DOOR.x, DOOR.y)).toBe(true);
  });

  it('state() → restore giữ vũng, cửa vỡ, tiếng ồn chờ → chạy tiếp cùng mã băm', () => {
    const w = world();
    const p = w.addPlayer('p');
    p.x = 15;
    w.zombies.push(testZombie(1, 10, 10.5, { kind: 'spitter', facing: 0, mode: 'chase', target: 'p' }));
    w.zombies.push(testZombie(2, 30, 10.5, { kind: 'screamer' }));
    w.step(new Map());
    w.emitNoise(30, 10, 5);
    const b = new SimWorld({ seed: 'x', map: field(), zombieCount: 0, restore: w.state() });
    expect(b.hash()).toBe(w.hash());
    for (let i = 0; i < 60; i++) {
      w.step(new Map());
      b.step(new Map());
    }
    expect(b.hash()).toBe(w.hash());
  });
});
