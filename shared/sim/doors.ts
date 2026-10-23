import type { Vec2 } from '@shared/types';
import type { MapSource } from './grid';

const key = (tx: number, ty: number) => `${tx},${ty}`;

/**
 * Trạng thái cửa, lưu riêng khỏi map gốc (map chỉ đọc). Mặc định mọi cửa đều đóng.
 * GĐ 2 gửi danh sách cửa mở như "thay đổi so với map seed" (AGENTS.md mục 2.6).
 */
export class Doors {
  private open = new Set<string>();

  isOpen(tx: number, ty: number): boolean {
    return this.open.has(key(tx, ty));
  }

  set(tx: number, ty: number, open: boolean): void {
    if (open) this.open.add(key(tx, ty));
    else this.open.delete(key(tx, ty));
  }

  /** Các cửa đang mở, đã sort (để băm/gửi tất định). */
  openList(): string[] {
    return [...this.open].sort();
  }
}

/** Ô cửa có tâm gần pos nhất trong tầm range, hoặc null. Hoà khoảng cách thì lấy theo y rồi x. */
export function nearestDoor(map: MapSource, pos: Vec2, range: number): Vec2 | null {
  const minX = Math.floor(pos.x - range);
  const maxX = Math.floor(pos.x + range);
  const minY = Math.floor(pos.y - range);
  const maxY = Math.floor(pos.y + range);
  let best: Vec2 | null = null;
  let bestD2 = range * range;
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      if (!map.isDoor(tx, ty)) continue;
      const d2 = (tx + 0.5 - pos.x) ** 2 + (ty + 0.5 - pos.y) ** 2;
      if (d2 <= bestD2 && (best === null || d2 < bestD2)) {
        best = { x: tx, y: ty };
        bestD2 = d2;
      }
    }
  }
  return best;
}

/** Hình tròn (x, y, r) có chồng lên ô (tx, ty) không. */
export function circleOverlapsTile(x: number, y: number, r: number, tx: number, ty: number): boolean {
  const cx = Math.min(Math.max(x, tx), tx + 1);
  const cy = Math.min(Math.max(y, ty), ty + 1);
  return (x - cx) ** 2 + (y - cy) ** 2 < r * r;
}
