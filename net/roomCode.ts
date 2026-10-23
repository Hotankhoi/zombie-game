import type { RoomCode } from '@shared/types';

/** Bỏ các ký tự dễ nhầm (0/O, 1/I/L) để đọc mã qua điện thoại cho dễ. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newRoomCode(random: () => number = Math.random, length = 6): RoomCode {
  let s = '';
  for (let i = 0; i < length; i++) s += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return s;
}

/** Chuẩn hóa mã người dùng gõ/dán vào. Trả null nếu không hợp lệ. */
export function normalizeRoomCode(input: string | null | undefined): RoomCode | null {
  if (!input) return null;
  const s = input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  // Chấp nhận mọi chữ/số (link cũ hoặc mã tự đặt vẫn vào được); chỉ mã TỰ TẠO mới tránh ký tự dễ nhầm.
  if (s.length < 4 || s.length > 12) return null;
  return s;
}
