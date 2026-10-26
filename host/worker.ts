/// <reference lib="webworker" />
import { MapgenSource } from '@shared/sim/mapgenSource';
import { SIM_TICK_MS } from '@shared/types';
import { HostServer } from './hostServer';
import type { FromWorker, ToWorker } from './workerProtocol';

/**
 * Web Worker của máy host (AGENTS.md mục 2.1): chạy HostServer 20Hz, tách khỏi luồng vẽ.
 * Tab host bị ẩn thì requestAnimationFrame dừng nhưng worker vẫn chạy → trận không đứng.
 */
declare const self: DedicatedWorkerGlobalScope;

/** Chạy bù tối đa bấy nhiêu tick khi bị trễ (máy giật), quá thì bỏ để không dồn. */
const MAX_CATCHUP = 5;

let server: HostServer | null = null;
let nextAt = 0;
let statAt = 0;
let sum = 0;
let max = 0;
let count = 0;

/** Chuyển quyền bộ đệm (không sao chép). Một gói có thể gửi cho nhiều người → bỏ trùng. */
const post = (m: FromWorker) =>
  self.postMessage(m, m.t === 'out' ? [...new Set(m.items.map((i) => i.data.buffer as ArrayBuffer))] : []);

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  switch (m.t) {
    case 'init': {
      server = new HostServer({
        seed: m.seed,
        map: new MapgenSource(m.seed),
        zombieCount: m.zombieCount,
        startTick: m.startTick,
        restore: m.restore,
        devSpawnRegion: m.devSpawnRegion,
        loot: m.loot,
      });
      nextAt = statAt = performance.now();
      loop();
      break;
    }
    case 'in':
      server?.receive(m.from, m.data);
      break;
    case 'seen':
      server?.heard(m.peer);
      break;
    case 'leave':
      server?.removePeer(m.peer);
      break;
  }
};

function loop() {
  if (!server) return;
  const now = performance.now();
  let n = 0;
  while (now >= nextAt && n < MAX_CATCHUP) {
    const t0 = performance.now();
    const items = server.tick();
    const dt = performance.now() - t0;
    sum += dt;
    max = Math.max(max, dt);
    count++;
    if (items.length > 0) post({ t: 'out', items });
    nextAt += SIM_TICK_MS;
    n++;
  }
  if (n === MAX_CATCHUP && now >= nextAt) nextAt = now + SIM_TICK_MS;
  if (now - statAt >= 1000) {
    post({
      t: 'beat',
      stats: {
        tickAvgMs: count ? sum / count : 0,
        tickMaxMs: max,
        ticks: count,
        clients: server.clientCount,
        zombies: server.world.zombies.length,
      },
    });
    statAt = now;
    sum = max = count = 0;
  }
  // hẹn đúng mốc tick sau (tự sửa trễ của setTimeout)
  setTimeout(loop, Math.max(0, nextAt - performance.now()));
}
