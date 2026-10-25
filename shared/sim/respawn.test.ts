import { describe, expect, it } from 'vitest';
import { isRoadTile, worldSeedForRoom } from '@shared/mapgen/world';
import { SIM_TICK_MS } from '@shared/types';
import type { PlayerInput } from './input';
import { MapgenSource } from './mapgenSource';
import { isAlive, type PlayerState } from './player';
import { testZombie } from './testMaps';
import { PARTY } from './tuning/party';
import { SimWorld } from './world';

const TICKS_PER_SEC = 1000 / SIM_TICK_MS;
const SEED = worldSeedForRoom('HOISINH');
const idle: PlayerInput = { seq: 0, moveX: 0, moveY: 0, aim: 0, buttons: 0 };

function run(w: SimWorld, ticks: number, ids: string[]) {
  for (let t = 0; t < ticks; t++) w.step(new Map(ids.map((id) => [id, idle])));
}

/** Giết hẳn `p` rồi chạy tới khi hồi sinh. */
function killAndRespawn(w: SimWorld, p: PlayerState, ids: string[]) {
  p.hp = 0;
  p.downedFor = 0.01;
  for (let t = 0; t < 20 * TICKS_PER_SEC && isAlive(p); t++) run(w, 1, ids);
  expect(isAlive(p)).toBe(false);
  for (let t = 0; t < 20 * TICKS_PER_SEC && !isAlive(p); t++) run(w, 1, ids);
  expect(isAlive(p)).toBe(true);
}

const minZombieDist = (w: SimWorld, p: PlayerState) =>
  Math.min(...w.zombies.filter((z) => z.hp > 0).map((z) => Math.hypot(z.x - p.x, p.y - z.y)));

describe('hồi sinh an toàn', () => {
  it('bầy zombie vây điểm xuất phát → hồi sinh trên ô đường gần đồng đội, không zombie trong bán kính', () => {
    const map = new MapgenSource(SEED);
    const w = new SimWorld({ seed: SEED, map, zombieCount: 0 });
    const a = w.addPlayer('a');
    const b = w.addPlayer('b');
    // b đứng xa trên đường ngang của chunk (0,0) — ô đường cách điểm xuất phát 40 ô sang phải (chunk kế)
    b.x = map.spawn.x + 40;
    b.y = map.spawn.y;
    // 30 zombie đứng yên quanh điểm xuất phát (chờ lâu mới cắn để không làm b gục)
    for (let i = 0; i < 30; i++) {
      const ang = (i / 30) * Math.PI * 2;
      w.zombies.push(
        testZombie(100 + i, map.spawn.x + Math.cos(ang) * 3, map.spawn.y + Math.sin(ang) * 3, {
          biteCd: 999,
        }),
      );
    }
    killAndRespawn(w, a, ['b']);
    expect(isRoadTile(Math.floor(a.x), Math.floor(a.y))).toBe(true);
    expect(minZombieDist(w, a)).toBeGreaterThanOrEqual(PARTY.respawnSafeRadius - 2); // zombie đi lang thang chút
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(Math.hypot(a.x - map.spawn.x, a.y - map.spawn.y));
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(6);
  });

  it('không còn ai: hồi sinh gần điểm xuất phát nhưng ngoài bán kính zombie', () => {
    const map = new MapgenSource(SEED);
    const w = new SimWorld({ seed: SEED, map, zombieCount: 0 });
    const a = w.addPlayer('a');
    w.zombies.push(testZombie(7, map.spawn.x, map.spawn.y, { biteCd: 999 }));
    killAndRespawn(w, a, []);
    const d = Math.hypot(a.x - map.spawn.x, a.y - map.spawn.y);
    expect(d).toBeGreaterThanOrEqual(PARTY.respawnSafeRadius - 1);
    expect(d).toBeLessThan(PARTY.respawnSafeRadius + 3);
    expect(isRoadTile(Math.floor(a.x), Math.floor(a.y))).toBe(true);
  });

  it(`vừa hồi sinh: bất tử ${PARTY.respawnShieldSec}s (zombie cắn không mất máu), hết bảo vệ thì mất máu`, () => {
    const map = new MapgenSource(SEED);
    const w = new SimWorld({ seed: SEED, map, zombieCount: 0 });
    const a = w.addPlayer('a');
    killAndRespawn(w, a, ['a']);
    expect(a.shield).toBeGreaterThan(PARTY.respawnShieldSec - 0.2);
    w.zombies.push(testZombie(9, a.x + 0.6, a.y, { mode: 'chase', target: 'a', facing: Math.PI }));
    run(w, (PARTY.respawnShieldSec - 0.5) * TICKS_PER_SEC, ['a']);
    expect(a.hp).toBe(100);
    run(w, 3 * TICKS_PER_SEC, ['a']);
    expect(a.shield).toBe(0);
    expect(a.hp).toBeLessThan(100);
  });

  it('tất định: cùng trạng thái → cùng chỗ hồi sinh', () => {
    const go = () => {
      const map = new MapgenSource(SEED);
      const w = new SimWorld({ seed: SEED, map, zombieCount: 80 });
      const a = w.addPlayer('a');
      w.addPlayer('b');
      run(w, 40, ['a', 'b']);
      killAndRespawn(w, a, ['b']);
      return w.hash();
    };
    expect(go()).toBe(go());
  });
});
