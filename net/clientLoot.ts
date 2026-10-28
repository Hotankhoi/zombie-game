import type { InventoryCommand, InventoryState } from '@shared/inventory/inventory';
import type { ChestState, LootCommand } from '@shared/loot/chest';
import {
  LootMessage,
  type LootAction,
  type LootReplicaWire,
  type LootReply,
  type LootStackWire,
} from '@shared/types/loot';
import {
  applyLootPatch,
  decodeLoot,
  encodeLoot,
  isValidPatch,
  isValidReplica,
  parseChestId,
  type LootErrorCode,
} from './lootCodec';
import { ownerIdOf } from './playerKey';
import { Emitter } from './transport';
import type { PeerId } from '@shared/types';

/** Chờ kết quả tối đa bấy nhiêu ms (host chờ mọi người ACK nên thường ~1 RTT + 1–2 tick). */
export const LOOT_TIMEOUT_MS = 15_000;
/** Chưa có replica của host hiện tại → gửi bản mình đang giữ cho host (host mới thu để chọn bản mới nhất) mỗi bấy nhiêu ms. */
export const LOOT_OFFER_EVERY_MS = 1000;
/** Term của bản rỗng (máy chưa có bản nào) khi gửi cho host mới. */
const EMPTY_TERM = '0.none';

/**
 * Lỗi phía máy khách (ngoài mã lỗi của host `LootErrorCode`):
 * - `not_ready`: chưa nhận replica của host hiện tại (vừa vào trận / vừa đổi host);
 * - `busy`: đang chờ kết quả một thao tác sửa đồ khác (mỗi lúc 1 thao tác — revision mới đúng);
 * - `host_changed`: host đổi khi đang chờ → KHÔNG biết thao tác có xảy ra không; trạng thái thật = replica host mới;
 * - `timeout`: quá LOOT_TIMEOUT_MS chưa có kết quả (trạng thái sẽ tự đúng khi replica/kết quả tới);
 * - `key_taken`: túi của mình đã bị một tab khác (cùng khóa) lấy — tab này không còn túi (claimError), xem `lost`.
 */
export type LootClientError = LootErrorCode | 'not_ready' | 'busy' | 'host_changed' | 'timeout' | 'key_taken';
export type LootOutcome =
  | { ok: true; inventory: InventoryState; chest: ChestState | null }
  | { ok: false; error: LootClientError; inventory: InventoryState | null; chest: ChestState | null };

/** Báo UI cái gì vừa đổi (UI đọc lại trạng thái từ ClientLoot, không dùng dữ liệu trong sự kiện). */
export type LootChange =
  | { kind: 'ready' }
  | { kind: 'reset' }
  | { kind: 'inventory' }
  | { kind: 'chest'; chestId: string }
  /** Tab khác cùng khóa đã lấy túi của mình (host báo, hoặc thao tác bị `unknown_player` và nhận lại không được). */
  | { kind: 'lost' };

export interface ClientLootOptions {
  seed: string;
  /** playerKey BÍ MẬT (net/playerKey.ts) — chỉ gửi cho host hiện tại; túi của mình = `ownerIdOf(key)`. */
  key: string;
  /** Khóa lấy từ sessionStorage của tab này (đã dùng trước đó: tải lại trang) → host cho lấy lại túi ngay. */
  resume?: boolean;
  /** Host báo khóa đang được tab khác dùng → trả khóa mới (NetGame: `replacePlayerKey`). Không có thì dừng ở lỗi. */
  onKeyInUse?: () => string;
  /** Host đã nhận khóa này (claim thành công) → NetGame nhớ vào sessionStorage của tab (tải lại = `resume`). */
  onClaimed?: (key: string) => void;
  /** Gửi gói cho host hiện tại (reliable). NetGame: worker nếu mình là host, không thì transport tới host. */
  send: (data: Uint8Array) => void;
  now?: () => number;
  timeoutMs?: number;
}

interface Pending {
  action: LootAction;
  mutating: boolean;
  /** claim tự gửi khi có term mới — không trả cho ai. */
  internal?: boolean;
  sentAt: number;
  chestId: string | null;
  resolve: (o: LootOutcome) => void;
}

