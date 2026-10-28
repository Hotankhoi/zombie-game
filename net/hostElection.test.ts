import { describe, expect, it } from 'vitest';
import {
  HostElection,
  decodeFollowing,
  decodeScore,
  encodeScore,
  pickBest,
  type ElectionOptions,
} from './hostElection';
import type { Transport } from './transport';
import { LoopbackHub, type LoopbackTransport } from './loopback';

function room() {
  let t = 0;
  const hub = new LoopbackHub();
  const members: { tr: LoopbackTransport; el: HostElection }[] = [];
  const join = (id: string, opts?: ElectionOptions) => {
    const tr = hub.join(id);
    const el = new HostElection(tr, () => t, opts);
    members.push({ tr, el });
    return el;
  };
  const advance = (ms: number) => {
    for (let i = 0; i < ms; i += 100) {
      t += 100;
      for (const m of members) m.el.tick();
    }
  };
  return { join, advance, members };
}

describe('HostElection', () => {
  it('một mình trong phòng: tự làm host sau thời gian nghe', () => {
    const r = room();
    const a = r.join('m');
    r.advance(1500);
    expect(a.hostId).toBeNull();
    r.advance(600);
    expect(a.isHost).toBe(true);
  });

  it('vào phòng đã có host: theo host đó, kể cả khi id mình nhỏ hơn', () => {
    const r = room();
    const host = r.join('m');
    r.advance(3000);
    const late = r.join('a');
    r.advance(1100); // host nhắc mỗi 1s
    expect(late.hostId).toBe('m');
    r.advance(5000);
    expect(late.hostId).toBe('m');
    expect(host.isHost).toBe(true);
  });

  it('hai người vào cùng lúc: id nhỏ nhất làm host, cả hai thống nhất', () => {
    const r = room();
    const b = r.join('b');
    const a = r.join('a');
    r.advance(4000);
    expect(a.isHost).toBe(true);
    expect(b.hostId).toBe('a');
  });

  it('host rời phòng: người id nhỏ nhất còn lại lên ngay', () => {
    const r = room();
    const a = r.join('a');
    const c = r.join('c');
    const b = r.join('b');
    r.advance(4000);
    expect(b.hostId).toBe('a');
    const changes: (string | null)[] = [];
    b.changed.on((h) => changes.push(h));
    void r.members[0]!.tr.leave();
    a.dispose();
    r.advance(200);
    expect(b.isHost).toBe(true);
    expect(c.hostId).toBe('b');
    expect(changes).toEqual(['b']);
  });

  it('host mất tín hiệu (không rời hẳn): sau thời gian chờ thì chọn host mới', () => {
    const r = room();
    const a = r.join('a');
    const b = r.join('b');
    r.advance(4000);
    expect(b.hostId).toBe('a');
    a.dispose(); // a im lặng nhưng vẫn trong phòng
    r.members.splice(0, 1);
    r.advance(3000);
    expect(b.hostId).toBe('a');
    r.advance(1000); // im > 3.5s: b (id nhỏ nhất còn phản hồi) lên ngay
    expect(b.isHost).toBe(true);
  });

  it('người mới vào mà chưa nghe kịp host, tự nhận host → host cũ (làm lâu hơn) vẫn giữ quyền', () => {
    const r = room();
    const m = r.join('m');
    r.advance(10000);
    // a không chờ nghe (listenMs = 0) và không chờ host mà người khác báo (waitHostMs = 0) → tự nhận host ngay
    const a = r.join('a', { listenMs: 0, waitHostMs: 0 });
    const seen: (string | null)[] = [];
    a.changed.on((h) => seen.push(h));
    r.advance(1100);
    expect(seen).toEqual(['a', 'm']);
    expect(a.hostId).toBe('m');
    expect(m.isHost).toBe(true);
  });

  it('chưa có host: máy điểm tốt nhất (ping thấp, máy mạnh) nhận host dù id lớn hơn', () => {
    const r = room();
    const slow = r.join('a', { getScore: () => 400 });
    const fast = r.join('z', { getScore: () => 60 });
    r.advance(3000);
    expect(fast.isHost).toBe(true);
    expect(slow.hostId).toBe('z');
  });

  it('điểm gần bằng nhau (lệch ≤ 15) thì id nhỏ hơn làm host — mọi máy chọn giống nhau', () => {
    const r = room();
    const a = r.join('a', { getScore: () => 70 });
    const b = r.join('b', { getScore: () => 60 });
    r.advance(3000);
    expect(a.isHost).toBe(true);
    expect(b.hostId).toBe('a');
  });

  it('máy mạnh hơn vào sau không cướp host đang chạy', () => {
    const r = room();
    const old = r.join('m', { getScore: () => 500 });
    r.advance(5000);
    const strong = r.join('a', { getScore: () => 10 });
    r.advance(3000);
    expect(old.isHost).toBe(true);
    expect(strong.hostId).toBe('m');
  });

  it('host rời: máy điểm tốt nhất còn lại lên thay', () => {
    const r = room();
    const h = r.join('a', { getScore: () => 10 });
    const weak = r.join('b', { getScore: () => 300 });
    const good = r.join('c', { getScore: () => 50 });
    r.advance(4000);
    expect(weak.hostId).toBe('a');
    void r.members[0]!.tr.leave();
    h.dispose();
    r.members.splice(0, 1);
    r.advance(300);
    expect(good.isHost).toBe(true);
    expect(weak.hostId).toBe('c');
  });

  it('gói điểm: mã hóa/giải mã, kẹp trong 0..65535', () => {
    expect(decodeScore(encodeScore(123))).toBe(123);
    expect(decodeScore(encodeScore(1e9))).toBe(65535);
    expect(decodeScore(encodeScore(-5))).toBe(0);
    expect(decodeScore(new Uint8Array([126]))).toBeNull();
  });
});

