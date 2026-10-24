/**
 * Ngày/đêm, tầm nhìn, đèn pin, tiếng ồn (GĐ 4, AGENTS.md mục 3).
 * TẠM ở vùng A (cam kết không sửa `/shared/data` lúc làm GĐ 4) → B chuyển vào `/shared/data` khi tiện.
 * Đơn vị: ô, giây; "darkness" 0 = trưa, 1 = nửa đêm.
 */
export const DAY = {
  /** Một ngày dài bao nhiêu giây (AGENTS: 10–12 phút). */
  lengthSec: 660,
  /** Trận bắt đầu lúc mấy giờ (0..1 của ngày; 0.3 ≈ 7h sáng). */
  startAt: 0.3,
  /** Mốc trong ngày (0..1): bắt đầu chạng vạng, tối hẳn, bắt đầu rạng sáng, sáng hẳn. */
  duskStart: 0.72,
  nightStart: 0.8,
  dawnStart: 0.2,
  dawnEnd: 0.28,
} as const;

export const VISION = {
  /** Nửa góc nón nhìn (độ). */
  coneHalfDeg: 55,
  /** Tầm nhìn ban ngày (ô). */
  dayRange: 16,
  /** Ban đêm không đèn: chỉ thấy gần. */
  nightRange: 3.5,
  /** Đèn pin: soi xa nhưng nón hẹp hơn. */
  flashlightRange: 11,
  flashlightHalfDeg: 30,
  /** Vòng luôn thấy quanh mình (ô): ngày / đêm. */
  aroundDay: 3,
  aroundNight: 1.6,
  /** Độ tối ngoài tầm nhìn: ban ngày (mờ nhẹ) và nửa đêm (gần như đen). */
  dimDay: 0.35,
  dimNight: 0.93,
} as const;

/** Zombie theo giờ: đêm mạnh hơn, nhìn kém hơn — trừ khi bạn bật đèn. */
export const ZOMBIE_NIGHT = {
  /** Tốc độ đuổi ban đêm = × (1 + hệ số × darkness). */
  speedBonus: 0.25,
  /** Tầm nhìn ban đêm = × (1 − hệ số × darkness). */
  sightPenalty: 0.5,
  /** Người bật đèn pin trong bóng tối: zombie thấy từ xa bấy nhiêu ô (mọi hướng nếu nhìn về phía đèn). */
  flashlightSeenRange: 14,
  /** Đèn chỉ làm lộ mình khi trời đủ tối. */
  flashlightDarkness: 0.3,
} as const;

/** Bán kính tiếng ồn (ô) của từng hành động: zombie trong bán kính kéo tới xem. */
export const NOISE = {
  doorToggle: 5,
  /** Chém trúng (dao êm: nhỏ). Ám sát = 0. */
  meleeHit: 3,
  /** Zombie thét khi phát hiện người: gọi cả bầy. */
  scream: 16,
  /** Zombie phình nổ. */
  bloaterBurst: 7,
  /** Khổng lồ phá cửa. */
  doorBreak: 9,
  /** Zombie đi kiểm tra tiếng ồn tối đa bấy nhiêu giây rồi thôi. */
  investigateSec: 8,
} as const;
