import { sha256Hex } from './sha256';

/**
 * Danh tính bền của người chơi (quyết định ở docs/save-format.md mục 4). PeerId đổi mỗi lần mở trang nên không dùng
 * làm khóa túi đồ được.
 * - `playerKey`: BÍ MẬT, 16 byte ngẫu nhiên (base64url, 22 ký tự), lưu ở trình duyệt. Chỉ gửi riêng cho host hiện tại
 *   (intent `claim`), không bao giờ nằm trong replica/bản lưu/file save.
 * - `ownerId = "p" + 24 ký tự hex đầu của sha256(playerKey)`: CÔNG KHAI, là khóa túi đồ trong replica, gói 125, file save.
 *   Biết ownerId (ai cũng thấy) không suy ra được playerKey → không mạo danh lấy túi người khác được.
 * Tải lại trang (cùng trình duyệt) → cùng playerKey → host trả đúng túi cũ.
 */
export const PLAYER_KEY_STORAGE = 'zombie-coop.playerKey';
const KEY = /^[A-Za-z0-9_-]{22}$/;

export function isPlayerKey(key: unknown): key is string {
  return typeof key === 'string' && KEY.test(key);
}

export function ownerIdOf(key: string): string {
  return `p${sha256Hex(`zombie-coop/owner/${key}`).slice(0, 24)}`;
}

export function newPlayerKey(
  random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n)),
): string {
  const b = random(16);
  let bin = '';
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Phần Web Storage cần dùng (localStorage / sessionStorage; test truyền bản giả). */
export interface KeyStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

/**
 * Khóa của tab này: sessionStorage (riêng từng tab, còn sau khi tải lại) nếu có, không thì localStorage (chung cả
 * trình duyệt, còn sau khi tắt máy), chưa có thì tạo mới (lưu localStorage để lần mở sau dùng lại).
 * `resume` = khóa lấy từ sessionStorage (tab này đã dùng → tải lại trang).
 * KHÔNG ghi sessionStorage ở đây: chỉ ghi khi host đã nhận khóa (`rememberPlayerKey` sau `claim` thành công). Ghi sớm thì
 * tab thứ 2 tải lại trước khi host trả `key_in_use` sẽ tưởng mình "tải lại" (resume) và lấy túi của tab 1.
 * Lỗi storage (chế độ riêng tư) → khóa tạm.
 */
export function loadPlayerKey(
  local: KeyStorage | null,
  session: KeyStorage | null,
  make = newPlayerKey,
): { key: string; resume: boolean } {
  const mine = readPlayerKey(session);
  const shared = readPlayerKey(local);
  const key = mine ?? shared ?? make();
  if (!shared) savePlayerKey(local, key);
  return { key, resume: mine !== null };
}

/** Host đã nhận khóa này cho tab này (claim thành công) → nhớ cho tab (tải lại trang = `resume`). */
export function rememberPlayerKey(session: KeyStorage | null, key: string): void {
  savePlayerKey(session, key);
}

/**
 * Host báo khóa đang được một tab khác dùng (2 tab cùng trình duyệt chung localStorage): tab này đổi sang khóa mới.
 * Chỉ tạo khóa — `rememberPlayerKey` lưu vào sessionStorage khi host đã nhận nó.
 */
export function replacePlayerKey(make = newPlayerKey): string {
  return make();
}

function readPlayerKey(s: KeyStorage | null): string | null {
  try {
    const v = s?.getItem(PLAYER_KEY_STORAGE) ?? null;
    return isPlayerKey(v) ? v : null;
  } catch {
    return null;
  }
}

function savePlayerKey(s: KeyStorage | null, key: string): void {
  try {
    s?.setItem(PLAYER_KEY_STORAGE, key);
  } catch {
    // chế độ riêng tư / bị chặn: dùng khóa tạm cho tới khi đóng trang
  }
}
