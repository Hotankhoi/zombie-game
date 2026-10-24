import { ZOMBIE_NORMAL } from '@shared/data/zombies';
import { Doors } from '@shared/sim/doors';
import type { MapSource } from '@shared/sim/grid';
import { aimToRad, type PlayerInput } from '@shared/sim/input';
import type { PlayerState } from '@shared/sim/player';
import { Predictor } from '@shared/sim/prediction';
import type { SimEvent, WorldState } from '@shared/sim/world';
import type { ZombieState } from '@shared/sim/zombie';
import { SIM_TICK_MS, type PeerId } from '@shared/types';
import { hashString } from '@shared/util/rng';
import {
  GameMsg,
  decodeGame,
  encodeGame,
  type SnapshotMsg,
  type WireEvent,
  type WirePlayer,
  type WireZombie,
} from './gameCodec';

/** Gửi dư: mỗi gói input kèm bấy nhiêu input gần nhất (AGENTS.md mục 2.9). */
export const INPUT_REDUNDANCY = 3;
const KEEP_SNAPSHOTS = 12;
/** Trễ nội suy tối thiểu/tối đa (ms) cho zombie và đồng đội. */
const MIN_INTERP_MS = 100;
const MAX_INTERP_MS = 400;
/** Snapshot tới muộn: ngoại suy theo vận tốc tối đa bấy nhiêu tick (150ms) rồi đứng chờ, không đoán xa hơn. */
const MAX_EXTRAP_TICKS = 3;

interface Snap {
  tick: number;
  players: Map<PeerId, WirePlayer>;
  zombies: Map<number, WireZombie>;
}

export interface RemotePlayerView {
  id: PeerId;
  x: number;
  y: number;
  facing: number;
  /** Còn trong trận (kể cả đang gục). */
  alive: boolean;
  hp: number;
  /** > 0 = đang gục, còn bấy nhiêu giây trước khi chết hẳn. */
  downedFor: number;
  /** Đang được cứu: đã giữ R bao lâu (giây). */
  reviveProgress: number;
}

export interface ZombieView {
  id: number;
  x: number;
  y: number;
  facing: number;
  chasing: boolean;
}

/**
 * Phía client của trận (GĐ 2a): dự đoán nhân vật mình, nội suy zombie/đồng đội từ snapshot,
 * gói input gửi host. Không phụ thuộc trình duyệt (nhận `now`), nên test được bằng mạng giả.
 */
export class ClientSync {
  readonly predictor: Predictor;
  doors = new Doors();
  /** Sự kiện đã nhận (đổi slot → PeerId), scene lấy ra vẽ hiệu ứng. */
  events: SimEvent[] = [];
  /** Snapshot mới nhất (để chuyển host). */
  latest: SnapshotMsg | null = null;
  /** Số snapshot đã nhận / bị bỏ vì tới muộn hơn cái mới hơn. */
  received = 0;
  stale = 0;
  /** Độ giật của khoảng cách giữa các snapshot (ms, làm mượt) — quyết định trễ nội suy. */
  jitterMs = 0;
  private slots = new Map<number, PeerId>();
  private snaps: Snap[] = [];
  private recent: PlayerInput[] = [];
  /** Ước lượng (giờ máy mình) − (tick host × 50ms). */
  private clockOffset: number | null = null;
  private lastRecv: { at: number; tick: number } | null = null;

  constructor(
    readonly selfId: PeerId,
    readonly map: MapSource,
    private now: () => number = () => performance.now(),
  ) {
    this.predictor = new Predictor(
      (tx, ty) => map.isWall(tx, ty) || (map.isDoor(tx, ty) && !this.doors.isOpen(tx, ty)),
    );
  }

  /** Một tick 20Hz của client: dự đoán + trả gói Input để gửi host. */
  tick(input: PlayerInput): { packet: Uint8Array; swung: boolean } {
    const swung = this.predictor.step(input);
    this.recent.unshift(input);
    if (this.recent.length > INPUT_REDUNDANCY) this.recent.length = INPUT_REDUNDANCY;
    return { packet: encodeGame({ type: GameMsg.Input, inputs: this.recent }), swung };
  }

