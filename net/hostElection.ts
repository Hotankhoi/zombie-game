import type { PeerId } from '@shared/types';
import { GameMsg, decodeGame, encodeGame } from './gameCodec';
import { Emitter, type Transport, type Unsubscribe } from './transport';

/**
 * Gói "điểm làm host" — riêng của bầu host, cố ý KHÔNG thêm vào danh sách gói chung trong gameCodec
 * (chỗ B đang thêm gói loot) để hai bên không sửa cùng một chỗ. Số loại gói chọn xa 16–20 của gameCodec.
 */
export const HOST_SCORE_MSG = 126;

export interface ElectionOptions {
  /** Mới vào phòng: nghe bao lâu (ms) xem đã có host chưa rồi mới tự nhận. */
  listenMs?: number;
  /** Host nhắc "tôi là host" mỗi bấy nhiêu ms. */
  claimEveryMs?: number;
  /** Không nghe host nhắc trong bấy nhiêu ms = host đã mất. */
  claimTimeoutMs?: number;
  /** Điểm làm host của máy mình (nhỏ = tốt): ping trung bình + độ chậm của máy. Mặc định 0. */
  getScore?: () => number;
  /** Báo điểm cho cả phòng mỗi bấy nhiêu ms. */
  scoreEveryMs?: number;
  /**
   * Biết chắc phòng đang có host (vd tab vừa tải lại, trước đó chơi cùng người khác): chờ nghe host thật tới mốc này
   * (theo đồng hồ `now`) rồi mới được tự nhận host — WebRTC sau khi tải lại thường nối lâu hơn `listenMs`, tự nhận sớm
   * thì thành một thế giới tạm (túi tạm) ~0,5 s rồi mới nhập vào host thật.
   */
  expectHostUntil?: number;
  /** Chờ host thật tối đa bấy nhiêu ms kể từ lúc vào phòng (người đã nối báo "có host" mà mình chưa nghe host). */
  waitHostMs?: number;
}

/** Chờ host thật tối đa (ms) — quá thì tự làm host như cũ (host thật có thể đã rời). */
export const WAIT_HOST_MS = 10_000;

/**
 * Chọn host (AGENTS.md mục 2.1: theo ping + sức máy; host migration):
 * - Vào phòng nghe `listenMs`; ai đang nhắc HostClaim thì người đó là host.
 * - Chưa có host: mọi máy báo điểm (ping trung bình + độ chậm của máy); máy điểm tốt nhất nhận host
 *   (bằng điểm thì id nhỏ hơn). Máy khác chờ gấp đôi rồi mới tự nhận, phòng khi máy đó treo.
 * - Hai host cùng lúc: ai làm host lâu hơn giữ quyền (người mới vào không cướp host, kể cả máy mạnh hơn —
 *   đổi host giữa trận tốn kém hơn lợi ích); cùng lúc (lệch < 1s) thì điểm tốt hơn, rồi id nhỏ hơn thắng.
 * - Host rời/mất tín hiệu → chọn lại như trên (chuyển host).
 * Gọi tick() đều đặn (cả khi tab ẩn: NetGame gọi theo nhịp của Web Worker host).
 */
export class HostElection {
  hostId: PeerId | null = null;
  readonly changed = new Emitter<[PeerId | null]>();
  /** Host khác đang nhắc: lúc nghe gần nhất + đã làm host bao lâu (ms) lúc đó. */
  private claims = new Map<PeerId, { at: number; hostedMs: number }>();
  /** Điểm làm host mới nhất của từng người. */
  private scores = new Map<PeerId, number>();
  /** Người đó báo (kèm điểm) là đang theo một host — mình chưa nghe host đó thì chờ thêm. */
  private following = new Map<PeerId, boolean>();
  /** Từng có host kể từ lúc vào phòng (mất host giữa trận thì chọn lại ngay như cũ, không chờ). */
  private everHadHost = false;
  private readonly expectHostUntil: number;
  private readonly waitHostMs: number;
  private claiming = false;
  private claimSince = 0;
  private lastClaimAt = -Infinity;
  private lastScoreAt = -Infinity;
  private noHostSince: number;
  /** Từng nhắc host rồi im quá lâu (tab đóng mà mạng chưa báo rời) → không tính khi chọn host mới. */
  private silent = new Set<PeerId>();
  private subs: Unsubscribe[];
  private readonly listenMs: number;
  private readonly claimEveryMs: number;
  private readonly claimTimeoutMs: number;
  private readonly scoreEveryMs: number;
  private readonly getScore: () => number;

