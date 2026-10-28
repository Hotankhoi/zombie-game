import { ClientLoot } from '@net/clientLoot';
import { ClientSync } from '@net/clientSync';
import { GameMsg } from '@net/gameCodec';
import { HostElection, WAIT_HOST_MS } from '@net/hostElection';
import { isLootPacket } from '@net/lootCodec';
import { loadPlayerKey, rememberPlayerKey, replacePlayerKey, type KeyStorage } from '@net/playerKey';
import type { Transport } from '@net/transport';
import { decodeRoomFull } from '@net/roomFull';
import { BackupParts, WORLD_BACKUP_MSG, mergeBackup } from '@net/worldBackup';
import { snapshotArea } from '@host/hostServer';
import type { FromWorker, HostStats, ToWorker } from '@host/workerProtocol';
import type { SaveParts } from '@host/hostServer';
import type { SavedWorld } from '@shared/save/save';
import { worldSeedForRoom } from '@shared/mapgen/world';
import type { PlayerInput } from '@shared/sim/input';
import type { AttackFx } from '@shared/sim/prediction';
import { MapgenSource } from '@shared/sim/mapgenSource';
import { SIM_TICK_HZ, type PeerId } from '@shared/types';
import type { ItemStack } from '@shared/inventory/inventory';
import { LOOT_REGIONS, type LootRegion } from '@shared/data/loot';
import { measureSimMs } from './benchmark';

export type NetRole = 'host' | 'client' | 'waiting';

export interface NetGameOptions {
  zombieCount?: number;
  /** Chỉ host dùng: thế giới mới bắt đầu ở tick này (thử ban đêm). */
  startTick?: number;
  /** CHỈ bản dev (`?kit=1`): mình làm host thì túi mới có sẵn đồ thử. */
  starterKit?: ItemStack[];
  /** CHỈ bản dev (`?den=police`): mình làm host thì người vào trận đứng cạnh rương của khu này. */
  devSpawnRegion?: LootRegion;
  /** CHỈ bản dev (`?dondat=giây`): mình làm host thì đồ trên đất hết hạn sau bấy nhiêu giây (thử tự dọn). */
  groundExpireSec?: number;
  /** CHỈ bản dev (`?roido=10`): mình làm host thì zombie rơi đồ nhiều gấp bấy nhiêu lần (thử nhanh). */
  devDropScale?: number;
  /** CHỈ bản dev (`?tran=5`): mình làm host thì đợt tràn chỉ bấy nhiêu zombie, không Boss (thử thắng nhanh). */
  devHordeQuota?: number;
  /**
   * GĐ 5: thế giới đã lưu của phòng này ("Tiếp tục thế giới đã lưu" / nhập file). Chỉ dùng nếu mình lên host khi
   * phòng chưa chạy (không có bản sao lưu/snapshot của host khác); phòng đang có host → bỏ (`savedLoad = 'rejected'`).
   */
  saved?: SavedWorld;
  /** GĐ 5: mình là host — phần thế giới để ghép file save (mỗi 30 s, hết đợt tràn, `requestSave`). */
  onSave?: (parts: SaveParts) => void;
  /** Ping (ms) tới một người, null nếu chưa đo — để tính điểm làm host. */
  rttOf?: (id: PeerId) => number | null;
  /** playerKey cố định (test). Không có thì đọc/ghi `storage` (mặc định localStorage + sessionStorage). */
  playerKey?: { key: string; resume: boolean; onKeyInUse?: () => string };
  /** Nơi lưu playerKey (test truyền bản giả để thử 2 tab cùng trình duyệt). */
  storage?: { local: KeyStorage | null; session: KeyStorage | null };
  /** Chỉ cho test (chạy trong Node, không Worker/timer thật): */
  test?: {
    now: () => number;
    /** Chạy host trong cùng tiến trình thay cho Web Worker. */
    startHost: (onMessage: (m: FromWorker) => void) => HostRunner;
    simBenchMs?: number;
  };
}

/** Nơi chạy HostServer của máy host: Web Worker (trình duyệt) hoặc chạy thẳng (test). */
export interface HostRunner {
  postMessage(m: ToWorker): void;
  terminate(): void;
}

/** Web Storage của trình duyệt (không có / bị chặn → null: khóa tạm tới khi đóng trang). */
function browserStorage(): { local: KeyStorage | null; session: KeyStorage | null } {
  const get = (name: 'localStorage' | 'sessionStorage') => {
    try {
      return globalThis[name] ?? null;
    } catch {
      return null;
    }
  };
  return { local: get('localStorage'), session: get('sessionStorage') };
}

