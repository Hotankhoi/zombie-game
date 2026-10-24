/**
 * Đếm giờ theo tick cố định. Trừ dt = 0.05 nhiều lần để lại sai số số thực
 * (vd: 0.4 - 8×0.05 ≈ 6.9e-17), làm hồi chiêu trễ thêm 1 tick. Giá trị đủ gần 0 coi là 0.
 */
export const TIME_EPS = 1e-6;

/** Giảm bộ đếm dt giây, không xuống dưới 0; phần dư nhỏ hơn TIME_EPS làm tròn về 0. */
export function countdown(v: number, dt: number): number {
  const r = v - dt;
  return r <= TIME_EPS ? 0 : r;
}

/** Thời gian t đã đạt mốc limit chưa (dung sai TIME_EPS). */
export function reached(t: number, limit: number): boolean {
  return t >= limit - TIME_EPS;
}
