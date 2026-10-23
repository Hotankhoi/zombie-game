import { describe, expect, it } from 'vitest';
import { LoopbackHub } from './loopback';
import { ConditionedTransport, type Scheduler } from './conditions';
import { Session } from './session';

/** Đồng hồ + hàng đợi timer giả để test tất định. */
function fakeClock() {
  let t = 0;
  const queue: { at: number; fn: () => void }[] = [];
  const sched: Scheduler = {
    now: () => t,
    random: () => 0.5,
    setTimeout: (fn, ms) => queue.push({ at: t + ms, fn }),
  };
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      queue.sort((a, b) => a.at - b.at);
      const next = queue[0];
      if (!next || next.at > end) break;
      queue.shift();
      t = next.at;
      next.fn();
    }
    t = end;
  };
  return { sched, advance, now: () => t };
}

describe('Session (phòng chờ ping/pong)', () => {
  it('2 người vào phòng thấy tên nhau và đo được ping', () => {
    const hub = new LoopbackHub();
    const a = new Session(hub.join('A'), { name: 'An', color: 1 }, () => 0);
    const b = new Session(hub.join('B'), { name: 'Bình', color: 2 }, () => 0);

    expect(a.peers.get('B')?.name).toBe('Bình');
    expect(b.peers.get('A')?.name).toBe('An');

    a.tick();
    expect(a.peers.get('B')?.pongs).toBe(1);
    expect(a.peers.get('B')?.rttMs).toBe(0);
  });

  it('4 người, một người rời phòng thì những người còn lại cập nhật', async () => {
    const hub = new LoopbackHub();
    const s = ['A', 'B', 'C', 'D'].map((id) => new Session(hub.join(id), { name: id, color: 0 }, () => 0));
    for (const x of s) expect(x.peers.size).toBe(3);
    await s[3]!.leave();
    for (const x of s.slice(0, 3)) expect([...x.peers.keys()]).not.toContain('D');
  });

  it('giả lập trễ 150ms một chiều → ping khứ hồi ~300ms', () => {
    const clock = fakeClock();
    const hub = new LoopbackHub();
    const cond = { latencyMs: 150, jitterMs: 0, loss: 0 };
    const ta = new ConditionedTransport(hub.join('A'), cond, clock.sched);
    const tb = new ConditionedTransport(hub.join('B'), cond, clock.sched);
    const a = new Session(ta, { name: 'An', color: 1 }, clock.now);
    new Session(tb, { name: 'Bình', color: 2 }, clock.now);

    clock.advance(1000);
    a.tick();
    clock.advance(1000);
    expect(a.peers.get('B')?.rttMs).toBe(300);
  });

  it('mất 100% gói unreliable → không có pong, nhưng Hello (reliable) vẫn tới', () => {
    const clock = fakeClock();
    const hub = new LoopbackHub();
    const cond = { latencyMs: 0, jitterMs: 0, loss: 1 };
    const a = new Session(
      new ConditionedTransport(hub.join('A'), cond, clock.sched),
      { name: 'An', color: 1 },
      clock.now,
    );
    new Session(
      new ConditionedTransport(hub.join('B'), cond, clock.sched),
      { name: 'Bình', color: 2 },
      clock.now,
    );
    a.tick();
    clock.advance(500);
    expect(a.peers.get('B')?.name).toBe('Bình');
    expect(a.peers.get('B')?.pongs).toBe(0);
  });
});

describe('Session.setMe', () => {
  it('đổi tên thì người khác thấy tên mới', () => {
    const hub = new LoopbackHub();
    const a = new Session(hub.join('A'), { name: 'An', color: 1 }, () => 0);
    const b = new Session(hub.join('B'), { name: 'Bình', color: 2 }, () => 0);
    a.setMe('An Pro', 3);
    expect(b.peers.get('A')).toMatchObject({ name: 'An Pro', color: 3 });
  });
});
