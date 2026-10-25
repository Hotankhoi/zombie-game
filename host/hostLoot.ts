import { LOOT_ERRORS, decodeLoot, encodeLoot, type LootErrorCode, type LootPatch } from '@net/lootCodec';
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
const TICK_HZ = 20;

/** Những gì HostLoot cần biết về trận (HostServer cung cấp). Danh tính người gửi luôn là `from` của Transport. */
export interface LootWorld {
  /** Người này đã được host cho vào trận (gửi input, không bị từ chối vì phòng đầy). */
  inMatch(peer: PeerId): boolean;
  /** Vị trí (ô) + đứng được (`isUp`) của người trong trận; null nếu không có trong thế giới. */
  position(peer: PeerId): { x: number; y: number; up: boolean } | null;
  /** Nhìn thẳng từ người chơi tới rương không bị tường/cửa đóng che. */
  sees(from: { x: number; y: number }, chest: ChestLocation): boolean;
}

export interface HostLootOptions {
  seed: string;
  world: LootWorld;
  /** Dựng tiếp trạng thái loot của host trước (chuyển host). */
  restore?: LootReplicaWire;
  /** Số thứ tự lần lên host (tăng dần, nằm trong term). Mặc định 1. */
  epoch?: number;
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
 * - Người gửi = `from` của Transport; túi của người đó = `ownerOf(from)` (bước sau: theo playerKey).
 * - Chỉ người đã vào trận; còn đứng (`isUp`); tầm với + đường nhìn (authority của B gọi `sees`); revision (reducer).
 * - `requestId` lặp: không làm lại, gửi lại đúng kết quả cũ. Giới hạn tần suất mỗi người.
 * - Sao chép: người vào trận nhận bản đầy đủ; mỗi tick có thay đổi → mọi người nhận phần đổi; người nhận ACK (113).
 * - Kết quả (111) chỉ gửi khi MỌI người trong trận đã ACK revision lúc tạo kết quả → host rời ngay sau đó thì
 *   máy nào lên host cũng có trạng thái đã báo cho người chơi (không mất đồ đã báo là nhặt được).
 * Thuần (không timer) như HostServer: gọi `flush(tick)` mỗi tick, gói ra lấy qua `drain()`.
 */
export class HostLoot {
  readonly term: string;
  readonly epoch: number;
  readonly authority: LootAuthority;
  private peers = new Map<PeerId, PeerLoot>();
  private owners = new Map<PeerId, string>();
  private pending: PendingReply[] = [];
  private dirtyInventories = new Set<string>();
  private dirtyChests = new Set<string>();
  /** Revision của lần phát phần đổi gần nhất. */
  private broadcast: number;
  private out: { to: PeerId; data: Uint8Array }[] = [];
  private tick = 0;
  /** Đếm cho bảng đo. */
  readonly stats = { requests: 0, ok: 0, rejected: 0, duplicates: 0, rateLimited: 0, bytes: 0 };

  constructor(private opts: HostLootOptions) {
    this.epoch = opts.epoch ?? 1;
    this.term = newTerm(this.epoch, opts.random);
    this.authority = new LootAuthority(opts.seed, opts.restore as unknown as LootSave | undefined);
    this.broadcast = this.authority.currentRevision();
  }

  /** Túi của người gửi. Bước 2: theo PeerId (bước 4: theo playerKey đã xác minh). */
  ownerOf(peer: PeerId): string | null {
    return this.owners.get(peer) ?? null;
  }

  /** HostServer vừa cho người này vào trận: tạo túi (nếu chưa có) và gửi bản đầy đủ. */
  admit(peer: PeerId): void {
    if (this.peers.has(peer)) return;
    this.peers.set(peer, {
      sent: -1,
      acked: -1,
      sentAt: 0,
      tokens: LOOT_BURST,
      replies: new Map(),
    });
    if (this.authority.join(peer)) {
      this.owners.set(peer, peer);
      this.dirtyInventories.add(peer);
    }
    this.sendFull(peer);
  }

