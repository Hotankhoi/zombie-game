import { describe, expect, it } from 'vitest';
import { PLAYER } from '@shared/data/player';
import { ZOMBIE_NORMAL } from '@shared/data/zombies';
import { Rng } from '@shared/util/rng';
import { createPlayer } from './player';
import { DOOR, twoRoomMap } from './testMaps';
import { SimWorld } from './world';
import { canDetect, createZombie, startChase } from './zombie';

const open = () => false;

describe('phát hiện người chơi', () => {
  it('thấy người ở phía trước, không thấy khi đứng sau lưng (đi bộ)', () => {
    const p = createPlayer('p', { x: 5, y: 5 });
    const z = createZombie(1, 8, 5, new Rng(1));
    z.facing = Math.PI; // nhìn về phía người
    expect(canDetect(z, p, open)).toBe(true);
    z.facing = 0; // quay lưng
    expect(canDetect(z, p, open)).toBe(false);
  });

  it('nghe tiếng chạy ở gần dù đứng sau lưng', () => {
    const p = createPlayer('p', { x: 5, y: 5 });
    const z = createZombie(1, 8, 5, new Rng(1));
    z.facing = 0;
    p.sprinting = true;
    expect(canDetect(z, p, open)).toBe(true);
  });

  it('không thấy xuyên tường', () => {
    const m = twoRoomMap();
    const p = createPlayer('p', { x: 6.5, y: 2.5 });
    const z = createZombie(1, 10.5, 2.5, new Rng(1));
    z.facing = Math.PI;
    expect(canDetect(z, p, (x, y) => m.isWall(x, y) || m.isDoor(x, y))).toBe(false);
  });
});

describe('zombie đuổi theo', () => {
  function setup() {
    const w = new SimWorld({ seed: 7, map: twoRoomMap(), zombieCount: 0 });
    const p = w.addPlayer('p');
    p.x = 3.5;
    p.y = 4.5;
    const z = createZombie(1, 12.5, 4.5, new Rng(2));
    w.zombies.push(z);
    startChase(z, 'p');
    const idle = new Map();
    return { w, p, z, idle };
  }

  it('dừng trước cửa đóng', () => {
    const { w, z, idle } = setup();
    for (let i = 0; i < 100; i++) w.step(idle);
    expect(z.x).toBeGreaterThan(DOOR.x + 1 + ZOMBIE_NORMAL.radius - 0.01);
  });

  it('đi qua cửa mở tới cắn người', () => {
    const { w, p, z, idle } = setup();
    w.doors.set(DOOR.x, DOOR.y, true);
    let bitten = false;
    for (let i = 0; i < 100 && !bitten; i++) {
      w.step(idle);
      bitten = w.events.some((e) => e.type === 'bite');
    }
    expect(bitten).toBe(true);
    expect(z.x).toBeLessThan(DOOR.x);
    expect(p.hp).toBe(PLAYER.maxHp - ZOMBIE_NORMAL.biteDamage);
  });

  it('cắn hết máu → chết, hồi sinh ở điểm xuất phát sau respawnSec', () => {
    const { w, p, z, idle } = setup();
    p.hp = ZOMBIE_NORMAL.biteDamage;
    p.x = 10.5;
    z.x = 11.2;
    z.y = 4.5;
    let ticks = 0;
    while (!w.events.some((e) => e.type === 'death') && ticks++ < 40) w.step(idle);
    expect(p.respawnIn).toBeCloseTo(PLAYER.respawnSec, 5);
    for (let i = 0; i < PLAYER.respawnSec * 20 + 1; i++) w.step(idle);
    expect(p.respawnIn).toBe(0);
    expect(p.hp).toBe(PLAYER.maxHp);
    expect(p.stamina).toBe(PLAYER.maxStamina);
    expect(p.x).toBe(w.map.spawn.x);
  });
});
