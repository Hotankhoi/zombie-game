import { generateChunk, MAP_VERSION, MAX_CHUNK, type Chunk, type District } from './world';

export interface ChestLocation {
  readonly id: string;
  readonly region: District;
  /** Center of a floor tile, in world tile units. */
  readonly x: number;
  readonly y: number;
}

/** One chest per building, two tiles inside the entrance, independent of visit order. */
export function chestLocations(chunk: Chunk): ChestLocation[] {
  return chunk.buildings.map((building) => ({
    id: `${building.id}:chest:0`,
    region: building.kind,
    x: building.door.x + 0.5,
    y: building.door.y + (building.door.y === building.y ? 2 : -2) + 0.5,
  }));
}

/** Resolve an untrusted ID to generated coordinates; clients cannot choose loot or placement. */
export function findChest(seed: string, id: unknown): ChestLocation | null {
  if (typeof id !== 'string' || id.length > 128) return null;
  const match = /^v(\d+):(-?\d+),(-?\d+):([01]),([01]):chest:0$/.exec(id);
  if (!match || Number(match[1]) !== MAP_VERSION) return null;
  const cx = Number(match[2]),
    cy = Number(match[3]);
  if (![cx, cy].every((n) => Number.isSafeInteger(n) && Math.abs(n) <= MAX_CHUNK)) return null;
  return chestLocations(generateChunk(seed, cx, cy)).find((chest) => chest.id === id) ?? null;
}
