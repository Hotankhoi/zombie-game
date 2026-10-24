import type { ItemId, Rarity } from './items';

interface LootEntry {
  readonly itemId: ItemId;
  readonly weight: number;
  readonly min: number;
  readonly max: number;
}
interface LootRegionDefinition {
  readonly name: string;
  readonly description: string;
  readonly entries: readonly LootEntry[];
  readonly rarities: readonly { rarity: Rarity; weight: number }[];
}

// Initial balance. Changing these tables changes generated contents: bump LOOT_VERSION
// and keep saved chest snapshots when adopting a new loot generation version.
export const LOOT_STACK_COUNT = { min: 3, max: 6 } as const;
export const LOOT_REGIONS = {
  residential: {
    name: 'Khu dân cư',
    description: 'Nhu yếu phẩm và dụng cụ còn sót lại trong những căn nhà.',
    entries: [
      { itemId: 'water', weight: 25, min: 1, max: 3 },
      { itemId: 'canned_food', weight: 25, min: 1, max: 3 },
      { itemId: 'scrap', weight: 20, min: 3, max: 12 },
      { itemId: 'bandage', weight: 15, min: 1, max: 4 },
      { itemId: 'knife', weight: 10, min: 1, max: 1 },
      { itemId: 'bat', weight: 5, min: 1, max: 1 },
    ],
    rarities: [
      { rarity: 'common', weight: 80 },
      { rarity: 'uncommon', weight: 18 },
      { rarity: 'rare', weight: 2 },
    ],
  },
  market: {
    name: 'Siêu thị',
    description: 'Tìm nước sạch, đồ hộp và một ít vật tư trong kho hàng.',
    entries: [
      { itemId: 'water', weight: 40, min: 2, max: 5 },
      { itemId: 'canned_food', weight: 40, min: 2, max: 5 },
      { itemId: 'bandage', weight: 10, min: 2, max: 5 },
      { itemId: 'scrap', weight: 10, min: 4, max: 15 },
    ],
    rarities: [
      { rarity: 'common', weight: 70 },
      { rarity: 'uncommon', weight: 25 },
      { rarity: 'rare', weight: 5 },
    ],
  },
  hospital: {
    name: 'Bệnh viện',
    description: 'Băng gạc, bộ sơ cứu và thuốc cho những chuyến đi dài.',
    entries: [
      { itemId: 'bandage', weight: 40, min: 3, max: 10 },
      { itemId: 'medkit', weight: 30, min: 1, max: 3 },
      { itemId: 'antibiotics', weight: 20, min: 1, max: 3 },
      { itemId: 'water', weight: 10, min: 1, max: 3 },
    ],
    rarities: [
      { rarity: 'common', weight: 55 },
      { rarity: 'uncommon', weight: 30 },
      { rarity: 'rare', weight: 13 },
      { rarity: 'epic', weight: 2 },
    ],
  },
  police: {
    name: 'Đồn cảnh sát',
    description: 'Kho vũ khí nhỏ với súng lục, đạn và vật tư sơ cứu.',
    entries: [
      { itemId: 'pistol', weight: 25, min: 1, max: 1 },
      { itemId: 'pistol_ammo', weight: 35, min: 12, max: 36 },
      { itemId: 'bat', weight: 10, min: 1, max: 1 },
      { itemId: 'rifle', weight: 5, min: 1, max: 1 },
      { itemId: 'rifle_ammo', weight: 10, min: 10, max: 24 },
      { itemId: 'bandage', weight: 15, min: 2, max: 6 },
    ],
    rarities: [
      { rarity: 'common', weight: 40 },
      { rarity: 'uncommon', weight: 35 },
      { rarity: 'rare', weight: 20 },
      { rarity: 'epic', weight: 5 },
    ],
  },
  military: {
    name: 'Căn cứ quân sự',
    description: 'Trang bị hiếm và nguồn đạn dự trữ trong kho quân nhu.',
    entries: [
      { itemId: 'rifle', weight: 30, min: 1, max: 1 },
      { itemId: 'rifle_ammo', weight: 35, min: 24, max: 60 },
      { itemId: 'pistol', weight: 10, min: 1, max: 1 },
      { itemId: 'pistol_ammo', weight: 10, min: 24, max: 60 },
      { itemId: 'medkit', weight: 10, min: 1, max: 3 },
      { itemId: 'antibiotics', weight: 5, min: 1, max: 5 },
    ],
    rarities: [
      { rarity: 'common', weight: 20 },
      { rarity: 'uncommon', weight: 30 },
      { rarity: 'rare', weight: 30 },
      { rarity: 'epic', weight: 16 },
      { rarity: 'legendary', weight: 4 },
    ],
  },
} as const satisfies Record<string, LootRegionDefinition>;
export type LootRegion = keyof typeof LOOT_REGIONS;
