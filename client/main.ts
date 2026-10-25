import Phaser from 'phaser';
import { MAX_PLAYERS, PLAYER_COLORS, SIM_TICK_MS } from '@shared/types';
import { tickOfDay } from '@shared/sim/dayNight';
import { DAY } from '@shared/sim/tuning/night';
import { hashString } from '@shared/util/rng';
import { ConditionedTransport } from '@net/conditions';
import { CountingTransport } from '@net/stats';
import { loadIceServers } from '@net/ice';
import { newRoomCode, normalizeRoomCode } from '@net/roomCode';
import { AutoTransport } from '@net/auto';
import { RELAY_URL, RelayTransport } from '@net/relay';
import { Session } from '@net/session';
import { TrysteroTransport } from '@net/trystero';
import type { Transport } from '@net/transport';
import { selfId as trysteroSelfId } from '@trystero-p2p/nostr';
import { NetGame } from './net/netGame';
import { mountVersionNotice } from './net/versionNotice';
import { HudScene } from './scenes/HudScene';
import { WorldScene } from './scenes/WorldScene';
import { mountDebugPanel } from './ui/debugPanel';
import { mountLobbyPanel } from './ui/lobbyPanel';

// ---- Mã phòng: lấy từ link (?room=XXXXXX) hoặc tạo mới ----
const url = new URL(window.location.href);
let room = normalizeRoomCode(url.searchParams.get('room'));
if (!room) {
  room = newRoomCode();
  url.searchParams.set('room', room);
  window.history.replaceState(null, '', url);
}

// ---- Số zombie (thử tải, chỉ máy host dùng): ?zombies=N ----
const zombiesParam = url.searchParams.get('zombies');
const zombieCount =
  zombiesParam !== null && Number.isFinite(Number(zombiesParam))
    ? Math.max(0, Math.min(1000, Math.floor(Number(zombiesParam))))
    : undefined;

// ---- Tên người chơi (nhớ trong trình duyệt) ----
const NAME_KEY = 'zg.name';
let name = safeGet(NAME_KEY) ?? `Người sống sót ${Math.floor(Math.random() * 90 + 10)}`;

// ---- Mạng ----
// Thử WebRTC trước; ai không nối thẳng được sau ~8s thì đi relay WebSocket (nếu có VITE_RELAY_URL).
// ?relay=1: WebRTC chỉ qua TURN · ?relay=ws: bỏ WebRTC, đi hẳn relay WebSocket (để thử relay trên 1 máy).
let netError: string | null = null;
const onNetError = (e: string) => {
  netError = e;
};
const relayParam = url.searchParams.get('relay');
const onlyRelay = relayParam === 'ws' && RELAY_URL !== '';
if (relayParam === 'ws' && !RELAY_URL) netError = 'Bản game này chưa có relay (VITE_RELAY_URL) — dùng WebRTC';
const trystero = onlyRelay
  ? null
  : new TrysteroTransport(room, {
      iceServers: await loadIceServers(),
      forceRelay: relayParam === '1',
      onError: onNetError,
    });
const relay = RELAY_URL ? new RelayTransport(RELAY_URL, room, trystero?.selfId ?? trysteroSelfId) : null;
const auto = relay ? new AutoTransport(trystero, relay) : null;
const base: Transport = auto ?? trystero!;
const conditioned = new ConditionedTransport(base);
const net = new CountingTransport(conditioned);
const color = PLAYER_COLORS[hashString(net.selfId) % PLAYER_COLORS.length] ?? 0xffffff;
// ?v=N (chỉ bản dev): giả làm bản game giao thức N để thử chặn khác phiên bản
const fakeVersion =
  import.meta.env.DEV && url.searchParams.has('v') ? Number(url.searchParams.get('v')) : NaN;
const session = new Session(net, {
  name,
  color,
  ...(Number.isInteger(fakeVersion) ? { version: fakeVersion } : {}),
});
// ---- Thử ngày/đêm/đợt tràn (chỉ máy host dùng): ?ngay=15&gio=0.79 → trận bắt đầu ngày 15 lúc 0.79 của ngày
// (đợt tràn 1 bắt đầu sau ~7 giây); ?gio=0.9 → đêm ngày 1 ----
const ngayParam = Math.floor(Number(url.searchParams.get('ngay')));
const gioParam = Number(url.searchParams.get('gio'));
const hasNgay = url.searchParams.has('ngay') && ngayParam >= 1;
const hasGio = url.searchParams.has('gio') && gioParam >= 0 && gioParam < 1;
const startTick =
  hasNgay || hasGio
    ? tickOfDay(hasNgay ? ngayParam : 1) +
      Math.round(((hasGio ? gioParam : DAY.startAt) * DAY.lengthSec * 1000) / SIM_TICK_MS)
    : undefined;
