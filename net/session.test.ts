import { describe, expect, it } from 'vitest';
import { LoopbackHub } from './loopback';
import { ConditionedTransport, type Scheduler } from './conditions';
import { PROTOCOL_VERSION } from '@shared/types';
import { GameMsg } from './gameCodec';
import { HostElection } from './hostElection';
import { Session, type SessionOptions } from './session';

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

describe('Session.game (chặn khác phiên bản)', () => {
  /** Phòng có đồng hồ giả: mỗi người = Session (bản nào tùy chọn) + HostElection trên session.game. */
  function room() {
    let t = 0;
    const hub = new LoopbackHub();
    const members: { s: Session; el: HostElection }[] = [];
    const join = (id: string, opts: Partial<SessionOptions> = {}) => {
      const s = new Session(hub.join(id), { name: id, color: 0, ...opts }, () => t);
      const el = new HostElection(s.game, () => t);
      members.push({ s, el });
      return { s, el };
    };
    const advance = (ms: number) => {
      for (let i = 0; i < ms; i += 100) {
        t += 100;
        for (const m of members) m.el.tick();
      }
    };
    return { join, advance };
  }

  it('2 bản khác PROTOCOL_VERSION không ghép trận: mỗi bên tự làm host riêng, gói game không tới', () => {
    const r = room();
    const a = r.join('A', { version: PROTOCOL_VERSION });
    const b = r.join('B', { version: PROTOCOL_VERSION + 1 });
    r.advance(5000);
    // phòng chờ vẫn thấy nhau (để hiện "khác phiên bản")
    expect(a.s.peers.get('B')?.versionMismatch).toBe(true);
    expect(b.s.peers.get('A')?.versionMismatch).toBe(true);
    // trong trận thì không
    expect(a.s.game.peers()).toEqual([]);
    expect(b.s.game.peers()).toEqual([]);
    expect(a.el.isHost).toBe(true);
    expect(b.el.isHost).toBe(true);
    const got: Uint8Array[] = [];
    b.s.game.onMessage((d) => got.push(d));
    a.s.game.send(new Uint8Array([GameMsg.Snapshot, 1, 2, 3]));
    a.s.game.send(new Uint8Array([GameMsg.Snapshot, 1, 2, 3]), { to: 'B' });
    a.s.transport.send(new Uint8Array([GameMsg.Snapshot, 1, 2, 3]), { to: 'B' }); // lọt đường thô cũng bị lọc
    expect(got).toEqual([]);
    // bản thấp hơn thấy nhắc "bản cũ", bản mới không
    expect(a.s.updateNotice).toBe('old');
    expect(b.s.updateNotice).toBeNull();
  });

  it('cùng phiên bản: ghép trận chung 1 host, gói game tới nhau', () => {
    const r = room();
    const a = r.join('A');
    const b = r.join('B');
    r.advance(5000);
    expect(a.s.game.peers()).toEqual(['B']);
    expect(a.el.hostId).toBe('A');
    expect(b.el.hostId).toBe('A');
    const got: Uint8Array[] = [];
    b.s.game.onMessage((d) => got.push(d));
    a.s.game.send(new Uint8Array([GameMsg.Snapshot, 9]));
    expect(got).toHaveLength(1);
  });

  it('cùng giao thức, khác build: vẫn chơi chung, bản build cũ hơn được nhắc "có bản mới"', () => {
    const r = room();
    const a = r.join('A', { build: { id: 'aaaa', time: 1000 } });
    const b = r.join('B', { build: { id: 'bbbb', time: 2000 } });
    r.advance(5000);
    expect(a.s.game.peers()).toEqual(['B']);
    expect(b.el.hostId).toBe(a.el.hostId);
    expect(a.s.updateNotice).toBe('newer');
    expect(b.s.updateNotice).toBeNull();
    // bản dev (time 0) không bao giờ bị nhắc
    const c = r.join('C', { build: { id: 'dev', time: 0 } });
    r.advance(500);
    expect(c.s.updateNotice).toBeNull();
  });

  it('người khác bản rời phòng: không báo rời trong trận (vì chưa từng vào)', async () => {
    const r = room();
    const a = r.join('A');
    const b = r.join('B', { version: PROTOCOL_VERSION + 1 });
    const c = r.join('C');
    r.advance(3000);
    const left: string[] = [];
    a.s.game.onPeerLeave((id) => left.push(id));
    await b.s.leave();
    await c.s.leave();
    expect(left).toEqual(['C']);
  });
});
