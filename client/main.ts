import Phaser from 'phaser';
import { MAX_PLAYERS, PLAYER_COLORS } from '@shared/types';
import { hashString } from '@shared/util/rng';
import { ConditionedTransport } from '@net/conditions';
import { newRoomCode, normalizeRoomCode } from '@net/roomCode';
import { Session } from '@net/session';
import { TrysteroTransport } from '@net/trystero';
import { LobbyScene } from './scenes/LobbyScene';
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

// ---- Tên người chơi (nhớ trong trình duyệt) ----
const NAME_KEY = 'zg.name';
let name = safeGet(NAME_KEY) ?? `Người sống sót ${Math.floor(Math.random() * 90 + 10)}`;

// ---- Mạng ----
let netError: string | null = null;
const net = new ConditionedTransport(
  new TrysteroTransport(room, (e) => {
    netError = e;
  }),
);
const color = PLAYER_COLORS[hashString(net.selfId) % PLAYER_COLORS.length] ?? 0xffffff;
const session = new Session(net, { name, color });

// ---- Phaser ----
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0e1110',
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  scene: [],
});
game.scene.add('lobby', LobbyScene, true, { session, name, color });

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
    (game.scene.getScene('lobby') as LobbyScene | null)?.setMe(name, color);
  },
  newRoom: () => {
    const u = new URL(window.location.href);
    u.searchParams.set('room', newRoomCode());
    window.location.href = u.toString();
  },
});
mountDebugPanel(hud, net);

function render() {
  lobby.update(session, netError);
}
session.changed.on(render);
setInterval(render, 500);
render();

window.addEventListener('beforeunload', () => {
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
