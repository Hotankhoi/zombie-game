/**
 * Hợp đồng dữ liệu dùng chung giữa client / host / net.
 * VÙNG CHUNG: sửa file này phải làm PR riêng và báo người kia (AGENTS.md mục 6–7).
 */

/**
 * Phiên bản giao thức mạng. Tăng khi đổi định dạng gói tin để 2 bản khác nhau không nói chuyện nhầm.
 * 3: hợp đồng loot (B). 4: host gửi gói loot 110–113 thật (codec `net/lootCodec.ts`, A).
 * 5: loot `claim` (playerKey), bản lưu 125 v6 có loot ở mẩu 0, host mới thu replica trước khi nhận ghi (A).
 * 6: GĐ 3b chỉ số sinh tồn (no/nước/nhiễm trùng/máu tối đa) trong snapshot + bản lưu 125 v7 (A).
 * 9: GĐ 3b giáp — mũ/áo/quần (danh mục vật phẩm thêm 3 món), `LOOT_VERSION` 2, giáp trong khối chỉ số, bản lưu 125 v10.
 * 8: GĐ 3b vũ khí — host xử lý `equip`/`reload`, sự kiện bắn, khối trang bị, input có tick đang xem, bản lưu 125 v9.
 * 7: GĐ 3b dùng đồ — host xử lý `use`, mã lỗi loot mới, khối chỉ số thêm hồi máu dần/đứng yên, bản lưu 125 v8 (A).
 * 10: thanh nhanh + thả/nhặt đồ (B, #48/#49).
 * 11: đồ trên đất có tick rơi `t` (tự dọn sau 5 phút, gộp đồ gần nhau), vị trí 1/32 ô, phần đổi 112 chỉ mang đồ rơi
 *     đã đổi/đã mất thay vì cả danh sách (A).
 * 12: thùng thưởng đợt tràn — replica có `rewards`, intent `reward`, mã lỗi `no_reward` (A).
 */
export const PROTOCOL_VERSION = 12;

/** ID người chơi trong phòng (do Trystero cấp, duy nhất mỗi lần mở trang). */
export type PeerId = string;

/** Mã phòng để mời bạn bè (vd: "ZK7Q2M"). */
export type RoomCode = string;

/** Tick mô phỏng cố định (AGENTS.md mục 2.2). */
export const SIM_TICK_HZ = 20;
export const SIM_TICK_MS = 1000 / SIM_TICK_HZ;

/** Tối đa người chơi mỗi phòng. */
export const MAX_PLAYERS = 4;

export interface Vec2 {
  x: number;
  y: number;
}

/** Thông tin hiển thị của một người chơi trong phòng. */
export interface PlayerInfo {
  id: PeerId;
  name: string;
  /** Màu riêng (dùng cho mũi tên định vị, minimap). Dạng 0xRRGGBB. */
  color: number;
}

/** Bảng màu cố định cho tối đa 4 người chơi. */
export const PLAYER_COLORS: readonly number[] = [0x4fc3f7, 0xffb74d, 0xaed581, 0xf06292];

/** Kênh gửi: unreliable cho vị trí (mất gói cũng được), reliable cho sự kiện. */
export type Channel = 'reliable' | 'unreliable';
