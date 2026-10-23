/**
 * Danh sách máy chủ ICE cho WebRTC.
 * - STUN: giúp 2 máy tìm đường nối thẳng (đủ khi mạng dễ tính).
 * - TURN (Metered Open Relay, free 20 GB/tháng, không cần thẻ): chuyển tiếp dữ liệu khi
 *   router/4G chặn nối thẳng. (Cloudflare TURN bắt nhập thẻ nên không dùng.)
 */
export const STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
];

/**
 * https://<app>.metered.live/api/v1/turn/credentials?apiKey=... — đặt lúc build bằng biến VITE_TURN_URL
 * (GitHub secret khi deploy, `.env.local` khi chạy máy mình). Rỗng = chỉ dùng STUN.
 */
export const TURN_URL: string = import.meta.env.VITE_TURN_URL ?? '';

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** Lấy STUN + TURN. Máy chủ TURN lỗi/chậm thì trả về chỉ STUN để game vẫn chạy. */
export async function loadIceServers(
  url: string = TURN_URL,
  fetchFn: FetchFn = (u, i) => fetch(u, i),
  timeoutMs = 3000,
): Promise<RTCIceServer[]> {
  if (!url) return STUN_SERVERS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Metered trả về mảng; dạng { iceServers } là chuẩn chung của các nhà cung cấp khác
    const body = (await res.json()) as RTCIceServer[] | { iceServers?: RTCIceServer[] };
    const list = Array.isArray(body) ? body : (body.iceServers ?? []);
    const turn = list.map(dropPort53).filter((s) => s.urls.length > 0);
    return [...STUN_SERVERS, ...turn];
  } catch (err) {
    console.warn('[net] không lấy được TURN, chỉ dùng STUN:', err);
    return STUN_SERVERS;
  } finally {
    clearTimeout(timer);
  }
}

/** Bỏ cổng 53: trình duyệt chặn, để lại chỉ làm chậm việc dò đường. */
function dropPort53(s: RTCIceServer): RTCIceServer {
  const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u));
  return { ...s, urls };
}
