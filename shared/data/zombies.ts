/**
 * Chỉ số zombie (giai đoạn 1a: chỉ zombie thường). Đơn vị: ô và giây.
 * GĐ 4 (A) thêm: chạy nhanh, thét, phình độc, phun axit, trốn, khổng lồ.
 */
export const ZOMBIE_NORMAL = {
  radius: 0.32,
  maxHp: 100,
  wanderSpeed: 1.2,
  chaseSpeed: 3.2,
  /** Thấy người trong tầm này, nếu người ở trước mặt và không bị tường che. */
  sightRange: 8,
  /** Nửa góc nhìn (độ) — đứng sau lưng thì không bị thấy. */
  sightHalfAngleDeg: 60,
  /** Người đang CHẠY trong tầm này thì zombie nghe tiếng chân (mọi hướng). */
  hearSprintRange: 4,
  /** Đuổi mà người chạy xa quá tầm này thì bỏ. */
  loseRange: 14,
  /** Cắn được khi khoảng cách mép–mép ≤ tầm này (ô). */
  biteRange: 0.25,
  biteDamage: 10,
  biteCooldownSec: 1,
  /** Người lệch khỏi hướng nhìn của zombie hơn góc này (độ) = đang đứng sau lưng → ám sát được. */
  behindAngleDeg: 120,
  /** Số zombie giữ quanh người chơi (giai đoạn 1a). */
  population: 40,
  /** Zombie mới sinh cách người chơi trong khoảng này (ô). */
  spawnMinDist: 10,
  spawnMaxDist: 28,
} as const;
