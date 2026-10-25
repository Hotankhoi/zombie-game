import { NetGame, type HostRunner } from '@client/net/netGame';
import { ConditionedTransport, type NetConditions } from '@net/conditions';
import { LoopbackHub } from '@net/loopback';
import { FakeTimers } from '@net/testTimers';
import type { FromWorker, ToWorker } from '@host/workerProtocol';
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
        loot: m.loot,
      });
    else if (m.t === 'in') this.server?.receive(m.from, m.data);
    else this.server?.removePeer(m.peer);
  }
  step(): void {
    if (this.dead || !this.server) return;
    const items = this.server.tick();
    if (items.length > 0) this.onMessage({ t: 'out', items });
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

  constructor(
    readonly room: string,
    private conditions: NetConditions = { latencyMs: 0, jitterMs: 0, loss: 0 },
  ) {}

  /** Một máy vào phòng. `key` = playerKey (cùng khóa = cùng người, vd tải lại trang). */
  join(id: PeerId, key: string, resume = false): MatchNode {
    const sched = { setTimeout: this.timers.setTimeout, now: this.timers.now, random: () => this.rng.next() };
    const transport = new ConditionedTransport(this.hub.join(id), this.conditions, sched);
    const node: MatchNode = { id, transport, host: null, key, game: null as unknown as NetGame };
    node.game = new NetGame(transport, this.room, {
      zombieCount: 0,
      playerKey: { key, resume },
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
        node.game.election.tick();
        node.game.tick({ seq: this.seq, moveX: 0, moveY: 0, aim: 0, buttons: 0 });
      }
      for (const node of this.nodes.values()) {
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