/**
 * playerKey của tab này. Chỉ nhớ vào sessionStorage khi host đã nhận khóa (claim thành công) — xem `loadPlayerKey`.
 */
function storedPlayerKey(s: { local: KeyStorage | null; session: KeyStorage | null }) {
  const { key, resume } = loadPlayerKey(s.local, s.session);
  return {
    key,
    resume,
    onKeyInUse: () => replacePlayerKey(),
    onClaimed: (k: string) => rememberPlayerKey(s.session, k),
  };
}

/** Tên khu loot hợp lệ (tham số dev `?den=`). */
export function isLootRegion(s: string): s is LootRegion {
  return Object.hasOwn(LOOT_REGIONS, s);
}

/** Báo worker "vẫn nghe người này" tối đa mỗi bấy nhiêu ms mỗi người. */
const SEEN_EVERY_MS = 500;

/**
 * Nhớ (sessionStorage của tab) "đang ở phòng X cùng người khác" — tải lại trang trong ROOM_MEMO_MS thì chờ host thật
 * (`HostElection.expectHostUntil`, tối đa WAIT_HOST_MS) thay vì tự làm host tạm ~0,5 s.
 */
export const ROOM_MEMO_STORAGE = 'zombie-coop.lastRoom';
const ROOM_MEMO_EVERY_MS = 2000;
const ROOM_MEMO_MS = 60_000;

function readRoomMemo(s: KeyStorage | null): { room: string; at: number; others: number } | null {
  try {
    const v = JSON.parse(s?.getItem(ROOM_MEMO_STORAGE) ?? 'null') as unknown;
    if (!v || typeof v !== 'object') return null;
    const m = v as { room?: unknown; at?: unknown; others?: unknown };
    return typeof m.room === 'string' && typeof m.at === 'number' && typeof m.others === 'number'
      ? { room: m.room, at: m.at, others: m.others }
      : null;
  } catch {
    return null;
  }
}

/** Điểm làm host = ping trung bình + hệ số × thời gian chạy thử 20 tick mô phỏng (ms). */
const SIM_MS_WEIGHT = 4;

/**
 * Ghép trận online trên trình duyệt (GĐ 2a): chọn host, nếu mình là host thì chạy HostServer
 * trong Web Worker và chuyển gói mạng ↔ worker; mọi máy (kể cả host) chơi qua ClientSync.
 * Host cũng là một client: gói của chính mình đi đường nội bộ, không qua mạng.
 */
export class NetGame {
  readonly sync: ClientSync;
  /** Túi đồ + rương của mình (lớp dữ liệu loot, UI đọc từ đây — xem docs/loot-online-plan.md "API ClientLoot"). */
  readonly loot: ClientLoot;
  readonly election: HostElection;
  readonly map: MapgenSource;
  readonly seed: string;
  /** Số đo của worker host (chỉ có khi mình là host), cập nhật mỗi giây. */
  hostStats: HostStats | null = null;
  /** Số lần đổi host từ lúc vào phòng (trừ lần chọn đầu). */
  migrations = 0;
  /** Thời gian chạy thử 20 tick mô phỏng trên máy này (ms) — đo 1 lần lúc vào. */
  readonly simBenchMs: number;
  /** Các mẩu sao lưu thế giới từ host (mỗi mẩu ≤10s tuổi) — ghép lại dùng khi mình phải lên làm host. */
  readonly backup = new BackupParts();
  /** Host báo phòng đã đủ người (số tối đa) — mình chỉ xem, không vào trận được. */
  roomFull: number | null = null;
  private worker: HostRunner | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly testHooks: NetGameOptions['test'];
  private zombieCount: number | undefined;
  private startTick: number | undefined;
  private starterKit: ItemStack[] | undefined;
  private groundExpireSec: number | undefined;
  private devDropScale: number | undefined;
  private devHordeQuota: number | undefined;
  private saved: SavedWorld | undefined;
  private onSave: ((parts: SaveParts) => void) | undefined;
  /** GĐ 5: thế giới đã lưu — chờ lên host / đã nạp / bị bỏ vì phòng đang chạy. */
  savedLoad: 'none' | 'pending' | 'loaded' | 'rejected' = 'none';
  private devSpawnRegion: LootRegion | undefined;
  private readonly now: () => number;
  /** Lần cuối báo worker "vẫn nghe" từng người. */
  private seenAt = new Map<PeerId, number>();
  private readonly session: KeyStorage | null;
  private readonly wallNow: () => number;
  private memoAt = -Infinity;