const MUTATING = new Set<LootAction['type']>([
  'drop',
  'pickup',
  'reward',
  'unequip',
  'open',
  'take',
  'takeAll',
  'move',
  'sort',
  'use',
  'reload',
]);

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
  /** Lỗi khi nhận túi (vd `inventory_limit`: phòng đã đủ 4 túi; `key_in_use`). null = chưa có lỗi. */
  claimError: LootClientError | null = null;
  private _term: string | null = null;
  private _replica: LootReplicaWire | null = null;
  /** Term của host đã gửi `_replica` (khác `_term` khi đã đổi host mà host mới chưa gửi bản nào). */
  private replicaTerm: string | null = null;
  private claimed = false;
  /** requestId của lần claim gần nhất — host dùng nó để báo "túi đã bị kết nối khác lấy". */
  private claimId: string | null = null;
  /** Đã mất túi vào tay tab khác: claim lại KHÔNG đổi khóa và không giành lại (tránh 2 tab giành qua lại). */
  private lost = false;
  private key: string;
  private _owner: string;
  private resume: boolean;
  private lastOfferAt = -Infinity;
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
    this.key = opts.key;
    this._owner = ownerIdOf(opts.key);
    this.resume = opts.resume ?? false;
  }

  /** ID túi của mình (công khai) trong replica. */
  get owner(): string {
    return this._owner;
  }
  /** Đã có replica của host hiện tại, host đã nhận khóa của mình (claim) và biết túi → thao tác được. */
  get ready(): boolean {
    return this._term !== null && this.claimed && this._inventory !== null;
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
  /**
   * Dùng 1 món ở ô `slot` (GĐ 3b): ăn/uống/y tế; `target` = PeerId đồng đội (băng gạc), null = cho mình. Host trừ đồ + áp
   * hiệu ứng khi mọi người đã xác nhận.
   */
  use(slot: number, target: PeerId | null = null): Promise<LootOutcome> {
    return this.request({ type: 'use', slot, target, expectedRevision: this._inventory?.revision ?? 0 });
  }
  /** Nạp đạn cho súng đang cầm (GĐ 3b): host lấy đạn đúng loại trong túi. */
  reload(): Promise<LootOutcome> {
    return this.request({ type: 'reload', expectedRevision: this._inventory?.revision ?? 0 });
  }
  /** Cầm vũ khí / mặc giáp đang có trong túi (GĐ 3b) — không đổi túi. */
  equip(itemId: string, rarity: LootStackWire['rarity']): Promise<LootOutcome> {
    return this.request({ type: 'equip', itemId, rarity });
  }
  /** Lệnh của panel rương (`client/ui/loot`) — dùng nguyên revision trong lệnh. */
  command(cmd: LootCommand | InventoryCommand): Promise<LootOutcome> {
    return this.request(cmd);
  }

  /** Gửi một hành động. Kết quả luôn resolve (không reject). */
  request(action: LootAction): Promise<LootOutcome> {
    const mutating = MUTATING.has(action.type);
    if (action.type === 'claim' || !this.ready || !this._term)
      return Promise.resolve(this.fail('not_ready', null));
    return this.send(action, mutating, false);
  }

  private send(action: LootAction, mutating: boolean, internal: boolean): Promise<LootOutcome> {
    if (!this._term) return Promise.resolve(this.fail('not_ready', null));
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
    if (action.type === 'claim') this.claimId = requestId;
    return new Promise((resolve) => {
      this.pending.set(requestId, { action, mutating, internal, sentAt: this.now(), chestId, resolve });
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

  /**
   * Khối loot trong mẩu 0 của bản sao lưu 125 (gói 112 đầy đủ của host): chỉ nhận khi đúng term hiện tại — làm mới
   * bản đang giữ (vá nếu lỡ mất phần đổi). Bản của host khác/đã đổi host thì bỏ.
   */
  receiveBackup(data: Uint8Array): void {
    const p = decodeLoot(data);
    if (!p || p.type !== LootMessage.Replica || !('state' in p) || p.term !== this._term) return;
    if (this._replica && p.state.revision <= this._replica.revision) return;
    this.receive(data);
  }

  /** Host đổi: thao tác đang chờ → `host_changed`; chờ replica của host mới (term mới) và gửi bản mình đang giữ. */
  resetHost(): void {
    this._term = null;
    this.claimed = false;
    this.lastOfferAt = -Infinity;
    for (const [id, p] of this.pending) {
      this.pending.delete(id);
      if (!p.internal) p.resolve(this.fail('host_changed', p.chestId));
    }
    this.changed.emit({ kind: 'reset' });
  }

  /** Hết giờ chờ; chưa có replica của host hiện tại → gửi bản mình đang giữ cho host (host mới đang thu). */
  tick(): void {
    const t = this.now();
    if (this._term === null && t - this.lastOfferAt >= LOOT_OFFER_EVERY_MS) {
      this.lastOfferAt = t;
      const state: LootReplicaWire = this._replica ?? {
        version: 1,
        seed: this.opts.seed,
        revision: 0,
        inventories: [],
        chests: [],
      };
      this.opts.send(
        encodeLoot({
          type: LootMessage.Replica,
          term: this._replica ? this.replicaTerm! : EMPTY_TERM,
          state,
        }),
      );
    }
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
    this.replicaTerm = term;
    if (fresh) {
      this.chests.clear();
      this.claimed = false;
      this.claim();
    }
    for (const c of next.chests) this.learnChest(c as ChestState, fresh);
    // túi của mình theo replica chỉ khi mình không có thao tác sửa đồ đang chờ (khỏi hiện kết quả chưa xác nhận)
    const mine = next.inventories.find((e) => e.id === this._owner)?.state as InventoryState | undefined;
    if (mine && (fresh || !this.busy)) this.learnInventory(mine, fresh);
    if (!wasReady && this.ready) this.changed.emit({ kind: 'ready' });
  }

  /** Gửi khóa cho host (tự động mỗi term mới). Kết quả xử lý ngay trong `reply` (đồng bộ, không qua Promise). */
  private claim(): void {
    void this.send({ type: 'claim', key: this.key, resume: this.resume }, false, true);
  }

  private onClaim(r: LootReply): void {
    if (r.ok) {
      const wasReady = this.ready;
      this.claimed = true;
      this.claimError = null;
      this.lost = false;
      this.resume = true;
      this.opts.onClaimed?.(this.key);
      if (!wasReady && this.ready) this.changed.emit({ kind: 'ready' });
    } else if (r.error === 'key_in_use' && this.lost) {
      // túi đang ở tab khác: báo rõ, không tạo túi mới, không giành lại
      const had = this._inventory !== null || this.claimError !== 'key_taken';
      this.claimError = 'key_taken';
      this._inventory = null;
      if (had) {
        this.changed.emit({ kind: 'inventory' });
        this.changed.emit({ kind: 'lost' });
      }
    } else if (r.error === 'key_in_use' && this.opts.onKeyInUse) {
      // 2 tab chung khóa: tab này đổi khóa riêng (túi mới) rồi nhận lại
      this.key = this.opts.onKeyInUse();
      this._owner = ownerIdOf(this.key);
      this.resume = false;
      this._inventory = null;
      this.claim();
    } else this.claimError = (r.error ?? 'internal_error') as LootErrorCode;
  }

  private reply(r: LootReply): void {
    const p = this.pending.get(r.requestId);
    // host báo: túi của khóa này vừa được giao cho kết nối khác (tab khác cùng trình duyệt)
    if (!p && !r.ok && r.error === 'key_in_use' && r.requestId === this.claimId && this.claimed) {
      this.loseInventory();
      return;
    }
    // kết quả claim: túi trong đó là của khóa vừa gửi
    if (r.inventory && (!p?.internal || r.ok)) this.learnInventory(r.inventory as InventoryState, false);
    if (r.chest) this.learnChest(r.chest as ChestState, false);
    if (!p) return;
    this.pending.delete(r.requestId);
    if (p.internal) {
      this.onClaim(r);
      return;
    }
    const chest = p.chestId ? this.chest(p.chestId) : null;
    // host không còn biết mình (túi bị tab khác lấy, hoặc host quên) → nhận lại bằng khóa hiện tại, không giành
    if (!r.ok && r.error === 'unknown_player' && this.claimed) {
      this.claimed = false;
      this.resume = false;
      this.lost = true;
      this.claim();
    }
    if (r.ok && this._inventory) p.resolve({ ok: true, inventory: this.inventory!, chest });
    else
      p.resolve({
        ok: false,
        error: (r.error ?? 'internal_error') as LootErrorCode,
        inventory: this.inventory,
        chest,
      });
  }

  /** Mất túi: không còn thao tác được; claim lại (không resume) — host nhận thì có lại túi, không thì `key_taken`. */
  private loseInventory(): void {
    this.claimed = false;
    this.resume = false;
    this.lost = true;
    this.claimError = 'key_taken';
    this._inventory = null;
    this.changed.emit({ kind: 'inventory' });
    this.changed.emit({ kind: 'lost' });
    this.claim();
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
