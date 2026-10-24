import { describe, expect, it } from 'vitest';
import { HostElection, type ElectionOptions } from './hostElection';
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
});