// trận chỉ gồm người cùng phiên bản giao thức (session.game lọc); phòng chờ vẫn thấy mọi người
const game = new NetGame(session.game, room, {
  zombieCount,
  startTick,
  rttOf: (id) => session.peers.get(id)?.rttMs ?? null,
});

// ---- Phaser ----
const phaser = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0e1110',
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  scene: [],
});
phaser.scene.add('world', WorldScene, true, { session, net: game, name, color });
phaser.scene.add('hud', HudScene, true);

// ---- Giao diện HTML ----
const hud = document.getElementById('hud')!;
const lobby = mountLobbyPanel(hud, {
  room,
  maxPlayers: MAX_PLAYERS,
  getName: () => name,
  setName: (n) => {
    name = n;
    safeSet(NAME_KEY, n);
    session.setMe(name, color);
    (phaser.scene.getScene('world') as WorldScene | null)?.setMe(name, color);
  },
  newRoom: () => {
    const u = new URL(window.location.href);
    u.searchParams.set('room', newRoomCode());
    window.location.href = u.toString();
  },
});
const debug = mountDebugPanel(hud, conditioned);
const versionNotice = mountVersionNotice(document.body);

function render() {
  lobby.update(session, netError);
  versionNotice.update(session.updateNotice);
  net.update();
  debug.setStats(netStatsText());
}

/** Số liệu mạng cho bảng F3 (AGENTS.md mục 2.12). */
function netStatsText(): string[] {
  const sync = game.sync;
  const world = phaser.scene.getScene('world') as WorldScene | null;
  const hudScene = phaser.scene.getScene('hud') as HudScene | null;
  const hostId = game.hostId;
  const ping = hostId && hostId !== net.selfId ? session.peers.get(hostId)?.rttMs : null;
  const lines = [
    `Vai trò: ${game.role === 'host' ? 'HOST' : game.role === 'client' ? 'khách' : 'đang tìm host'}` +
      (game.migrations > 0 ? ` · đổi host ${game.migrations} lần` : ''),
    `Ping tới host: ${ping == null ? '—' : `${Math.round(ping)} ms`}`,
    `Băng thông: ↑ ${net.upKBps.toFixed(1)} KB/s · ↓ ${net.downKBps.toFixed(1)} KB/s`,
    `Kênh unreliable: ${trystero?.unreliableOpen ?? 0}/${net.peers().length} người`,
    ...relayLine(),
    `Điểm host: mình ${game.election.scoreOf(net.selfId) ?? '—'}` +
      (hostId && hostId !== net.selfId ? ` · host ${game.election.scoreOf(hostId) ?? '—'}` : '') +
      ` · chạy thử ${game.simBenchMs.toFixed(1)} ms` +
      (game.backup.have > 0 ? ` · bản lưu ${game.backup.have}/${game.backup.total} mẩu` : ''),
    `Nhận: ${sync.zombieCount} zombie · snapshot ${sync.received} (muộn ${sync.stale})`,
    `Nội suy ${Math.round(sync.interpDelayMs)} ms · giật ${sync.jitterMs.toFixed(0)} ms`,
    `Dự đoán: lệch ${sync.predictor.lastError.toFixed(3)} ô · chờ ack ${sync.predictor.pendingCount}`,
    `Frame: ${world ? world.frameMs.toFixed(2) : '—'} ms · HUD ${hudScene ? hudScene.hudMs.toFixed(2) : '—'} ms`,
  ];
  const hs = game.hostStats;
  if (hs) {
    lines.push(
      `Host tick: tb ${hs.tickAvgMs.toFixed(2)} ms · max ${hs.tickMaxMs.toFixed(2)} ms · ${hs.ticks} tick/s`,
      `Host: ${hs.clients} người · ${hs.zombies} zombie`,
    );
  }
  return lines;
}
/** Đường đi của gói: thẳng (WebRTC) hay relay WebSocket, và số khung gửi lên relay (= hạn mức Cloudflare). */
let relayFrames = { at: performance.now(), n: 0, perSec: 0 };
function relayLine(): string[] {
  if (!relay || !auto) return [];
  const now = performance.now();
  if (now - relayFrames.at >= 1000) {
    relayFrames = {
      at: now,
      n: relay.framesSent,
      perSec: ((relay.framesSent - relayFrames.n) * 1000) / (now - relayFrames.at),
    };
  }
  return [
    `Đường: thẳng ${net.peers().length - auto.relayed} · relay ${auto.relayed} người` +
      ` (${relay.connected ? 'đã nối' : 'chưa nối'} relay, ${relayFrames.perSec.toFixed(0)} khung/s)`,
  ];
}
session.changed.on(render);
setInterval(render, 500);
render();

window.addEventListener('beforeunload', () => {
  game.dispose();
  void net.leave();
});

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* trình duyệt chặn lưu trữ: bỏ qua */
  }
}
