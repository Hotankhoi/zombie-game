import { NetGame, type HostRunner, type NetGameOptions } from '@client/net/netGame';
import { ConditionedTransport, type NetConditions } from '@net/conditions';
import { LoopbackHub } from '@net/loopback';
import { FakeTimers } from '@net/testTimers';
import type { FromWorker, ToWorker } from '@host/workerProtocol';
import type { KeyStorage } from '@net/playerKey';
import type { Transport } from '@net/transport';
import { MapgenSource } from '@shared/sim/mapgenSource';
import { SIM_TICK_MS, type PeerId } from '@shared/types';
import { Rng } from '@shared/util/rng';
import { HostServer } from './hostServer';

/**
 * Chỉ cho test: chạy HostServer trong cùng tiến trình thay cho Web Worker (cùng tin nhắn ToWorker/FromWorker).
 */
export class InProcessHost implements HostRunner {
  server: HostServer | null = null;
  dead = false;
  constructor(private onMessage: (m: FromWorker) => void) {}
  postMessage(m: ToWorker): void {
    if (this.dead) return;
    if (m.t === 'init')
      this.server = new HostServer({
        seed: m.seed,
        map: new MapgenSource(m.seed),
        zombieCount: m.zombieCount,
        startTick: m.startTick,
        restore: m.restore,
        saved: m.saved,
        devSpawnRegion: m.devSpawnRegion,
        loot: m.loot,
      });
    else if (m.t === 'in') this.server?.receive(m.from, m.data);
    else if (m.t === 'seen') this.server?.heard(m.peer);
    else if (m.t === 'save') this.server?.requestSave();
    else this.server?.removePeer(m.peer);
  }
  step(): void {
    if (this.dead || !this.server) return;
    const items = this.server.tick();
    if (items.length > 0) this.onMessage({ t: 'out', items });
    const save = this.server.pollSave();
    if (save) this.onMessage({ t: 'save', ...save });
  }
  terminate(): void {
    this.dead = true;
    this.server = null;
  }
}

export interface MatchNode {
  id: PeerId;
  game: NetGame;
  transport: ConditionedTransport;
  /** Host đang chạy trên máy này (nếu đang là host). */
  host: InProcessHost | null;
  key: string;
}

/** Bộ nhớ Web Storage giả (localStorage chung cả "trình duyệt", sessionStorage riêng từng tab). */
export class MemStorage implements KeyStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

/**
 * Trận thử nhiều máy (chỉ cho test): NetGame thật của từng người trên LoopbackHub + ConditionedTransport (trễ, mất gói
 * kênh unreliable), đồng hồ giả, host chạy trong tiến trình. Mỗi `step()` = 1 tick 20Hz trên mọi máy.
 */
export class TestMatch {
  readonly hub = new LoopbackHub();
  readonly timers = new FakeTimers();
  readonly nodes = new Map<PeerId, MatchNode>();
  private rng = new Rng('match-loss');
  private seq = 0;
  /** Tab ẩn: requestAnimationFrame dừng (không tick game / không input) nhưng hẹn giờ vẫn chạy (bầu host, điểm host). */
  readonly hidden = new Set<PeerId>();
  /** Tab treo hẳn: không chạy gì, không gửi gì (mạng chưa báo rời). */
  readonly frozen = new Set<PeerId>();

  constructor(
    readonly room: string,
    private conditions: NetConditions = { latencyMs: 0, jitterMs: 0, loss: 0 },
  ) {}

  /**
   * Một máy vào phòng. `key` = playerKey (cùng khóa = cùng người, vd tải lại trang), hoặc Web Storage giả (NetGame tự
   * đọc/ghi khóa như trên trình duyệt: `local` chung, `session` riêng tab).
   */
  join(
    id: PeerId,
    key: string | { local: KeyStorage; session: KeyStorage },
    resume = false,
    /** Chưa nối được ai trong bấy nhiêu ms (WebRTC sau khi tải lại nối chậm): không gửi/nhận gì. */
    connectAfterMs = 0,
    /** Tùy chọn NetGame thêm (GĐ 5: `saved`, `onSave`). */
    extra: Partial<NetGameOptions> = {},
  ): MatchNode {
    const blindUntil = this.timers.now() + connectAfterMs;
    const blind = () => this.timers.now() < blindUntil;
    const sched = { setTimeout: this.timers.setTimeout, now: this.timers.now, random: () => this.rng.next() };
    // tab treo (frozen): không gửi được gì (kể cả trả lời gói tới)
    const raw = this.hub.join(id);
    const mutable: Transport = {
      selfId: raw.selfId,
      peers: () => (blind() ? [] : raw.peers()),
      send: (data, o) => {
        if (!this.frozen.has(id) && !blind()) raw.send(data, o);
      },
      onMessage: (h) =>
        raw.onMessage((data, from) => {
          if (!blind()) h(data, from);
        }),
      onPeerJoin: (h) => raw.onPeerJoin(h),
      onPeerLeave: (h) => raw.onPeerLeave(h),
      leave: () => raw.leave(),
    };
    const transport = new ConditionedTransport(mutable, this.conditions, sched);
    const node: MatchNode = {
      id,
      transport,
      host: null,
      key: typeof key === 'string' ? key : '',
      game: null as unknown as NetGame,
    };
    node.game = new NetGame(transport, this.room, {
      zombieCount: 0,
      ...extra,
      ...(typeof key === 'string' ? { playerKey: { key, resume } } : { storage: key }),
      test: {
        now: this.timers.now,
        simBenchMs: 1,
        startHost: (onMessage) => (node.host = new InProcessHost(onMessage)),
      },
    });
    this.nodes.set(id, node);
    return node;
  }

  /** Máy rời phòng (đóng tab). */
  leave(id: PeerId): void {
    const n = this.nodes.get(id);
    if (!n) return;
    n.game.dispose();
    void n.transport.leave();
    this.nodes.delete(id);
  }

  step(n = 1): void {
    for (let i = 0; i < n; i++) {
      this.seq++;
      for (const node of this.nodes.values()) {
        if (this.frozen.has(node.id)) continue;
        node.game.election.tick();
        if (!this.hidden.has(node.id))
          node.game.tick({ seq: this.seq, moveX: 0, moveY: 0, aim: 0, buttons: 0 });
      }
      for (const node of this.nodes.values()) {
        if (this.frozen.has(node.id)) continue;
        if (node.host?.dead) node.host = null;
        node.host?.step();
      }
      this.timers.advance(SIM_TICK_MS);
    }
  }

  /** Chạy tới khi điều kiện đúng (tối đa `max` tick). Trả về số tick đã chạy. */
  until(cond: () => boolean, max = 2000): number {
    for (let i = 0; i < max; i++) {
      if (cond()) return i;
      this.step();
    }
    throw new Error('quá thời gian chờ');
  }

  /** Máy đang làm host (theo HostServer đang chạy). */
  hostNode(): MatchNode | null {
    for (const n of this.nodes.values()) if (n.host?.server) return n;
    return null;
  }

  server(): HostServer {
    const h = this.hostNode()?.host?.server;
    if (!h) throw new Error('chưa có host');
    return h;
  }

  /** Dịch nhân vật (phía host) tới vị trí. */
  place(id: PeerId, x: number, y: number): void {
    const p = this.server().world.players.get(id);
    if (!p) throw new Error(`${id} chưa vào trận`);
    p.x = x;
    p.y = y;
  }
}
