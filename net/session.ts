import { PROTOCOL_VERSION, type PeerId } from '@shared/types';
import { BUILD, type BuildInfo } from './build';
import { MsgType, decode, encode, hello } from './codec';
import { Emitter, type SendOptions, type Transport, type Unsubscribe } from './transport';

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
  /** PROTOCOL_VERSION họ gửi trong Hello; null = chưa nghe họ chào. */
  version: number | null;
  /** Bản build của họ (id rỗng = bản cũ chưa gửi). */
  build: BuildInfo;
}

export interface SessionOptions {
  name: string;
  color: number;
  /** Bao lâu ping một lần (ms). */
  pingIntervalMs?: number;
  /** Chỉ để test: giả làm bản game khác. */
  version?: number;
  build?: BuildInfo;
}

/** Nhắc cập nhật: 'old' = mình là bản cũ (giao thức thấp hơn người khác, không chơi chung được);
 * 'newer' = cùng giao thức nhưng có người build mới hơn (vẫn chơi được, nên tải lại); null = ổn. */
export type UpdateNotice = 'old' | 'newer' | null;

/**
 * Phiên phòng chờ giai đoạn 0: chào nhau (Hello) và đo ping (Ping/Pong).
 * Gọi tick(now) đều đặn từ vòng lặp game. Không tự dùng timer để test được tất định.
 *
 * `game` là cửa lọc cho mọi gói trong trận (bầu host, input, snapshot, sao lưu, loot): chỉ thấy những người đã
 * chào cùng PROTOCOL_VERSION — người khác phiên bản vẫn hiện ở phòng chờ ("khác phiên bản") nhưng không ghép
 * trận, không gửi/nhận gói game với mình (tránh đọc lệch byte ra trạng thái hỏng).
 */
export class Session {
  readonly peers = new Map<PeerId, PeerState>();
  readonly changed = new Emitter<[]>();
  readonly game: Transport;
  private seq = 0;
  /** Những người đã gửi Hello cho mình ít nhất 1 lần. */
  private heardFrom = new Set<PeerId>();
  private lastPingAt = -Infinity;
  private subs: Unsubscribe[] = [];
  private readonly pingInterval: number;
  private readonly version: number;
  private readonly build: BuildInfo;
  private readonly gate: GameGate;

  constructor(
    readonly transport: Transport,
    private me: SessionOptions,
    private now: () => number = () => performance.now(),
  ) {
    this.pingInterval = me.pingIntervalMs ?? 1000;
    this.version = me.version ?? PROTOCOL_VERSION;
    this.build = me.build ?? BUILD;
    this.gate = new GameGate(transport);
    this.game = this.gate;
    this.subs.push(
      transport.onPeerJoin((id) => this.handleJoin(id)),
      transport.onPeerLeave((id) => {
        this.peers.delete(id);
        this.heardFrom.delete(id);
        this.gate.setCompatible(id, false);
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
    this.transport.send(encode(this.hello()));
    this.changed.emit();
  }

  get myName(): string {
    return this.me.name;
  }

  /** Có cần nhắc tải lại trang không (xem UpdateNotice). */
  get updateNotice(): UpdateNotice {
    let notice: UpdateNotice = null;
    for (const p of this.peers.values()) {
      if (p.version === null) continue;
      if (p.version > this.version) return 'old';
      if (p.version === this.version && this.build.time > 0 && p.build.time > this.build.time)
        notice = 'newer';
    }
    return notice;
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
    this.gate.dispose();
    await this.transport.leave();
  }

  private hello() {
    return hello(this.me.name, this.me.color, this.version, this.build);
  }

  private newPeer(id: PeerId): PeerState {
    return {
      id,
      name: '…',
      color: 0x888888,
      rttMs: null,
      pongs: 0,
      versionMismatch: false,
      version: null,
      build: { id: '', time: 0 },
    };
  }

  private handleJoin(id: PeerId): void {
    if (!this.peers.has(id)) this.peers.set(id, this.newPeer(id));
    // Chào riêng người mới vào để họ biết tên/màu của mình
    this.transport.send(encode(this.hello()), { to: id });
    this.changed.emit();
  }

  private handleMessage(data: Uint8Array, from: PeerId): void {
    const msg = decode(data);
    if (!msg) return;
    let peer = this.peers.get(from);
    if (!peer) {
      // Tin nhắn đến trước sự kiện join (có thể xảy ra với WebRTC) → tạo luôn
      peer = this.newPeer(from);
      this.peers.set(from, peer);
    }
    switch (msg.type) {
      case MsgType.Hello:
        // Lần đầu nghe họ chào → chào lại 1 lần, phòng khi Hello của mình gửi lúc họ chưa sẵn sàng nghe
        if (!this.heardFrom.has(from)) {
          this.heardFrom.add(from);
          this.transport.send(encode(this.hello()), { to: from });
        }
        peer.name = msg.name || 'Người chơi';
        peer.color = msg.color;
        peer.version = msg.version;
        peer.build = msg.build;
        peer.versionMismatch = msg.version !== this.version;
        this.gate.setCompatible(from, !peer.versionMismatch);
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

/**
 * Transport chỉ gồm những người cùng phiên bản giao thức (đã chào nhau). Người chưa chào coi như chưa vào phòng
 * (bầu host nghe 2s trước khi tự nhận, Hello tới gần như cùng lúc với join nên không làm chậm vào trận).
 */
class GameGate implements Transport {
  private ok = new Set<PeerId>();
  private msg = new Emitter<[Uint8Array, PeerId]>();
  private joinE = new Emitter<[PeerId]>();
  private leaveE = new Emitter<[PeerId]>();
  private unsub: Unsubscribe;

  constructor(private inner: Transport) {
    this.unsub = inner.onMessage((data, from) => {
      if (this.ok.has(from)) this.msg.emit(data, from);
    });
  }

  get selfId(): PeerId {
    return this.inner.selfId;
  }

  setCompatible(id: PeerId, yes: boolean): void {
    if (yes === this.ok.has(id)) return;
    if (yes) {
      this.ok.add(id);
      this.joinE.emit(id);
    } else {
      this.ok.delete(id);
      this.leaveE.emit(id);
    }
  }

  peers(): PeerId[] {
    return [...this.ok];
  }

  send(data: Uint8Array, opts: SendOptions = {}): void {
    const want = opts.to === undefined ? [...this.ok] : Array.isArray(opts.to) ? opts.to : [opts.to];
    const to = want.filter((id) => this.ok.has(id));
    if (to.length === 0) return;
    this.inner.send(data, { ...opts, to: to.length === 1 ? to[0] : to });
  }

  onMessage(h: (data: Uint8Array, from: PeerId) => void): Unsubscribe {
    return this.msg.on(h);
  }
  onPeerJoin(h: (peer: PeerId) => void): Unsubscribe {
    return this.joinE.on(h);
  }
  onPeerLeave(h: (peer: PeerId) => void): Unsubscribe {
    return this.leaveE.on(h);
  }

  leave(): Promise<void> {
    return this.inner.leave();
  }

  dispose(): void {
    this.unsub();
  }
}
