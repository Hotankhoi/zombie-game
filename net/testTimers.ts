/** Đồng hồ giả cho test mạng: hẹn giờ chỉ chạy khi gọi advance(ms). */
export class FakeTimers {
  private t = 0;
  private seq = 0;
  private pending = new Map<number, { at: number; fn: () => void }>();

  now = (): number => this.t;

  setTimeout = (fn: () => void, ms: number): unknown => {
    const id = ++this.seq;
    this.pending.set(id, { at: this.t + Math.max(0, ms), fn });
    return id;
  };

  clearTimeout = (id: unknown): void => {
    this.pending.delete(id as number);
  };

  /** Chạy mọi hẹn giờ tới hạn trong `ms` tới, theo đúng thứ tự thời gian. */
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | null = null;
      for (const e of this.pending) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e;
      if (!next) break;
      this.pending.delete(next[0]);
      this.t = next[1].at;
      next[1].fn();
    }
    this.t = end;
  }
}
