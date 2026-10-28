import { describe, expect, it } from 'vitest';
import { RelayTransport, type WebSocketLike } from './relay';
import {
  RELAY_KEY,
  RELAY_PING,
  admitPeer,
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
  members = new Map<FakeSocket, { id: string; slot: number; key: string }>();
  rejected = 0;
  framesIn = 0;
  pings = 0;

  connect(url: string): FakeSocket {
    const ws = new FakeSocket(this);
    const id = new URL(url).searchParams.get('peer')!;
    const key = new URL(url).searchParams.get('k')!;
    queueOpen(() => {
      // giống relay/src/index.ts: cùng id khác mã → từ chối; cùng mã → thay kết nối cũ
      const admit = admitPeer(this.members.values(), id, key);
      if (admit === 'reject') {
        this.rejected++;
        ws.readyState = 3;
        ws.onclose?.({});
        return;
      }
      for (const [old, m] of [...this.members]) if (m.id === id) this.drop(old);
      const slot = freeSlot([...this.members.values()].map((m) => m.slot));
      ws.readyState = 1;
      ws.onopen?.({});
      ws.deliver(encodeWelcome(slot));
      for (const [other, m] of this.members) {
        ws.deliver(encodeJoin(m.slot, m.id));
        other.deliver(encodeJoin(slot, id));
      }
      this.members.set(ws, { id, slot, key });
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

  it('kết nối thay thế cùng peer id: đúng mã của chính máy đó → thay; người lạ (mã khác) → bị từ chối, không đá ai', () => {
    const { relay, timers, peers } = setup(2);
    const [a, b] = peers;
    const left: string[] = [];
    a!.t.onPeerLeave((p) => left.push(p));
    const connectTo = (u: string) => relay.connect(u);
    // kẻ lạ biết id 'p1' (cả phòng đều thấy) nhưng không có mã của p1
    const stranger = new RelayTransport('https://relay.test', 'ROOM1', 'p1', {
      timers,
      createSocket: connectTo,
    });
    flushOpens();
    expect(relay.rejected).toBe(1);
    expect(stranger.connected).toBe(false);
    expect(left).toEqual([]);
    expect(b!.t.connected).toBe(true);
    b!.t.send(Uint8Array.of(5));
    timers.advance(0);
    expect(a!.got).toEqual(['p1:5']);
    void stranger.leave();

    // chính máy đó nối lại (cùng mã) khi relay chưa kịp thấy kết nối cũ đứt → thay kết nối cũ
    const key = 'K'.repeat(22);
    const c1 = new RelayTransport('https://relay.test', 'ROOM1', 'p9', {
      timers,
      key,
      createSocket: connectTo,
    });
    flushOpens();
    const c2 = new RelayTransport('https://relay.test', 'ROOM1', 'p9', {
      timers,
      key,
      createSocket: connectTo,
    });
    flushOpens();
    expect(c2.connected).toBe(true);
    expect(c2.peers().sort()).toEqual(['p0', 'p1']);
    expect([...relay.members.values()].filter((m) => m.id === 'p9')).toHaveLength(1);
    void c1.leave();
  });

  it('mỗi trang 1 mã ngẫu nhiên, nối lại dùng lại đúng mã đó', () => {
    const urls: string[] = [];
    const { relay, timers, sockets } = setup(0);
    const t = new RelayTransport('https://relay.test', 'ROOM1', 'p5', {
      timers,
      createSocket: (u) => {
        urls.push(u);
        const ws = relay.connect(u);
        sockets.push(ws);
        return ws;
      },
    });
    flushOpens();
    relay.drop(sockets.at(-1)!);
    timers.advance(1000);
    flushOpens();
    expect(urls).toHaveLength(2);
    const k = urls.map((u) => new URL(u).searchParams.get('k'));
    expect(k[0]).toMatch(RELAY_KEY);
    expect(k[1]).toBe(k[0]);
    expect(t.connected).toBe(true);
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
