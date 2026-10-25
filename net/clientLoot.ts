import type { InventoryCommand, InventoryState } from '@shared/inventory/inventory';
import type { ChestState, LootCommand } from '@shared/loot/chest';
import { LootMessage, type LootAction, type LootReplicaWire, type LootReply } from '@shared/types/loot';
import {
  applyLootPatch,
  decodeLoot,
  encodeLoot,
  isValidPatch,
  isValidReplica,
  parseChestId,
  type LootErrorCode,
} from './lootCodec';
import { Emitter } from './transport';

/** Chờ kết quả tối đa bấy nhiêu ms (host chờ mọi người ACK nên thường ~1 RTT + 1–2 tick). */
export const LOOT_TIMEOUT_MS = 15_000;

/**
 * Lỗi phía máy khách (ngoài mã lỗi của host `LootErrorCode`):
 * - `not_ready`: chưa nhận replica của host hiện tại (vừa vào trận / vừa đổi host);
 * - `busy`: đang chờ kết quả một thao tác sửa đồ khác (mỗi lúc 1 thao tác — revision mới đúng);
 * - `host_changed`: host đổi khi đang chờ → KHÔNG biết thao tác có xảy ra không; trạng thái thật = replica host mới;
 * - `timeout`: quá LOOT_TIMEOUT_MS chưa có kết quả (trạng thái sẽ tự đúng khi replica/kết quả tới).
 */
export type LootClientError = LootErrorCode | 'not_ready' | 'busy' | 'host_changed' | 'timeout';
export type LootOutcome =
  | { ok: true; inventory: InventoryState; chest: ChestState | null }
  | { ok: false; error: LootClientError; inventory: InventoryState | null; chest: ChestState | null };

/** Báo UI cái gì vừa đổi (UI đọc lại trạng thái từ ClientLoot, không dùng dữ liệu trong sự kiện). */
export type LootChange =
  { kind: 'ready' } | { kind: 'reset' } | { kind: 'inventory' } | { kind: 'chest'; chestId: string };

export interface ClientLootOptions {
  seed: string;
  /** ID túi của mình trong replica. */
  owner: string;
  /** Gửi gói cho host hiện tại (reliable). NetGame: worker nếu mình là host, không thì transport tới host. */
  send: (data: Uint8Array) => void;
  now?: () => number;
  timeoutMs?: number;
}

interface Pending {
  action: LootAction;
  mutating: boolean;
  sentAt: number;
  chestId: string | null;
  resolve: (o: LootOutcome) => void;
}

const MUTATING = new Set<LootAction['type']>(['open', 'take', 'takeAll', 'move', 'sort']);

/**
 * Loot phía máy khách (phần 2A — lớp dữ liệu, KHÔNG có UI). Gửi intent cho host (tự điền revision mong đợi),
 * nhận kết quả 111 + replica 112 (đầy đủ / phần đổi → kiểm tra nguyên bản rồi ACK 113), giữ:
 * - `inventory`: túi của mình ĐÃ XÁC NHẬN (từ kết quả của host — host chỉ trả khi mọi người đã sao chép — hoặc từ
 *   replica khi mình không có thao tác nào đang chờ);
 * - `chest(id)`: rương đã biết (replica, kết quả `view`/`open`…); rương chưa ai đụng thì chưa biết → gọi `view`;
 * - `replica`: bản đầy đủ mới nhất đã kiểm tra — dùng khi mình phải lên làm host.
 * Mọi gói chỉ nhận từ host hiện tại (NetGame lọc) và đúng `term`. Thuần, không timer: gọi `tick()` đều đặn.
 */
export class ClientLoot {
  readonly changed = new Emitter<[LootChange]>();
  private _term: string | null = null;
  private _replica: LootReplicaWire | null = null;
  private _inventory: InventoryState | null = null;
  private chests = new Map<string, ChestState>();
  private pending = new Map<string, Pending>();
  private seq = 0;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  /** Đếm cho bảng F3 / đo tải. */
  readonly stats = { sent: 0, received: 0, rejectedPackets: 0, acks: 0 };

