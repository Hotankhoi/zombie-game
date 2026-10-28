/**
 * Vũ khí cận chiến (AGENTS.md mục 3: dao → gậy → rìu → mã tấu → cưa máy).
 * Giai đoạn 1a mới có dao. GĐ 3 (B) thêm các món còn lại + độ bền.
 */
export interface MeleeWeapon {
  id: string;
  name: string;
  damage: number;
  /** Tầm với (ô), tính từ tâm người tới mép zombie. */
  range: number;
  /** Góc quạt chém (độ), chia đều hai bên hướng nhìn. */
  arcDeg: number;
  cooldownSec: number;
  staminaCost: number;
  /** Ám sát từ sau lưng = hạ ngay, không ồn. */
  canAssassinate: boolean;
}

export const KNIFE: MeleeWeapon = {
  id: 'knife',
  name: 'Dao',
  damage: 34,
  range: 1.1,
  arcDeg: 90,
  cooldownSec: 0.4,
  staminaCost: 8,
  canAssassinate: true,
};

/** Gậy bóng chày (GĐ 3b, A): đau hơn, với xa hơn, quạt rộng, chậm, tốn sức; không ám sát được. */
export const BAT: MeleeWeapon = {
  id: 'bat',
  name: 'Gậy bóng chày',
  damage: 55,
  range: 1.4,
  arcDeg: 110,
  cooldownSec: 0.75,
  staminaCost: 14,
  canAssassinate: false,
};

/** Tay không (không còn vũ khí nào trong túi). */
export const FISTS: MeleeWeapon = {
  id: 'fists',
  name: 'Tay không',
  damage: 12,
  range: 0.9,
  arcDeg: 80,
  cooldownSec: 0.5,
  staminaCost: 6,
  canAssassinate: false,
};
