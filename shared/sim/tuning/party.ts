/**
 * Số cân bằng của gục/cứu/kéo người gục (GĐ 2c, AGENTS.md mục 3 "Hợp tác & định vị").
 * TẠM ở vùng A: theo cam kết lúc làm 2c, A không sửa `/shared/data` (vùng B) → B chuyển file này
 * vào `/shared/data` khi tiện (chỉ cần đổi đường import). Đơn vị: ô và giây.
 */
export const PARTY = {
  /** Gục bao lâu (giây) không ai cứu thì chết hẳn. */
  downedSec: 30,
  /** Bị cắn khi đang gục: mất thêm bấy nhiêu giây. */
  downedBitePenaltySec: 5,
  /** Giữ R cạnh người gục bao lâu (giây) thì cứu được. */
  reviveSec: 4,
  /** Không ai giữ R: thời gian cứu giảm nhanh gấp bấy nhiêu lần lúc cứu (4s cứu → về 0 sau ~1.3s). */
  reviveDecayRate: 3,
  /** Tầm cứu/kéo (ô, tâm tới tâm). */
  reviveRange: 1.4,
  dragRange: 1.6,
  /** Đứng dậy với bấy nhiêu máu. */
  reviveHp: 30,
  /** Tốc độ bò khi gục = walkSpeed × hệ số này. */
  crawlSpeedFactor: 0.25,
  /** Người đang kéo đi chậm lại = walkSpeed × hệ số này (không chạy được). */
  dragSpeedFactor: 0.6,
  /** Người bị kéo nằm sau lưng người kéo bấy nhiêu ô. */
  dragOffset: 0.75,
} as const;