  constructor(
    private transport: Transport,
    private readonly room: string,
    opts: NetGameOptions = {},
  ) {
    this.seed = worldSeedForRoom(room);
    this.testHooks = opts.test;
    this.now = opts.test?.now ?? (() => performance.now());
    // đồng hồ thật (còn đúng sau khi tải lại trang) cho ghi nhớ phòng; test dùng đồng hồ giả chung cả trận
    this.wallNow = opts.test?.now ?? (() => Date.now());
    const storage = opts.storage ?? (opts.playerKey ? null : browserStorage());
    this.zombieCount = opts.zombieCount;
    this.startTick = opts.startTick;
    this.starterKit = opts.starterKit;
    this.groundExpireSec = opts.groundExpireSec;
    this.devDropScale = opts.devDropScale;
    this.devHordeQuota = opts.devHordeQuota;
    this.saved = opts.saved;
    this.onSave = opts.onSave;
    if (opts.saved) this.savedLoad = 'pending';
    this.devSpawnRegion = opts.devSpawnRegion;
    this.map = new MapgenSource(this.seed);
    this.sync = new ClientSync(transport.selfId, this.map);
    this.loot = new ClientLoot({
      seed: this.seed,
      ...(opts.playerKey ?? storedPlayerKey(storage ?? { local: null, session: null })),
      send: (d) => this.sendLoot(d),
      now: opts.test?.now,
    });
    this.simBenchMs = opts.test?.simBenchMs ?? measureSimMs();
    const rttOf = opts.rttOf ?? (() => null);
    this.session = storage?.session ?? null;
    const memo = readRoomMemo(this.session);
    const reloaded =
      memo !== null && memo.room === room && memo.others > 0 && this.wallNow() - memo.at < ROOM_MEMO_MS;
    this.election = new HostElection(transport, opts.test?.now, {
      ...(reloaded && { expectHostUntil: this.now() + WAIT_HOST_MS }),
      getScore: () => {
        const rtts = transport
          .peers()
          .map(rttOf)
          .filter((r): r is number => r !== null);
        const avg = rtts.length > 0 ? rtts.reduce((a, b) => a + b, 0) / rtts.length : 0;
        return avg + SIM_MS_WEIGHT * this.simBenchMs;
      },
    });
    this.election.changed.on((h) => this.onHostChanged(h));
    transport.onMessage((data, from) => this.onMessage(data, from));
    transport.onMessage((data, from) => {
      if (from !== this.election.hostId) return;
      if (data[0] === WORLD_BACKUP_MSG && this.backup.receive(data)) {
        // mẩu 0 mang bản loot đầy đủ của host → làm mới bản đang giữ (để lên host)
        const loot = this.backup.takeLoot();
        if (loot) this.loot.receiveBackup(loot);
      }
      const full = decodeRoomFull(data);
      if (full !== null) this.roomFull = full;
    });
    transport.onPeerLeave((id) => this.toWorker({ t: 'leave', peer: id }));
    // tab ẩn: hẹn giờ chậm lại nhưng vẫn chạy; nếu mình là host thì nhịp của worker gọi thêm (test tự gọi)
    if (!opts.test) this.timer = setInterval(() => this.election.tick(), 250);
    this.election.tick();
  }

  get role(): NetRole {
    const h = this.election.hostId;
    return h === null ? 'waiting' : h === this.transport.selfId ? 'host' : 'client';
  }

  get hostId(): PeerId | null {
    return this.election.hostId;
  }

  /** Một tick 20Hz của mình: dự đoán + gửi input cho host. Trả về vết chém / tia đạn vừa dự đoán (để vẽ ngay). */
  tick(input: PlayerInput): AttackFx | null {
    const { packet, fx } = this.sync.tick(input);
    const host = this.election.hostId;
    if (host === this.transport.selfId) this.toWorker({ t: 'in', from: host, data: packet });
    else if (host) this.transport.send(packet, { to: host, channel: 'unreliable' });
    this.loot.tick();
    this.rememberRoom();
    return fx;
  }

  /** Ghi nhớ phòng (mỗi ~2 s, chỉ khi đã có host): tải lại trang lúc đang chơi cùng người khác → chờ host thật. */
  private rememberRoom(): void {
    const t = this.now();
    if (!this.session || this.election.hostId === null || t - this.memoAt < ROOM_MEMO_EVERY_MS) return;
    this.memoAt = t;
    try {
      this.session.setItem(
        ROOM_MEMO_STORAGE,
        JSON.stringify({ room: this.room, at: this.wallNow(), others: this.transport.peers().length }),
      );
    } catch {
      // bị chặn lưu trữ: tải lại thì chờ host như vào phòng mới (2 s)
    }
  }

