import {
  LOOT_ERRORS,
  decodeLoot,
  encodeLoot,
  isValidReplica,
  type LootErrorCode,
  type LootPatch,
} from '@net/lootCodec';
import { isPlayerKey, ownerIdOf } from '@net/playerKey';
import { LootAuthority, type AuthorityResult, type LootActor, type LootSave } from '@shared/loot/authority';
import type { ChestLocation } from '@shared/mapgen/chests';
import { LootMessage, type ChestWire, type LootReplicaWire, type LootRequest } from '@shared/types/loot';
import type { PeerId } from '@shared/types';

/** Mỗi người tối đa bấy nhiêu yêu cầu loot mỗi giây (gom dồn tối đa LOOT_BURST). Thao tác bằng tay ~2–5/giây. */
export const LOOT_RATE_PER_SEC = 10;
export const LOOT_BURST = 20;
/** Nhớ kết quả bấy nhiêu requestId gần nhất mỗi người — gửi lại đúng kết quả cũ khi yêu cầu lặp. */
export const LOOT_REPLY_CACHE = 64;
/** Người chưa ACK bản đã gửi sau bấy nhiêu tick → gửi lại bản đầy đủ (kênh reliable hiếm khi cần). */
export const LOOT_RESEND_TICKS = 40;
/** Host mới chờ bản replica của mọi người tối đa bấy nhiêu tick (3s) rồi mới nhận ghi. */
export const LOOT_RECOVER_TICKS = 60;
/**
 * Khóa đang gắn với một kết nối khác: cho người mới lấy túi nếu kết nối kia im (không gửi GÌ cho host — input, loot, ping,
 * điểm host) ≥ bấy nhiêu tick (10 s) — tab cũ đã đóng/treo nhưng mạng chưa báo rời. Tab ẩn vẫn gửi ping/điểm host theo
 * setInterval nên không bị coi là im (trước đây chỉ đếm input → tab ẩn 3 s là bị tab khác cùng trình duyệt lấy túi).
 */
export const LOOT_TAKEOVER_IDLE_TICKS = 200;
const TICK_HZ = 20;

/** Những gì HostLoot cần biết về trận (HostServer cung cấp). Danh tính người gửi luôn là `from` của Transport. */
export interface LootWorld {
  /** Người này đã được host cho vào trận (gửi input, không bị từ chối vì phòng đầy). */
  inMatch(peer: PeerId): boolean;
  /** Vị trí (ô) + đứng được (`isUp`) của người trong trận; null nếu không có trong thế giới. */
  position(peer: PeerId): { x: number; y: number; up: boolean } | null;
  /** Nhìn thẳng từ người chơi tới rương không bị tường/cửa đóng che. */
  sees(from: { x: number; y: number }, chest: ChestLocation): boolean;
  /** Số tick từ gói gần nhất của người này (input…); null nếu không biết. */
  idleTicks(peer: PeerId): number | null;
}

export interface HostLootOptions {
  seed: string;
  world: LootWorld;
  /** Dựng ngay từ bản này (test / không cần thu bản của người khác). */
  restore?: LootReplicaWire;
  /** Epoch tối thiểu cho term (tăng dần mỗi lần lên host). Mặc định 1. */
  epoch?: number;
  /**
   * Lên thay host cũ: KHÔNG nhận ghi cho tới khi nhận bản replica (112 đầy đủ) của mọi người trong `expected`
   * (kể cả chính mình) hoặc hết LOOT_RECOVER_TICKS → chọn bản mới nhất theo (epoch của term, revision).
   */
  recover?: { expected: readonly PeerId[]; timeoutTicks?: number };
  /** 8 byte ngẫu nhiên dạng hex cho term (test truyền cố định). */
  random?: () => string;
}

/** Term = `<epoch>.<ngẫu nhiên>`: khác nhau mỗi lần lên host (kể cả cùng máy), so được lần nào mới hơn. */
export function newTerm(epoch: number, random: () => string = randomHex): string {
  return `${epoch}.${random()}`;
}
export function termEpoch(term: string | null | undefined): number {
  const n = Number((term ?? '').split('.')[0]);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}