  constructor(private opts: ClientLootOptions) {
    this.now = opts.now ?? (() => performance.now());
    this.timeoutMs = opts.timeoutMs ?? LOOT_TIMEOUT_MS;
  }

  get owner(): string {
    return this.opts.owner;
  }
  /** Đã có replica của host hiện tại và biết túi của mình → thao tác được. */
  get ready(): boolean {
    return this._term !== null && this._inventory !== null;
  }
  get term(): string | null {
    return this._term;
  }
  /** Túi của mình (đã xác nhận). null = chưa biết. */
  get inventory(): InventoryState | null {
    return this._inventory ? structuredClone(this._inventory) : null;
  }
  /** Rương đã biết; null = chưa biết (chưa ai đụng hoặc chưa xem) → `view(id)`. */
  chest(id: string): ChestState | null {
    const c = this.chests.get(id);
    return c ? structuredClone(c) : null;
  }
  /** Bản replica đầy đủ mới nhất đã kiểm tra (để lên host). */
  get replica(): LootReplicaWire | null {
    return this._replica;
  }
  /** Đang chờ kết quả một thao tác sửa đồ. */
  get busy(): boolean {
    return [...this.pending.values()].some((p) => p.mutating);
  }

  // ---------- intent ----------

  /** Hỏi lại túi của mình. */
  refresh(): Promise<LootOutcome> {
    return this.request({ type: 'inventory' });
  }
  /** Xem rương trong tầm (không đổi gì). */
  view(chestId: string): Promise<LootOutcome> {
    return this.request({ type: 'view', chestId });
  }
  open(chestId: string): Promise<LootOutcome> {
    return this.request({ type: 'open', chestId, ...this.expected(chestId) });
  }
  take(chestId: string, slot: number, quantity: number): Promise<LootOutcome> {
    return this.request({ type: 'take', chestId, slot, quantity, ...this.expected(chestId) });
  }
  takeAll(chestId: string): Promise<LootOutcome> {
    return this.request({ type: 'takeAll', chestId, ...this.expected(chestId) });
  }
  move(from: number, to: number, quantity: number): Promise<LootOutcome> {
    return this.request({
      type: 'move',
      from,
      to,
      quantity,
      expectedRevision: this._inventory?.revision ?? 0,
    });
  }
  sort(): Promise<LootOutcome> {
    return this.request({ type: 'sort', expectedRevision: this._inventory?.revision ?? 0 });
  }
  /** Lệnh của panel rương (`client/ui/loot`) — dùng nguyên revision trong lệnh. */
  command(cmd: LootCommand | InventoryCommand): Promise<LootOutcome> {
    return this.request(cmd);
  }

  /** Gửi một hành động. Kết quả luôn resolve (không reject). */
  request(action: LootAction): Promise<LootOutcome> {
    const mutating = MUTATING.has(action.type);
    if (!this.ready || !this._term) return Promise.resolve(this.fail('not_ready', null));
    const chestId = 'chestId' in action ? action.chestId : null;
    if (chestId !== null && !parseChestId(chestId)) return Promise.resolve(this.fail('unknown_chest', null));
    if (mutating && this.busy) return Promise.resolve(this.fail('busy', chestId));
    const requestId = `c${(++this.seq).toString(36)}`;
    let data: Uint8Array;
    try {
      data = encodeLoot({ type: LootMessage.Request, term: this._term, requestId, action });
    } catch {
      return Promise.resolve(this.fail('invalid_command', chestId));
    }
    return new Promise((resolve) => {
      this.pending.set(requestId, { action, mutating, sentAt: this.now(), chestId, resolve });
      this.stats.sent++;
      this.opts.send(data);
    });
  }

  // ---------- mạng ----------

