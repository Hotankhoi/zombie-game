import type { PeerId, RoomCode } from '@shared/types';
import {
  RELAY_PING,
  decodeServer,
  encodeClientBatch,
  newRelayKey,
  relayRoomUrl,
  type OutEntry,
} from './relayProtocol';
import { Emitter, type SendOptions, type Transport } from './transport';

/**
 * Transport relay dự phòng (GĐ 7): WebSocket tới Cloudflare Worker + Durable Object (gói Free, thư mục relay/),
 * mỗi phòng = 1 Durable Object chuyển tiếp gói cho nhau. Dùng khi WebRTC không nối thẳng được (4G, router khó)
 * và TURN hết hạn mức — AutoTransport (./auto.ts) tự chọn đường, game không cần biết.
 *
 * Gộp gói: relay tính tiền theo số khung WebSocket gửi LÊN (20 khung = 1 request, 100k request/ngày miễn phí),
 * nên mọi gói gửi trong cùng một nhịp được gộp thành 1 khung, mỗi máy tối đa 1 khung / `flushMs` (mặc định 50ms
 * = 1 tick 20Hz). Tính toán giờ chơi/ngày: docs/relay.md.
 *
 * WebSocket là TCP nên kênh 'unreliable' cũng đi như 'reliable' (không mất, có thứ tự).
 */
export const RELAY_URL: string = import.meta.env.VITE_RELAY_URL ?? '';

/** Phần WebSocket cần dùng — để test bằng WebSocket giả và chạy được trên Node 22 (có WebSocket sẵn). */
export interface WebSocketLike {
  binaryType: string;
  readonly readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
}

export interface RelayTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  now(): number;
}

export interface RelayOptions {
  /** Gộp gói: tối đa 1 khung gửi lên mỗi `flushMs` ms. */
  flushMs?: number;
  /** Gửi "ping" giữ kết nối khi rảnh (ms). */
  keepAliveMs?: number;
  createSocket?: (url: string) => WebSocketLike;
  timers?: RelayTimers;
  onError?: (message: string) => void;
  /** Chỉ để test: mã bí mật cố định thay vì tạo ngẫu nhiên. */
  key?: string;
}

const OPEN = 1;

const defaultTimers: RelayTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  now: () => performance.now(),
};

export class RelayTransport implements Transport {
  /** Số khung đã gửi lên relay (= số "tin WebSocket" bị tính tiền) và số gói game trong đó. */
  framesSent = 0;
  packetsSent = 0;
  bytesSent = 0;
  private ws: WebSocketLike | null = null;
  private slotToId = new Map<number, PeerId>();
  private idToSlot = new Map<PeerId, number>();
  private msg = new Emitter<[Uint8Array, PeerId]>();
  private joinE = new Emitter<[PeerId]>();
  private leaveE = new Emitter<[PeerId]>();
  private queue: OutEntry[] = [];
  private flushTimer: unknown = null;
  private lastFlush = -Infinity;
  private keepAliveTimer: unknown = null;
  private reconnectTimer: unknown = null;
  private retries = 0;
  private left = false;
  private readonly url: string;
  private readonly flushMs: number;
  private readonly keepAliveMs: number;
  private readonly createSocket: (url: string) => WebSocketLike;
  private readonly timers: RelayTimers;
  private readonly onError: ((message: string) => void) | undefined;

  constructor(
    baseUrl: string,
    room: RoomCode,
    readonly selfId: PeerId,
    opts: RelayOptions = {},
  ) {
    // mã bí mật tạo 1 lần cho trang này, dùng lại mỗi lần nối lại → chỉ chính mình thay được kết nối của mình
    this.url = relayRoomUrl(baseUrl, room, selfId, opts.key ?? newRelayKey());
    this.flushMs = opts.flushMs ?? 50;
    this.keepAliveMs = opts.keepAliveMs ?? 30_000;
    this.createSocket = opts.createSocket ?? ((u) => new WebSocket(u) as unknown as WebSocketLike);
    this.timers = opts.timers ?? defaultTimers;
    this.onError = opts.onError;
    this.connect();
  }

  /** Đã vào phòng relay (nhận được Welcome). */
  get connected(): boolean {
    return this.ws?.readyState === OPEN;
  }

  peers(): PeerId[] {
    return [...this.idToSlot.keys()];
  }

  send(data: Uint8Array, opts: SendOptions = {}): void {
    if (this.left || !this.connected) return;
    let targets: number[] = [];
    if (opts.to !== undefined) {
      for (const id of Array.isArray(opts.to) ? opts.to : [opts.to]) {
        const slot = this.idToSlot.get(id);
        if (slot !== undefined) targets.push(slot);
      }
      if (targets.length === 0) return;
      // gửi cho tất cả người khác thì dùng "cả phòng" cho gọn
      if (targets.length === this.idToSlot.size) targets = [];
    }
    this.queue.push({ targets, data: data.slice() });
    this.scheduleFlush();
  }

