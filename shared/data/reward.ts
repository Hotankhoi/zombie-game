import type { ItemId, Rarity } from './items';

/**
 * Thùng thưởng sau đợt tràn thắng (A). Mỗi người một phần riêng, quay tất định theo (seed thế giới, số đợt, ownerId):
 * 1 món Huyền thoại (vũ khí hoặc giáp) + đạn hợp súng (hoặc đạn súng lục nếu ra giáp) + đồ y tế.
 */
export const HORDE_REWARD = {
  /** Món chính (trọng số), luôn độ hiếm `rarity`. */
  main: [
    { item: 'rifle', weight: 25 },
    { item: 'pistol', weight: 15 },
    { item: 'vest', weight: 25 },
    { item: 'helmet', weight: 20 },
    { item: 'pants', weight: 15 },
  ] as readonly { item: ItemId; weight: number }[],
  rarity: 'legendary' as Rarity,
  /** Đạn kèm theo (Thường). */
  ammo: { rifle: 40, pistol: 40 } as const,
  /** Đồ y tế kèm theo. */
  extras: [
    { itemId: 'medkit', rarity: 'epic', quantity: 2 },
    { itemId: 'antibiotics', rarity: 'rare', quantity: 2 },
  ] as readonly { itemId: ItemId; rarity: Rarity; quantity: number }[],
  /** Thùng đặt ở chỗ an toàn gần đội (logic chỗ hồi sinh an toàn), cách xa tối đa bấy nhiêu ô vẫn hiện mũi tên HUD. */
  hudRange: 200,
} as const;
