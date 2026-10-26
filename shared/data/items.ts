/** Initial inventory data. Combat, loot rates and equipment effects are added separately (guns.ts, armor.ts…). */
export const RARITIES = {
  common: { name: 'Thường', color: '#a9b5b1', rank: 0 },
  uncommon: { name: 'Tốt', color: '#7cd69c', rank: 1 },
  rare: { name: 'Hiếm', color: '#78b9ff', rank: 2 },
  epic: { name: 'Sử thi', color: '#c0a0ff', rank: 3 },
  legendary: { name: 'Huyền thoại', color: '#efc76b', rank: 4 },
} as const;
export type Rarity = keyof typeof RARITIES;
export type ItemCategory = 'weapon' | 'ammo' | 'medical' | 'food' | 'material' | 'armor';
export const CATEGORY_NAMES: Record<ItemCategory, string> = {
  weapon: 'Vũ khí',
  ammo: 'Đạn',
  medical: 'Y tế',
  food: 'Nhu yếu phẩm',
  material: 'Vật liệu',
  armor: 'Giáp',
};
interface ItemDefinition {
  name: string;
  category: ItemCategory;
  maxStack: number;
  description: string;
}
export const ITEMS = {
  knife: {
    name: 'Dao sinh tồn',
    category: 'weapon',
    maxStack: 1,
    description: 'Gọn nhẹ, luôn cần thiết trong hành trang.',
  },
  bat: {
    name: 'Gậy bóng chày',
    category: 'weapon',
    maxStack: 1,
    description: 'Một cây gậy chắc chắn cho những chuyến đi gần.',
  },
  pistol: {
    name: 'Súng lục',
    category: 'weapon',
    maxStack: 1,
    description: 'Vũ khí nhỏ gọn. Sử dụng đạn súng lục.',
  },
  rifle: {
    name: 'Súng trường',
    category: 'weapon',
    maxStack: 1,
    description: 'Vũ khí tầm xa. Sử dụng đạn súng trường.',
  },
  pistol_ammo: {
    name: 'Đạn súng lục',
    category: 'ammo',
    maxStack: 60,
    description: 'Cất gọn thành từng hộp để dành chỗ trong túi.',
  },
  rifle_ammo: {
    name: 'Đạn súng trường',
    category: 'ammo',
    maxStack: 60,
    description: 'Đạn dự trữ dành cho súng trường.',
  },
  bandage: {
    name: 'Băng gạc',
    category: 'medical',
    maxStack: 10,
    description: 'Vật tư sơ cứu cơ bản, nên mang theo mỗi chuyến đi.',
  },
  medkit: {
    name: 'Bộ sơ cứu',
    category: 'medical',
    maxStack: 3,
    description: 'Một bộ vật tư y tế được đóng gói cẩn thận.',
  },
  antibiotics: {
    name: 'Kháng sinh',
    category: 'medical',
    maxStack: 5,
    description: 'Thuốc hiếm trong những khu vực đã bị bỏ hoang.',
  },
  water: {
    name: 'Nước sạch',
    category: 'food',
    maxStack: 5,
    description: 'Nước uống đóng chai cho hành trình dài.',
  },
  canned_food: {
    name: 'Đồ hộp',
    category: 'food',
    maxStack: 5,
    description: 'Thực phẩm dễ bảo quản và mang theo.',
  },
  scrap: {
    name: 'Phế liệu',
    category: 'material',
    maxStack: 30,
    description: 'Những mảnh kim loại thu gom để chế tạo về sau.',
  },
  // GĐ 3b (A): giáp — thêm CUỐI danh mục (mã trên dây = thứ tự). Chỉ số ở shared/data/armor.ts.
  helmet: {
    name: 'Mũ bảo hộ',
    category: 'armor',
    maxStack: 1,
    description: 'Che đầu. Giảm sát thương và nguy cơ nhiễm trùng khi bị cắn.',
  },
  vest: {
    name: 'Áo giáp',
    category: 'armor',
    maxStack: 1,
    description: 'Lớp bảo vệ thân người, chịu được nhiều vết cắn nhất.',
  },
  pants: {
    name: 'Quần bảo hộ',
    category: 'armor',
    maxStack: 1,
    description: 'Vải dày chống cắn cho chân.',
  },
} as const satisfies Record<string, ItemDefinition>;
export type ItemId = keyof typeof ITEMS;

export const BACKPACKS = {
  basic: { name: 'Túi cơ bản', capacity: 12 },
  scout: { name: 'Balo trinh sát', capacity: 16 },
  expedition: { name: 'Balo viễn chinh', capacity: 24 },
} as const;
export type BackpackId = keyof typeof BACKPACKS;