  onMessage(h: (data: Uint8Array, from: PeerId) => void) {
    return this.msg.on(h);
  }
  onPeerJoin(h: (peer: PeerId) => void) {
    return this.joinE.on(h);
  }
  onPeerLeave(h: (peer: PeerId) => void) {
    return this.leaveE.on(h);
  }

  async leave(): Promise<void> {
    if (this.left) return;
    this.flush();
    this.left = true;
    for (const t of [this.flushTimer, this.keepAliveTimer, this.reconnectTimer]) {
      if (t !== null) this.timers.clearTimeout(t);
    }
    this.ws?.close(1000, 'leave');
    this.ws = null;
    this.dropPeers();
    this.msg.clear();
    this.joinE.clear();
    this.leaveE.clear();
  }

  /** Gửi ngay các gói đang chờ (1 khung). */
  flush(): void {
    if (this.flushTimer !== null) {
      this.timers.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.queue.length === 0) return;
    const entries = this.queue;
    this.queue = [];
    if (!this.connected) return;
    const frame = encodeClientBatch(entries);
    try {
      this.ws!.send(frame);
    } catch (err) {
      console.warn('[relay] gửi lỗi:', err);
      return;
    }
    this.lastFlush = this.timers.now();
    this.framesSent++;
    this.packetsSent += entries.length;
    this.bytesSent += frame.length;
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    // gói đầu tiên sau một lúc rảnh: gửi ở lượt kế tiếp (gom các gói cùng nhịp); không thì chờ đủ flushMs
    const wait = Math.max(0, this.lastFlush + this.flushMs - this.timers.now());
    this.flushTimer = this.timers.setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, wait);
  }

  private connect(): void {
    if (this.left) return;
    let ws: WebSocketLike;
    try {
      ws = this.createSocket(this.url);
    } catch (err) {
      this.onError?.(`relay: ${String(err)}`);
      this.scheduleReconnect();
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onmessage = (e) => {
      if (this.ws !== ws || typeof e.data === 'string') return; // "pong"
      const bytes = toBytes(e.data);
      if (bytes) this.handle(bytes);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.dropPeers();
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      if (this.ws === ws) this.onError?.('relay: lỗi kết nối');
    };
  }

  private handle(bytes: Uint8Array): void {
    const m = decodeServer(bytes);
    if (!m) return;
    switch (m.t) {
      case 'welcome':
        this.retries = 0;
        this.armKeepAlive();
        break;
      case 'join': {
        const old = this.slotToId.get(m.slot);
        if (old !== undefined && old !== m.id) this.removeSlot(m.slot);
        if (this.idToSlot.has(m.id)) this.removeSlot(this.idToSlot.get(m.id)!);
        this.slotToId.set(m.slot, m.id);
        this.idToSlot.set(m.id, m.slot);
        this.joinE.emit(m.id);
        break;
      }
      case 'leave':
        this.removeSlot(m.slot);
        break;
      case 'data':
        for (const e of m.entries) {
          const from = this.slotToId.get(e.from);
          if (from !== undefined) this.msg.emit(e.data.slice(), from);
        }
        break;
    }
  }

  private removeSlot(slot: number): void {
    const id = this.slotToId.get(slot);
    if (id === undefined) return;
    this.slotToId.delete(slot);
    this.idToSlot.delete(id);
    this.leaveE.emit(id);
  }

  private dropPeers(): void {
    for (const slot of [...this.slotToId.keys()]) this.removeSlot(slot);
    this.queue = [];
  }

  private armKeepAlive(): void {
    if (this.keepAliveTimer !== null) this.timers.clearTimeout(this.keepAliveTimer);
    this.keepAliveTimer = this.timers.setTimeout(() => {
      this.keepAliveTimer = null;
      if (this.left || !this.connected) return;
      // đang gửi gói đều thì không cần ping
      if (this.timers.now() - this.lastFlush >= this.keepAliveMs) this.ws!.send(RELAY_PING);
      this.armKeepAlive();
    }, this.keepAliveMs);
  }

  private scheduleReconnect(): void {
    if (this.left || this.reconnectTimer !== null) return;
    // 1s, 2s, 4s… tối đa 30s — mỗi lần nối lại tốn 1 request
    const delay = Math.min(30_000, 1000 * 2 ** this.retries++);
    this.reconnectTimer = this.timers.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

function toBytes(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
}
