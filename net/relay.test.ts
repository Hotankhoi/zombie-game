import { describe, expect, it } from 'vitest';
import { RelayTransport, type WebSocketLike } from './relay';
import {
  RELAY_PING,
  decodeClientBatch,
  encodeJoin,
  encodeLeave,
  encodeServerData,
  encodeWelcome,
  freeSlot,
  routeBatch,
} from './relayProtocol';
import { FakeTimers } from './testTimers';

/** Relay giả trong bộ nhớ, cùng logic với relay/src/index.ts (routeBatch, freeSlot). */
class FakeRelay {
  members = new Map<FakeSocket, { id: string; slot: number }>();
  framesIn = 0;
  pings = 0;

  connect(url: string): FakeSocket {
    const ws = new FakeSocket(this);
    const id = new URL(url).searchParams.get('peer')!;
    queueOpen(() => {
      const slot = freeSlot([...this.members.values()].map((m) => m.slot));
      ws.readyState = 1;
      ws.onopen?.({});
      ws.deliver(encodeWelcome(slot));
      for (const [other, m] of this.members) {
        ws.deliver(encodeJoin(m.slot, m.id));
        other.deliver(encodeJoin(slot, id));
      }
      this.members.set(ws, { id, slot });
    });
    return ws;
  }

  receive(ws: FakeSocket, data: string | Uint8Array) {
    if (typeof data === 'string') {
      if (data === RELAY_PING) this.pings++;
      return;
    }
    this.framesIn++;
    const me = this.members.get(ws)!;
    const bySlot = new Map([...this.members].filter(([w]) => w !== ws).map(([w, m]) => [m.slot, w]));
    for (const [slot, list] of routeBatch(me.slot, decodeClientBatch(data)!, [...bySlot.keys()])) {
      bySlot.get(slot)!.deliver(encodeServerData(list));
    }
  }

  drop(ws: FakeSocket) {
    const me = this.members.get(ws);
    if (!me) return;
    this.members.delete(ws);
    for (const other of this.members.keys()) other.deliver(encodeLeave(me.slot));
    ws.readyState = 3;
    ws.onclose?.({});
  }
}

let opens: (() => void)[] = [];
const queueOpen = (fn: () => void) => opens.push(fn);
const flushOpens = () => {
  const list = opens;
  opens = [];
  for (const fn of list) fn();
};

class FakeSocket implements WebSocketLike {
  binaryType = 'blob';
  readyState = 0;
  onopen: WebSocketLike['onopen'] = null;
  onclose: WebSocketLike['onclose'] = null;
  onerror: WebSocketLike['onerror'] = null;
  onmessage: WebSocketLike['onmessage'] = null;
  constructor(private relay: FakeRelay) {}
  send(data: string | Uint8Array) {
    this.relay.receive(this, typeof data === 'string' ? data : data.slice());
  }
  close() {
    this.relay.drop(this);
  }
  deliver(data: Uint8Array) {
    const copy = data.slice();
    this.onmessage?.({ data: copy.buffer });
  }
}

function setup(n: number) {
  const relay = new FakeRelay();
  const timers = new FakeTimers();
  const sockets: FakeSocket[] = [];
  const peers = Array.from({ length: n }, (_, i) => {
    const t = new RelayTransport('https://relay.test', 'ROOM1', `p${i}`, {
      timers,
      createSocket: (u) => {
        const ws = relay.connect(u);
        sockets.push(ws);
        return ws;
      },
    });
    const got: string[] = [];
    t.onMessage((d, f) => got.push(`${f}:${[...d].join(',')}`));
    return { t, got };
  });
  flushOpens();
  return { relay, timers, peers, sockets };
}

describe('RelayTransport', () => {
  it('vào phòng thấy nhau, gửi cả phòng / gửi riêng', () => {
    const { timers, peers } = setup(3);
    const [a, b, c] = peers;
    expect(a!.t.peers().sort()).toEqual(['p1', 'p2']);
    expect(c!.t.peers().sort()).toEqual(['p0', 'p1']);
    a!.t.send(Uint8Array.of(1));
    a!.t.send(Uint8Array.of(2), { to: 'p2', channel: 'unreliable' });
    timers.advance(0);
    expect(b!.got).toEqual(['p0:1']);
    expect(c!.got).toEqual(['p0:1', 'p0:2']);
  });

  it('gộp gói: mọi gói trong cùng nhịp = 1 khung; tối đa 1 khung / 50ms', () => {
    const { relay, timers, peers } = setup(4);
    const host = peers[0]!.t;
    // 1 giây của host 20Hz: mỗi tick gửi snapshot riêng cho 3 khách + ping
    for (let tick = 0; tick < 20; tick++) {
      for (const id of ['p1', 'p2', 'p3']) host.send(Uint8Array.of(tick), { to: id, channel: 'unreliable' });
      if (tick % 5 === 0) host.send(Uint8Array.of(200));
      timers.advance(50);
    }
    expect(host.framesSent).toBe(20);
    expect(host.packetsSent).toBe(64);
    expect(relay.framesIn).toBe(20);
    expect(peers[1]!.got.filter((g) => g !== 'p0:200')).toHaveLength(20);

    // gửi dồn dập (60 lần/giây) vẫn chỉ ≤ 20 khung/giây
    const before = host.framesSent;
    for (let i = 0; i < 60; i++) {
      host.send(Uint8Array.of(i), { to: 'p1' });
      timers.advance(1000 / 60);
    }
    timers.advance(50);
    expect(host.framesSent - before).toBeLessThanOrEqual(21);
    expect(peers[1]!.got.length).toBe(20 + 4 + 60);
  });

  it('người rời phòng → báo rời; mất kết nối → nối lại, thấy nhau lại', () => {
    const { relay, timers, peers, sockets } = setup(2);
    const [a, b] = peers;
    const left: string[] = [];
    a!.t.onPeerLeave((p) => left.push(p));
    relay.drop(sockets[1]!); // mạng của b chập
    expect(left).toEqual(['p1']);
    expect(b!.t.peers()).toEqual([]);
    timers.advance(1000); // b tự nối lại sau 1s
    flushOpens();
    expect(a!.t.peers()).toEqual(['p1']);
    b!.t.send(Uint8Array.of(9));
    timers.advance(0);
    expect(a!.got).toEqual(['p1:9']);
  });

  it('rảnh thì 30s ping 1 lần; đang gửi đều thì không ping', () => {
    const { relay, timers, peers } = setup(2);
    timers.advance(30_000);
    expect(relay.pings).toBe(2);
    for (let i = 0; i < 600; i++) {
      peers[0]!.t.send(Uint8Array.of(1));
      timers.advance(50);
    }
    expect(relay.pings).toBe(3); // chỉ máy rảnh (p1) ping
  });

  it('leave(): gửi nốt gói đang chờ rồi đóng', async () => {
    const { timers, peers } = setup(2);
    peers[0]!.t.send(Uint8Array.of(5));
    await peers[0]!.t.leave();
    timers.advance(100);
    expect(peers[1]!.got).toEqual(['p0:5']);
    expect(peers[1]!.t.peers()).toEqual([]);
  });
});
