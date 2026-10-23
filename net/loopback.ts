import type { PeerId } from '@shared/types';
import { Emitter, type SendOptions, type Transport } from './transport';

/**
 * Mạng giả trong bộ nhớ: nhiều "người chơi" trong cùng một tiến trình.
 * Dùng cho test tự động và bot giả lập (tools/). Không cần internet.
 */
export class LoopbackHub {
  private members = new Map<PeerId, LoopbackTransport>();
  private counter = 0;

  join(id: PeerId = `peer${++this.counter}`): LoopbackTransport {
    const t = new LoopbackTransport(id, this);
    const existing = [...this.members.values()];
    this.members.set(id, t);
    for (const other of existing) {
      other._peerJoin(id);
      t._peerJoin(other.selfId);
    }
    return t;
  }

  /** @internal */
  _leave(id: PeerId): void {
    if (!this.members.delete(id)) return;
    for (const other of this.members.values()) other._peerLeave(id);
  }

  /** @internal */
  _deliver(from: PeerId, data: Uint8Array, to: PeerId[] | null): void {
    for (const [id, t] of this.members) {
      if (id === from) continue;
      if (to && !to.includes(id)) continue;
      // copy để mô phỏng đúng việc dữ liệu đi qua mạng
      t._receive(data.slice(), from);
    }
  }
}

export class LoopbackTransport implements Transport {
  private known = new Set<PeerId>();
  private msg = new Emitter<[Uint8Array, PeerId]>();
  private joinE = new Emitter<[PeerId]>();
  private leaveE = new Emitter<[PeerId]>();
  private left = false;

  constructor(
    readonly selfId: PeerId,
    private hub: LoopbackHub,
  ) {}

  peers(): PeerId[] {
    return [...this.known];
  }

  send(data: Uint8Array, opts: SendOptions = {}): void {
    if (this.left) return;
    const to = opts.to === undefined ? null : Array.isArray(opts.to) ? opts.to : [opts.to];
    this.hub._deliver(this.selfId, data, to);
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
    this.left = true;
    this.hub._leave(this.selfId);
    this.known.clear();
  }

  /** @internal */ _peerJoin(id: PeerId) {
    if (this.known.has(id)) return;
    this.known.add(id);
    this.joinE.emit(id);
  }
  /** @internal */ _peerLeave(id: PeerId) {
    if (!this.known.delete(id)) return;
    this.leaveE.emit(id);
  }
  /** @internal */ _receive(data: Uint8Array, from: PeerId) {
    if (!this.left) this.msg.emit(data, from);
  }
}
