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
