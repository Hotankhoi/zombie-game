import type { ItemId, Rarity } from './items';

/**
 * Đồ dùng được (GĐ 3b, AGENTS.md mục 3 "Hồi phục"). Thêm bởi A (B đồng ý A làm phần dùng đồ) — B chỉnh số thoải mái,
 * logic ở `shared/sim/items.ts`. Đơn vị: máu/điểm và giây.
 */
export interface ConsumableDefinition {
  /** Hồi máu ngay. */
  readonly heal?: number;
  /** Hồi máu dần: tổng bấy nhiêu máu trong `selfSec` (tự băng) / `allySec` (băng cho đồng đội — nhanh hơn). */
  readonly healOverTime?: { readonly hp: number; readonly selfSec: number; readonly allySec: number };
  /** Băng cho đồng đội đang gục → đứng dậy ngay với bấy nhiêu máu (thay vì giữ R 4 s). */
  readonly reviveHp?: number;
  /** Phải đứng yên bấy nhiêu giây (không đi, không đánh) trước khi dùng — bộ sơ cứu. */
  readonly stillSec?: number;
  readonly cure?: number;
  readonly food?: number;
  readonly water?: number;
  /** Dùng được cho đồng đội trong tầm này (ô, tâm tới tâm, nhìn thấy nhau). */
  readonly allyRange?: number;
}

export const CONSUMABLES: Partial<Record<ItemId, ConsumableDefinition>> = {
  bandage: { healOverTime: { hp: 20, selfSec: 8, allySec: 3 }, reviveHp: 30, allyRange: 1.5 },
  medkit: { heal: 60, stillSec: 3 },
  antibiotics: { cure: 60 },
  water: { water: 45 },
  canned_food: { food: 40 },
};

/** Độ hiếm nhân hiệu ứng (máu, nhiễm trùng giảm, no/nước). */
export const RARITY_POTENCY: Record<Rarity, number> = {
  common: 1,
  uncommon: 1.15,
  rare: 1.3,
  epic: 1.5,
  legendary: 1.75,
};

/** Host chấp nhận "đã đứng yên" sớm hơn bấy nhiêu giây so với yêu cầu (trễ mạng giữa input và yêu cầu dùng đồ). */
export const USE_STILL_TOLERANCE_SEC = 0.5;
