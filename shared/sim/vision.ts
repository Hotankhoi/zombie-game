import type { Vec2 } from '@shared/types';
import { angleDiff, hasLineOfSight, type BlockedFn } from './collision';
import { VISION } from './tuning/night';

/**
 * Tầm nhìn bị tường che (GĐ 4 bổ sung): bắn tia theo lưới ô (DDA) từ mắt người chơi, tia dừng ở ô chặn
 * (tường, cửa đóng). Dùng cho lớp tối (HUD vẽ đa giác nhìn thấy) và để không vẽ zombie sau tường.
 * Thuần, không phụ thuộc trình duyệt → test được và chạy giống nhau trên mọi máy.
 */

/** Tia ăn sâu vào ô chặn bấy nhiêu ô để mặt tường gần mình vẫn được soi sáng. */
const WALL_PEEK = 0.35;
/** Khoảng góc tối đa giữa 2 tia liền nhau (radian) — 10°, cho vòng nhỏ quanh mình. */
const MAX_STEP = (10 * Math.PI) / 180;
/** Tia tối thiểu cho 1 hình (vòng quanh mình nhỏ vẫn đủ tròn). */
const MIN_RAYS = 12;

/**
 * Khoảng cách (ô) từ `o` theo hướng `angle` tới khi gặp ô chặn (cộng WALL_PEEK), tối đa `max`.
 * Ô đang đứng không tính (đứng sát cửa vẫn nhìn ra được).
 */
export function castRay(o: Vec2, angle: number, max: number, blocked: BlockedFn): number {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let tx = Math.floor(o.x);
  let ty = Math.floor(o.y);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tMaxX = dx !== 0 ? (dx > 0 ? tx + 1 - o.x : o.x - tx) * tDeltaX : Infinity;
  let tMaxY = dy !== 0 ? (dy > 0 ? ty + 1 - o.y : o.y - ty) * tDeltaY : Infinity;
  for (;;) {
    let t: number;
    if (tMaxX < tMaxY) {
      t = tMaxX;
      tMaxX += tDeltaX;
      tx += stepX;
    } else {
      t = tMaxY;
      tMaxY += tDeltaY;
      ty += stepY;
    }
    if (t >= max) return max;
    if (blocked(tx, ty)) return Math.min(max, t + WALL_PEEK);
  }
}

/**
 * Đa giác phần nhìn thấy của một hình quạt (nón nhìn, đèn pin) hoặc cả vòng tròn (`halfAngle >= π`),
 * tọa độ ô. Hình quạt bắt đầu bằng chính điểm mắt; vòng tròn chỉ gồm các điểm trên vành.
 */
export function visionPolygon(
  o: Vec2,
  facing: number,
  halfAngle: number,
  range: number,
  blocked: BlockedFn,
): Vec2[] {
  const full = halfAngle >= Math.PI;
  const span = full ? Math.PI * 2 : halfAngle * 2;
  // tia đủ dày để khe giữa 2 tia ở cuối tầm ≤ ~0.5 ô
  const rays = Math.max(MIN_RAYS, Math.ceil(span / Math.min(MAX_STEP, 0.5 / Math.max(0.5, range))));
  const start = full ? 0 : facing - halfAngle;
  const pts: Vec2[] = full ? [] : [{ x: o.x, y: o.y }];
  const n = full ? rays : rays + 1;
  for (let i = 0; i < n; i++) {
    const a = start + (span * i) / rays;
    const d = castRay(o, a, range, blocked);
    pts.push({ x: o.x + Math.cos(a) * d, y: o.y + Math.sin(a) * d });
  }
  return pts;
}

/** Điểm `p` có nằm trong hình quạt (hoặc vòng tròn) nhìn từ `o` và không bị ô chặn che không. */
export function seesPoint(
  o: Vec2,
  facing: number,
  halfAngle: number,
  range: number,
  p: Vec2,
  blocked: BlockedFn,
): boolean {
  const dx = p.x - o.x;
  const dy = p.y - o.y;
  if (dx * dx + dy * dy > range * range) return false;
  if (halfAngle < Math.PI && angleDiff(facing, Math.atan2(dy, dx)) > halfAngle) return false;
  return hasLineOfSight(o, p, blocked);
}

/** Một vùng nhìn thấy/soi sáng: hình quạt (nón nhìn, đèn pin) hoặc vòng tròn (`halfAngle = π`). */
export interface VisionShape {
  x: number;
  y: number;
  facing: number;
  halfAngle: number;
  range: number;
}

const DEG = Math.PI / 180;

/**
 * Các vùng nhìn thấy của mình lúc `darkness` (0 trưa … 1 nửa đêm): nón nhìn, vòng quanh mình, đèn pin của
 * mình và của đồng đội (đèn đồng đội cũng soi cho mình). Lớp tối và việc vẽ zombie dùng chung danh sách này.
 */
export function visionShapes(
  view: { x: number; y: number; facing: number; flashlight: boolean },
  darkness: number,
  others: readonly { x: number; y: number; facing: number; alive: boolean; flashlight: boolean }[],
): VisionShape[] {
  const lerp = (a: number, b: number) => a + (b - a) * darkness;
  const dark = darkness > 0.05;
  const shapes: VisionShape[] = [
    {
      x: view.x,
      y: view.y,
      facing: view.facing,
      halfAngle: VISION.coneHalfDeg * DEG,
      range: lerp(VISION.dayRange, VISION.nightRange),
    },
    {
      x: view.x,
      y: view.y,
      facing: 0,
      halfAngle: Math.PI,
      range: lerp(VISION.aroundDay, VISION.aroundNight),
    },
  ];
  const torch = (o: { x: number; y: number; facing: number }) =>
    shapes.push({
      x: o.x,
      y: o.y,
      facing: o.facing,
      halfAngle: VISION.flashlightHalfDeg * DEG,
      range: VISION.flashlightRange,
    });
  if (dark && view.flashlight) torch(view);
  for (const o of others) if (dark && o.alive && o.flashlight) torch(o);
  return shapes;
}
