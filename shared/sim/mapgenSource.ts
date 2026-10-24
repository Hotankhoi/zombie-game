import { CHUNK_SIZE, MAX_CHUNK, Tile, generateChunk, spawnPoint } from '@shared/mapgen/world';
import type { Vec2 } from '@shared/types';
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
  /** Map owns spawn placement; simulation consumes world coordinates in tile units. */
  readonly spawn: Vec2 = spawnPoint();
  private chunks = new Map<number, Uint8Array>();
  private lastKey = NaN;
  private last: Uint8Array | null = null;

  constructor(readonly seed: string) {}

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
