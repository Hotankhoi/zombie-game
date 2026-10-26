import {
  decodeGame,
  encodeGame,
  FAR_ZOMBIE_TILES,
  GameMsg,
  TileChange,
  type SnapshotMsg,
  type WireEvent,
  type WireHorde,
  type WirePlayer,
  type WireVitals,
  VITAL_FIELDS,
} from '@net/gameCodec';
import { isLootPacket } from '@net/lootCodec';
import { encodeRoomFull } from '@net/roomFull';
import { BACKUP_PARTS, encodeBackupPart } from '@net/worldBackup';
import { hasLineOfSight } from '@shared/sim/collision';
import type { MapSource } from '@shared/sim/grid';
import { radToAim, type PlayerInput } from '@shared/sim/input';
import { isUp, type PlayerState } from '@shared/sim/player';
import type { ZombieState } from '@shared/sim/zombie';
import { SimWorld, type SimEvent, type WorldState } from '@shared/sim/world';
import { MAX_PLAYERS, type Channel, type PeerId } from '@shared/types';
import type { LootReplicaWire } from '@shared/types/loot';
import { HostLoot } from './hostLoot';
import type { ItemStack } from '@shared/inventory/inventory';

/** Gửi snapshot mỗi bấy nhiêu tick (2 tick = 10 lần/giây) — đủ mượt nhờ nội suy, tiết kiệm băng thông. */
export const SNAPSHOT_EVERY = 2;
/**
 * Bán kính quan tâm (ô, hình vuông): chỉ gửi zombie/cửa/sự kiện trong vùng này quanh người nhận
 * (AGENTS.md mục 2.7: ~1.5 màn hình; màn hình zoom 3 rộng khoảng 40 ô).
 */
export const INTEREST_RADIUS = 32;
/**
 * Ngân sách zombie mỗi snapshot (đợt tràn tối đa ≤ 20 KB/s mỗi người, chừa ~5 KB/s cho loot): luôn gửi
 * ZOMBIE_NEAR_ALWAYS con gần nhất, phần còn lại gửi xoay vòng trong số chỗ trống — ưu tiên con trên màn hình,
 * con ngoài màn hình (> FAR_ZOMBIE_TILES ô) chỉ được tối đa ZOMBIE_OFFSCREEN_ROOM chỗ. Client giữ vị trí cũ
 * của con vắng mặt một lúc (net/clientSync.ts). Cách làm triệt để (delta + zombie tất định) để GĐ 2b'.
 */
export const ZOMBIE_BUDGET = 165;
export const ZOMBIE_NEAR_ALWAYS = 130;
export const ZOMBIE_OFFSCREEN_ROOM = 8;
/**
 * Mỗi người nhận đủ bản sao lưu toàn thế giới mỗi bấy nhiêu tick (200 tick = 10s) — để chuyển host không mất
 * trạng thái. Chia BACKUP_PARTS mẩu, mỗi BACKUP_EVERY / BACKUP_PARTS tick (1s) gửi 1 mẩu cho mọi người: băng thông
 * đều (~2 KB/s lúc đợt tràn tối đa) thay vì ~23 KB dồn 1 lần làm vọt đỉnh.
 */
export const BACKUP_EVERY = 200;
/** Hàng input dài hơn mức này sau 1 tick → chạy bù thêm 1 input (bắt kịp gấp đôi tốc độ). */
const CATCH_UP_ABOVE = 1;
/** Hàng input tối đa (1 giây). Dài hơn (máy khách treo rồi gửi dồn) thì bỏ input cũ nhất. */
const MAX_QUEUE = 20;

export interface Outgoing {
  to: PeerId;
  data: Uint8Array;
  channel: Channel;
}

