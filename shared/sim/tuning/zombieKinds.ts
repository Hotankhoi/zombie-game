/**
 * Các loại zombie (GĐ 4, AGENTS.md mục 3): thường, chạy nhanh, thét, phình độc, phun axit, trốn, khổng lồ.
 * Số là hệ số nhân trên ZOMBIE_NORMAL (`/shared/data/zombies.ts`) + chỉ số riêng.
 * TẠM ở vùng A (cam kết không sửa `/shared/data` lúc làm GĐ 4) → B chuyển vào `/shared/data` khi tiện.
 * Boss của đợt tràn: GĐ 5.
 */
/** Thứ tự cố định (gửi qua mạng bằng chỉ số 0..7) — chỉ thêm vào cuối. */
export const ZOMBIE_KINDS = [
  'normal',
  'runner',
  'screamer',
  'bloater',
  'spitter',
  'hider',
  'giant',
  'boss',
] as const;
export type ZombieKind = (typeof ZOMBIE_KINDS)[number];

export interface KindStats {
  hp: number;
  speed: number;
  radius: number;
  biteDamage: number;
  /** Tỉ lệ xuất hiện (ban ngày / ban đêm). */
  weightDay: number;
  weightNight: number;
}

export const KIND: Record<ZombieKind, KindStats> = {
  normal: { hp: 1, speed: 1, radius: 1, biteDamage: 1, weightDay: 60, weightNight: 50 },
  /** Chạy nhanh, ít máu. */
  runner: { hp: 0.6, speed: 1.55, radius: 0.9, biteDamage: 0.8, weightDay: 10, weightNight: 18 },
  /** Thét gọi bầy khi phát hiện người (tiếng ồn lớn). */
  screamer: { hp: 0.8, speed: 0.95, radius: 1, biteDamage: 0.6, weightDay: 6, weightNight: 7 },
  /** Phình: chậm, nhiều máu; chết thì nổ vũng độc. */
  bloater: { hp: 1.6, speed: 0.75, radius: 1.35, biteDamage: 1, weightDay: 7, weightNight: 7 },
  /** Phun axit từ xa (vũng axit ở chỗ người đứng). Mòn giáp: chờ giáp của B (GĐ 3). */
  spitter: { hp: 0.8, speed: 0.9, radius: 1, biteDamage: 0.6, weightDay: 7, weightNight: 7 },
  /** Trốn: nằm im, không hiện, người tới gần thì lao ra. */
  hider: { hp: 0.9, speed: 1.1, radius: 0.95, biteDamage: 1.3, weightDay: 6, weightNight: 6 },
  /** Khổng lồ: rất nhiều máu, cắn đau, phá cửa đóng. Phá tường: chưa làm (phải đồng bộ thay đổi map). */
  giant: { hp: 6, speed: 0.7, radius: 1.75, biteDamage: 3, weightDay: 4, weightNight: 5 },
  /** Boss đợt tràn (GĐ 5): chỉ đợt tràn sinh ra. Đập đất + gầm gọi bầy (tuning/horde.ts), phá cửa. */
  boss: { hp: 40, speed: 0.8, radius: 2.4, biteDamage: 4, weightDay: 0, weightNight: 0 },
};

/** Loại phá được cửa đóng (đi xuyên cửa). */
export function breaksDoors(kind: ZombieKind): boolean {
  return kind === 'giant' || kind === 'boss';
}

export const SPECIAL = {
  /** Phình nổ: vũng độc. */
  bloaterPool: { radius: 2.2, ttlSec: 8, dps: 8 },
  /** Phun axit: tầm (ô), hồi chiêu, thời gian bay tới, vũng axit. */
  spit: { minRange: 2.5, maxRange: 7, cooldownSec: 3.5, flightSec: 0.6, radius: 1.1, ttlSec: 3, dps: 14 },
  /** Trốn: người (đứng được) tới gần bấy nhiêu ô thì lao ra, tăng tốc bấy nhiêu giây. */
  hider: { revealRange: 2.6, burstSec: 1.5, burstSpeed: 1.8 },
} as const;
