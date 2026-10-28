import type { RewardCrateWire } from '@shared/types/loot';
import type { Vec2 } from '@shared/types';

/** Thùng còn phần của mình (chưa lấy hết). */
export function myCrates(crates: readonly RewardCrateWire[], owner: string): RewardCrateWire[] {
  return crates.filter((c) => c.shares.some((s) => s.owner === owner && s.slots.some(Boolean)));
}

const ARROWS = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
/** "12 ô ↗" — khoảng cách + mũi tên 8 hướng (trục y màn hình hướng xuống). */
export function directionText(from: Vec2, to: Vec2): string {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  const k = (Math.round(a / (Math.PI / 4)) + 8) % 8;
  return `${Math.round(d)} ô ${ARROWS[k]}`;
}
