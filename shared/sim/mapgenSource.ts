import { CHUNK_SIZE, MAX_CHUNK, Tile, generateChunk, isRoadTile, spawnPoint } from '@shared/mapgen/world';
import { MAX_PLAYERS, type Vec2 } from '@shared/types';
import type { MapSource } from './grid';

const OPEN = 0;
const WALL = 1;
const DOOR = 2;
/** Số chunk giữ trong cache. Sinh lại chunk là thuần (cùng seed → cùng kết quả) nên xóa cache không đổi gì. */
const MAX_CACHED = 4096;
const SPAN = MAX_CHUNK * 2 + 1;

/**
 * Adapter: map thật của B (`shared/mapgen`) → `MapSource` cho mô phỏng.
 * Không dùng `WorldMap.tileAt` vì va chạm/flow field hỏi hàng chục nghìn ô mỗi tick:
 * ở đây mỗi chunk chỉ lưu 1 byte/ô (trống/tường/cửa), khóa số, nhớ chunk vừa tra.
 */
export class MapgenSource implements MapSource {
  /** Điểm xuất phát theo API của B (`spawnPoint`): giữa ngã tư của chunk (0, 0), trên ô đường. */
  readonly spawn: Vec2 = spawnPoint();
  /** MAX_PLAYERS chỗ đứng trên ô đường trống quanh điểm xuất phát (gần trước), mỗi người một ô. */
  readonly spawns: readonly Vec2[];
  private chunks = new Map<number, Uint8Array>();
  private lastKey = NaN;
  private last: Uint8Array | null = null;

  constructor(readonly seed: string) {
    this.spawns = this.roadSpotsAround(this.spawn, MAX_PLAYERS);
  }

  isWall(tx: number, ty: number): boolean {
    return this.kind(tx, ty) === WALL;
  }

  isDoor(tx: number, ty: number): boolean {
    return this.kind(tx, ty) === DOOR;
  }

  tileKind(tx: number, ty: number): number {
    return this.kind(tx, ty);
  }

  private kind(tx: number, ty: number): number {
    const cx = Math.floor(tx / CHUNK_SIZE);
    const cy = Math.floor(ty / CHUNK_SIZE);
    // ngoài vùng map hỗ trợ → coi như tường
    if (cx < -MAX_CHUNK || cx > MAX_CHUNK || cy < -MAX_CHUNK || cy > MAX_CHUNK) return WALL;
    const key = (cx + MAX_CHUNK) * SPAN + (cy + MAX_CHUNK);
    let cells = key === this.lastKey ? this.last : this.chunks.get(key);
    if (!cells) {
      cells = this.load(cx, cy);
      if (this.chunks.size >= MAX_CACHED) this.chunks.clear();
      this.chunks.set(key, cells);
    }
    this.lastKey = key;
    this.last = cells;
    return cells[(ty - cy * CHUNK_SIZE) * CHUNK_SIZE + (tx - cx * CHUNK_SIZE)] as number;
  }

  /** Tâm các ô đường (`isRoadTile` của B) không phải tường/cửa trong vòng 3 ô quanh `c`, gần nhất trước. */
  private roadSpotsAround(c: Vec2, n: number): Vec2[] {
    const cx = Math.floor(c.x);
    const cy = Math.floor(c.y);
    const spots: { x: number; y: number; d: number }[] = [];
    for (let ty = cy - 3; ty <= cy + 3; ty++) {
      for (let tx = cx - 3; tx <= cx + 3; tx++) {
        if (!isRoadTile(tx, ty) || this.kind(tx, ty) !== OPEN) continue;
        spots.push({ x: tx + 0.5, y: ty + 0.5, d: Math.hypot(tx + 0.5 - c.x, ty + 0.5 - c.y) });
      }
    }
    spots.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
    return spots.slice(0, n).map(({ x, y }) => ({ x, y }));
  }

  private load(cx: number, cy: number): Uint8Array {
    const tiles = generateChunk(this.seed, cx, cy).tiles;
    const cells = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    for (let i = 0; i < cells.length; i++) {
      const t = tiles[i];
      cells[i] = t === Tile.Wall ? WALL : t === Tile.Door ? DOOR : OPEN;
    }
    return cells;
  }
}
