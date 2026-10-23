import { Rng, hashString } from '../util/rng';

export const MAP_VERSION = 1;
export const CHUNK_SIZE = 32;
export const TILE_SIZE = 16;
// Keep arithmetic exact, including conversion from tiles to display pixels.
export const MAX_CHUNK = 1_000_000;
export const Tile = { Grass: 0, Road: 1, Pavement: 2, Floor: 3, Wall: 4, Door: 5 } as const;
export type TileId = (typeof Tile)[keyof typeof Tile];
export const DISTRICTS = ['residential', 'market', 'hospital', 'police', 'military'] as const;
export type District = (typeof DISTRICTS)[number];

export interface Building {
  id: string;
  kind: District;
  /** World tile coordinates, not pixels. Bounds include the walls. */
  x: number;
  y: number;
  width: number;
  height: number;
  door: { x: number; y: number };
}

export interface Chunk {
  version: number;
  x: number;
  y: number;
  district: District;
  /** Row-major, CHUNK_SIZE * CHUNK_SIZE entries. */
  tiles: TileId[];
  buildings: Building[];
}

export function worldSeedForRoom(room: string): string {
  return `zombie-world:${room.trim().toUpperCase()}`;
}

/** Floor division is essential at negative world coordinates. */
export function tileToChunk(x: number, y: number) {
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
    throw new RangeError('Tile coordinates must be safe integers');
  }
  const chunkX = Math.floor(x / CHUNK_SIZE);
  const chunkY = Math.floor(y / CHUNK_SIZE);
  validateChunk(chunkX, chunkY);
  return { chunkX, chunkY, localX: x - chunkX * CHUNK_SIZE, localY: y - chunkY * CHUNK_SIZE };
}

function validateChunk(x: number, y: number) {
  if (![x, y].every((v) => Number.isSafeInteger(v) && Math.abs(v) <= MAX_CHUNK)) {
    throw new RangeError('Chunk coordinates are outside the supported world');
  }
}

/** Pure: no global RNG, clock, browser state, or generation-order dependency. */
export function generateChunk(seed: string, x: number, y: number): Chunk {
  validateChunk(x, y);
  const rng = new Rng(seed).fork(`chunk:${x},${y}`);
  // Neighbourhoods span 2x2 chunks; every five neighbourhoods include all POI types.
  const n = Math.floor(x / 2) + 3 * Math.floor(y / 2) + hashString(seed);
  const district = DISTRICTS[((n % DISTRICTS.length) + DISTRICTS.length) % DISTRICTS.length]!;
  const tiles: TileId[] = Array<TileId>(CHUNK_SIZE * CHUNK_SIZE).fill(Tile.Grass);
  const buildings: Building[] = [];
  const put = (tx: number, ty: number, tile: TileId) => {
    tiles[ty * CHUNK_SIZE + tx] = tile;
  };

  // Crossroads use global alignment so every shared chunk edge matches exactly.
  for (let ty = 0; ty < CHUNK_SIZE; ty++) {
    for (let tx = 0; tx < CHUNK_SIZE; tx++) {
      if (tx === 15 || tx === 16 || ty === 15 || ty === 16) put(tx, ty, Tile.Road);
      else if (tx === 14 || tx === 17 || ty === 14 || ty === 17) put(tx, ty, Tile.Pavement);
    }
  }

  for (let by = 0; by < 2; by++) {
    for (let bx = 0; bx < 2; bx++) {
      const width = rng.int(7, 10);
      const height = rng.int(7, 10);
      const left = (bx === 0 ? 2 : 19) + rng.int(0, 1);
      const top = (by === 0 ? 2 : 19) + rng.int(0, 1);
      const doorX = left + Math.floor(width / 2);
      const doorY = by === 0 ? top + height - 1 : top;
      for (let ty = top; ty < top + height; ty++) {
        for (let tx = left; tx < left + width; tx++) {
          const edge = tx === left || tx === left + width - 1 || ty === top || ty === top + height - 1;
          put(tx, ty, edge ? Tile.Wall : Tile.Floor);
        }
      }
      // A paved path connects every entrance to the public street.
      for (let ty = Math.min(doorY, 14); ty <= Math.max(doorY, 17); ty++) {
        if (ty === doorY) put(doorX, ty, Tile.Door);
        else if (ty < top || ty >= top + height) {
          if (ty !== 15 && ty !== 16) put(doorX, ty, Tile.Pavement);
        }
      }
      buildings.push({
        id: `v${MAP_VERSION}:${x},${y}:${bx},${by}`,
        kind: bx === 0 && by === 0 ? district : 'residential',
        x: x * CHUNK_SIZE + left,
        y: y * CHUNK_SIZE + top,
        width,
        height,
        door: { x: x * CHUNK_SIZE + doorX, y: y * CHUNK_SIZE + doorY },
      });
    }
  }
  return { version: MAP_VERSION, x, y, district, tiles, buildings };
}

/** Base collision only. A owns runtime door changes and simulation. */
export function isSolid(tile: TileId): boolean {
  return tile === Tile.Wall || tile === Tile.Door;
}

/** Bounded cache for renderers/host; eviction never affects generated output. */
export class WorldMap {
  private readonly chunks = new Map<string, Chunk>();
  constructor(
    readonly seed: string,
    private readonly capacity = 64,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('Invalid cache capacity');
  }
  get size() {
    return this.chunks.size;
  }
  getChunk(x: number, y: number): Chunk {
    const key = `${x},${y}`;
    let chunk = this.chunks.get(key);
    if (!chunk) chunk = generateChunk(this.seed, x, y);
    this.chunks.delete(key);
    this.chunks.set(key, chunk);
    if (this.chunks.size > this.capacity) this.chunks.delete(this.chunks.keys().next().value!);
    return chunk;
  }
  tileAt(x: number, y: number): TileId {
    const p = tileToChunk(x, y);
    return this.getChunk(p.chunkX, p.chunkY).tiles[p.localY * CHUNK_SIZE + p.localX]!;
  }
}