export interface HostServerOptions {
  seed: string;
  map: MapSource;
  zombieCount?: number;
  /** Thế giới mới bắt đầu ở tick này (thử ban đêm: `?gio=`). Bỏ qua khi dựng tiếp từ thế giới cũ. */
  startTick?: number;
  /** Dựng tiếp từ thế giới cũ (chuyển host). */
  restore?: WorldState;
  /** Loot: dựng tiếp từ bản replica của host cũ + số thứ tự lần lên host (nằm trong term). */
  loot?: {
    restore?: LootReplicaWire;
    epoch?: number;
    /** Lên thay host cũ: thu bản replica của những người này trước khi nhận ghi (host/hostLoot.ts). */
    recover?: { expected: readonly PeerId[]; timeoutTicks?: number };
    random?: () => string;
    /** CHỈ bản dev (`?kit=1`): đồ có sẵn trong túi mới. */
    starterKit?: readonly ItemStack[];
  };
}

interface Client {
  id: PeerId;
  slot: number;
  /** Input chờ chạy, xếp theo seq tăng dần. */
  queue: PlayerInput[];
  /** seq của input cuối cùng đã chạy — gửi lại cho client để reconcile. */
  ack: number;
  /** Tick nhận input gần nhất (loot: kết nối im lâu = tab cũ đã đóng). */
  heardAt: number;
}

/**
 * Mô phỏng phía host (AGENTS.md mục 2.1): nhận input của mọi người, chạy SimWorld 20Hz,
 * gửi snapshot riêng cho từng người theo vùng quan tâm + sự kiện.
 * Thuần (không timer, không Worker) để test được; host/worker.ts bọc nó chạy trong Web Worker.
 */
export class HostServer {
  readonly world: SimWorld;
  /** Túi đồ + rương (gói 110–113, reliable). */
  readonly loot: HostLoot;
  private clients = new Map<PeerId, Client>();
  private out: Outgoing[] = [];
  private rosterDirty = false;
  /** Mẩu sao lưu gửi lần tới (xoay vòng 0..BACKUP_PARTS-1). */
  private backupTurn = 0;
  private readonly devKit: boolean;
  /** Người bị từ chối vì phòng đầy: tick báo gần nhất. */
  private rejectedAt = new Map<PeerId, number>();

  constructor(opts: HostServerOptions) {
    this.world = new SimWorld({
      seed: opts.seed,
      map: opts.map,
      zombieCount: opts.zombieCount,
      restore: opts.restore,
    });
    if (!opts.restore && opts.startTick) this.world.tick = opts.startTick;
    this.devKit = (opts.loot?.starterKit?.length ?? 0) > 0;
    this.loot = new HostLoot({
      seed: opts.seed,
      ...opts.loot,
      world: {
        inMatch: (id) => this.clients.has(id),
        position: (id) => {
          const p = this.world.players.get(id);
          return p ? { x: p.x, y: p.y, up: isUp(p) } : null;
        },
        sees: (from, chest) => hasLineOfSight(from, chest, this.world.blocked),
        idleTicks: (id) => {
          const c = this.clients.get(id);
          return c ? this.world.tick - c.heardAt : null;
        },
        checkUse: (id, item, target) => this.world.checkItemUse(id, item.itemId, target),
        applyUse: (id, item, target) => this.world.applyItemUse(id, item.itemId, item.rarity, target),
      },
    });
  }

  /** Gói từ mạng (hoặc từ chính máy host). Người gửi input lần đầu = vào trận. */
  receive(from: PeerId, data: Uint8Array): void {
    if (isLootPacket(data)) {
      this.heard(from);
      this.loot.receive(from, data);
      return;
    }
    const msg = decodeGame(data);
    if (!msg || msg.type !== GameMsg.Input) return;
    const c = this.client(from);
    if (!c) return;
    c.heardAt = this.world.tick;
    // gói kèm 3 input gần nhất → lấy những cái chưa chạy và chưa có, chèn đúng thứ tự seq
    // (gói tới sai thứ tự vẫn ghép lại được; input cũ hơn cái đã chạy thì bỏ)
    for (const i of msg.inputs) {
      if (i.seq <= c.ack || c.queue.some((q) => q.seq === i.seq)) continue;
      let at = c.queue.length;
      while (at > 0 && (c.queue[at - 1] as PlayerInput).seq > i.seq) at--;
      c.queue.splice(at, 0, { ...i, moveX: Math.sign(i.moveX), moveY: Math.sign(i.moveY) });
    }
    // máy khách gửi dồn quá nhiều (vd: tab bị treo) → bỏ input cũ nhất; client sẽ được sửa theo host
    while (c.queue.length > MAX_QUEUE) c.ack = (c.queue.shift() as PlayerInput).seq;
  }

