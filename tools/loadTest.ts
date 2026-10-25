import { ClientSync } from '@net/clientSync';
import { GameMsg } from '@net/gameCodec';
import { HostServer } from '@host/hostServer';
import { worldSeedForRoom } from '@shared/mapgen/world';
import { tickOfDay } from '@shared/sim/dayNight';
import { MapgenSource } from '@shared/sim/mapgenSource';
import { DAY } from '@shared/sim/tuning/night';
import { SIM_TICK_MS, type PeerId } from '@shared/types';
import { Rng } from '@shared/util/rng';
import { Bot } from './bot';

export interface LoadTestOptions {
  /** Tên kịch bản (in trong báo cáo). */
  name: string;
  players?: number;
  seconds?: number;
  /** Trễ mỗi chiều (ms) và mất gói kênh unreliable (0..1). */
  latencyMs?: number;
  loss?: number;
  zombieCount?: number;
  /** Bắt đầu ở ngày/giờ này (vd ngày 150 lúc 0.799 → đợt tràn tối đa ngay). */
  startDay?: number;
  startTime?: number;
  /** Người chơi không chết (để đo tải đợt tràn trọn vẹn, không bị thua giữa chừng). */
  immortal?: boolean;
  room?: string;
}

export interface LoadReport {
  name: string;
  players: number;
  seconds: number;
  zombiesAvg: number;
  zombiesMax: number;
  hostTickAvgMs: number;
  hostTickP95Ms: number;
  hostTickMaxMs: number;
  /** Thời gian xử lý phía máy khách mỗi tick (nhận gói + nội suy + bot), trung bình mỗi người. */
  clientTickAvgMs: number;
  /** Băng thông nhận của mỗi người (KB/s): trung bình và cửa sổ 5s cao nhất (tính trung bình cả nhóm). */
  downKBps: number;
  downPeakKBps: number;
  /** Cửa sổ 5s cao nhất của NGƯỜI nhận nhiều nhất (KB/s) — đỉnh thật mà một máy phải chịu. */
  downPeakMaxKBps: number;
  upKBps: number;
  /**
   * Sai lệch dự đoán lớn nhất (ô), bỏ qua lần "nhảy" > 2 ô (hồi sinh, bị đồng đội kéo — đúng luật, không phải lỗi
   * dự đoán) — và số lần phải sửa > 0.05 ô mỗi phút mỗi người.
   */
  predictionErrMax: number;
  correctionsPerMin: number;
  snapshotsLostPct: number;
  kills: number;
  deaths: number;
  revives: number;
  horde: string;
}

/**
 * Đo tải (GĐ 7, AGENTS.md mục 7: "bot 4 người, đo tải"): host thật (HostServer) + N máy khách thật
 * (ClientSync + Bot) nối bằng mạng giả có trễ/mất gói, chạy nhanh hết mức không cần trình duyệt.
 * Không phải test tất định của mô phỏng: mất gói dùng Rng cố định nên lặp lại được, còn thời gian đo thay đổi theo máy.
 */
