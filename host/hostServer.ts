import { decodeGame, encodeGame, GameMsg, type WireEvent, type WirePlayer } from '@net/gameCodec';
import type { MapSource } from '@shared/sim/grid';
import { radToAim, type PlayerInput } from '@shared/sim/input';
import type { PlayerState } from '@shared/sim/player';
import { SimWorld, type SimEvent, type WorldState } from '@shared/sim/world';
import type { Channel, PeerId } from '@shared/types';

/** Gửi snapshot mỗi bấy nhiêu tick (2 tick = 10 lần/giây) — đủ mượt nhờ nội suy, tiết kiệm băng thông. */
export const SNAPSHOT_EVERY = 2;
/**
 * Bán kính quan tâm (ô, hình vuông): chỉ gửi zombie/cửa/sự kiện trong vùng này quanh người nhận
 * (AGENTS.md mục 2.7: ~1.5 màn hình; màn hình zoom 3 rộng khoảng 40 ô).
 */
export const INTEREST_RADIUS = 32;
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
  /** Dựng tiếp từ thế giới cũ (chuyển host). */
  restore?: WorldState;
}

interface Client {
  id: PeerId;
  slot: number;
  /** Input chờ chạy, xếp theo seq tăng dần. */
  queue: PlayerInput[];
  /** seq của input cuối cùng đã chạy — gửi lại cho client để reconcile. */
  ack: number;
}

/**
 * Mô phỏng phía host (AGENTS.md mục 2.1): nhận input của mọi người, chạy SimWorld 20Hz,
 * gửi snapshot riêng cho từng người theo vùng quan tâm + sự kiện.
 * Thuần (không timer, không Worker) để test được; host/worker.ts bọc nó chạy trong Web Worker.
 */
export class HostServer {
  readonly world: SimWorld;
  private clients = new Map<PeerId, Client>();
  private out: Outgoing[] = [];
  private rosterDirty = false;

  constructor(opts: HostServerOptions) {
    this.world = new SimWorld({
      seed: opts.seed,
      map: opts.map,
      zombieCount: opts.zombieCount,
      restore: opts.restore,
    });
  }

  /** Gói từ mạng (hoặc từ chính máy host). Người gửi input lần đầu = vào trận. */
  receive(from: PeerId, data: Uint8Array): void {
    const msg = decodeGame(data);
    if (!msg || msg.type !== GameMsg.Input) return;
    const c = this.client(from);
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

  removePeer(id: PeerId): void {
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
    if (this.world.tick % SNAPSHOT_EVERY === 0) this.sendSnapshots();

    const out = this.out;
    this.out = [];
    return out;
  }

  private client(id: PeerId): Client {
    let c = this.clients.get(id);
    if (!c) {
      const used = new Set([...this.clients.values()].map((x) => x.slot));
      let slot = 0;
      while (used.has(slot)) slot++;
      c = { id, slot, queue: [], ack: 0 };
      this.clients.set(id, c);
      this.world.addPlayer(id);
      this.rosterDirty = true;
    }
    return c;
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

  private sendEvents(events: readonly SimEvent[]): void {
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
    for (const c of this.clients.values()) {
      const me = w.players.get(c.id);
      if (!me) continue;
      const zombies = [];
      for (const z of w.zombies) {
        if (near(me, z.x, z.y))
          zombies.push({ id: z.id, x: z.x, y: z.y, facing: z.facing, chasing: z.mode === 'chase' });
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
        }),
        channel: 'unreliable',
      });
    }
  }
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
  };
}