  /** Gói loot (intent/ACK) tới host hiện tại: chính mình → worker; người khác → mạng (reliable). */
  private sendLoot(data: Uint8Array): void {
    const host = this.election.hostId;
    if (host === this.transport.selfId) this.toWorker({ t: 'in', from: host, data });
    else if (host) this.transport.send(data, { to: host, channel: 'reliable' });
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.stopHost();
    this.election.dispose();
  }

  private onMessage(data: Uint8Array, from: PeerId): void {
    if (this.worker) this.markSeen(from);
    if (isLootPacket(data)) {
      // mình là host: intent/ACK của người khác → worker; còn lại chỉ nghe host hiện tại
      if (this.role === 'host') this.toWorker({ t: 'in', from, data: data.slice() });
      else if (from === this.election.hostId) this.loot.receive(data);
      return;
    }
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

  /** Mình là host: gói bất kỳ (ping, điểm host…) của người này → báo worker họ còn sống (tab ẩn không gửi input). */
  private markSeen(from: PeerId): void {
    const t = this.now();
    if (t - (this.seenAt.get(from) ?? -Infinity) < SEEN_EVERY_MS) return;
    this.seenAt.set(from, t);
    this.toWorker({ t: 'seen', peer: from });
  }

  private onHostChanged(host: PeerId | null): void {
    const self = this.transport.selfId;
    if (host === self) this.startHost();
    else this.stopHost();
    // GĐ 5: phòng đã có host khác (đang chạy) → không nạp thế giới đã lưu đè lên
    if (host && host !== self && this.saved) {
      this.saved = undefined;
      this.savedLoad = 'rejected';
    }
    if (this.sync.latest) this.migrations++;
    this.roomFull = null;
    this.sync.resetHost();
    this.loot.resetHost();
  }

  private startHost(): void {
    if (this.worker) return;
    const self = this.transport.selfId;
    // lên thay host cũ: bản sao lưu toàn thế giới (≤10s) ghép với snapshot mới nhất quanh mình
    const keep = new Set([self, ...this.transport.peers()]);
    const latest = this.sync.latest;
    const area = latest ? snapshotArea(latest) : null;
    const restore =
      mergeBackup(this.backup.assemble(), this.sync.toWorldState(this.seed, keep), area, keep) ?? undefined;
    this.backup.clear();
    const onMessage = (m: FromWorker) => {
      if (m.t === 'out') {
        for (const item of m.items) {
          if (item.to === self) {
            if (isLootPacket(item.data)) this.loot.receive(item.data);
            else this.sync.receive(item.data);
          } else this.transport.send(item.data, { to: item.to, channel: item.channel });
        }
      } else if (m.t === 'save') this.onSave?.(m);
      else {
        this.hostStats = m.stats;
        this.election.tick();
      }
    };
    // GĐ 5: thế giới đã lưu chỉ nạp khi phòng chưa chạy (không có gì của host trước)
    const saved = this.saved && !restore ? this.saved : undefined;
    if (this.saved) this.savedLoad = saved ? 'loaded' : 'rejected';
    this.saved = undefined;
    if (this.testHooks) this.worker = this.testHooks.startHost(onMessage);
    else {
      const w = new Worker(new URL('../../host/worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<FromWorker>) => onMessage(e.data);
      w.onerror = (e) => console.error('[host] worker lỗi:', e.message);
      this.worker = w;
    }
    this.toWorker({
      t: 'init',
      seed: this.seed,
      zombieCount: this.zombieCount,
      startTick: this.startTick,
      restore,
      ...(saved ? { saved: saved.world } : {}),
      devSpawnRegion: this.devSpawnRegion,
      devDropScale: this.devDropScale,
      devHordeQuota: this.devHordeQuota,
      // loot: thu bản replica của mọi người (cả mình — ClientLoot tự gửi) rồi chọn bản mới nhất trước khi nhận ghi
      loot: {
        recover: { expected: [...keep] },
        ...(saved ? { restore: saved.loot } : {}),
        starterKit: this.starterKit,
        ...(this.groundExpireSec ? { groundExpireTicks: this.groundExpireSec * SIM_TICK_HZ } : {}),
      },
    });
  }

  /** GĐ 5: mình là host → lưu ngay (worker gửi phần thế giới qua `onSave` khi loot đã xác nhận). */
  requestSave(): boolean {
    if (!this.worker) return false;
    this.toWorker({ t: 'save' });
    return true;
  }

  private stopHost(): void {
    this.seenAt.clear();
    this.worker?.terminate();
    this.worker = null;
    this.hostStats = null;
  }

  private toWorker(m: ToWorker): void {
    this.worker?.postMessage(m);
  }
}
