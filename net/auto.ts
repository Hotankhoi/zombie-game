import type { PeerId } from '@shared/types';
import { Emitter, type SendOptions, type Transport, type Unsubscribe } from './transport';

export type Route = 'direct' | 'relay';

export interface AutoOptions {
  /** Người đã có trên relay mà sau chừng này ms vẫn chưa nối thẳng được thì đi qua relay. */
  fallbackMs?: number;
  timers?: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(id: unknown): void };
}

export const RELAY_FALLBACK_MS = 8000;

/**
 * Tự chọn đường cho từng người (GĐ 7): thử nối thẳng (WebRTC/Trystero) trước; ai đã có mặt trên relay mà sau
 * ~8s vẫn chưa nối thẳng được thì gửi/nhận qua relay (WebSocket, ./relay.ts). Game chỉ thấy một Transport.
 *
 * - Relay luôn nối sẵn nhưng chỉ để biết ai đang trong phòng (rảnh thì Durable Object ngủ, gần như không tốn).
 * - Nhận được gói từ relay của người chưa vào → bên kia đã chọn relay → mình cũng chọn relay ngay (không chờ 8s).
 * - Sau đó nối thẳng được → quay về đường thẳng (đỡ tốn hạn mức relay). Mất đường thẳng mà người đó còn trên relay
 *   → chuyển sang relay, game không thấy ai rời phòng.
 * - `direct = null` (link ?relay=ws) → mọi người đi qua relay ngay.
 * Định dạng gói game giữ nguyên; mỗi gói chỉ đi một đường nên không bị nhận 2 lần.
 */
export class AutoTransport implements Transport {
  readonly selfId: PeerId;
  private route = new Map<PeerId, Route>();
  private waiting = new Map<PeerId, unknown>();
  private msg = new Emitter<[Uint8Array, PeerId]>();
  private joinE = new Emitter<[PeerId]>();
  private leaveE = new Emitter<[PeerId]>();
  private subs: Unsubscribe[] = [];
  private readonly fallbackMs: number;
  private readonly timers: NonNullable<AutoOptions['timers']>;

  constructor(
    private direct: Transport | null,
    private relay: Transport | null,
    opts: AutoOptions = {},
  ) {
    const self = direct?.selfId ?? relay?.selfId;
    if (self === undefined) throw new Error('AutoTransport cần ít nhất một đường');
    if (direct && relay && direct.selfId !== relay.selfId) throw new Error('2 đường phải cùng selfId');
    this.selfId = self;
    this.fallbackMs = opts.fallbackMs ?? RELAY_FALLBACK_MS;
    this.timers = opts.timers ?? {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    };
    if (direct) {
      this.subs.push(
        direct.onPeerJoin((id) => this.directJoin(id)),
        direct.onPeerLeave((id) => this.directLeave(id)),
        direct.onMessage((data, from) => this.msg.emit(data, from)),
      );
      for (const id of direct.peers()) this.directJoin(id);
    }
    if (relay) {
      this.subs.push(
        relay.onPeerJoin((id) => this.relayJoin(id)),
        relay.onPeerLeave((id) => this.relayLeave(id)),
        relay.onMessage((data, from) => this.relayMessage(data, from)),
      );
      for (const id of relay.peers()) this.relayJoin(id);
    }
  }

  /** Đường đang dùng cho một người (bảng F3). */
  routeOf(id: PeerId): Route | null {
    return this.route.get(id) ?? null;
  }

  /** Số người đang đi qua relay. */
  get relayed(): number {
    let n = 0;
    for (const r of this.route.values()) if (r === 'relay') n++;
    return n;
  }

  peers(): PeerId[] {
    return [...this.route.keys()];
  }

  send(data: Uint8Array, opts: SendOptions = {}): void {
    if (opts.to === undefined && this.relayed === 0) {
      // không ai đi relay: y như trước (gửi cả phòng qua đường thẳng)
      this.direct?.send(data, opts);
      return;
    }
    const targets = opts.to === undefined ? this.peers() : Array.isArray(opts.to) ? opts.to : [opts.to];
    const viaDirect: PeerId[] = [];
    const viaRelay: PeerId[] = [];
    for (const id of targets) (this.route.get(id) === 'relay' ? viaRelay : viaDirect).push(id);
    if (viaDirect.length > 0) this.direct?.send(data, { ...opts, to: viaDirect });
    if (viaRelay.length > 0) this.relay?.send(data, { ...opts, to: viaRelay });
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
    for (const t of this.waiting.values()) this.timers.clearTimeout(t);
    this.waiting.clear();
    for (const u of this.subs) u();
    this.subs = [];
    this.route.clear();
    this.msg.clear();
    this.joinE.clear();
    this.leaveE.clear();
    await Promise.all([this.direct?.leave(), this.relay?.leave()]);
  }

  private directJoin(id: PeerId): void {
    this.stopWaiting(id);
    const had = this.route.has(id);
    this.route.set(id, 'direct');
    if (!had) this.joinE.emit(id);
  }

  private directLeave(id: PeerId): void {
    if (this.route.get(id) !== 'direct') return;
    if (this.relay?.peers().includes(id)) {
      this.route.set(id, 'relay'); // rớt đường thẳng nhưng còn relay: chơi tiếp, không báo rời phòng
      return;
    }
    this.route.delete(id);
    this.leaveE.emit(id);
  }

  private relayJoin(id: PeerId): void {
    if (this.route.has(id) || this.waiting.has(id)) return;
    if (!this.direct) {
      this.useRelay(id);
      return;
    }
    this.waiting.set(
      id,
      this.timers.setTimeout(() => {
        this.waiting.delete(id);
        if (!this.route.has(id) && this.relay?.peers().includes(id)) this.useRelay(id);
      }, this.fallbackMs),
    );
  }

  private relayLeave(id: PeerId): void {
    this.stopWaiting(id);
    if (this.route.get(id) !== 'relay') return;
    if (this.direct?.peers().includes(id)) {
      this.route.set(id, 'direct');
      return;
    }
    this.route.delete(id);
    this.leaveE.emit(id);
  }

  private relayMessage(data: Uint8Array, from: PeerId): void {
    // bên kia đã chọn relay cho mình (hết 8s trước mình) → chọn luôn, khỏi chờ
    if (!this.route.has(from)) this.useRelay(from);
    this.msg.emit(data, from);
  }

  private useRelay(id: PeerId): void {
    this.stopWaiting(id);
    this.route.set(id, 'relay');
    this.joinE.emit(id);
  }

  private stopWaiting(id: PeerId): void {
    const t = this.waiting.get(id);
    if (t === undefined) return;
    this.timers.clearTimeout(t);
    this.waiting.delete(id);
  }
}
