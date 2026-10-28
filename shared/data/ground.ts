import { SIM_TICK_HZ } from '../types';

/**
 * Đồ nằm trên đất (A, giao thức 11 — số cân bằng cho phần thả/nhặt của B). Host quyết theo tick thế giới.
 * - `max`: tối đa bấy nhiêu đống đồ trong cả thế giới (giới hạn của B, #49).
 * - `expireSec`: không ai nhặt sau bấy nhiêu giây thì biến mất (tính từ lúc rơi / được gộp thêm gần nhất).
 * - `mergeRadius`: đồ cùng loại + độ hiếm cách nhau ≤ bấy nhiêu ô thì gộp thành 1 đống (tới `maxStack`).
 * - `sweepEveryTicks`: host dọn/gộp mỗi bấy nhiêu tick.
 * - `grid`: vị trí làm tròn 1/grid ô (gửi gọn trên mạng, mọi máy có đúng cùng số).
 */
export const GROUND = {
  max: 128,
  expireSec: 300,
  expireTicks: 300 * SIM_TICK_HZ,
  mergeRadius: 0.5,
  sweepEveryTicks: 20,
  grid: 32,
} as const;
