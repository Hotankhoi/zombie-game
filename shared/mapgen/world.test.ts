import { describe, expect, it } from 'vitest';
import { hashString } from '../util/rng';
import {
  CHUNK_SIZE,
  DISTRICTS,
  generateChunk,
  isSolid,
  MAX_CHUNK,
  Tile,
  tileToChunk,
  WorldMap,
  worldSeedForRoom,
} from './world';

describe('world generation v1', () => {
  it('matches the v1 reference output verified in Chromium as well as Node', () => {
    expect(hashString(JSON.stringify(generateChunk('survivors', 0, 0)))).toBe(3605968675);
    expect(hashString(JSON.stringify(generateChunk('survivors', -1, -1)))).toBe(3015655695);
  });
  it('recreates identical chunks in independent worlds and arbitrary request order', () => {
    const a = new WorldMap('survivors');
    const b = new WorldMap('survivors');
    const coords = [
      [0, 0],
      [-1, -1],
      [12, -38],
      [1, 0],
    ] as const;
    for (const [x, y] of [...coords].reverse()) b.getChunk(x, y);
    for (const [x, y] of coords) expect(a.getChunk(x, y)).toEqual(b.getChunk(x, y));
  });
  it('changes the layout when the seed changes', () => {
    expect(generateChunk('alpha', 0, 0)).not.toEqual(generateChunk('beta', 0, 0));
  });
  it('normalizes room-derived seeds for all peers', () => {
    expect(worldSeedForRoom(' abcd12 ')).toBe(worldSeedForRoom('ABCD12'));
  });
  it('handles negative tile coordinates and rejects invalid coordinates', () => {
    expect(tileToChunk(-1, -32)).toEqual({ chunkX: -1, chunkY: -1, localX: 31, localY: 0 });
    for (const x of [NaN, Infinity, 0.5, MAX_CHUNK + 1])
      expect(() => generateChunk('x', x, 0)).toThrow(RangeError);
    expect(() => tileToChunk(0.2, 0)).toThrow(RangeError);
  });
  it('matches every boundary tile and connects roads across positive and negative chunks', () => {
    for (const seed of ['a', 'b', 'c'])
      for (let y = -3; y <= 3; y++)
        for (let x = -3; x <= 3; x++) {
          const c = generateChunk(seed, x, y);
          const right = generateChunk(seed, x + 1, y);
          const below = generateChunk(seed, x, y + 1);
          for (let i = 0; i < CHUNK_SIZE; i++) {
            expect(c.tiles[i * CHUNK_SIZE + 31]).toBe(right.tiles[i * CHUNK_SIZE]);
            expect(c.tiles[31 * CHUNK_SIZE + i]).toBe(below.tiles[i]);
          }
          expect(c.tiles[15 * CHUNK_SIZE]).toBe(Tile.Road);
          expect(c.tiles[15]).toBe(Tile.Road);
        }
  });
  it('includes all district types and valid buildings with reachable entrances', () => {
    const world = new WorldMap('districts');
    const kinds = new Set<string>();
    const ids = new Set<string>();
    for (let x = -6; x <= 6; x++) {
      const c = world.getChunk(x, 0);
      expect(c.tiles).toHaveLength(CHUNK_SIZE ** 2);
      for (const b of c.buildings) {
        kinds.add(b.kind);
        expect(ids.has(b.id)).toBe(false);
        ids.add(b.id);
        expect(world.tileAt(b.door.x, b.door.y)).toBe(Tile.Door);
        expect(world.tileAt(b.x + 1, b.y + 1)).toBe(Tile.Floor);
        // Flood-fill outside each door to verify a route to the street.
        const outsideY = b.door.y === b.y ? b.door.y - 1 : b.door.y + 1;
        const queue = [[b.door.x, outsideY]];
        const seen = new Set<string>();
        let road = false;
        while (queue.length && !road) {
          const [tx, ty] = queue.shift()!;
          if (tx === undefined || ty === undefined || tx < x * 32 || tx >= (x + 1) * 32 || ty < 0 || ty >= 32)
            continue;
          const key = `${tx},${ty}`;
          if (seen.has(key) || isSolid(world.tileAt(tx, ty))) continue;
          seen.add(key);
          road = world.tileAt(tx, ty) === Tile.Road;
          queue.push([tx + 1, ty], [tx - 1, ty], [tx, ty + 1], [tx, ty - 1]);
        }
        expect(road).toBe(true);
      }
    }
    expect([...kinds].sort()).toEqual([...DISTRICTS].sort());
  });
  it('evicts cached chunks without changing their regenerated data', () => {
    const world = new WorldMap('cache', 2);
    const first = structuredClone(world.getChunk(0, 0));
    world.getChunk(1, 0);
    world.getChunk(2, 0);
    expect(world.size).toBe(2);
    expect(world.getChunk(0, 0)).toEqual(first);
    expect(world.tileAt(-1, -1)).toBe(generateChunk('cache', -1, -1).tiles[1023]);
    expect(() => new WorldMap('x', 0)).toThrow(RangeError);
  });
  it('exposes solid walls/closed doors and walkable floors/roads in world coordinates', () => {
    const world = new WorldMap('collision');
    for (const [cx, cy] of [
      [0, 0],
      [-2, -3],
    ]) {
      const b = world.getChunk(cx!, cy!).buildings[0]!;
      expect(world.isSolid(b.x, b.y)).toBe(true);
      expect(world.isSolid(b.door.x, b.door.y)).toBe(true);
      expect(world.isSolid(b.x + 1, b.y + 1)).toBe(false);
      expect(world.isSolid(cx! * CHUNK_SIZE + 15, cy! * CHUNK_SIZE + 15)).toBe(false);
    }
  });
});
