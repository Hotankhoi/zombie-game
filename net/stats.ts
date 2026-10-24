import type { PeerId } from '@shared/types';
import type { SendOptions, Transport } from './transport';

/**
 * Đếm băng thông (AGENTS.md mục 2.12: bảng debug hiện băng thông). Bọc ngoài Transport bất kỳ.
 * Gói gửi cho nhiều người được tính một lần cho mỗi người nhận (đúng với P2P: gửi riêng từng kết nối).
 */
export class CountingTransport implements Transport {
  /** KB/s gửi và nhận, cập nhật mỗi giây. */
  upKBps = 0;
  downKBps = 0;
  private up = 0;
  private down = 0;
  private since: number;

  constructor(
    private inner: Transport,
    private now: () => number = () => performance.now(),
  ) {
    this.since = now();
    inner.onMessage((data) => {
      this.down += data.length;
    });
  }

  get selfId(): PeerId {
    return this.inner.selfId;
  }
  peers() {
    return this.inner.peers();
  }
  onMessage(h: (data: Uint8Array, from: PeerId) => void) {
    return this.inner.onMessage(h);
  }
  onPeerJoin(h: (peer: PeerId) => void) {
    return this.inner.onPeerJoin(h);
  }
  onPeerLeave(h: (peer: PeerId) => void) {
    return this.inner.onPeerLeave(h);
  }
  leave() {
    return this.inner.leave();
  }

  send(data: Uint8Array, opts: SendOptions = {}): void {
    const n = opts.to === undefined ? this.inner.peers().length : Array.isArray(opts.to) ? opts.to.length : 1;
    this.up += data.length * n;
    this.inner.send(data, opts);
  }

  /** Gọi định kỳ (vd: mỗi frame) để chốt số KB/s mỗi giây. */
  update(): void {
    const t = this.now();
    const dt = t - this.since;
    if (dt < 1000) return;
    this.upKBps = this.up / 1024 / (dt / 1000);
    this.downKBps = this.down / 1024 / (dt / 1000);
    this.up = this.down = 0;
    this.since = t;
  }
}