  constructor(
    private transport: Transport,
    private now: () => number = () => performance.now(),
    opts: ElectionOptions = {},
  ) {
    this.listenMs = opts.listenMs ?? 2000;
    this.claimEveryMs = opts.claimEveryMs ?? 1000;
    this.claimTimeoutMs = opts.claimTimeoutMs ?? 3500;
    this.scoreEveryMs = opts.scoreEveryMs ?? 2000;
    this.getScore = opts.getScore ?? (() => 0);
    this.expectHostUntil = opts.expectHostUntil ?? -Infinity;
    this.waitHostMs = opts.waitHostMs ?? WAIT_HOST_MS;
    this.noHostSince = now();
    this.subs = [
      transport.onMessage((data, from) => {
        if (data[0] === HOST_SCORE_MSG) {
          const score = decodeScore(data);
          if (score !== null) this.scores.set(from, score);
          const f = decodeFollowing(data);
          if (f !== null) this.following.set(from, f);
          return;
        }
        if (data[0] !== GameMsg.HostClaim) return;
        const msg = decodeGame(data);
        if (msg?.type !== GameMsg.HostClaim) return;
        this.claims.set(from, { at: this.now(), hostedMs: msg.hostedMs });
        this.silent.delete(from);
        this.tick();
      }),
      transport.onPeerJoin((id) => {
        // người mới vào: báo ngay mình là host (không bắt họ chờ) và điểm của mình
        if (this.claiming) this.transport.send(this.claimPacket(), { to: id });
        this.transport.send(this.scorePacket(), { to: id });
      }),
      transport.onPeerLeave((id) => {
        this.silent.delete(id);
        this.scores.delete(id);
        this.following.delete(id);
        if (this.claims.delete(id)) this.tick();
      }),
    ];
  }

  get isHost(): boolean {
    return this.hostId === this.transport.selfId;
  }

  /** Điểm đã biết của mọi người (kể cả mình) — bảng F3. */
  scoreOf(id: PeerId): number | null {
    return id === this.transport.selfId ? this.myScore() : (this.scores.get(id) ?? null);
  }

  tick(): void {
    const t = this.now();
    const self = this.transport.selfId;
    if (t - this.lastScoreAt >= this.scoreEveryMs) {
      this.lastScoreAt = t;
      this.transport.send(this.scorePacket());
    }

    const candidates: Candidate[] = [];
    for (const [id, c] of this.claims) {
      if (t - c.at > this.claimTimeoutMs) {
        this.claims.delete(id);
        this.silent.add(id);
      } else {
        candidates.push({ id, hostedMs: c.hostedMs + (t - c.at), score: this.scores.get(id) ?? Infinity });
      }
    }
    if (this.claiming) candidates.push({ id: self, hostedMs: t - this.claimSince, score: this.myScore() });
    let host = pickHost(candidates);

    if (host === null) {
      // vừa mất host (rời phòng, hoặc im quá claimTimeoutMs — đã chờ đủ rồi): máy tốt nhất lên ngay
      if (this.hostId !== null) this.noHostSince = t - this.listenMs;
      const waited = t - this.noHostSince;
      const alive = this.transport.peers().filter((id) => !this.silent.has(id));
      const best = pickBest([
        { id: self, score: this.myScore() },
        ...alive.map((id) => ({ id, score: this.scores.get(id) ?? Infinity })),
      ]);
      // máy tốt nhất nhận sau listenMs; máy khác chờ gấp đôi (phòng khi máy đó treo); biết phòng có host thì chờ host
      if (waited >= this.listenMs * (best === self ? 1 : 2) && !this.waitingForHost(t, alive)) {
        this.claiming = true;
        this.claimSince = t;
        host = self;
      }
    } else if (this.claiming && host !== self) {
      this.claiming = false; // có host làm lâu hơn (hoặc tốt hơn khi cùng lúc) → lui
    }

    if (this.claiming && t - this.lastClaimAt >= this.claimEveryMs) {
      this.lastClaimAt = t;
      this.transport.send(this.claimPacket());
    }
    if (host !== this.hostId) {
      this.hostId = host;
      if (host !== null) this.everHadHost = true;
      // báo ngay cờ "đang theo host" mới (người vừa vào nhờ cờ này biết có nên chờ host không)
      this.transport.send(this.scorePacket());
      this.changed.emit(host);
    }
  }

