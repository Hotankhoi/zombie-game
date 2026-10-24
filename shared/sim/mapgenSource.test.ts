import { describe, expect, it } from 'vitest';
import { Tile, WorldMap, worldSeedForRoom } from '@shared/mapgen/world';
import { Rng } from '@shared/util/rng';
import { Btn, type PlayerInput } from './input';
import { MapgenSource } from './mapgenSource';
import { SimWorld } from './world';

const SEED = worldSeedForRoom('ABC123');

describe('MapgenSource (map thật của B)', () => {
  it('khớp WorldMap.tileAt của B, kể cả tọa độ âm và biên chunk', () => {
    const src = new MapgenSource(SEED);
    const ref = new WorldMap(SEED);
    const r = new Rng('pts');
    for (let i = 0; i < 4000; i++) {
      const x = r.int(-200, 200);
      const y = r.int(-200, 200);
      const t = ref.tileAt(x, y);
      expect(src.isWall(x, y)).toBe(t === Tile.Wall);
      expect(src.isDoor(x, y)).toBe(t === Tile.Door);
    }
    for (const [x, y] of [
      [-1, -1],
      [-32, 0],
      [31, 31],
      [32, -33],
    ] as const) {
      expect(src.isDoor(x, y)).toBe(ref.tileAt(x, y) === Tile.Door);
    }
  });

  it('điểm xuất phát nằm trên đường, không bị chặn', () => {
    const src = new MapgenSource(SEED);
    const { x, y } = src.spawn;
    for (const [tx, ty] of [
      [x - 1, y - 1],
      [x, y - 1],
      [x - 1, y],
      [x, y],
    ] as const) {
      expect(src.isWall(tx, ty) || src.isDoor(tx, ty)).toBe(false);
    }
  });

  it('ngoài vùng hỗ trợ là tường', () => {
    const src = new MapgenSource(SEED);
    expect(src.isWall(32 * 1_000_001, 0)).toBe(true);
    expect(src.isWall(0, -32 * 1_000_002)).toBe(true);
  });

  it('SimWorld chạy trên map thật: tất định, zombie sinh trên ô trống', () => {
    const run = () => {
      const w = new SimWorld({ seed: SEED, map: new MapgenSource(SEED), zombieCount: 60 });
      w.addPlayer('a');
      const r = new Rng('in');
      let input: PlayerInput = { seq: 0, moveX: 0, moveY: 0, aim: 0, buttons: 0 };
      for (let t = 0; t < 400; t++) {
        if (t % 10 === 0) {
          input = {
            seq: t,
            moveX: r.int(-1, 1),
            moveY: r.int(-1, 1),
            aim: r.int(0, 255),
            buttons: (r.chance(0.3) ? Btn.Sprint : 0) | (r.chance(0.4) ? Btn.Attack : 0),
          };
        }
        w.step(new Map([['a', input]]));
      }
      return w;
    };
    const a = run();
    expect(a.hash()).toBe(run().hash());
    expect(a.zombies).toHaveLength(60);
    for (const z of a.zombies) expect(a.blocked(Math.floor(z.x), Math.floor(z.y))).toBe(false);
  });
});
