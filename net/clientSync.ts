import type { BlockedFn } from '@shared/sim/collision';
import { Doors } from '@shared/sim/doors';
import type { MapSource } from '@shared/sim/grid';
import { aimToRad, type PlayerInput } from '@shared/sim/input';
import type { PlayerState } from '@shared/sim/player';
import { Predictor } from '@shared/sim/prediction';
import type { Corpse, SimEvent, WorldState } from '@shared/sim/world';
import { PARTY } from '@shared/sim/tuning/party';
import type { ZombieKind } from '@shared/sim/tuning/zombieKinds';
import { maxHpOf, type ZombieState } from '@shared/sim/zombie';
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
/**
 * Đợt tràn lớn: host chỉ gửi một phần zombie mỗi snapshot (ngân sách, xem host/hostServer.ts). Zombie vắng
 * mặt mà mới thấy cách đây ≤ bấy nhiêu tick (và không bị giết) thì giữ vị trí cũ thay vì cho biến mất.
 */
const KEEP_MISSING_TICKS = 24;
/** Snapshot tới muộn: ngoại suy theo vận tốc tối đa bấy nhiêu tick (150ms) rồi đứng chờ, không đoán xa hơn. */
const MAX_EXTRAP_TICKS = 3;
const TICKS_PER_SEC = 1000 / SIM_TICK_MS;
/** Nhớ máu tối đa bấy nhiêu zombie bị đánh gần nhất. */
const ZOMBIE_HP_KEEP = 1024;

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
  /** Đèn pin đang bật (GĐ 4) — đèn của đồng đội cũng soi sáng cho mình. */
  flashlight: boolean;
}

export interface ZombieView {
  id: number;
  x: number;
  y: number;
  facing: number;
  chasing: boolean;
  kind: ZombieKind;
  /** Zombie từ xác đồng đội (GĐ 6): người đó, để vẽ màu riêng. */
  turnedFrom: PeerId | null;
}

/**
 * Phía client của trận (GĐ 2a): dự đoán nhân vật mình, nội suy zombie/đồng đội từ snapshot,
 * gói input gửi host. Không phụ thuộc trình duyệt (nhận `now`), nên test được bằng mạng giả.
 */
export class ClientSync {
  readonly predictor: Predictor;
  /** Ô chặn theo máy mình: tường + cửa đang đóng (theo snapshot) — dự đoán di chuyển và tầm nhìn dùng chung. */
  readonly blocked: BlockedFn;
  doors = new Doors();
  /** Sự kiện đã nhận (đổi slot → PeerId), scene lấy ra vẽ hiệu ứng. */
  events: SimEvent[] = [];
  /** Người chơi của một slot (bảng thành tích đợt tràn). */
  peerOfSlot(slot: number): PeerId | undefined {
    return this.slots.get(slot);
  }

  /** Snapshot mới nhất (để chuyển host). */
  latest: SnapshotMsg | null = null;
  /** Số snapshot đã nhận / bị bỏ vì tới muộn hơn cái mới hơn. */
  received = 0;
  stale = 0;
  /** Độ giật của khoảng cách giữa các snapshot (ms, làm mượt) — quyết định trễ nội suy. */
  jitterMs = 0;
  private slots = new Map<number, PeerId>();
  private snaps: Snap[] = [];
  /** Tick snapshot gần nhất có mặt từng zombie (giữ zombie xa ở snapshot lẻ). */
  private zombieSeen = new Map<number, number>();
  /**
   * Máu zombie đã bị đánh (16 bit thấp của id → máu còn lại, theo sự kiện hit) — chuyển host không hồi máu
   * zombie (snapshot không gửi máu cho đỡ tốn băng thông). Giới hạn ZOMBIE_HP_KEEP con gần nhất bị đánh.
   */
  private zombieHp = new Map<number, number>();
  /** Xác đồng đội chưa thành zombie (sự kiện death + vị trí cuối) — chuyển host không làm mất xác. */
  private corpses: { player: PeerId; x: number; y: number; tick: number }[] = [];
  private recent: PlayerInput[] = [];
  /** Ước lượng (giờ máy mình) − (tick host × 50ms). */
  private clockOffset: number | null = null;
  private lastRecv: { at: number; tick: number } | null = null;