  /** Gói loot từ host hiện tại (NetGame đã lọc người gửi). */
  receive(data: Uint8Array): void {
    const p = decodeLoot(data);
    if (!p) {
      this.stats.rejectedPackets++;
      return;
    }
    this.stats.received++;
    if (p.type === LootMessage.Replica) {
      let next: LootReplicaWire | null;
      if ('patch' in p) {
        // phần đổi: cùng term, đúng gốc, phần mới hợp lệ — không thì bỏ, host gửi lại bản đầy đủ
        if (p.term !== this._term || !this._replica || !isValidPatch(p.patch, this.opts.seed)) return;
        next = applyLootPatch(this._replica, p.patch);
      } else next = isValidReplica(p.state, this.opts.seed) ? p.state : null;
      if (!next) {
        this.stats.rejectedPackets++;
        return;
      }
      this.adopt(p.term, next);
      this.stats.acks++;
      this.opts.send(encodeLoot({ type: LootMessage.Ack, term: p.term, revision: next.revision }));
    } else if (p.type === LootMessage.Reply && p.term === this._term) this.reply(p);
  }

  /** Host đổi: thao tác đang chờ → `host_changed`; chờ replica của host mới (term mới). */
  resetHost(): void {
    this._term = null;
    for (const [id, p] of this.pending) {
      this.pending.delete(id);
      p.resolve(this.fail('host_changed', p.chestId));
    }
    this.changed.emit({ kind: 'reset' });
  }

  /** Hết giờ chờ. */
  tick(): void {
    const t = this.now();
    for (const [id, p] of this.pending) {
      if (t - p.sentAt < this.timeoutMs) continue;
      this.pending.delete(id);
      p.resolve(this.fail('timeout', p.chestId));
    }
  }

  // ---------- nội bộ ----------

  private adopt(term: string, next: LootReplicaWire): void {
    const fresh = term !== this._term;
    const wasReady = this.ready;
    this._term = term;
    this._replica = next;
    if (fresh) this.chests.clear();
    for (const c of next.chests) this.learnChest(c as ChestState, fresh);
    // túi của mình theo replica chỉ khi mình không có thao tác sửa đồ đang chờ (khỏi hiện kết quả chưa xác nhận)
    const mine = next.inventories.find((e) => e.id === this.opts.owner)?.state as InventoryState | undefined;
    if (mine && (fresh || !this.busy)) this.learnInventory(mine, fresh);
    if (!wasReady && this.ready) this.changed.emit({ kind: 'ready' });
  }

  private reply(r: LootReply): void {
    if (r.inventory) this.learnInventory(r.inventory as InventoryState, false);
    if (r.chest) this.learnChest(r.chest as ChestState, false);
    const p = this.pending.get(r.requestId);
    if (!p) return;
    this.pending.delete(r.requestId);
    const chest = p.chestId ? this.chest(p.chestId) : null;
    if (r.ok && this._inventory) p.resolve({ ok: true, inventory: this.inventory!, chest });
    else
      p.resolve({
        ok: false,
        error: (r.error ?? 'internal_error') as LootErrorCode,
        inventory: this.inventory,
        chest,
      });
  }

  private learnInventory(s: InventoryState, force: boolean): void {
    const cur = this._inventory;
    if (!force && cur && cur.revision > s.revision) return;
    if (cur && cur.revision === s.revision && !force) return;
    this._inventory = structuredClone(s);
    this.changed.emit({ kind: 'inventory' });
  }

  private learnChest(c: ChestState, force: boolean): void {
    const cur = this.chests.get(c.id);
    if (!force && cur && cur.revision >= c.revision) return;
    this.chests.set(c.id, structuredClone(c));
    this.changed.emit({ kind: 'chest', chestId: c.id });
  }

  private expected(chestId: string) {
    return {
      // rương chưa ai đụng không nằm trong replica → revision 0
      expectedChestRevision: this.chests.get(chestId)?.revision ?? 0,
      expectedInventoryRevision: this._inventory?.revision ?? 0,
    };
  }

  private fail(error: LootClientError, chestId: string | null): LootOutcome {
    return { ok: false, error, inventory: this.inventory, chest: chestId ? this.chest(chestId) : null };
  }
}
