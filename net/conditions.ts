import type { PeerId } from '@shared/types';
import type { SendOptions, Transport } from './transport';

/**
 * Giả lập mạng xấu (AGENTS.md mục 2.12) — bọc ngoài bất kỳ Transport nào.
 * Giống công cụ Network Simulation của Roblox Studio: thêm trễ, giật, mất gói vào gói GỬI ĐI.
 */
export interface NetConditions {
  /** Trễ thêm một chiều (ms). */
  latencyMs: number;
  /** Dao động ngẫu nhiên ± (ms). */
  jitterMs: number;
  /** Tỉ lệ mất gói 0..1 — chỉ áp dụng cho kênh 'unreliable'. */
  loss: number;
}

export const GOOD_NETWORK: NetConditions = { latencyMs: 0, jitterMs: 0, loss: 0 };

export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  now(): number;
  random(): number;
}

const defaultScheduler: Scheduler = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  now: () => performance.now(),
  random: () => Math.random(), // chỉ dùng cho giả lập mạng, không phải logic game
};

export class ConditionedTransport implements Transport {
  conditions: NetConditions;
  /** Thời điểm gói reliable gần nhất sẽ được gửi, theo từng đích — giữ đúng thứ tự cho kênh reliable. */
  private lastReliableAt = new Map<string, number>();

  constructor(
    private inner: Transport,
    conditions: NetConditions = GOOD_NETWORK,
    private sched: Scheduler = defaultScheduler,
  ) {
    this.conditions = { ...conditions };
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
    const { latencyMs, jitterMs, loss } = this.conditions;
    const channel = opts.channel ?? 'reliable';
    if (channel === 'unreliable' && loss > 0 && this.sched.random() < loss) return;

    if (latencyMs <= 0 && jitterMs <= 0) {
      this.inner.send(data, opts);
      return;
    }
    const jitter = jitterMs > 0 ? (this.sched.random() * 2 - 1) * jitterMs : 0;
    let delay = Math.max(0, latencyMs + jitter);

    if (channel === 'reliable') {
      const key = opts.to === undefined ? '*' : String(opts.to);
      const now = this.sched.now();
      const at = Math.max(now + delay, this.lastReliableAt.get(key) ?? 0);
      this.lastReliableAt.set(key, at);
      delay = at - now;
    }
    const copy = data.slice();
    this.sched.setTimeout(() => this.inner.send(copy, opts), delay);
  }
}
