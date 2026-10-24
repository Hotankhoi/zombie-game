import type { Vec2 } from '@shared/types';
import type { BlockedFn } from './collision';

const UNREACHABLE = 0xffff;
/** Khung tối đa (ô) để BFS — đủ rộng quanh người chơi, vẫn rẻ. */
const MAX_SIZE = 128;
const MARGIN = 40;

/**
 * Bản đồ "khoảng cách tới người chơi gần nhất" (AGENTS.md mục 2.5: zombie đi theo flow field).
 * BFS nhiều nguồn trên lưới ô, tất định. Zombie đứng ở ô nào thì bước sang ô kề có số nhỏ hơn.
 */
export class FlowField {
  private originX = 0;
  private originY = 0;
  private w = 0;
  private h = 0;
  private dist = new Uint16Array(0);

  /** Tính lại từ vị trí các người chơi còn sống. */
  build(targets: readonly Vec2[], blocked: BlockedFn): void {
    if (targets.length === 0) {
      this.w = this.h = 0;
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const t of targets) {
      minX = Math.min(minX, Math.floor(t.x));
      minY = Math.min(minY, Math.floor(t.y));
      maxX = Math.max(maxX, Math.floor(t.x));
      maxY = Math.max(maxY, Math.floor(t.y));
    }
    this.w = Math.min(MAX_SIZE, maxX - minX + 1 + MARGIN * 2);
    this.h = Math.min(MAX_SIZE, maxY - minY + 1 + MARGIN * 2);
    // khung quá to (người chơi tản xa) → canh giữa quanh người đầu tiên
    const first = targets[0] as Vec2;
    this.originX = this.w === MAX_SIZE ? Math.floor(first.x) - MAX_SIZE / 2 : minX - MARGIN;
    this.originY = this.h === MAX_SIZE ? Math.floor(first.y) - MAX_SIZE / 2 : minY - MARGIN;

    const size = this.w * this.h;
    if (this.dist.length < size) this.dist = new Uint16Array(size);
    this.dist.fill(UNREACHABLE, 0, size);
    const queue = new Int32Array(size);
    let head = 0;
    let tail = 0;
    for (const t of targets) {
      const i = this.index(Math.floor(t.x), Math.floor(t.y));
      if (i >= 0 && this.dist[i] === UNREACHABLE) {
        this.dist[i] = 0;
        queue[tail++] = i;
      }
    }
    while (head < tail) {
      const i = queue[head++] as number;
      const lx = i % this.w;
      const ly = (i - lx) / this.w;
      const d = (this.dist[i] as number) + 1;
      for (const [nx, ny] of [
        [lx + 1, ly],
        [lx - 1, ly],
        [lx, ly + 1],
        [lx, ly - 1],
      ] as const) {
        if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue;
        const j = ny * this.w + nx;
        if (this.dist[j] !== UNREACHABLE) continue;
        if (blocked(this.originX + nx, this.originY + ny)) continue;
        this.dist[j] = d;
        queue[tail++] = j;
      }
    }
  }

  /** Số bước tới người chơi gần nhất, hoặc null nếu không tới được / ngoài khung. */
  distanceAt(tx: number, ty: number): number | null {
    const i = this.index(tx, ty);
    if (i < 0) return null;
    const d = this.dist[i] as number;
    return d === UNREACHABLE ? null : d;
  }

  /**
   * Điểm (tâm ô kề) nên đi tới từ vị trí pos, hoặc null nếu không có đường.
   * Đi chéo chỉ khi 2 ô cạnh đều trống (không cắt góc tường).
   */
  nextStep(pos: Vec2, blocked: BlockedFn): Vec2 | null {
    const tx = Math.floor(pos.x);
    const ty = Math.floor(pos.y);
    const here = this.distanceAt(tx, ty);
    if (here === null) return null;
    let best = here;
    let bx = 0;
    let by = 0;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oy === 0) continue;
        if (ox !== 0 && oy !== 0 && (blocked(tx + ox, ty) || blocked(tx, ty + oy))) continue;
        const d = this.distanceAt(tx + ox, ty + oy);
        if (d !== null && d < best) {
          best = d;
          bx = ox;
          by = oy;
        }
      }
    }
    if (best === here) return null;
    return { x: tx + bx + 0.5, y: ty + by + 0.5 };
  }

  private index(tx: number, ty: number): number {
    const lx = tx - this.originX;
    const ly = ty - this.originY;
    if (lx < 0 || ly < 0 || lx >= this.w || ly >= this.h) return -1;
    return ly * this.w + lx;
  }
}
