import { describe, expect, it } from 'vitest';
import { AutoTransport } from './auto';
import { LoopbackHub, type LoopbackTransport } from './loopback';
import { FakeTimers } from './testTimers';

/**
 * Chuyển đường: 2 LoopbackHub — `direct` giả WebRTC, `relay` giả relay WebSocket.
 * Người "4G" chỉ vào được hub relay (không nối thẳng được).
 */
function setup() {
  const timers = new FakeTimers();
  const direct = new LoopbackHub();
  const relay = new LoopbackHub();
  const make = (id: string, viaDirect: boolean) => {
    // không nối thẳng được = WebRTC vẫn chạy nhưng không thấy ai (hub riêng)
    const d = viaDirect ? direct.join(id) : new LoopbackHub().join(id);
    const r = relay.join(id);
    const sends = { direct: 0, relay: 0 };
    count(d, () => sends.direct++);
    count(r, () => sends.relay++);
    const auto = new AutoTransport(d, r, { timers });
    const got: string[] = [];
    const events: string[] = [];
    auto.onMessage((data, from) => got.push(`${from}:${data[0]}`));
    auto.onPeerJoin((p) => events.push(`+${p}`));
    auto.onPeerLeave((p) => events.push(`-${p}`));
    return { auto, d, r, sends, got, events };
  };
  return { timers, direct, relay, make };
}

function count(t: LoopbackTransport | null, fn: () => void) {
  if (!t) return;
  const send = t.send.bind(t);
  t.send = (data, opts) => {
    fn();
    send(data, opts);
  };
}

describe('AutoTransport', () => {
  it('nối thẳng được: dùng đường thẳng, relay không tốn gói nào', () => {
    const { make, timers } = setup();
    const a = make('A', true);
    const b = make('B', true);
    expect(a.auto.peers()).toEqual(['B']);
    expect(a.auto.routeOf('B')).toBe('direct');
    a.auto.send(Uint8Array.of(1));
    a.auto.send(Uint8Array.of(2), { to: 'B', channel: 'unreliable' });
    timers.advance(20_000);
    expect(b.got).toEqual(['A:1', 'A:2']);
    expect(a.sends.relay).toBe(0);
    expect(a.events).toEqual(['+B']);
  });

  it('không nối thẳng được: sau 8s đi qua relay, 2 chiều đều tới, không nhận trùng', () => {
    const { make, timers } = setup();
    const a = make('A', true);
    const b = make('B', true);
    const c = make('C', false); // 4G
    timers.advance(7999);
    expect(a.auto.peers()).toEqual(['B']);
    expect(c.auto.peers()).toEqual([]);
    timers.advance(1);
    expect(a.auto.routeOf('C')).toBe('relay');
    expect(c.auto.peers().sort()).toEqual(['A', 'B']);
    expect(c.events.sort()).toEqual(['+A', '+B']);

    a.auto.send(Uint8Array.of(7)); // cả phòng: B đi thẳng, C qua relay
    c.auto.send(Uint8Array.of(8), { to: 'A' });
    c.auto.send(Uint8Array.of(9));
    expect(b.got).toEqual(['A:7', 'C:9']);
    expect(c.got).toEqual(['A:7']);
    expect(a.got).toEqual(['C:8', 'C:9']);
    expect(a.sends).toEqual({ direct: 1, relay: 1 });
  });

  it('nhận gói qua relay từ người đang chờ → chọn relay ngay, không chờ đủ 8s', () => {
    // mỗi máy một đồng hồ: đồng hồ của C chạy trước (C thấy A trên relay sớm hơn)
    const ta = new FakeTimers();
    const tc = new FakeTimers();
    const relay = new LoopbackHub();
    const a = new AutoTransport(new LoopbackHub().join('A'), relay.join('A'), { timers: ta });
    const c = new AutoTransport(new LoopbackHub().join('C'), relay.join('C'), { timers: tc });
    const got: string[] = [];
    const events: string[] = [];
    a.onMessage((d, f) => got.push(`${f}:${d[0]}`));
    a.onPeerJoin((p) => events.push(`+${p}`));
    tc.advance(8000);
    ta.advance(3000);
    expect(c.peers()).toEqual(['A']);
    expect(a.peers()).toEqual([]);
    c.send(Uint8Array.of(4));
    expect(a.peers()).toEqual(['C']);
    expect(got).toEqual(['C:4']);
    expect(events).toEqual(['+C']);
    ta.advance(10_000); // hẹn giờ cũ của A đã hủy: không vào lần 2
    expect(events).toEqual(['+C']);
  });

  it('nối thẳng được muộn → quay về đường thẳng, game không thấy ai rời', () => {
    const { make, timers, direct } = setup();
    const a = make('A', true);
    make('C', false);
    timers.advance(8000);
    expect(a.auto.routeOf('C')).toBe('relay');
    direct.join('C'); // giả WebRTC nối được muộn (phía A thấy C trên đường thẳng)
    expect(a.auto.routeOf('C')).toBe('direct');
    a.auto.send(Uint8Array.of(5), { to: 'C' });
    expect(a.sends.relay).toBe(0);
    expect(a.events).toEqual(['+C']);
  });

  it('rớt đường thẳng nhưng còn relay → chơi tiếp qua relay; rời cả 2 → báo rời', async () => {
    const { make } = setup();
    const a = make('A', true);
    const b = make('B', true);
    await b.d!.leave(); // WebRTC của B rớt
    expect(a.auto.routeOf('B')).toBe('relay');
    expect(a.events).toEqual(['+B']);
    a.auto.send(Uint8Array.of(6));
    expect(b.got).toEqual(['A:6']);
    await b.r.leave();
    expect(a.auto.peers()).toEqual([]);
    expect(a.events).toEqual(['+B', '-B']);
  });

  it('rời relay trước khi hết 8s → không vào, không rời', async () => {
    const { make, timers } = setup();
    const a = make('A', true);
    const c = make('C', false);
    timers.advance(2000);
    await c.r.leave();
    timers.advance(20_000);
    expect(a.events).toEqual([]);
  });

  it('?relay=ws (không có đường thẳng): mọi người đi relay ngay', () => {
    const timers = new FakeTimers();
    const relay = new LoopbackHub();
    const direct = new LoopbackHub();
    const a = new AutoTransport(direct.join('A'), relay.join('A'), { timers });
    const c = new AutoTransport(null, relay.join('C'), { timers });
    expect(c.peers()).toEqual(['A']);
    const got: string[] = [];
    a.onMessage((d, f) => got.push(`${f}:${d[0]}`));
    c.send(Uint8Array.of(1));
    expect(got).toEqual(['C:1']);
    expect(a.routeOf('C')).toBe('relay');
  });

  it('không có relay (chưa đặt VITE_RELAY_URL): giống hệt đường thẳng', () => {
    const direct = new LoopbackHub();
    const a = new AutoTransport(direct.join('A'), null);
    const b = direct.join('B');
    const got: number[] = [];
    b.onMessage((d) => got.push(d[0]!));
    a.send(Uint8Array.of(3));
    expect(a.peers()).toEqual(['B']);
    expect(got).toEqual([3]);
  });
});