  /** Gói từ host. Trả về false nếu không phải gói trong trận. */
  receive(data: Uint8Array): boolean {
    const msg = decodeGame(data);
    if (!msg) return false;
    switch (msg.type) {
      case GameMsg.Roster:
        this.slots = new Map(msg.slots.map((s) => [s.slot, s.id]));
        return true;
      case GameMsg.Snapshot:
        this.onSnapshot(msg);
        return true;
      case GameMsg.Events:
        for (const e of msg.events) {
          const ev = this.fromWire(e);
          if (ev) this.events.push(ev);
        }
        return true;
      default:
        return false;
    }
  }

  /** Đổi host: bỏ đồng hồ/bộ đệm cũ (tick của host mới có thể nhảy). Giữ dự đoán. */
  resetHost(): void {
    this.snaps = [];
    this.clockOffset = null;
    this.lastRecv = null;
    this.latest = null;
  }

  get interpDelayMs(): number {
    const gap = 2 * SIM_TICK_MS; // khoảng cách 2 snapshot
    return Math.max(MIN_INTERP_MS, Math.min(MAX_INTERP_MS, gap + 2.5 * this.jitterMs + 20));
  }

  get zombieCount(): number {
    return this.snaps[this.snaps.length - 1]?.zombies.size ?? 0;
  }

  /** Số lần vẽ phải ngoại suy vì snapshot tới muộn (bảng F3). */
  extrapolated = 0;

  /**
   * Zombie + đồng đội tại thời điểm vẽ (lùi lại interpDelayMs để luôn có 2 snapshot kẹp hai đầu).
   * Snapshot sau chưa tới (mất gói/giật): ngoại suy từ 2 snapshot cuối, tối đa MAX_EXTRAP_TICKS.
   */
  sample(): { zombies: ZombieView[]; others: RemotePlayerView[] } {
    const zombies: ZombieView[] = [];
    const others: RemotePlayerView[] = [];
    if (this.snaps.length === 0 || this.clockOffset === null) return { zombies, others };
    const t = (this.now() - this.clockOffset - this.interpDelayMs) / SIM_TICK_MS;
    let i = this.snaps.length - 1;
    while (i > 0 && (this.snaps[i] as Snap).tick > t) i--;
    const a = this.snaps[i] as Snap;
    const b = this.snaps[i + 1];
    let from: Snap | undefined;
    let to = a;
    let alpha = 0;
    if (b) {
      from = a;
      to = b;
      alpha = Math.max(0, Math.min(1, (t - a.tick) / (b.tick - a.tick)));
    } else if (i > 0 && t > a.tick) {
      // alpha > 1 trên đoạn (snapshot trước → a) = đi tiếp theo vận tốc cũ
      from = this.snaps[i - 1] as Snap;
      alpha = 1 + Math.min(t - a.tick, MAX_EXTRAP_TICKS) / (a.tick - from.tick);
      this.extrapolated++;
    }
    for (const [id, zb] of to.zombies) {
      const za = from?.zombies.get(id);
      zombies.push(
        za
          ? {
              id,
              x: za.x + (zb.x - za.x) * alpha,
              y: za.y + (zb.y - za.y) * alpha,
              facing: lerpAngle(za.facing, zb.facing, alpha),
              chasing: alpha < 0.5 ? za.chasing : zb.chasing,
            }
          : { ...zb },
      );
    }
    for (const [id, pb] of to.players) {
      if (id === this.selfId) continue;
      const pa = from?.players.get(id);
      const far = pa && Math.hypot(pb.x - pa.x, pb.y - pa.y) > 2; // hồi sinh: nhảy luôn
      const fb = aimToRad(pb.aim);
      others.push({
        id,
        x: pa && !far ? pa.x + (pb.x - pa.x) * alpha : pb.x,
        y: pa && !far ? pa.y + (pb.y - pa.y) * alpha : pb.y,
        facing: pa ? lerpAngle(aimToRad(pa.aim), fb, alpha) : fb,
        alive: pb.respawnIn <= 0,
        hp: pb.hp,
        downedFor: pb.respawnIn <= 0 ? pb.downedFor : 0,
        reviveProgress: pb.reviveProgress,
      });
    }
    return { zombies, others };
  }

