import { describe, expect, it } from 'vitest';
import { HostElection, decodeScore, encodeScore, pickBest, type ElectionOptions } from './hostElection';
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
    // a không chờ nghe (listenMs = 0) nên tự nhận host ngay ở tick đầu
    const a = r.join('a', { listenMs: 0 });
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
