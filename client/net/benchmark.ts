import { arenaMap } from '@shared/sim/grid';
import { Btn } from '@shared/sim/input';
import { SimWorld } from '@shared/sim/world';

/**
 * Đo sức máy (AGENTS.md mục 2.1: chọn host theo ping + sức máy): thời gian (ms) chạy 20 tick mô phỏng
 * với 120 zombie trên map thử. Máy yếu (điện thoại cũ) chậm hơn rõ rệt → ít được chọn làm host.
 * Chạy 4 lượt × 5 tick, lấy lượt nhanh nhất × 4: lượt đầu chậm vì JavaScript chưa được tối ưu (JIT),
 * và tab đang bận việc khác cũng làm số đo nhảy. Tổng khoảng 10–40ms lúc vào phòng.
 */
export function measureSimMs(): number {
  const w = new SimWorld({ seed: 'bench', map: arenaMap(), zombieCount: 120 });
  w.addPlayer('bench');
  const input = new Map([['bench', { seq: 0, moveX: 1, moveY: 0, aim: 0, buttons: Btn.Sprint }]]);
  let best = Infinity;
  for (let round = 0; round < 4; round++) {
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) w.step(input);
    best = Math.min(best, performance.now() - t0);
  }
  return best * 4;
}
