import { ClientSync } from '@net/clientSync';
import { GameMsg } from '@net/gameCodec';
import { HostElection } from '@net/hostElection';
import type { Transport } from '@net/transport';
import type { FromWorker, HostStats, ToWorker } from '@host/workerProtocol';
import { worldSeedForRoom } from '@shared/mapgen/world';
import type { PlayerInput } from '@shared/sim/input';
import { MapgenSource } from '@shared/sim/mapgenSource';
import type { PeerId } from '@shared/types';

export type NetRole = 'host' | 'client' | 'waiting';

/**
 * Ghép trận online trên trình duyệt (GĐ 2a): chọn host, nếu mình là host thì chạy HostServer
 * trong Web Worker và chuyển gói mạng ↔ worker; mọi máy (kể cả host) chơi qua ClientSync.
 * Host cũng là một client: gói của chính mình đi đường nội bộ, không qua mạng.
 */
export class NetGame {
  readonly sync: ClientSync;
  readonly election: HostElection;
  readonly map: MapgenSource;
  readonly seed: string;
  /** Số đo của worker host (chỉ có khi mình là host), cập nhật mỗi giây. */
  hostStats: HostStats | null = null;
  /** Số lần đổi host từ lúc vào phòng (trừ lần chọn đầu). */
  migrations = 0;
  private worker: Worker | null = null;
  private timer: ReturnType<typeof setInterval>;

  constructor(
    private transport: Transport,
    room: string,
    private zombieCount?: number,
  ) {
    this.seed = worldSeedForRoom(room);
    this.map = new MapgenSource(this.seed);
    this.sync = new ClientSync(transport.selfId, this.map);
    this.election = new HostElection(transport);
    this.election.changed.on((h) => this.onHostChanged(h));
    transport.onMessage((data, from) => this.onMessage(data, from));
    transport.onPeerLeave((id) => this.toWorker({ t: 'leave', peer: id }));
    // tab ẩn: hẹn giờ chậm lại nhưng vẫn chạy; nếu mình là host thì nhịp của worker gọi thêm
    this.timer = setInterval(() => this.election.tick(), 250);
    this.election.tick();
  }

  get role(): NetRole {
    const h = this.election.hostId;
    return h === null ? 'waiting' : h === this.transport.selfId ? 'host' : 'client';
  }

  get hostId(): PeerId | null {
    return this.election.hostId;
  }

  /** Một tick 20Hz của mình: dự đoán + gửi input cho host. Trả về true nếu vừa chém. */
  tick(input: PlayerInput): boolean {
    const { packet, swung } = this.sync.tick(input);
    const host = this.election.hostId;
    if (host === this.transport.selfId) this.toWorker({ t: 'in', from: host, data: packet });
    else if (host) this.transport.send(packet, { to: host, channel: 'unreliable' });
    return swung;
  }

  dispose(): void {
    clearInterval(this.timer);
    this.stopHost();
    this.election.dispose();
  }

  private onMessage(data: Uint8Array, from: PeerId): void {
    switch (data[0]) {
      case GameMsg.Input:
        this.toWorker({ t: 'in', from, data: data.slice() });
        break;
      case GameMsg.Snapshot:
      case GameMsg.Events:
      case GameMsg.Roster:
        // chỉ nghe host hiện tại (gói muộn của host cũ thì bỏ)
        if (from === this.election.hostId) this.sync.receive(data);
        break;
    }
  }

  private onHostChanged(host: PeerId | null): void {
    const self = this.transport.selfId;
    if (host === self) this.startHost();
    else this.stopHost();
    if (this.sync.latest) this.migrations++;
    this.sync.resetHost();
  }

  private startHost(): void {
    if (this.worker) return;
    const self = this.transport.selfId;
    // lên thay host cũ: dựng tiếp thế giới từ snapshot cuối mình nhận được
    const restore =
      this.sync.toWorldState(this.seed, new Set([self, ...this.transport.peers()])) ?? undefined;
    const w = new Worker(new URL('../../host/worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.t === 'out') {
        for (const item of m.items) {
          if (item.to === self) this.sync.receive(item.data);
          else this.transport.send(item.data, { to: item.to, channel: item.channel });
        }
      } else {
        this.hostStats = m.stats;
        this.election.tick();
      }
    };
    w.onerror = (e) => console.error('[host] worker lỗi:', e.message);
    this.worker = w;
    this.toWorker({ t: 'init', seed: this.seed, zombieCount: this.zombieCount, restore });
  }

  private stopHost(): void {
    this.worker?.terminate();
    this.worker = null;
    this.hostStats = null;
  }

  private toWorker(m: ToWorker): void {
    this.worker?.postMessage(m);
  }
}
