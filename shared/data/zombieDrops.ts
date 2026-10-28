import type { ItemId, Rarity } from './items';

/** Một dòng trong bảng rơi: món, trọng số (càng lớn càng hay ra), số lượng [ít nhất, nhiều nhất]. */
export interface DropEntry {
  readonly item: ItemId;
  readonly weight: number;
  readonly qty: readonly [number, number];
}
export interface DropTable {
  /** Xác suất rơi đồ khi chết, ban ngày / ban đêm (`dayClock(tick).night`). */
  readonly chance: { readonly day: number; readonly night: number };
  /** Số món mỗi lần rơi. */
  readonly rolls: number;
  readonly items: readonly DropEntry[];
  /** Trọng số độ hiếm. */
  readonly rarity: Partial<Record<Rarity, number>>;
}

const SUPPLIES: readonly DropEntry[] = [
  { item: 'bandage', weight: 25, qty: [1, 1] },
  { item: 'water', weight: 25, qty: [1, 1] },
  { item: 'canned_food', weight: 25, qty: [1, 1] },
  { item: 'pistol_ammo', weight: 15, qty: [3, 8] },
  { item: 'scrap', weight: 10, qty: [1, 3] },
];

/**
 * Zombie rơi đồ (A). Host quyết, tất định: quay số bằng `Rng` của mô phỏng gieo từ (id zombie, tick chết) —
 * `shared/sim/zombieDrops.ts`. Đồ rơi xuống đất (hệ thả/nhặt của B), tự dọn sau 5 phút như mọi đồ khác.
 */
export const ZOMBIE_DROPS = {
  /** Mọi loại zombie trừ Boss: đồ lặt vặt, tỉ lệ thấp. */
  normal: {
    chance: { day: 0.04, night: 0.08 },
    rolls: 1,
    items: SUPPLIES,
    rarity: { common: 80, uncommon: 20 },
  },
  /** Zombie đứng dậy từ xác đồng đội (`turnedFrom`): rơi nhiều hơn, tốt hơn. */
  turned: {
    chance: { day: 0.6, night: 0.8 },
    rolls: 2,
    items: [
      ...SUPPLIES,
      { item: 'rifle_ammo', weight: 10, qty: [5, 10] },
      { item: 'antibiotics', weight: 8, qty: [1, 1] },
    ],
    rarity: { common: 55, uncommon: 35, rare: 10 },
  },
  /** Boss: chắc chắn 1 món hiếm trở lên + 1 đống đạn. */
  boss: {
    chance: { day: 1, night: 1 },
    rolls: 1,
    items: [
      { item: 'pistol', weight: 15, qty: [1, 1] },
      { item: 'rifle', weight: 20, qty: [1, 1] },
      { item: 'helmet', weight: 15, qty: [1, 1] },
      { item: 'vest', weight: 20, qty: [1, 1] },
      { item: 'pants', weight: 15, qty: [1, 1] },
      { item: 'medkit', weight: 15, qty: [1, 1] },
    ],
    rarity: { rare: 60, epic: 30, legendary: 10 },
  },
} as const satisfies Record<string, DropTable>;

/** Đạn kèm theo khi Boss rơi đồ (luôn Thường). */
export const BOSS_AMMO: readonly DropEntry[] = [
  { item: 'pistol_ammo', weight: 1, qty: [10, 20] },
  { item: 'rifle_ammo', weight: 1, qty: [10, 20] },
];
