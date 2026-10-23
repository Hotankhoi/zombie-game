import { PROTOCOL_VERSION, type PeerId } from '@shared/types';
import { MsgType, decode, encode, hello } from './codec';
import { Emitter, type Transport, type Unsubscribe } from './transport';

export interface PeerState {
  id: PeerId;
  name: string;
  color: number;
  /** Ping khứ hồi gần nhất (ms), làm mượt. null = chưa đo được. */
  rttMs: number | null;
  /** Số pong đã nhận (chứng minh 2 máy nói chuyện được với nhau). */
  pongs: number;
  /** Bản game khác phiên bản giao thức → không chơi chung được. */
  versionMismatch: boolean;
}

export interface SessionOptions {
  name: string;
  color: number;
  /** Bao lâu ping một lần (ms). */
  pingIntervalMs?: number;
}

/**
 * Phiên phòng chờ giai đoạn 0: chào nhau (Hello) và đo ping (Ping/Pong).
 * Gọi tick(now) đều đặn từ vòng lặp game. Không tự dùng timer để test được tất định.
 */
export class Session {
  readonly peers = new Map<PeerId, PeerState>();
  readonly changed = new Emitter<[]>();
  private seq = 0;
  /** Những người đã gửi Hello cho mình ít nhất 1 lần. */
  private heardFrom = new Set<PeerId>();
  private lastPingAt = -Infinity;
  private subs: Unsubscribe[] = [];
  private readonly pingInterval: number;

  constructor(
    readonly transport: Transport,
    private me: SessionOptions,
    private now: () => number = () => performance.now(),
  ) {
    this.pingInterval = me.pingIntervalMs ?? 1000;
    this.subs.push(
      transport.onPeerJoin((id) => this.handleJoin(id)),
      transport.onPeerLeave((id) => {
        this.peers.delete(id);
        this.heardFrom.delete(id);
        this.changed.emit();
      }),
      transport.onMessage((data, from) => this.handleMessage(data, from)),
    );
    for (const id of transport.peers()) this.handleJoin(id);
  }

  get selfId(): PeerId {
    return this.transport.selfId;
  }

  /** Đổi tên/màu và báo cho cả phòng. */
  setMe(name: string, color: number): void {
    this.me = { ...this.me, name, color };
    this.transport.send(encode(hello(name, color)));
    this.changed.emit();
  }

  get myName(): string {
    return this.me.name;
  }

  tick(): void {
    const t = this.now();
    if (t - this.lastPingAt < this.pingInterval || this.peers.size === 0) return;
    this.lastPingAt = t;
    this.transport.send(encode({ type: MsgType.Ping, seq: ++this.seq, sentAt: t }), {
      channel: 'unreliable',
    });
  }

  async leave(): Promise<void> {
    for (const u of this.subs) u();
    this.subs = [];
    await this.transport.leave();
  }

  private handleJoin(id: PeerId): void {
    if (!this.peers.has(id)) {
      this.peers.set(id, { id, name: '…', color: 0x888888, rttMs: null, pongs: 0, versionMismatch: false });
    }
    // Chào riêng người mới vào để họ biết tên/màu của mình
    this.transport.send(encode(hello(this.me.name, this.me.color)), { to: id });
    this.changed.emit();
  }

  private handleMessage(data: Uint8Array, from: PeerId): void {
    const msg = decode(data);
    if (!msg) return;
    let peer = this.peers.get(from);
    if (!peer) {
      // Tin nhắn đến trước sự kiện join (có thể xảy ra với WebRTC) → tạo luôn
      peer = { id: from, name: '…', color: 0x888888, rttMs: null, pongs: 0, versionMismatch: false };
      this.peers.set(from, peer);
    }
    switch (msg.type) {
      case MsgType.Hello:
        // Lần đầu nghe họ chào → chào lại 1 lần, phòng khi Hello của mình gửi lúc họ chưa sẵn sàng nghe
        if (!this.heardFrom.has(from)) {
          this.heardFrom.add(from);
          this.transport.send(encode(hello(this.me.name, this.me.color)), { to: from });
        }
        peer.name = msg.name || 'Người chơi';
        peer.color = msg.color;
        peer.versionMismatch = msg.version !== PROTOCOL_VERSION;
        break;
      case MsgType.Ping:
        this.transport.send(encode({ type: MsgType.Pong, seq: msg.seq, sentAt: msg.sentAt }), {
          to: from,
          channel: 'unreliable',
        });
        return;
      case MsgType.Pong: {
        const rtt = Math.max(0, this.now() - msg.sentAt);
        peer.rttMs = peer.rttMs === null ? rtt : peer.rttMs * 0.7 + rtt * 0.3;
        peer.pongs++;
        break;
      }
    }
    this.changed.emit();
  }
}
