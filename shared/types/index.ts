/**
 * Hợp đồng dữ liệu dùng chung giữa client / host / net.
 * VÙNG CHUNG: sửa file này phải làm PR riêng và báo người kia (AGENTS.md mục 6–7).
 */

/** Phiên bản giao thức mạng. Tăng khi đổi định dạng gói tin để 2 bản khác nhau không nói chuyện nhầm. */
export const PROTOCOL_VERSION = 3;

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
