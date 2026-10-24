/**
 * Gói "phòng đã đủ người" (GĐ 2c, tối đa MAX_PLAYERS): host gửi cho người thứ 5 trở đi khi họ gửi input.
 * Loại gói riêng (124), cố ý không thêm vào danh sách gói chung của gameCodec (chỗ B thêm gói loot).
 */
export const ROOM_FULL_MSG = 124;

export function encodeRoomFull(maxPlayers: number): Uint8Array {
  return new Uint8Array([ROOM_FULL_MSG, maxPlayers & 0xff]);
}

/** Số người tối đa host báo, hoặc null nếu không phải gói này. */
export function decodeRoomFull(buf: Uint8Array): number | null {
  return buf.length >= 2 && buf[0] === ROOM_FULL_MSG ? (buf[1] as number) : null;
}