describe('pickBest', () => {
  it('không phụ thuộc thứ tự duyệt (không có chu trình a > b > z > a)', () => {
    const cands = [
      { id: 'a', score: 100 },
      { id: 'b', score: 90 },
      { id: 'z', score: 80 },
    ];
    const orders = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    const picks = new Set(orders.map((o) => pickBest(o.map((i) => cands[i] as (typeof cands)[number]))));
    expect([...picks]).toEqual(['b']); // mốc 80, b (90) ngang z → id nhỏ hơn
  });

  it('chưa ai có điểm: id nhỏ nhất; có điểm thì hơn người chưa có', () => {
    expect(
      pickBest([
        { id: 'c', score: Infinity },
        { id: 'b', score: Infinity },
      ]),
    ).toBe('b');
    expect(
      pickBest([
        { id: 'a', score: Infinity },
        { id: 'c', score: 300 },
      ]),
    ).toBe('c');
  });
});

describe('HostElection — chờ host thật (tab vừa tải lại, lỗi 2A #2)', () => {
  /** Máy `a` chưa nghe được `m` (host) trong `blindMs` đầu (WebRTC nối chậm) nhưng nghe được những người khác. */
  function slowLink(blindMs: number, opts: ElectionOptions) {
    let t = 0;
    const hub = new LoopbackHub();
    const els: HostElection[] = [];
    const add = (tr: Transport, o?: ElectionOptions) => {
      const el = new HostElection(tr, () => t, o);
      els.push(el);
      return el;
    };
    const m = add(hub.join('m'));
    const z = add(hub.join('z'));
    const advance = (ms: number) => {
      for (let i = 0; i < ms; i += 100) {
        t += 100;
        for (const e of els) e.tick();
      }
    };
    advance(4000);
    const raw = hub.join('a');
    const start = t;
    const deaf: Transport = {
      selfId: raw.selfId,
      peers: () => raw.peers(),
      send: (d, o) => raw.send(d, o),
      onMessage: (h) =>
        raw.onMessage((d, from) => {
          if (from !== 'm' || t - start >= blindMs) h(d, from);
        }),
      onPeerJoin: (h) => raw.onPeerJoin(h),
      onPeerLeave: (h) => raw.onPeerLeave(h),
      leave: () => raw.leave(),
    };
    const a = add(deaf, { ...opts });
    return { m, z, a, advance, now: () => t };
  }

  it('người đã nối (z) báo "đang theo host" → a chờ, không tự nhận; nghe được m thì theo m', () => {
    const { a, m, advance } = slowLink(5000, {});
    advance(4500);
    expect(a.hostId).toBeNull();
    expect(a.waitingForHostMs()).not.toBeNull();
    advance(1500);
    expect(a.hostId).toBe('m');
    expect(m.isHost).toBe(true);
  });

  it('ghi nhớ "có host" (expectHostUntil) mà chưa nối được ai → chờ tới hạn rồi mới tự nhận', () => {
    let t = 0;
    const hub = new LoopbackHub();
    const a = new HostElection(hub.join('a'), () => t, { expectHostUntil: 10_000 });
    for (; t < 9_900; t += 100) a.tick();
    expect(a.hostId).toBeNull();
    expect(a.waitingForHostMs()!).toBeLessThanOrEqual(200);
    for (; t < 10_200; t += 100) a.tick();
    expect(a.isHost).toBe(true);
  });

  it('mọi người đã nối đều báo "không có host" → thôi chờ, bầu host như thường', () => {
    let t = 0;
    const hub = new LoopbackHub();
    const a = new HostElection(hub.join('a'), () => t, { expectHostUntil: 10_000 });
    const b = new HostElection(hub.join('b'), () => t);
    for (; t < 4_500; t += 100) {
      a.tick();
      b.tick();
    }
    expect(a.isHost).toBe(true);
    expect(b.hostId).toBe('a');
  });

  it('gói điểm bản cũ (3 byte) vẫn đọc được điểm; cờ mới ở byte 4', () => {
    expect(decodeScore(new Uint8Array([126, 0, 42]))).toBe(42);
    expect(decodeFollowing(new Uint8Array([126, 0, 42]))).toBeNull();
    expect(decodeFollowing(encodeScore(7, true))).toBe(true);
    expect(decodeScore(encodeScore(7, true))).toBe(7);
  });
});