  constructor(
    readonly selfId: PeerId,
    readonly map: MapSource,
    private now: () => number = () => performance.now(),
  ) {
    // tileKind (nếu có): 1 lần tra thay vì 2 — tầm nhìn bắn vài nghìn tia ô mỗi frame
    const kind = map.tileKind?.bind(map);
    this.blocked = kind
      ? (tx, ty) => {
          const k = kind(tx, ty);
          return k === 1 || (k === 2 && !this.doors.isOpen(tx, ty));
        }
      : (tx, ty) => map.isWall(tx, ty) || (map.isDoor(tx, ty) && !this.doors.isOpen(tx, ty));
    this.predictor = new Predictor(this.blocked);
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
          // zombie bị giết: bỏ khỏi danh sách "giữ khi vắng mặt" ngay
          if (e.kind === 'hit' && e.killed) this.forgetZombie(e.zombie);
          else if (e.kind === 'hit') this.rememberHp(e.zombie & 0xffff, e.hp);
          else if (e.kind === 'death') this.rememberCorpse(e.slot, msg.tick);
        }
        return true;
      default:
        return false;
    }
  }

  private turnedOf(z: WireZombie): PeerId | null {
    return z.turnedSlot === null ? null : (this.slots.get(z.turnedSlot) ?? null);
  }

  private rememberHp(id: number, hp: number): void {
    this.zombieHp.delete(id); // chèn lại cuối → Map giữ thứ tự bị đánh gần nhất
    this.zombieHp.set(id, hp);
    if (this.zombieHp.size > ZOMBIE_HP_KEEP)
      this.zombieHp.delete(this.zombieHp.keys().next().value as number);
  }

  private rememberCorpse(slot: number, tick: number): void {
    const id = this.slots.get(slot);
    const p = this.latest?.players.find((w) => w.slot === slot);
    if (!id || !p) return;
    this.corpses = this.corpses.filter((c) => tick - c.tick < PARTY.turnSec * TICKS_PER_SEC);
    this.corpses.push({ player: id, x: p.x, y: p.y, tick });
  }

  private forgetZombie(id: number): void {
    this.zombieSeen.delete(id);
    this.zombieHp.delete(id & 0xffff);
    for (const s of this.snaps) s.zombies.delete(id);
  }

  /** Đổi host: bỏ đồng hồ/bộ đệm cũ (tick của host mới có thể nhảy). Giữ dự đoán. */
  resetHost(): void {
    this.snaps = [];
    this.zombieSeen.clear();
    this.clockOffset = null;
    this.lastRecv = null;
    this.latest = null;
  }

  get interpDelayMs(): number {
    const gap = 2 * SIM_TICK_MS; // khoảng cách 2 snapshot
    return Math.max(MIN_INTERP_MS, Math.min(MAX_INTERP_MS, gap + 2.5 * this.jitterMs + 20));
  }

  /**
   * Tick hiện tại của host ước lượng theo đồng hồ máy mình (ngày/đêm, đếm ngày của GĐ 4–5
   * suy ra từ tick nên mọi máy thấy cùng giờ). Chưa có snapshot thì 0.
   */
  serverTick(): number {
    if (this.clockOffset === null) return this.latest?.tick ?? 0;
    return Math.max(0, (this.now() - this.clockOffset) / SIM_TICK_MS);
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
              kind: zb.kind,
              turnedFrom: this.turnedOf(zb),
            }
          : { ...zb, turnedFrom: this.turnedOf(zb) },
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
        flashlight: pb.flashlight,
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
        kind: z.kind,
        x: z.x,
        y: z.y,
        facing: z.facing,
        hp: this.zombieHp.get(z.id) ?? maxHpOf(z.kind),
        mode: target ? 'chase' : 'wander',
        target,
        wanderIn: 1,
        wanderMoving: false,
        biteCd: 0,
        goalX: z.x,
        goalY: z.y,
        investigateFor: 0,
        hidden: false,
        burstFor: 0,
        spitCd: 0,
        horde: false,
        slamCd: 0,
        roarCd: 0,
        turnedFrom: z.turnedSlot === null ? null : (this.slots.get(z.turnedSlot) ?? null),
      };
    });
    return {
      tick: s.tick,
      rngState: hashString(`${seed}:${s.tick}`),
      nextZombieId: maxId + 1,
      players,
      zombies,
      corpses: this.corpses
        .map((c): Corpse => ({
          player: c.player,
          x: c.x,
          y: c.y,
          turnIn: PARTY.turnSec - (s.tick - c.tick) / TICKS_PER_SEC,
        }))
        .filter((c) => c.turnIn > 0),
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
    const zmap = new Map(msg.zombies.map((z) => [z.id, z]));
    for (const z of msg.zombies) this.zombieSeen.set(z.id, msg.tick);
    const prev = this.snaps[this.snaps.length - 1];
    if (prev) {
      for (const [id, z] of prev.zombies) {
        if (zmap.has(id)) continue;
        const seen = this.zombieSeen.get(id) ?? -Infinity;
        if (msg.tick - seen <= KEEP_MISSING_TICKS) zmap.set(id, z);
        else this.zombieSeen.delete(id);
      }
    }
    this.snaps.push({ tick: msg.tick, players, zombies: zmap });
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
              hp: e.hp,
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
    flashlight: w.flashlight,
  };
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
