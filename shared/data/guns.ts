import type { ItemId, Rarity } from './items';

/**
 * Súng (GĐ 3b, AGENTS.md mục 3). Thêm bởi A (B đồng ý A làm phần dùng đồ) — B chỉnh số thoải mái, logic ở
 * `shared/sim/guns.ts`. Đơn vị: ô, giây, độ. Tiếng ồn = bán kính (ô) zombie nghe thấy và kéo tới (`SimWorld.emitNoise`).
 */
export interface GunDefinition {
  readonly name: string;
  /** Loại đạn trong túi (nạp đạn lấy từ đây, mọi độ hiếm). */
  readonly ammo: ItemId;
  readonly damage: number;
  /** Tầm bắn tối đa (ô). */
  readonly range: number;
  /** Số phát mỗi giây tối đa. */
  readonly fireRate: number;
  /** true = giữ chuột bắn liên tục; false = mỗi lần bấm 1 phát. */
  readonly automatic: boolean;
  /** Băng đạn chứa bấy nhiêu viên. */
  readonly magazine: number;
  readonly reloadSec: number;
  /** Tản cơ bản (độ, lệch tối đa mỗi bên). */
  readonly spreadDeg: number;
  /** Độ giật: mỗi phát cộng thêm bấy nhiêu độ tản, tối đa `recoilMaxDeg`, hồi `recoilRecoverDegPerSec`. */
  readonly recoilDeg: number;
  readonly recoilMaxDeg: number;
  readonly recoilRecoverDegPerSec: number;
  /** Đạn xuyên thêm bấy nhiêu zombie (0 = dừng ở con đầu). */
  readonly pierce: number;
  /** Bán kính tiếng ồn (ô). */
  readonly noise: number;
}

export const GUNS = {
  pistol: {
    name: 'Súng lục',
    ammo: 'pistol_ammo',
    damage: 30,
    range: 14,
    fireRate: 4,
    automatic: false,
    magazine: 12,
    reloadSec: 1.2,
    spreadDeg: 3,
    recoilDeg: 4,
    recoilMaxDeg: 12,
    recoilRecoverDegPerSec: 10,
    pierce: 0,
    noise: 18,
  },
  rifle: {
    name: 'Súng trường',
    ammo: 'rifle_ammo',
    damage: 55,
    range: 22,
    fireRate: 3,
    automatic: true,
    magazine: 20,
    reloadSec: 2,
    spreadDeg: 1.5,
    recoilDeg: 6,
    recoilMaxDeg: 15,
    recoilRecoverDegPerSec: 10,
    pierce: 1,
    noise: 28,
  },
} as const satisfies Record<string, GunDefinition>;
export type GunId = keyof typeof GUNS;

/** Độ hiếm nhân sát thương vũ khí (cận chiến và súng). */
export const RARITY_DAMAGE: Record<Rarity, number> = {
  common: 1,
  uncommon: 1.1,
  rare: 1.2,
  epic: 1.35,
  legendary: 1.5,
};