function randomHex(): string {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

interface PeerLoot {
  /** Revision của bản cuối cùng đã gửi cho người này (đầy đủ hoặc phần đổi). -1 = chưa gửi. */
  sent: number;
  /** Revision lớn nhất người này đã ACK (đã nhận + kiểm tra nguyên bản). */
  acked: number;
  sentAt: number;
  /** Token bucket giới hạn tần suất. */
  tokens: number;
  /** requestId → gói reply đã gửi (hoặc null = đang chờ xác nhận). Giữ thứ tự chèn để bỏ cái cũ nhất. */
  replies: Map<string, Uint8Array | null>;
}

interface PendingReply {
  peer: PeerId;
  requestId: string;
  /** Gửi khi mọi người trong trận đã ACK revision này. */
  revision: number;
  data: Uint8Array;
}

/**
 * Loot phía host (GĐ 3 nối mạng, phần 2A): giữ `LootAuthority` của B, nhận intent 110 và trả 111/112.
 * - Người gửi = `from` của Transport; túi = ownerId của playerKey mà người đó đã `claim` (xác minh ở host).
 * - Chỉ người đã vào trận; còn đứng (`isUp`); tầm với + đường nhìn (authority của B gọi `sees`); revision (reducer).
 * - `requestId` lặp: không làm lại, gửi lại đúng kết quả cũ. Giới hạn tần suất mỗi người.
 * - Sao chép: người vào trận nhận bản đầy đủ; mỗi tick có thay đổi → mọi người nhận phần đổi; người nhận ACK (113).
 * - Kết quả (111) chỉ gửi khi MỌI người trong trận đã ACK revision lúc tạo kết quả → host rời ngay sau đó thì
 *   máy nào lên host cũng có trạng thái đã báo cho người chơi (không mất đồ đã báo là nhặt được).
 * - Lên thay host cũ (`recover`): thu bản replica của mọi người, chọn bản mới nhất rồi mới nhận ghi → host mới là
 *   người vừa vào (chưa có bản nào) cũng không xóa đồ của cả đội.
 * Thuần (không timer) như HostServer: gọi `flush(tick)` mỗi tick, gói ra lấy qua `drain()`.
 */
export class HostLoot {
  private _term = '';
  private _epoch = 0;
  private _authority: LootAuthority;
  private peers = new Map<PeerId, PeerLoot>();
  private owners = new Map<PeerId, string>();
  /** requestId của lần claim thành công của từng người — để báo họ khi túi bị giao cho kết nối khác. */
  private claimIds = new Map<PeerId, string>();
  private pending: PendingReply[] = [];
  private dirtyInventories = new Set<string>();
  private dirtyChests = new Set<string>();
  /** Revision của lần phát phần đổi gần nhất. */
  private broadcast = 0;
  private out: { to: PeerId; data: Uint8Array }[] = [];
  private tick = 0;
  /** Đang thu bản replica (lên thay host cũ): ai đã gửi, bản tốt nhất, hạn chót. */
  private recovery: {
    waiting: Set<PeerId>;
    best: { term: string; state: LootReplicaWire } | null;
    deadline: number | null;
    timeout: number;
  } | null = null;
  /** Đếm cho bảng đo. */
  readonly stats = { requests: 0, ok: 0, rejected: 0, duplicates: 0, rateLimited: 0, bytes: 0, offers: 0 };

  constructor(private opts: HostLootOptions) {
    this._authority = new LootAuthority(opts.seed);
    if (opts.recover) {
      this.recovery = {
        waiting: new Set(opts.recover.expected),
        best: null,
        deadline: null,
        timeout: opts.recover.timeoutTicks ?? LOOT_RECOVER_TICKS,
      };
      if (opts.restore) this.offer(opts.restore, '0.restore');
    } else this.start(opts.restore ?? null, opts.epoch ?? 1);
  }

  get term(): string {
    return this._term;
  }
  get epoch(): number {
    return this._epoch;
  }
  get authority(): LootAuthority {
    return this._authority;
  }
  /** Đang thu bản replica của mọi người (chưa nhận ghi). */
  get recovering(): boolean {
    return this.recovery !== null;
  }

  /** Túi (ownerId) mà người này đã claim; null = chưa. */
  ownerOf(peer: PeerId): string | null {
    return this.owners.get(peer) ?? null;
  }

  /** HostServer vừa cho người này vào trận: gửi bản đầy đủ (sau khi thu xong bản replica nếu đang thu). */
  admit(peer: PeerId): void {
    if (this.peers.has(peer)) return;
    this.peers.set(peer, { sent: -1, acked: -1, sentAt: 0, tokens: LOOT_BURST, replies: new Map() });
    if (!this.recovery) this.sendFull(peer);
  }

  removePeer(peer: PeerId): void {
    this.peers.delete(peer);
    this.owners.delete(peer);
    this.claimIds.delete(peer);
    this.pending = this.pending.filter((p) => p.peer !== peer);
    this.recovery?.waiting.delete(peer);
  }

  receive(from: PeerId, data: Uint8Array): void {
    const p = decodeLoot(data);
    if (!p) return;
    if (this.recovery) {
      // đang thu: chỉ nhận bản đầy đủ của mỗi người (kể cả người chưa vào trận), mỗi người 1 lần
      if (p.type === LootMessage.Replica && 'state' in p && this.recovery.waiting.delete(from))
        this.offer(p.state, p.term);
      return;
    }
    const me = this.peers.get(from);
    if (!me || p.term !== this._term) return;
    if (p.type === LootMessage.Ack) {
      // ACK chỉ tính cho bản đã gửi thật
      if (p.revision <= me.sent) me.acked = Math.max(me.acked, p.revision);
      return;
    }
    if (p.type === LootMessage.Request) this.request(from, me, p);
  }

  /** Cuối tick: phát phần đổi, gửi lại bản đầy đủ cho ai chưa ACK lâu, gửi kết quả đã đủ xác nhận. */
  flush(tick: number): void {
    const dt = tick - this.tick;
    this.tick = tick;
    if (this.recovery) {
      const r = this.recovery;
      r.deadline ??= tick + r.timeout;
      if (r.waiting.size > 0 && tick < r.deadline) return;
      this.recovery = null;
      this.start(r.best?.state ?? null, Math.max(this.opts.epoch ?? 1, termEpoch(r.best?.term) + 1));
      for (const id of this.peers.keys()) this.sendFull(id);
      return;
    }
    for (const me of this.peers.values())
      me.tokens = Math.min(LOOT_BURST, me.tokens + (dt * LOOT_RATE_PER_SEC) / TICK_HZ);
    const rev = this._authority.currentRevision();
    if (rev !== this.broadcast) {
      const patch = this.patch(this.broadcast, rev);
      const data = encodeLoot({ type: LootMessage.Replica, term: this._term, patch });
      for (const [id, me] of this.peers) {
        if (me.sent === this.broadcast) {
          this.push(id, data);
          me.sent = rev;
          me.sentAt = tick;
        } else if (me.sent < rev) this.sendFull(id);
      }
      this.broadcast = rev;
      this.dirtyInventories.clear();
      this.dirtyChests.clear();
    }
    for (const [id, me] of this.peers) {
      if (me.acked < me.sent && tick - me.sentAt >= LOOT_RESEND_TICKS) this.sendFull(id);
    }
    this.sendConfirmed();
  }

  /** Lấy các gói cần gửi (reliable). */
  drain(): { to: PeerId; data: Uint8Array }[] {
    const out = this.out;
    this.out = [];
    return out;
  }

  /** Revision mà mọi người trong trận đã ACK (trận không có ai → revision hiện tại). */
  confirmedRevision(): number {
    let min = this._authority.currentRevision();
    for (const me of this.peers.values()) min = Math.min(min, me.acked);
    return min;
  }

  /** Bản đầy đủ hiện tại. */
  replica(): LootReplicaWire {
    return this._authority.snapshot() as LootReplicaWire;
  }

  /**
   * Gói 112 đầy đủ (term hiện tại) để nhét vào mẩu 0 của bản sao lưu 125; null khi đang thu bản replica.
   * Gọi sau `flush` của cùng tick: revision = bản vừa phát cho mọi người.
   */
  backupBlock(): Uint8Array | null {
    if (this.recovery) return null;
    return encodeLoot({ type: LootMessage.Replica, term: this._term, state: this.replica() });
  }

  private start(state: LootReplicaWire | null, epoch: number): void {
    this._authority = new LootAuthority(this.opts.seed, (state ?? undefined) as LootSave | undefined);
    this._epoch = epoch;
    this._term = newTerm(epoch, this.opts.random);
    this.broadcast = this._authority.currentRevision();
  }

  /** Bản replica một người gửi lúc host mới thu: giữ bản mới nhất theo (epoch của term, revision). */
  private offer(state: LootReplicaWire, term: string): void {
    const r = this.recovery;
    if (!r || !isValidReplica(state, this.opts.seed)) return;
    this.stats.offers++;
    const b = r.best;
    const newer =
      !b ||
      termEpoch(term) > termEpoch(b.term) ||
      (termEpoch(term) === termEpoch(b.term) && state.revision > b.state.revision);
    if (newer) r.best = { term, state };
  }

  private request(from: PeerId, me: PeerLoot, req: LootRequest): void {
    this.stats.requests++;
    if (me.replies.has(req.requestId)) {
      // yêu cầu lặp: không làm lại; đã có kết quả → gửi lại đúng gói cũ, còn chờ xác nhận → để nó tự tới
      this.stats.duplicates++;
      const cached = me.replies.get(req.requestId);
      if (cached) this.push(from, cached);
      return;
    }
    if (me.tokens < 1) {
      this.stats.rateLimited++;
      this.push(from, this.replyPacket(req.requestId, { ok: false, error: 'rate_limited' }, null));
      return;
    }
    me.tokens--;
    const before = this._authority.currentRevision();
    const result = this.apply(from, req);
    if (result.ok) this.stats.ok++;
    else this.stats.rejected++;
    const chestId = 'chestId' in req.action ? req.action.chestId : null;
    if (result.ok && this._authority.currentRevision() !== before) {
      const owner = this.ownerOf(from);
      if (owner) this.dirtyInventories.add(owner);
      if (chestId && req.action.type !== 'view') this.dirtyChests.add(chestId);
    }
    // lỗi do quy tắc rương/túi (revision cũ, túi đầy…) → kèm trạng thái hiện tại để máy khách chọn lại;
    // lỗi tầm với/đường nhìn/không đứng được → không kèm rương (không lộ đồ trong rương ở xa)
    const showChest = result.ok || !GATE_ERRORS.has(result.error as LootErrorCode);
    const data = this.replyPacket(req.requestId, result, showChest ? chestId : null, this.ownerOf(from));
    me.replies.set(req.requestId, null);
    while (me.replies.size > LOOT_REPLY_CACHE) me.replies.delete(me.replies.keys().next().value as string);
    // mọi kết quả kèm trạng thái đều chờ xác nhận revision hiện tại — không bao giờ cho người chơi thấy
    // trạng thái mà host mới có thể không có
    this.pending.push({
      peer: from,
      requestId: req.requestId,
      revision: this._authority.currentRevision(),
      data,
    });
    this.sendConfirmed();
  }

  private apply(from: PeerId, req: LootRequest): AuthorityResult {
    if (!this.opts.world.inMatch(from)) return { ok: false, error: 'not_in_match' };
    const a = req.action;
    if (a.type === 'claim') return this.claim(from, a.key, a.resume, req.requestId);
    const owner = this.ownerOf(from);
    const at = this.opts.world.position(from);
    if (!owner || !at) return { ok: false, error: 'unknown_player' };
    const actor: LootActor = { id: owner, x: at.x, y: at.y, canInteract: at.up };
    const sees = (c: ChestLocation) => this.opts.world.sees(at, c);
    switch (a.type) {
      case 'inventory': {
        const inventory = this._authority.inventory(owner);
        return inventory ? { ok: true, inventory } : { ok: false, error: 'unknown_player' };
      }
      case 'view':
        return this._authority.view(actor, a.chestId, sees);
      case 'open':
      case 'take':
      case 'takeAll':
        return this._authority.loot(actor, a, sees);
      case 'move':
      case 'sort':
        return this._authority.move(actor, a);
    }
  }

  /**
   * Gắn người gửi với túi của playerKey (ownerId = hash, không lưu key). Khóa đang gắn với kết nối khác: cho lấy nếu
   * `resume` (tab này đã dùng khóa — tải lại trang) hoặc kết nối kia im lâu; không thì `key_in_use` (2 tab chung khóa).
   */
  private claim(from: PeerId, key: string, resume: boolean, requestId: string): AuthorityResult {
    if (!isPlayerKey(key)) return { ok: false, error: 'invalid_key' };
    const owner = ownerIdOf(key);
    const current = this.owners.get(from);
    if (current && current !== owner) return { ok: false, error: 'invalid_key' };
    for (const [peer, o] of this.owners) {
      if (o !== owner || peer === from) continue;
      const idle = this.opts.world.idleTicks(peer);
      if (!resume && (idle === null || idle < LOOT_TAKEOVER_IDLE_TICKS))
        return { ok: false, error: 'key_in_use' };
      this.owners.delete(peer);
      // báo kết nối cũ ngay (trả lời lại đúng requestId claim của họ): túi đã sang tab khác → họ thôi hiện túi này
      const old = this.claimIds.get(peer);
      this.claimIds.delete(peer);
      if (old) this.push(peer, this.replyPacket(old, { ok: false, error: 'key_in_use' }, null));
    }
    if (!this._authority.join(owner)) return { ok: false, error: 'inventory_limit' };
    this.owners.set(from, owner);
    this.claimIds.set(from, requestId);
    return { ok: true, inventory: this._authority.inventory(owner)! };
  }

  private replyPacket(
    requestId: string,
    result: AuthorityResult,
    chestId: string | null,
    owner: string | null = null,
  ): Uint8Array {
    const inventory = result.ok ? result.inventory : owner ? this._authority.inventory(owner) : null;
    const chest = result.ok ? (result.chest ?? null) : chestId ? this._authority.chest(chestId) : null;
    const error = result.ok ? undefined : result.error;
    return encodeLoot({
      type: LootMessage.Reply,
      term: this._term,
      requestId,
      ok: result.ok,
      ...(error !== undefined && {
        error: (LOOT_ERRORS as readonly string[]).includes(error) ? error : 'internal_error',
      }),
      revision: this._authority.currentRevision(),
      ...(inventory && { inventory }),
      ...(chest && { chest: chest as ChestWire }),
    });
  }

  private sendConfirmed(): void {
    if (this.pending.length === 0) return;
    const confirmed = this.confirmedRevision();
    const keep: PendingReply[] = [];
    for (const p of this.pending) {
      if (p.revision > confirmed) {
        keep.push(p);
        continue;
      }
      const me = this.peers.get(p.peer);
      if (!me) continue;
      if (me.replies.has(p.requestId)) me.replies.set(p.requestId, p.data);
      this.push(p.peer, p.data);
    }
    this.pending = keep;
  }

  private sendFull(peer: PeerId): void {
    const me = this.peers.get(peer);
    if (!me) return;
    const state = this.replica();
    this.push(peer, encodeLoot({ type: LootMessage.Replica, term: this._term, state }));
    me.sent = state.revision;
    me.sentAt = this.tick;
  }

  private patch(base: number, revision: number): LootPatch {
    const inventories: LootPatch['inventories'][number][] = [];
    for (const id of this.dirtyInventories) {
      const state = this._authority.inventory(id);
      if (state) inventories.push({ id, state });
    }
    const chests: ChestWire[] = [];
    for (const id of this.dirtyChests) {
      const c = this._authority.chest(id);
      if (c) chests.push(c as ChestWire);
    }
    return { baseRevision: base, revision, inventories, chests };
  }

  private push(to: PeerId, data: Uint8Array): void {
    this.stats.bytes += data.length;
    this.out.push({ to, data });
  }
}

/** Lỗi ở cửa kiểm tra người chơi/tầm với — kết quả không kèm nội dung rương. */
const GATE_ERRORS = new Set<LootErrorCode>([
  'not_in_match',
  'unknown_player',
  'player_not_up',
  'unknown_chest',
  'out_of_reach',
  'blocked',
  'rate_limited',
  'invalid_command',
  'invalid_key',
  'key_in_use',
  'inventory_limit',
]);
