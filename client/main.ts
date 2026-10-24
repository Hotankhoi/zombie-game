import Phaser from 'phaser';
import { MAX_PLAYERS, PLAYER_COLORS } from '@shared/types';
import { hashString } from '@shared/util/rng';
import { ConditionedTransport } from '@net/conditions';
import { CountingTransport } from '@net/stats';
import { loadIceServers } from '@net/ice';
import { newRoomCode, normalizeRoomCode } from '@net/roomCode';
import { Session } from '@net/session';
import { TrysteroTransport } from '@net/trystero';
import { NetGame } from './net/netGame';
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
let netError: string | null = null;
const iceServers = await loadIceServers();
const trystero = new TrysteroTransport(room, {
  iceServers,
  forceRelay: url.searchParams.get('relay') === '1',
  onError: (e) => {
    netError = e;
  },
});
const conditioned = new ConditionedTransport(trystero);
const net = new CountingTransport(conditioned);
const color = PLAYER_COLORS[hashString(net.selfId) % PLAYER_COLORS.length] ?? 0xffffff;
const session = new Session(net, { name, color });
const game = new NetGame(net, room, { zombieCount, rttOf: (id) => session.peers.get(id)?.rttMs ?? null });

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

function render() {
  lobby.update(session, netError);
  net.update();
  debug.setStats(netStatsText());
}

/** Số liệu mạng cho bảng F3 (AGENTS.md mục 2.12). */
function netStatsText(): string[] {
  const sync = game.sync;
  const world = phaser.scene.getScene('world') as WorldScene | null;
  const hostId = game.hostId;
  const ping = hostId && hostId !== net.selfId ? session.peers.get(hostId)?.rttMs : null;
  const lines = [
    `Vai trò: ${game.role === 'host' ? 'HOST' : game.role === 'client' ? 'khách' : 'đang tìm host'}` +
      (game.migrations > 0 ? ` · đổi host ${game.migrations} lần` : ''),
    `Ping tới host: ${ping == null ? '—' : `${Math.round(ping)} ms`}`,
    `Băng thông: ↑ ${net.upKBps.toFixed(1)} KB/s · ↓ ${net.downKBps.toFixed(1)} KB/s`,
    `Kênh unreliable: ${trystero.unreliableOpen}/${net.peers().length} người`,
    `Điểm host: mình ${game.election.scoreOf(net.selfId) ?? '—'}` +
      (hostId && hostId !== net.selfId ? ` · host ${game.election.scoreOf(hostId) ?? '—'}` : '') +
      ` · chạy thử ${game.simBenchMs.toFixed(1)} ms` +
      (game.backup ? ` · có bản lưu tick ${game.backup.tick}` : ''),
    `Nhận: ${sync.zombieCount} zombie · snapshot ${sync.received} (muộn ${sync.stale})`,
    `Nội suy ${Math.round(sync.interpDelayMs)} ms · giật ${sync.jitterMs.toFixed(0)} ms`,
    `Dự đoán: lệch ${sync.predictor.lastError.toFixed(3)} ô · chờ ack ${sync.predictor.pendingCount}`,
    `Frame: ${world ? world.frameMs.toFixed(2) : '—'} ms`,
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
