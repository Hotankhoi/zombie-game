import { ClientSync } from '@net/clientSync';
import { RelayTransport } from '@net/relay';
import { Session } from '@net/session';
import { HostServer } from '@host/hostServer';
import { worldSeedForRoom } from '@shared/mapgen/world';
import { MapgenSource } from '@shared/sim/mapgenSource';
import { SIM_TICK_MS, type PeerId } from '@shared/types';
import { Bot } from './bot';

/** Hạn mức Durable Objects gói Free: 100k request/ngày; 20 tin WebSocket gửi lên = 1 request. */
export const FREE_REQUESTS_PER_DAY = 100_000;
export const WS_MESSAGES_PER_REQUEST = 20;

/** Số giờ chơi/ngày trong hạn mức free, khi cả phòng gửi lên relay `framesPerSec` khung mỗi giây. */
export function freeHoursPerDay(framesPerSec: number): number {
  return (FREE_REQUESTS_PER_DAY * WS_MESSAGES_PER_REQUEST) / framesPerSec / 3600;
}

export interface RelayLoadReport {
  players: number;
  seconds: number;
  /** Khung gửi lên relay mỗi giây: cả phòng, của host, trung bình mỗi khách. */
  framesPerSec: number;
  hostFramesPerSec: number;
  clientFramesPerSec: number;
  /** Gói game trung bình trong 1 khung (gộp gói). */
  packetsPerFrame: number;
  /** Nhận snapshot mỗi giây trung bình mỗi khách (đủ = 20). */
  snapshotsPerSec: number;
  downKBps: number;
  pingMs: number | null;
  hoursPerDay: number;
}

/**
 * Đo qua relay THẬT (wrangler dev hoặc relay đã deploy), chạy theo thời gian thật: host (HostServer) + bot1
 * trên cùng máy như NetGame, bot2..N là máy khách, mọi gói giữa các máy đi qua RelayTransport (WebSocket).
 * Mỗi máy có Session (chào + ping 1 lần/giây) như game thật.
 */
export async function runRelayLoadTest(opts: {
  url: string;
  players?: number;
  seconds?: number;
  zombieCount?: number;
  room?: string;
}): Promise<RelayLoadReport> {
  const players = opts.players ?? 4;
  const seconds = opts.seconds ?? 30;
  const room = opts.room ?? `LT${Math.floor(Math.random() * 1e6)}`;
  const seed = worldSeedForRoom(room);
  const ids: PeerId[] = Array.from({ length: players }, (_, i) => `bot${i + 1}`);
  const hostId = ids[0]!;
  const host = new HostServer({ seed, map: new MapgenSource(seed), zombieCount: opts.zombieCount ?? 200 });
  const nets = new Map(ids.map((id) => [id, new RelayTransport(opts.url, room, id)]));
  const syncs = new Map(ids.map((id) => [id, new ClientSync(id, new MapgenSource(seed))]));
  const bots = new Map(ids.map((id) => [id, new Bot(syncs.get(id)!, id)]));
  const sessions = new Map(ids.map((id) => [id, new Session(nets.get(id)!, { name: id, color: 0xffffff })]));
  let down = 0;
  nets.get(hostId)!.onMessage((data, from) => host.receive(from, data));
  for (const id of ids.slice(1)) {
    nets.get(id)!.onMessage((data, from) => {
      down += data.length;
      if (from === hostId) syncs.get(id)!.receive(data);
    });
  }

  // chờ mọi máy thấy nhau qua relay
  const deadline = performance.now() + 10_000;
  while ([...nets.values()].some((n) => n.peers().length < players - 1)) {
    if (performance.now() > deadline) throw new Error('các máy không thấy nhau qua relay sau 10s');
    await sleep(50);
  }

  const frames0 = new Map(ids.map((id) => [id, nets.get(id)!.framesSent]));
  const packets0 = [...nets.values()].reduce((n, t) => n + t.packetsSent, 0);
  const t0 = performance.now();
  let seq = 0;
  await new Promise<void>((done) => {
    const timer = setInterval(() => {
      seq++;
      for (const id of ids) {
        const { packet } = syncs.get(id)!.tick({ ...bots.get(id)!.decide(seq), seq });
        if (id === hostId) host.receive(id, packet);
        else nets.get(id)!.send(packet, { to: hostId, channel: 'unreliable' });
        sessions.get(id)!.tick();
      }
      for (const o of host.tick()) {
        if (o.to === hostId) syncs.get(hostId)!.receive(o.data);
        else nets.get(hostId)!.send(o.data, { to: o.to, channel: o.channel });
      }
      if (performance.now() - t0 >= seconds * 1000) {
        clearInterval(timer);
        done();
      }
    }, SIM_TICK_MS);
  });
  const elapsed = (performance.now() - t0) / 1000;
  const framesOf = (id: PeerId) => nets.get(id)!.framesSent - frames0.get(id)!;
  const total = ids.reduce((n, id) => n + framesOf(id), 0);
  const packets = [...nets.values()].reduce((n, t) => n + t.packetsSent, 0) - packets0;
  const clients = ids.slice(1);
  const pings = clients
    .map((id) => sessions.get(id)!.peers.get(hostId)?.rttMs)
    .filter((r): r is number => typeof r === 'number');
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const report: RelayLoadReport = {
    players,
    seconds: r2(elapsed),
    framesPerSec: r2(total / elapsed),
    hostFramesPerSec: r2(framesOf(hostId) / elapsed),
    clientFramesPerSec: r2(clients.reduce((n, id) => n + framesOf(id), 0) / clients.length / elapsed),
    packetsPerFrame: r2(packets / Math.max(1, total)),
    snapshotsPerSec: r2(clients.reduce((n, id) => n + syncs.get(id)!.received, 0) / clients.length / elapsed),
    downKBps: r2(down / clients.length / 1024 / elapsed),
    pingMs: pings.length > 0 ? r2(pings.reduce((a, b) => a + b, 0) / pings.length) : null,
    hoursPerDay: r2(freeHoursPerDay(total / elapsed)),
  };
  await Promise.all([...sessions.values()].map((s) => s.leave()));
  return report;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
