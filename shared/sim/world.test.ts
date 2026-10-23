import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZOMBIE_NORMAL } from '@shared/data/zombies';
import { Rng } from '@shared/util/rng';
import { arenaMap } from './grid';
import { Btn, type PlayerInput } from './input';
import { SimWorld } from './world';

/** Chạy n tick với chuỗi input giả lập (tất định theo inputSeed) cho 2 người chơi. */
function simulate(seed: string, ticks: number, inputSeed = 'inputs'): SimWorld {
  const w = new SimWorld({ seed, map: arenaMap() });
  w.addPlayer('bob');
  w.addPlayer('alice');
  const r = new Rng(inputSeed);
  const held = new Map<string, PlayerInput>();
  for (let t = 0; t < ticks; t++) {
    for (const id of ['alice', 'bob']) {
      // đổi input mỗi ~0.5s, như người bấm phím
      if (t % 10 === 0 || !held.has(id)) {
        held.set(id, {
          seq: t,
          moveX: r.int(-1, 1),
          moveY: r.int(-1, 1),
          aim: r.int(0, 255),
          buttons: (r.chance(0.3) ? Btn.Sprint : 0) | (r.chance(0.5) ? Btn.Attack : 0) | (r.chance(0.1) ? Btn.Interact : 0),
        });
      }
    }
    w.step(held);
  }
  return w;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SimWorld', () => {
  it('tất định: cùng seed + cùng chuỗi input → cùng mã băm sau 1000 tick', () => {
    const a = simulate('room-1', 1000);
    const b = simulate('room-1', 1000);
    expect(a.tick).toBe(1000);
    expect(a.hash()).toBe(b.hash());
  });

  it('khác seed hoặc khác input → khác mã băm', () => {
    const base = simulate('room-1', 200).hash();
    expect(simulate('room-2', 200).hash()).not.toBe(base);
    expect(simulate('room-1', 200, 'other-inputs').hash()).not.toBe(base);
  });

  it('không dùng Math.random', () => {
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random bị gọi trong /shared');
    });
    simulate('room-1', 300);
    expect(spy).not.toHaveBeenCalled();
  });

  it('sinh đủ số zombie, trên ô trống, cách điểm xuất phát đủ xa', () => {
    const w = new SimWorld({ seed: 'x', map: arenaMap(), zombieCount: 40 });
    expect(w.zombies).toHaveLength(40);
    for (const z of w.zombies) {
      expect(w.blocked(Math.floor(z.x), Math.floor(z.y))).toBe(false);
      expect(Math.hypot(z.x - w.map.spawn.x, z.y - w.map.spawn.y)).toBeGreaterThanOrEqual(ZOMBIE_NORMAL.spawnMinDist);
    }
    expect(new Set(w.zombies.map((z) => z.id)).size).toBe(40);
  });

  it('zombie chết thì sinh con mới để giữ đủ số', () => {
    const w = new SimWorld({ seed: 'x', map: arenaMap(), zombieCount: 10 });
    w.addPlayer('p');
    const killed = w.zombies.slice(0, 3).map((z) => z.id);
    for (const z of w.zombies.slice(0, 3)) z.hp = 0;
    w.step(new Map());
    expect(w.zombies).toHaveLength(10);
    for (const id of killed) expect(w.zombies.some((z) => z.id === id)).toBe(false);
  });

  it('zombie không chồng lên nhau và không chui vào tường', () => {
    const w = simulate('crowd', 400);
    for (const z of w.zombies) expect(w.blocked(Math.floor(z.x), Math.floor(z.y))).toBe(false);
    let overlaps = 0;
    for (let i = 0; i < w.zombies.length; i++) {
      for (let j = i + 1; j < w.zombies.length; j++) {
        const a = w.zombies[i]!;
        const b = w.zombies[j]!;
        if (Math.hypot(a.x - b.x, a.y - b.y) < ZOMBIE_NORMAL.radius) overlaps++;
      }
    }
    expect(overlaps).toBe(0);
  });
});
