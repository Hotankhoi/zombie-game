/**
 * Định dạng khung WebSocket giữa máy chơi và relay (Cloudflare Durable Object, thư mục relay/).
 * Dùng chung cho cả 2 phía (relay/src/index.ts import file này) để không lệch nhau.
 * Không đụng định dạng gói game: gói game nằm nguyên vẹn trong `data`.
 *
 * Mỗi người trong phòng được relay gán một số ghế (slot, 0..RELAY_MAX_PEERS-1) để khỏi gửi lại PeerId dài.
 *
 * Máy chơi → relay (1 khung = nhiều gói gộp lại, vì relay tính tiền theo SỐ KHUNG gửi lên):
 *   lặp: [số người nhận n u8][n × slot u8][độ dài u32][gói]      n = 0 → gửi cả phòng (trừ mình)
 * Relay → máy chơi:
 *   [Welcome][slot của mình]
 *   [Join][slot][độ dài id u8][id utf8]
 *   [Leave][slot]
 *   [Data] lặp: [slot người gửi u8][độ dài u32][gói]
 * Khung chữ "ping" → relay tự trả "pong" (không đánh thức Durable Object), giữ kết nối khi đang rảnh.
 */
export const RELAY_PROTOCOL = 2;
/** Tối đa người trong 1 phòng relay (game giới hạn 4 người chơi; dư cho người xem khi phòng đầy). */
export const RELAY_MAX_PEERS = 16;
/** Khung lớn nhất relay nhận (byte) — chặn gửi rác. Sao lưu thế giới lớn nhất ~ vài chục KB. */
export const RELAY_MAX_FRAME = 1 << 20;
export const RELAY_PING = 'ping';
export const RELAY_PONG = 'pong';

export const RelayMsg = { Welcome: 1, Join: 2, Leave: 3, Data: 4 } as const;

/** PeerId hợp lệ trên relay (id của Trystero là chữ/số). */
export const RELAY_PEER_ID = /^[A-Za-z0-9_-]{1,64}$/;
/**
 * Mã bí mật của kết nối (RELAY_PROTOCOL 2): máy chơi tự tạo ngẫu nhiên 1 lần lúc vào (chỉ giữ trong bộ nhớ trang),
 * gửi kèm mỗi lần nối/nối lại. Relay chỉ cho kết nối mới THAY kết nối cũ cùng peer id khi mã khớp → người khác
 * biết peer id (cả phòng đều thấy id) cũng không đá được ai ra.
 */
export const RELAY_KEY = /^[A-Za-z0-9_-]{16,64}$/;