  /** Còn bao lâu (ms) mình chờ host thật trước khi tự nhận; null = không chờ (HUD: "Đang tìm host của phòng…"). */
  waitingForHostMs(): number | null {
    if (this.hostId !== null) return null;
    const t = this.now();
    const alive = this.transport.peers().filter((id) => !this.silent.has(id));
    return this.waitingForHost(t, alive) ? Math.max(0, this.noHostSince + this.waitHostMs - t) : null;
  }

  /**
   * Chưa từng có host mà biết phòng đang có host: (1) người đã nối báo đang theo một host mình chưa nghe, hoặc (2) tab vừa
   * tải lại (`expectHostUntil`) và chưa ai đã nối nói "phòng không có host" → chờ, tối đa `waitHostMs` từ lúc vào.
   */
  private waitingForHost(t: number, alive: readonly PeerId[]): boolean {
    if (this.everHadHost || t - this.noHostSince >= this.waitHostMs) return false;
    const flags = alive.map((id) => this.following.get(id));
    if (flags.some((f) => f === true)) return true;
    if (t >= this.expectHostUntil) return false;
    return !(flags.length > 0 && flags.every((f) => f === false));
  }

  private scorePacket(): Uint8Array {
    return encodeScore(this.myScore(), this.hostId !== null);
  }

  private myScore(): number {
    return clampScore(this.getScore());
  }

  private claimPacket(): Uint8Array {
    return encodeGame({ type: GameMsg.HostClaim, hostedMs: this.now() - this.claimSince });
  }

  dispose(): void {
    for (const u of this.subs) u();
    this.subs = [];
  }
}

interface Candidate {
  id: PeerId;
  hostedMs: number;
  score: number;
}

/** Lệch thời gian làm host dưới mức này coi như bằng nhau (trễ mạng làm số đo không chính xác). */
const SENIORITY_TIE_MS = 1000;
/** Lệch điểm dưới mức này coi như bằng nhau (ping dao động) → dùng id để mọi máy chọn giống nhau. */
const SCORE_TIE = 15;

/**
 * Hai hàm chọn dưới đây chỉ phụ thuộc TẬP ứng viên, không phụ thuộc thứ tự duyệt (mọi máy chọn giống nhau):
 * lấy mốc tốt nhất của cả tập, coi ai lệch dưới ngưỡng so với mốc đó là ngang nhau, rồi lấy id nhỏ nhất.
 * (So từng cặp theo ngưỡng thì không bắc cầu: a=100 thắng b=90 theo id, b thắng z=80 theo id, z thắng a.)
 */
function pickHost(cands: Candidate[]): PeerId | null {
  if (cands.length === 0) return null;
  const top = Math.max(...cands.map((c) => c.hostedMs));
  return pickBest(cands.filter((c) => c.hostedMs >= top - SENIORITY_TIE_MS));
}

export function pickBest(cands: { id: PeerId; score: number }[]): PeerId | null {
  if (cands.length === 0) return null;
  const known = cands.filter((c) => Number.isFinite(c.score));
  let pool = cands;
  if (known.length > 0) {
    const low = Math.min(...known.map((c) => c.score));
    pool = known.filter((c) => c.score <= low + SCORE_TIE);
  }
  let best = pool[0] as { id: PeerId };
  for (const c of pool) if (c.id < best.id) best = c;
  return best.id;
}

const MAX_SCORE = 0xffff;

function clampScore(s: number): number {
  return Number.isFinite(s) ? Math.max(0, Math.min(MAX_SCORE, Math.round(s))) : MAX_SCORE;
}

/**
 * Gói điểm: [126][điểm u16][cờ]. Byte cờ (bit 0 = "mình đang theo một host") nối cuối — bản cũ chỉ đọc 3 byte đầu.
 */
export function encodeScore(score: number, following = false): Uint8Array {
  const buf = new Uint8Array(4);
  buf[0] = HOST_SCORE_MSG;
  new DataView(buf.buffer).setUint16(1, clampScore(score));
  buf[3] = following ? 1 : 0;
  return buf;
}

/** Cờ "đang theo một host" trong gói điểm; null = gói bản cũ (không có cờ). */
export function decodeFollowing(buf: Uint8Array): boolean | null {
  if (buf.length < 4 || buf[0] !== HOST_SCORE_MSG) return null;
  return (buf[3]! & 1) !== 0;
}

export function decodeScore(buf: Uint8Array): number | null {
  if (buf.length < 3 || buf[0] !== HOST_SCORE_MSG) return null;
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint16(1);
}
