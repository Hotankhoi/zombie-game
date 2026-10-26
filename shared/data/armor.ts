import type { ItemId, Rarity } from './items';

/**
 * Giáp (GĐ 3b, AGENTS.md mục 3 "Giáp"). Thêm bởi A (B đồng ý A làm phần dùng đồ) — B chỉnh số thoải mái, logic ở
 * `shared/sim/armor.ts`. Món giáp vẫn nằm trong túi (chiếm ô); mặc = host ghi vào nhân vật. Độ bền thuộc CHỖ mặc
 * (đổi mũ khác không hồi bền); hết bền thì món đó vỡ (host trừ khỏi túi).
 */
export type ArmorSlot = 'head' | 'body' | 'legs';
export const ARMOR: Partial<Record<ItemId, { slot: ArmorSlot; reduction: number }>> = {
  helmet: { slot: 'head', reduction: 0.08 },
  vest: { slot: 'body', reduction: 0.15 },
  pants: { slot: 'legs', reduction: 0.07 },
};
/** Độ hiếm nhân mức giảm sát thương. */
export const RARITY_ARMOR: Record<Rarity, number> = {
  common: 1,
  uncommon: 1.25,
  rare: 1.5,
  epic: 1.8,
  legendary: 2.1,
};
export const ARMOR_RULES = {
  /** Tổng mức giảm sát thương tối đa của cả bộ. */
  maxReduction: 0.7,
  /** Giảm nhiễm trùng khi bị cắn = hệ số này × mức giảm sát thương. */
  infectionFactor: 0.8,
  /** Độ bền mỗi món khi mới mặc; mất bằng lượng sát thương món đó đỡ. */
  durability: 100,
  /** Vũng axit (zombie phun axit) làm mòn giáp nhanh gấp bấy nhiêu lần. */
  acidWear: 3,
} as const;
