/**
 * Chỉ số sinh tồn (GĐ 3b, AGENTS.md mục 3): no, nước, nhiễm trùng. Đơn vị: điểm 0–100 và giây.
 * Thêm bởi A (B đồng ý A làm phần dùng đồ) — B chỉnh số thoải mái, logic ở `shared/sim/survival.ts`.
 */
export const SURVIVAL = {
  /** No bụng: 100 = no, 0 = đói lả. Hết từ 100 → 0 trong ~25 phút (~2,3 ngày game). */
  food: { start: 100, drainPerSec: 100 / (25 * 60), lowAt: 25, starveDps: 0.5 },
  /** Nước: 100 = đủ nước. Hết trong ~18 phút; đang chạy thì khát nhanh hơn. */
  water: { start: 100, drainPerSec: 100 / (18 * 60), sprintFactor: 1.5, lowAt: 25, starveDps: 0.5 },
  /** No hoặc nước dưới `lowAt` → stamina hồi chậm (nhân hệ số này cho mỗi thứ đang thấp). */
  lowStaminaRegenFactor: 0.5,
  /** Nhiễm trùng: 0 = sạch, 100 = rất nặng. */
  infection: {
    /** Mỗi lần bị cắn cộng thêm (× hệ số sát thương cắn của loại zombie). */
    perBite: 8,
    /** Đã nhiễm (> 0) thì tự nặng dần, không tự khỏi — cần kháng sinh. */
    growPerSec: 0.05,
    /** Từ mức này máu tối đa giảm dần. */
    maxHpLossAt: 50,
    maxHpLossPerSec: 1 / 6,
    minMaxHp: 40,
    /** Khỏi hẳn (= 0) thì máu tối đa hồi dần. */
    maxHpRecoverPerSec: 0.1,
  },
  /** Hồi sinh (phạt nhẹ): hết nhiễm trùng, máu tối đa đầy, no/nước ít nhất bấy nhiêu. */
  respawn: { minFood: 60, minWater: 60 },
} as const;
