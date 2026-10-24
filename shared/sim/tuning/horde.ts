/**
 * Đợt tràn (GĐ 5, AGENTS.md mục 3): mỗi 15 ngày, vào đêm ngày 15, 30, 45… Mỗi đợt mạnh hơn.
 * TẠM ở vùng A (cam kết không sửa `/shared/data` lúc làm GĐ 5) → B chuyển vào `/shared/data` khi tiện.
 */
export const HORDE = {
  /** Đợt tràn vào đêm của mỗi ngày chia hết cho số này. */
  everyDays: 15,
  /** Trời đỏ dần từ ngày này của chu kỳ (13 → đỏ dần tới đêm ngày 15). */
  redSkyFromDay: 13,
  /** Số zombie của đợt thứ n = base + perHorde × (n − 1), tối đa max (mục tiêu hiệu năng: 500). */
  baseCount: 150,
  perHorde: 100,
  maxCount: 500,
  /** Sinh tối đa bấy nhiêu con mỗi giây (dồn dần, không hiện ra cùng lúc). */
  spawnPerSec: 12,
  /** Sinh cách người chơi trong khoảng này (ô): ngoài tầm nhìn ban đêm, trong vùng quan tâm (32). */
  spawnMinDist: 20,
  spawnMaxDist: 29,
  /** Boss xuất hiện khi đã sinh được tỉ lệ này của đợt; số Boss = số thứ tự đợt (tối đa 4). */
  bossAt: 0.3,
  maxBosses: 4,
  /** Mỗi bấy nhiêu giây, zombie đợt tràn đang không đuổi ai được chỉ tới chỗ người chơi gần nhất. */
  homingSec: 2,
  /** Tỉ lệ loại zombie trong đợt tràn (tổng bất kỳ). */
  kindWeights: { normal: 50, runner: 22, screamer: 4, bloater: 8, spitter: 8, hider: 0, giant: 8 },
} as const;

/** Boss của đợt tràn. */
export const BOSS = {
  /** Đập đất: mọi người đứng được trong bán kính mất máu, hồi chiêu. */
  slamRange: 3,
  slamDamage: 25,
  slamCooldownSec: 5,
  /** Gầm gọi bầy (tiếng ồn) mỗi bấy nhiêu giây khi đang đuổi. */
  roarEverySec: 12,
  roarRadius: 24,
} as const;