export function runLoadTest(opts: LoadTestOptions): LoadReport {
  const players = opts.players ?? 4;
  const seconds = opts.seconds ?? 60;
  const lagTicks = Math.round((opts.latencyMs ?? 0) / SIM_TICK_MS);
  const loss = opts.loss ?? 0;
  const seed = worldSeedForRoom(opts.room ?? 'LOADTEST');
  const startTick =
    opts.startDay !== undefined || opts.startTime !== undefined
      ? tickOfDay(opts.startDay ?? 1) +
        Math.round(((opts.startTime ?? DAY.startAt) * DAY.lengthSec * 1000) / SIM_TICK_MS)
      : undefined;
  const host = new HostServer({
    seed,
    map: new MapgenSource(seed),
    zombieCount: opts.zombieCount,
    startTick,
  });
  const ids: PeerId[] = Array.from({ length: players }, (_, i) => `bot${i + 1}`);
  let now = 0;
  const syncs = new Map(ids.map((id) => [id, new ClientSync(id, new MapgenSource(seed), () => now)]));
  const bots = new Map(ids.map((id) => [id, new Bot(syncs.get(id)!, id)]));
  const rng = new Rng('loss');
  const toHost: { at: number; from: PeerId; data: Uint8Array }[] = [];
  const toClient = new Map<PeerId, { at: number; data: Uint8Array }[]>(ids.map((id) => [id, []]));

  const ticks = seconds * (1000 / SIM_TICK_MS);
  const hostTimes: number[] = [];
  let clientTime = 0;
  let down = 0;
  let up = 0;
  const window: number[] = [];
  let peak = 0;
  // cửa sổ 5s riêng từng người: tổng byte trong cửa sổ + hàng byte từng tick
  const own = new Map(ids.map((id) => [id, { sum: 0, ticks: [] as number[] }]));
  let peakMax = 0;
  let zSum = 0;
  let zMax = 0;
  let predErr = 0;
  let corrections = 0;
  let snapsSent = 0;
  let snapsLost = 0;
  let deaths = 0;
  let kills = 0;
  let seq = 0;

  for (let t = 0; t < ticks; t++) {
    seq++;
    for (const id of ids) {
      const t0 = performance.now();
      const input = bots.get(id)!.decide(t);
      const { packet } = syncs.get(id)!.tick({ ...input, seq });
      clientTime += performance.now() - t0;
      up += packet.length;
      if (!(loss > 0 && rng.chance(loss))) toHost.push({ at: t + lagTicks, from: id, data: packet });
    }
    for (let i = 0; i < toHost.length;) {
      const m = toHost[i]!;
      if (m.at <= t) {
        host.receive(m.from, m.data);
        toHost.splice(i, 1);
      } else i++;
    }

    const h0 = performance.now();
    const out = host.tick();
    hostTimes.push(performance.now() - h0);
    if (opts.immortal) {
      for (const p of host.world.players.values()) {
        p.hp = 100;
        p.downedFor = 0;
        p.respawnIn = 0;
      }
    }
    let tickBytes = 0;
    const perPeer = new Map<PeerId, number>();
    for (const o of out) {
      if (o.data[0] === GameMsg.Snapshot) snapsSent++;
      if (o.channel === 'unreliable' && loss > 0 && rng.chance(loss)) {
        if (o.data[0] === GameMsg.Snapshot) snapsLost++;
        continue;
      }
      toClient.get(o.to)!.push({ at: t + lagTicks, data: o.data });
      down += o.data.length;
      tickBytes += o.data.length;
      perPeer.set(o.to, (perPeer.get(o.to) ?? 0) + o.data.length);
    }
    for (const [id, w] of own) {
      const b = perPeer.get(id) ?? 0;
      w.ticks.push(b);
      w.sum += b;
      if (w.ticks.length > 100) w.sum -= w.ticks.shift()!;
      if (w.ticks.length === 100) peakMax = Math.max(peakMax, w.sum / 5);
    }
    window.push(tickBytes / players);
    if (window.length > 100) window.shift();
    if (window.length === 100) peak = Math.max(peak, window.reduce((a, b) => a + b, 0) / 5);

    for (const [id, q] of toClient) {
      const sync = syncs.get(id)!;
      const t0 = performance.now();
      while (q.length > 0 && q[0]!.at <= t) {
        const before = sync.received;
        const status = statusOf(sync.predictor.state);
        sync.receive(q.shift()!.data);
        if (sync.received === before) continue; // không phải snapshot mới
        const err = sync.predictor.lastError;
        // nhảy chỗ hợp lệ: hồi sinh/chết/gục/đứng dậy (host quyết), hoặc bị đồng đội kéo xa
        if (err > 2 || statusOf(sync.predictor.state) !== status) continue;
        predErr = Math.max(predErr, err);
        if (err > 0.05) corrections++;
      }
      for (const e of sync.events) {
        if (e.type === 'death' && e.player === id) deaths++;
        if (e.type === 'hit' && e.killed && e.player === id) kills++;
      }
      sync.events = [];
      clientTime += performance.now() - t0;
    }
    const zc = host.world.zombies.length;
    zSum += zc;
    zMax = Math.max(zMax, zc);
    now += SIM_TICK_MS;
  }

  const sorted = [...hostTimes].sort((a, b) => a - b);
  const h = host.world.horde;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    name: opts.name,
    players,
    seconds,
    zombiesAvg: Math.round(zSum / ticks),
    zombiesMax: zMax,
    hostTickAvgMs: r2(hostTimes.reduce((a, b) => a + b, 0) / ticks),
    hostTickP95Ms: r2(sorted[Math.floor(ticks * 0.95)]!),
    hostTickMaxMs: r2(sorted[ticks - 1]!),
    clientTickAvgMs: r2(clientTime / ticks / players),
    downKBps: r2(down / players / 1024 / seconds),
    downPeakKBps: r2(peak / 1024),
    downPeakMaxKBps: r2(peakMax / 1024),
    upKBps: r2(up / players / 1024 / seconds),
    predictionErrMax: r2(predErr),
    correctionsPerMin: r2(corrections / players / (seconds / 60)),
    snapshotsLostPct: r2((snapsLost / Math.max(1, snapsSent)) * 100),
    kills,
    deaths,
    revives: [...bots.values()].reduce((n, b) => n + b.stats.revives, 0),
    horde: h
      ? `#${h.number} ${h.active ? 'đang diễn ra' : h.survived ? 'sống sót' : 'thất bại'} (${h.spawned}/${h.quota}, Boss ${h.bossesSpawned})`
      : '—',
  };
}

/** Trạng thái sống/gục/chết — đổi trạng thái thì nhân vật nhảy chỗ đúng luật, không tính là lỗi dự đoán. */
function statusOf(p: { respawnIn: number; downedFor: number } | null): string {
  if (!p) return 'none';
  return p.respawnIn > 0 ? 'dead' : p.downedFor > 0 ? 'downed' : 'up';
}
