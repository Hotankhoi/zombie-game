/**
 * Chỉ số người chơi (giai đoạn 1a). Đơn vị: ô (tile) và giây.
 * Thêm bởi A cho 1a — B có thể chỉnh số khi làm GĐ 3 (đói/khát làm stamina hồi chậm).
 */
export const PLAYER = {
  /** Bán kính va chạm (ô). */
  radius: 0.3,
  walkSpeed: 4,
  sprintSpeed: 6.5,
  maxHp: 100,
  maxStamina: 100,
  /** Stamina mất mỗi giây khi chạy. */
  sprintCostPerSec: 25,
  /** Stamina hồi mỗi giây sau khi nghỉ đủ lâu. */
  staminaRegenPerSec: 20,
  /** Nghỉ bao lâu (giây) thì bắt đầu hồi stamina. */
  staminaRegenDelaySec: 1,
  /** Cạn stamina thì phải hồi tới tỉ lệ này mới chạy lại được. */
  sprintResumeFraction: 0.25,
  /** Tầm với để mở/đóng cửa (ô, tính từ tâm người tới tâm ô cửa). */
  interactRange: 1.6,
  /** Chết (tạm, trước khi có gục/cứu ở GĐ 2) → hồi sinh sau bao lâu. */
  respawnSec: 3,
} as const;