/** 16 byte ngẫu nhiên dạng base64url (22 ký tự). */
export function newRelayKey(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Phía relay: có cho kết nối mới (peer id + mã) vào không.
 * 'new' = chưa ai dùng id này · 'replace' = cùng id, đúng mã (nối lại) → đóng kết nối cũ ·
 * 'reject' = id đang có người dùng với mã khác (không đụng tới kết nối đang có).
 */
export function admitPeer(
  members: Iterable<{ id: string; key: string }>,
  id: string,
  key: string,
): 'new' | 'replace' | 'reject' {
  let found: 'new' | 'replace' = 'new';
  for (const m of members) {
    if (m.id !== id) continue;
    if (m.key !== key) return 'reject';
    found = 'replace';
  }
  return found;
}

export interface OutEntry {
  /** Rỗng = gửi cả phòng. */
  targets: number[];
  data: Uint8Array;
}

export interface InEntry {
  from: number;
  data: Uint8Array;
}

export type ServerMsg =
  | { t: 'welcome'; slot: number }
  | { t: 'join'; slot: number; id: string }
  | { t: 'leave'; slot: number }
  | { t: 'data'; entries: InEntry[] };

export function encodeClientBatch(entries: OutEntry[]): Uint8Array {
  let size = 0;
  for (const e of entries) size += 1 + e.targets.length + 4 + e.data.length;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let o = 0;
  for (const e of entries) {
    out[o++] = e.targets.length;
    for (const t of e.targets) out[o++] = t;
    view.setUint32(o, e.data.length, true);
    o += 4;
    out.set(e.data, o);
    o += e.data.length;
  }
  return out;
}

/** null = khung hỏng (bỏ cả khung). */
export function decodeClientBatch(buf: Uint8Array): OutEntry[] | null {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out: OutEntry[] = [];
  let o = 0;
  while (o < buf.length) {
    const n = buf[o++]!;
    if (o + n + 4 > buf.length) return null;
    const targets = Array.from(buf.subarray(o, o + n));
    o += n;
    const len = view.getUint32(o, true);
    o += 4;
    if (o + len > buf.length) return null;
    out.push({ targets, data: buf.subarray(o, o + len) });
    o += len;
  }
  return out;
}

export function encodeWelcome(slot: number): Uint8Array {
  return Uint8Array.of(RelayMsg.Welcome, slot);
}

export function encodeJoin(slot: number, id: string): Uint8Array {
  const idBytes = new TextEncoder().encode(id);
  const out = new Uint8Array(3 + idBytes.length);
  out[0] = RelayMsg.Join;
  out[1] = slot;
  out[2] = idBytes.length;
  out.set(idBytes, 3);
  return out;
}

export function encodeLeave(slot: number): Uint8Array {
  return Uint8Array.of(RelayMsg.Leave, slot);
}

export function encodeServerData(entries: InEntry[]): Uint8Array {
  let size = 1;
  for (const e of entries) size += 1 + 4 + e.data.length;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out[0] = RelayMsg.Data;
  let o = 1;
  for (const e of entries) {
    out[o++] = e.from;
    view.setUint32(o, e.data.length, true);
    o += 4;
    out.set(e.data, o);
    o += e.data.length;
  }
  return out;
}

export function decodeServer(buf: Uint8Array): ServerMsg | null {
  if (buf.length < 2) return null;
  switch (buf[0]) {
    case RelayMsg.Welcome:
      return { t: 'welcome', slot: buf[1]! };
    case RelayMsg.Leave:
      return { t: 'leave', slot: buf[1]! };
    case RelayMsg.Join: {
      const len = buf[2] ?? 0;
      if (buf.length < 3 + len) return null;
      return { t: 'join', slot: buf[1]!, id: new TextDecoder().decode(buf.subarray(3, 3 + len)) };
    }
    case RelayMsg.Data: {
      const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      const entries: InEntry[] = [];
      let o = 1;
      while (o < buf.length) {
        if (o + 5 > buf.length) return null;
        const from = buf[o++]!;
        const len = view.getUint32(o, true);
        o += 4;
        if (o + len > buf.length) return null;
        entries.push({ from, data: buf.subarray(o, o + len) });
        o += len;
      }
      return { t: 'data', entries };
    }
    default:
      return null;
  }
}

/** `wss://abc.workers.dev` (hoặc https://…) + mã phòng + id + mã bí mật → địa chỉ WebSocket của phòng. */
export function relayRoomUrl(base: string, room: string, peer: string, key: string): string {
  const b = base
    .trim()
    .replace(/\/+$/, '')
    .replace(/^http(s?):\/\//, 'ws$1://');
  return `${b}/room/${encodeURIComponent(room)}?peer=${encodeURIComponent(peer)}&k=${encodeURIComponent(key)}&v=${RELAY_PROTOCOL}`;
}

/**
 * Phía relay: chia các gói trong 1 khung của người gửi `from` cho từng người nhận.
 * `others` = slot của những người khác đang trong phòng. Gói gửi tới slot không có trong phòng thì bỏ.
 */
export function routeBatch(from: number, entries: OutEntry[], others: number[]): Map<number, InEntry[]> {
  const out = new Map<number, InEntry[]>();
  const present = new Set(others);
  for (const e of entries) {
    const targets = e.targets.length === 0 ? others : e.targets;
    for (const t of targets) {
      if (t === from || !present.has(t)) continue;
      let list = out.get(t);
      if (!list) out.set(t, (list = []));
      list.push({ from, data: e.data });
    }
  }
  return out;
}

/** Ghế trống nhỏ nhất, -1 nếu phòng đầy. */
export function freeSlot(used: Iterable<number>): number {
  const taken = new Set(used);
  for (let s = 0; s < RELAY_MAX_PEERS; s++) if (!taken.has(s)) return s;
  return -1;
}