  /** Vừa nghe người này (gói bất kỳ: ping, điểm host…) — còn sống dù tab ẩn không gửi input (loot: chống lấy túi). */
  heard(id: PeerId): void {
    const c = this.clients.get(id);
    if (c) c.heardAt = this.world.tick;
  }

  removePeer(id: PeerId): void {
    this.rejectedAt.delete(id);
    // cả người chưa vào trận: host mới đang thu bản loot thì khỏi chờ người đã rời
    this.loot.removePeer(id);
    if (!this.clients.delete(id)) return;
    this.world.removePlayer(id);
    this.rosterDirty = true;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /** Chạy 1 tick, trả về các gói cần gửi. */
  tick(): Outgoing[] {
    const inputs = new Map<PeerId, PlayerInput>();
    for (const c of this.clients.values()) {
      const input = this.nextInput(c);
      if (input) inputs.set(c.id, input);
    }
    this.world.step(inputs);
    for (const c of this.clients.values()) {
      const extra = c.queue.length > CATCH_UP_ABOVE ? this.nextInput(c) : null;
      if (extra) this.world.catchUp(c.id, extra);
    }

    if (this.rosterDirty) this.sendRoster();
    this.sendEvents(this.world.events);
    if (this.world.mapChanges.length > 0) this.sendMapDelta(this.world.mapChanges, [...this.clients.keys()]);
    // loot trước sao lưu: mẩu 0 mang đúng bản vừa phát cho mọi người
    this.loot.flush(this.world.tick);
    for (const o of this.loot.drain()) this.out.push({ to: o.to, data: o.data, channel: 'reliable' });
    if (this.world.tick % SNAPSHOT_EVERY === 0) this.sendSnapshots();
    if (this.world.tick % (BACKUP_EVERY / BACKUP_PARTS) === 0) this.sendBackup();

    const out = this.out;
    this.out = [];
    return out;
  }

  /** Người chơi đã vào trận, hoặc thêm mới; phòng đủ MAX_PLAYERS thì từ chối (null) và báo cho họ. */
  private client(id: PeerId): Client | null {
    let c = this.clients.get(id);
    if (!c && this.clients.size >= MAX_PLAYERS) {
      // báo tối đa mỗi 2 giây (họ gửi input 20 lần/giây)
      const last = this.rejectedAt.get(id) ?? -Infinity;
      if (this.world.tick - last >= 40) {
        this.rejectedAt.set(id, this.world.tick);
        this.out.push({ to: id, data: encodeRoomFull(MAX_PLAYERS), channel: 'reliable' });
      }
      return null;
    }
    if (!c) {
      const used = new Set([...this.clients.values()].map((x) => x.slot));
      let slot = 0;
      while (used.has(slot)) slot++;
      c = { id, slot, queue: [], ack: 0, heardAt: this.world.tick };
      this.clients.set(id, c);
      const p = this.world.addPlayer(id);
      // CHỈ bản dev (`?kit=1`): vào trận đã đói/khát, bị thương, nhiễm trùng để thử dùng đồ ngay
      if (this.devKit) {
        p.food = Math.min(p.food, 30);
        p.water = Math.min(p.water, 20);
        p.hp = Math.min(p.hp, 45);
        p.infection = Math.max(p.infection, 40);
      }
      this.loot.admit(id);
      this.rosterDirty = true;
      // người mới (hoặc mọi người khi host mới dựng lại thế giới): gửi cả danh sách ô map đã đổi
      const changed = this.world.brokenWallList();
      if (changed.length > 0) this.sendMapDelta(changed, [id]);
    }
    return c;
  }

  /** Danh sách ô tường đã vỡ → người nhận (reliable, không lọc theo vùng quan tâm: map dùng chung). */
  private sendMapDelta(tiles: readonly { x: number; y: number }[], to: readonly PeerId[]): void {
    const data = encodeGame({
      type: GameMsg.MapDelta,
      tiles: tiles.map((t) => ({ x: t.x, y: t.y, change: TileChange.WallBroken })),
    });
    for (const id of to) this.out.push({ to: id, data, channel: 'reliable' });
  }

  /**
   * Input tiếp theo của người chơi, hoặc null nếu chưa có (mạng giật/máy khách khựng) → nhân vật
   * đứng chờ, KHÔNG đoán: đoán sai thì phải kéo nhân vật của họ lại. Input tới muộn vẫn được chạy (catchUp).
   */
  private nextInput(c: Client): PlayerInput | null {
    const next = c.queue.shift();
    if (!next) return null;
    c.ack = next.seq;
    return next;
  }

  /**
   * Zombie gửi cho một người: trong vùng quan tâm, không đang nấp; quá ngân sách thì lấy con gần nhất
   * + xoay vòng phần còn lại theo số thứ tự snapshot (mỗi con xa vẫn được cập nhật vài lần mỗi giây).
   */
  private pickZombies(me: PlayerState, round: number): ZombieState[] {
    const list: { z: ZombieState; d: number }[] = [];
    for (const z of this.world.zombies) {
      // zombie đang nấp không gửi đi: máy người chơi không biết nó ở đâu cho tới khi nó lao ra
      if (z.hidden || !near(me, z.x, z.y)) continue;
      list.push({ z, d: Math.max(Math.abs(z.x - me.x), Math.abs(z.y - me.y)) });
    }
    if (list.length <= ZOMBIE_BUDGET) return list.map((e) => e.z);
    list.sort((a, b) => a.d - b.d || a.z.id - b.z.id);
    const out = list.slice(0, ZOMBIE_NEAR_ALWAYS).map((e) => e.z);
    const onScreen: ZombieState[] = [];
    const offScreen: ZombieState[] = [];
    for (const e of list.slice(ZOMBIE_NEAR_ALWAYS)) (e.d > FAR_ZOMBIE_TILES ? offScreen : onScreen).push(e.z);
    const room = ZOMBIE_BUDGET - ZOMBIE_NEAR_ALWAYS;
    const roomOff = Math.min(offScreen.length, Math.max(ZOMBIE_OFFSCREEN_ROOM, room - onScreen.length));
    rotate(out, onScreen, room - roomOff, round);
    rotate(out, offScreen, roomOff, round);
    return out;
  }

  private sendBackup(): void {
    const list = [...this.clients.values()].sort((a, b) => a.slot - b.slot);
    if (list.length === 0) return;
    // mã hóa 1 lần, cùng một gói cho mọi người
    const part = this.backupTurn++ % BACKUP_PARTS;
    // mẩu 0 kèm bản loot đầy đủ (túi + rương) — mỗi người có lại nguyên bản ≤ 10s một lần
    const data = encodeBackupPart(
      this.world.state(),
      part,
      BACKUP_PARTS,
      part === 0 ? this.loot.backupBlock() : null,
    );
    for (const c of list) this.out.push({ to: c.id, data, channel: 'reliable' });
  }

  private sendRoster(): void {
    this.rosterDirty = false;
    const data = encodeGame({
      type: GameMsg.Roster,
      slots: [...this.clients.values()].map((c) => ({ slot: c.slot, id: c.id })),
    });
    for (const c of this.clients.values()) this.out.push({ to: c.id, data, channel: 'reliable' });
  }

  private slotOf(id: PeerId): number {
    return this.clients.get(id)?.slot ?? 255;
  }

  private sendEvents(all: readonly SimEvent[]): void {
    // bị cả bầy cắn cùng lúc: máy khách chỉ vẽ 1 vệt máu ở chỗ người bị cắn + rung màn hình (máu đã trừ trong mô phỏng,
    // gửi qua snapshot) → mỗi người chỉ gửi 1 sự kiện cắn mỗi tick (đợt tràn tối đa: ~8 → 1, bớt ~2 KB/s mỗi người)
    const bitten = new Set<PeerId>();
    const events = all.filter((e) => e.type !== 'bite' || (!bitten.has(e.player) && !!bitten.add(e.player)));
    if (events.length === 0) return;
    const wire = events.map((e) => this.toWire(e));
    for (const c of this.clients.values()) {
      const me = this.world.players.get(c.id);
      if (!me) continue;
      const mine = wire.filter((e, i) => {
        const src = events[i] as SimEvent;
        // vết chém của chính mình client đã tự vẽ (dự đoán)
        if (src.type === 'swing' && src.player === c.id) return false;
        if (!('x' in e)) return true;
        return near(me, e.x, e.y);
      });
      if (mine.length === 0) continue;
      this.out.push({
        to: c.id,
        data: encodeGame({ type: GameMsg.Events, tick: this.world.tick, events: mine }),
        channel: 'reliable',
      });
    }
  }

  private toWire(e: SimEvent): WireEvent {
    switch (e.type) {
      case 'swing':
        return { kind: 'swing', slot: this.slotOf(e.player), x: e.x, y: e.y, facing: e.facing };
      case 'hit':
        return {
          kind: 'hit',
          slot: this.slotOf(e.player),
          zombie: e.zombie,
          x: e.x,
          y: e.y,
          killed: e.killed,
          assassination: e.assassination,
          silent: e.silent,
          hp: e.hp,
        };
      case 'bite':
        return { kind: 'bite', zombie: e.zombie, slot: this.slotOf(e.player), x: e.x, y: e.y };
      case 'door':
        return { kind: 'door', x: e.x, y: e.y, open: e.open };
      case 'death':
        return { kind: 'death', slot: this.slotOf(e.player) };
      case 'respawn':
        return { kind: 'respawn', slot: this.slotOf(e.player) };
    }
  }

  /**
   * Chỉ số sinh tồn gửi cho người nhận `c`: của chính họ (dự đoán + HUD) + 1 đồng đội xoay vòng theo số thứ tự snapshot
   * (mỗi đồng đội ≤ 0,3 s một lần — đủ để lên host thay mà không mất chỉ số, ~190 B/s mỗi người).
   */
  private vitalsFor(c: Client, round: number): WireVitals[] {
    const out: WireVitals[] = [];
    const add = (id: PeerId, slot: number) => {
      const p = this.world.players.get(id);
      if (!p) return;
      const v = { slot } as WireVitals;
      for (const f of VITAL_FIELDS) v[f] = p[f];
      out.push(v);
    };
    add(c.id, c.slot);
    const others = [...this.clients.values()].filter((o) => o !== c).sort((a, b) => a.slot - b.slot);
    const o = others[round % Math.max(1, others.length)];
    if (o) add(o.id, o.slot);
    return out;
  }

  private sendSnapshots(): void {
    const w = this.world;
    const players: WirePlayer[] = [];
    for (const c of this.clients.values()) {
      const p = w.players.get(c.id);
      if (p) players.push(wirePlayer(c.slot, p));
    }
    const doors = w.doors.openList().map((k) => {
      const [x, y] = k.split(',').map(Number);
      return { x: x as number, y: y as number };
    });
    const h = w.horde;
    const horde: WireHorde | null = h
      ? {
          number: h.number,
          active: h.active,
          survived: h.survived,
          remaining: w.hordeRemaining(),
          bossAlive: w.zombies.some((z) => z.kind === 'boss' && z.horde),
          rows: [...this.clients.values()].map((c) => ({
            slot: c.slot,
            kills: h.kills[c.id] ?? 0,
            downs: h.downs[c.id] ?? 0,
          })),
        }
      : null;
    const round = w.tick / SNAPSHOT_EVERY;
    for (const c of this.clients.values()) {
      const me = w.players.get(c.id);
      if (!me) continue;
      const zombies = [];
      for (const z of this.pickZombies(me, w.tick / SNAPSHOT_EVERY)) {
        zombies.push({
          id: z.id,
          x: z.x,
          y: z.y,
          facing: z.facing,
          chasing: z.mode === 'chase',
          kind: z.kind,
          turnedSlot: z.turnedFrom ? (this.clients.get(z.turnedFrom)?.slot ?? null) : null,
        });
      }
      this.out.push({
        to: c.id,
        data: encodeGame({
          type: GameMsg.Snapshot,
          tick: w.tick,
          ack: c.ack,
          originX: Math.floor(me.x),
          originY: Math.floor(me.y),
          players,
          zombies,
          doors: doors.filter((d) => near(me, d.x + 0.5, d.y + 0.5)),
          horde,
          pools: w.pools
            .filter((p) => near(me, p.x, p.y))
            .map((p) => ({
              kind: p.kind,
              x: p.x,
              y: p.y,
              radius: p.radius,
              arming: p.armIn > 0,
              ttl: p.ttl,
            })),
          vitals: this.vitalsFor(c, round),
        }),
        channel: 'unreliable',
      });
    }
  }
}

/**
 * Vùng mà snapshot gửi ĐỦ zombie (trừ zombie đang nấp) quanh gốc của gói: cả vùng quan tâm, hoặc — khi chạm
 * ngân sách — chỉ tới con gần thứ ZOMBIE_NEAR_ALWAYS (xa hơn chỉ gửi xoay vòng). Chuyển host dùng vùng này
 * để biết zombie vắng mặt là đã chết hay chỉ bị bỏ bớt (net/worldBackup.ts mergeBackup).
 */
export function snapshotArea(s: SnapshotMsg): { x: number; y: number; radius: number; zombieRadius: number } {
  const area = { x: s.originX, y: s.originY, radius: INTEREST_RADIUS, zombieRadius: INTEREST_RADIUS };
  if (s.zombies.length < ZOMBIE_BUDGET) return area;
  const d = s.zombies
    .map((z) => Math.max(Math.abs(z.x - s.originX), Math.abs(z.y - s.originY)))
    .sort((a, b) => a - b);
  // gốc gói = vị trí người nhận làm tròn (lệch ≤ 0.5 ô) → lùi thêm 1 ô cho chắc
  area.zombieRadius = Math.max(0, (d[ZOMBIE_NEAR_ALWAYS - 1] ?? 0) - 1);
  return area;
}

/** Thêm `room` con từ `from` vào `out`, lượt sau lấy tiếp chỗ lượt trước dừng (xoay vòng); đủ chỗ thì lấy hết. */
function rotate(out: ZombieState[], from: readonly ZombieState[], room: number, round: number): void {
  if (room >= from.length) {
    out.push(...from);
    return;
  }
  const start = (round * room) % from.length;
  for (let i = 0; i < room; i++) out.push(from[(start + i) % from.length] as ZombieState);
}

function near(p: { x: number; y: number }, x: number, y: number): boolean {
  return Math.abs(x - p.x) <= INTEREST_RADIUS && Math.abs(y - p.y) <= INTEREST_RADIUS;
}

function wirePlayer(slot: number, p: PlayerState): WirePlayer {
  return {
    slot,
    x: p.x,
    y: p.y,
    aim: radToAim(p.facing),
    hp: p.hp,
    stamina: p.stamina,
    staminaIdle: p.staminaIdle,
    attackCd: p.attackCd,
    respawnIn: p.respawnIn,
    exhausted: p.exhausted,
    sprinting: p.sprinting,
    prevButtons: p.prevButtons,
    downedFor: p.downedFor,
    reviveProgress: p.reviveProgress,
    dragging: p.dragging,
    flashlight: p.flashlight,
  };
}