  removePeer(peer: PeerId): void {
    this.peers.delete(peer);
    this.owners.delete(peer);
    this.pending = this.pending.filter((p) => p.peer !== peer);
  }

  receive(from: PeerId, data: Uint8Array): void {
    const p = decodeLoot(data);
    const me = this.peers.get(from);
    if (!p || !me || p.term !== this.term) return;
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
    for (const me of this.peers.values())
      me.tokens = Math.min(LOOT_BURST, me.tokens + (dt * LOOT_RATE_PER_SEC) / TICK_HZ);
    const rev = this.authority.currentRevision();
    if (rev !== this.broadcast) {
      const patch = this.patch(this.broadcast, rev);
      const data = encodeLoot({ type: LootMessage.Replica, term: this.term, patch });
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
    let min = this.authority.currentRevision();
    for (const me of this.peers.values()) min = Math.min(min, me.acked);
    return min;
  }

  /** Bản đầy đủ hiện tại (sao lưu gói 125, chuyển host). */
  replica(): LootReplicaWire {
    return this.authority.snapshot() as LootReplicaWire;
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
    const before = this.authority.currentRevision();
    const result = this.apply(from, req);
    if (result.ok) this.stats.ok++;
    else this.stats.rejected++;
    const chestId = 'chestId' in req.action ? req.action.chestId : null;
    if (result.ok && this.authority.currentRevision() !== before) {
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
      revision: this.authority.currentRevision(),
      data,
    });
    this.sendConfirmed();
  }

  private apply(from: PeerId, req: LootRequest): AuthorityResult {
    if (!this.opts.world.inMatch(from)) return { ok: false, error: 'not_in_match' };
    const owner = this.ownerOf(from);
    const at = this.opts.world.position(from);
    // không có túi: phòng đã đủ số túi tối đa (LOOT_INTERACTION.maxInventories)
    if (!owner) return { ok: false, error: 'inventory_limit' };
    if (!at) return { ok: false, error: 'unknown_player' };
    const actor: LootActor = { id: owner, x: at.x, y: at.y, canInteract: at.up };
    const sees = (c: ChestLocation) => this.opts.world.sees(at, c);
    const a = req.action;
    switch (a.type) {
      case 'inventory': {
        const inventory = this.authority.inventory(owner);
        return inventory ? { ok: true, inventory } : { ok: false, error: 'unknown_player' };
      }
      case 'view':
        return this.authority.view(actor, a.chestId, sees);
      case 'open':
      case 'take':
      case 'takeAll':
        return this.authority.loot(actor, a, sees);
      case 'move':
      case 'sort':
        return this.authority.move(actor, a);
    }
  }

  private replyPacket(
    requestId: string,
    result: AuthorityResult,
    chestId: string | null,
    owner: string | null = null,
  ): Uint8Array {
    const inventory = result.ok ? result.inventory : owner ? this.authority.inventory(owner) : null;
    const chest = result.ok ? (result.chest ?? null) : chestId ? this.authority.chest(chestId) : null;
    return encodeLoot({
      type: LootMessage.Reply,
      term: this.term,
      requestId,
      ok: result.ok,
      ...(!result.ok && {
        error: (LOOT_ERRORS as readonly string[]).includes(result.error) ? result.error : 'internal_error',
      }),
      revision: this.authority.currentRevision(),
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
    this.push(peer, encodeLoot({ type: LootMessage.Replica, term: this.term, state }));
    me.sent = state.revision;
    me.sentAt = this.tick;
  }

  private patch(base: number, revision: number): LootPatch {
    const inventories: LootPatch['inventories'][number][] = [];
    for (const id of this.dirtyInventories) {
      const state = this.authority.inventory(id);
      if (state) inventories.push({ id, state });
    }
    const chests: ChestWire[] = [];
    for (const id of this.dirtyChests) {
      const c = this.authority.chest(id);
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
]);