  /**
   * Dựng trạng thái thế giới từ snapshot cuối (khi mình lên làm host thay người vừa rời).
   * Chỉ biết zombie quanh mình; zombie còn thiếu SimWorld tự sinh thêm.
   */
  toWorldState(seed: string, keep: ReadonlySet<PeerId>): WorldState | null {
    const s = this.latest;
    if (!s) return null;
    const players: PlayerState[] = [];
    for (const wp of s.players) {
      const id = this.slots.get(wp.slot);
      if (id && keep.has(id)) players.push(toPlayerState(id, wp));
    }
    const alive = players.filter((p) => p.respawnIn <= 0);
    let maxId = 0;
    const zombies: ZombieState[] = s.zombies.map((z) => {
      maxId = Math.max(maxId, z.id);
      let target: PeerId | null = null;
      if (z.chasing) {
        let best = Infinity;
        for (const p of alive) {
          const d = Math.hypot(p.x - z.x, p.y - z.y);
          if (d < best) {
            best = d;
            target = p.id;
          }
        }
      }
      return {
        id: z.id,
        x: z.x,
        y: z.y,
        facing: z.facing,
        hp: ZOMBIE_NORMAL.maxHp,
        mode: target ? 'chase' : 'wander',
        target,
        wanderIn: 1,
        wanderMoving: false,
        biteCd: 0,
      };
    });
    return {
      tick: s.tick,
      rngState: hashString(`${seed}:${s.tick}`),
      nextZombieId: maxId + 1,
      players,
      zombies,
      openDoors: s.doors.map((d) => ({ ...d })),
      flowTargets: alive.map((p) => ({ x: p.x, y: p.y })),
      flowDirty: true,
    };
  }

  private onSnapshot(msg: SnapshotMsg): void {
    const last = this.snaps[this.snaps.length - 1];
    if (last && msg.tick <= last.tick) {
      this.stale++;
      return;
    }
    this.received++;
    const at = this.now();
    // đồng hồ host: lấy giá trị nhỏ nhất gần đây (gói tới sớm nhất ít bị trễ nhất), trôi chậm lên
    const offset = at - msg.tick * SIM_TICK_MS;
    this.clockOffset = this.clockOffset === null ? offset : Math.min(offset, this.clockOffset + 0.5);
    if (this.lastRecv) {
      const expected = (msg.tick - this.lastRecv.tick) * SIM_TICK_MS;
      const dev = Math.abs(at - this.lastRecv.at - expected);
      this.jitterMs = this.jitterMs * 0.9 + dev * 0.1;
    }
    this.lastRecv = { at, tick: msg.tick };
    this.latest = msg;

    const players = new Map<PeerId, WirePlayer>();
    for (const p of msg.players) {
      const id = this.slots.get(p.slot);
      if (id) players.set(id, p);
    }
    this.snaps.push({ tick: msg.tick, players, zombies: new Map(msg.zombies.map((z) => [z.id, z])) });
    if (this.snaps.length > KEEP_SNAPSHOTS) this.snaps.shift();

    const doors = new Doors();
    for (const d of msg.doors) doors.set(d.x, d.y, true);
    this.doors = doors;

    const mine = players.get(this.selfId);
    if (mine) this.predictor.reconcile(toPlayerState(this.selfId, mine), msg.ack);
  }

  private fromWire(e: WireEvent): SimEvent | null {
    const who = 'slot' in e ? this.slots.get(e.slot) : undefined;
    switch (e.kind) {
      case 'door':
        return { type: 'door', x: e.x, y: e.y, open: e.open };
      case 'swing':
        return who ? { type: 'swing', player: who, x: e.x, y: e.y, facing: e.facing } : null;
      case 'hit':
        return who
          ? {
              type: 'hit',
              player: who,
              zombie: e.zombie,
              x: e.x,
              y: e.y,
              killed: e.killed,
              assassination: e.assassination,
              silent: e.silent,
            }
          : null;
      case 'bite':
        return who ? { type: 'bite', zombie: e.zombie, player: who, x: e.x, y: e.y } : null;
      case 'death':
        return who ? { type: 'death', player: who } : null;
      case 'respawn':
        return who ? { type: 'respawn', player: who } : null;
    }
  }
}

export function toPlayerState(id: PeerId, w: WirePlayer): PlayerState {
  return {
    id,
    x: w.x,
    y: w.y,
    facing: aimToRad(w.aim),
    hp: w.hp,
    stamina: w.stamina,
    exhausted: w.exhausted,
    staminaIdle: w.staminaIdle,
    sprinting: w.sprinting,
    attackCd: w.attackCd,
    prevButtons: w.prevButtons,
    respawnIn: w.respawnIn,
    downedFor: w.downedFor,
    reviveProgress: w.reviveProgress,
    dragging: w.dragging,
  };
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
