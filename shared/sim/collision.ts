import type { Vec2 } from '@shared/types';

/** Hàm hỏi "ô (tx, ty) có chặn không" — tường, cửa đóng… */
export type BlockedFn = (tx: number, ty: number) => boolean;

/**
 * Di chuyển hình tròn bán kính r thêm (dx, dy) trên lưới ô, trượt dọc tường.
 * Chia nhỏ bước để không xuyên tường khi đi nhanh. Sửa thẳng vào pos.
 */
export function moveCircle(pos: Vec2, dx: number, dy: number, r: number, blocked: BlockedFn): void {
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / (r * 0.5)));
  for (let i = 0; i < steps; i++) {
    pos.x += dx / steps;
    pos.y += dy / steps;
    pushOut(pos, r, blocked);
  }
}

/** Đẩy hình tròn ra khỏi các ô chặn đang chồng lên (theo hướng ngắn nhất). */
export function pushOut(pos: Vec2, r: number, blocked: BlockedFn): void {
  for (let iter = 0; iter < 4; iter++) {
    let moved = false;
    const minX = Math.floor(pos.x - r);
    const maxX = Math.floor(pos.x + r);
    const minY = Math.floor(pos.y - r);
    const maxY = Math.floor(pos.y + r);
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        if (!blocked(tx, ty)) continue;
        // Chạm đúng góc ô nhưng ô kề (về phía tâm) cũng chặn → góc nằm giữa một bức tường liền,
        // để ô kề xử lý như mặt phẳng. Không thì bị "vấp" ở chỗ nối giữa 2 ô tường khi trượt.
        const outX = pos.x < tx || pos.x > tx + 1;
        const outY = pos.y < ty || pos.y > ty + 1;
        if (outX && outY) {
          const nx = pos.x < tx ? tx - 1 : tx + 1;
          const ny = pos.y < ty ? ty - 1 : ty + 1;
          if (blocked(nx, ty) || blocked(tx, ny)) continue;
        }
        // điểm gần tâm nhất trên ô vuông [tx, tx+1] × [ty, ty+1]
        const cx = Math.min(Math.max(pos.x, tx), tx + 1);
        const cy = Math.min(Math.max(pos.y, ty), ty + 1);
        const ox = pos.x - cx;
        const oy = pos.y - cy;
        const d2 = ox * ox + oy * oy;
        if (d2 >= r * r) continue;
        if (d2 > 1e-12) {
          const d = Math.sqrt(d2);
          const push = (r - d) / d;
          pos.x += ox * push;
          pos.y += oy * push;
        } else {
          // tâm nằm trong ô chặn (chỉ xảy ra khi sinh sai chỗ) → đẩy ra mép gần nhất
          const left = pos.x - tx;
          const right = tx + 1 - pos.x;
          const up = pos.y - ty;
          const down = ty + 1 - pos.y;
          const m = Math.min(left, right, up, down);
          if (m === left) pos.x = tx - r;
          else if (m === right) pos.x = tx + 1 + r;
          else if (m === up) pos.y = ty - r;
          else pos.y = ty + 1 + r;
        }
        moved = true;
      }
    }
    if (!moved) return;
  }
}

/** Có nhìn thẳng từ a tới b không bị ô chặn che không (duyệt ô kiểu DDA). */
export function hasLineOfSight(a: Vec2, b: Vec2, blocked: BlockedFn): boolean {
  let tx = Math.floor(a.x);
  let ty = Math.floor(a.y);
  const endX = Math.floor(b.x);
  const endY = Math.floor(b.y);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tMaxX = dx !== 0 ? (dx > 0 ? tx + 1 - a.x : a.x - tx) * tDeltaX : Infinity;
  let tMaxY = dy !== 0 ? (dy > 0 ? ty + 1 - a.y : a.y - ty) * tDeltaY : Infinity;
  for (let guard = 0; guard < 512; guard++) {
    if (tx === endX && ty === endY) return true;
    if (tMaxX < tMaxY) {
      tMaxX += tDeltaX;
      tx += stepX;
    } else {
      tMaxY += tDeltaY;
      ty += stepY;
    }
    if (tx === endX && ty === endY) return true;
    if (blocked(tx, ty)) return false;
  }
  return false;
}

/** Góc lệch tuyệt đối giữa 2 hướng (radian), trong [0, π]. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d < -Math.PI) d += Math.PI * 2;
  if (d > Math.PI) d -= Math.PI * 2;
  return Math.abs(d);
}
