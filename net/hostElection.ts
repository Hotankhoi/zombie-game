import type { PeerId } from '@shared/types';
import { GameMsg, decodeGame, encodeGame } from './gameCodec';
import { Emitter, type Transport, type Unsubscribe } from './transport';

export interface ElectionOptions {
  /** Mới vào phòng: nghe bao lâu (ms) xem đã có host chưa rồi mới tự nhận. */
  listenMs?: number;
  /** Host nhắc "tôi là host" mỗi bấy nhiêu ms. */
  claimEveryMs?: number;
  /** Không nghe host nhắc trong bấy nhiêu ms = host đã mất. */
  claimTimeoutMs?: number;
}

/**
 * Chọn host bản đơn giản (GĐ 2a; GĐ 2b chọn theo ping + sức máy):
 * - Vào phòng nghe `listenMs`; ai đang nhắc HostClaim thì người đó là host.
 * - Không có host: người có id nhỏ nhất trong phòng tự nhận (người khác chờ thêm rồi mới nhận,
 *   phòng khi người đó không phản hồi).
 * - Hai host cùng lúc: ai làm host lâu hơn giữ quyền (người mới vào không cướp host);
 *   cùng lúc (lệch < 1s, vd: hai người vào cùng lúc) thì id nhỏ hơn thắng. Bên thua lui.
 * - Host rời/mất tín hiệu → chọn lại như trên (chuyển host).
 * Gọi tick() đều đặn (cả khi tab ẩn: NetGame gọi theo nhịp của Web Worker host).
 */
export class HostElection {
  hostId: PeerId | null = null;
  readonly changed = new Emitter<[PeerId | null]>();
  /** Host khác đang nhắc: lúc nghe gần nhất + đã làm host bao lâu (ms) lúc đó. */
  private claims = new Map<PeerId, { at: number; hostedMs: number }>();
  private claiming = false;
  private claimSince = 0;
  private lastClaimAt = -Infinity;
  private noHostSince: number;
  /** Từng nhắc host rồi im quá lâu (tab đóng mà mạng chưa báo rời) → không tính khi xét id nhỏ nhất. */
  private silent = new Set<PeerId>();
  private subs: Unsubscribe[];
  private readonly listenMs: number;
  private readonly claimEveryMs: number;
  private readonly claimTimeoutMs: number;

  constructor(
    private transport: Transport,
    private now: () => number = () => performance.now(),
    opts: ElectionOptions = {},
  ) {
    this.listenMs = opts.listenMs ?? 2000;
    this.claimEveryMs = opts.claimEveryMs ?? 1000;
    this.claimTimeoutMs = opts.claimTimeoutMs ?? 3500;
    this.noHostSince = now();
    this.subs = [
      transport.onMessage((data, from) => {
        if (data[0] !== GameMsg.HostClaim) return;
        const msg = decodeGame(data);
        if (msg?.type !== GameMsg.HostClaim) return;
        this.claims.set(from, { at: this.now(), hostedMs: msg.hostedMs });
        this.silent.delete(from);
        this.tick();
      }),
      transport.onPeerJoin((id) => {
        // người mới vào: báo ngay mình là host, không bắt họ chờ
        if (this.claiming) this.transport.send(this.claimPacket(), { to: id });
      }),
      transport.onPeerLeave((id) => {
        this.silent.delete(id);
        if (this.claims.delete(id)) this.tick();
      }),
    ];
  }

  get isHost(): boolean {
    return this.hostId === this.transport.selfId;
  }

  tick(): void {
    const t = this.now();
    const self = this.transport.selfId;
    const candidates: { id: PeerId; hostedMs: number }[] = [];
    for (const [id, c] of this.claims) {
      if (t - c.at > this.claimTimeoutMs) {
        this.claims.delete(id);
        this.silent.add(id);
      } else {
        candidates.push({ id, hostedMs: c.hostedMs + (t - c.at) });
      }
    }
    if (this.claiming) candidates.push({ id: self, hostedMs: t - this.claimSince });
    let host = pickHost(candidates);

    if (host === null) {
      // vừa mất host (rời phòng, hoặc im quá claimTimeoutMs — đã chờ đủ rồi): người id nhỏ nhất lên ngay
      if (this.hostId !== null) this.noHostSince = t - this.listenMs;
      const waited = t - this.noHostSince;
      const alive = this.transport.peers().filter((id) => !this.silent.has(id));
      const lowest = minId([self, ...alive]) === self;
      // người id nhỏ nhất nhận sau listenMs; người khác chờ gấp đôi (phòng khi người đó treo)
      if (waited >= this.listenMs * (lowest ? 1 : 2)) {
        this.claiming = true;
        this.claimSince = t;
        host = self;
      }
    } else if (this.claiming && host !== self) {
      this.claiming = false; // có host id nhỏ hơn → lui
    }

    if (this.claiming && t - this.lastClaimAt >= this.claimEveryMs) {
      this.lastClaimAt = t;
      this.transport.send(this.claimPacket());
    }
    if (host !== this.hostId) {
      this.hostId = host;
      this.changed.emit(host);
    }
  }

  private claimPacket(): Uint8Array {
    return encodeGame({ type: GameMsg.HostClaim, hostedMs: this.now() - this.claimSince });
  }

  dispose(): void {
    for (const u of this.subs) u();
    this.subs = [];
  }
}

/** Lệch thời gian làm host dưới mức này coi như bằng nhau (trễ mạng làm số đo không chính xác). */
const SENIORITY_TIE_MS = 1000;

function pickHost(cands: { id: PeerId; hostedMs: number }[]): PeerId | null {
  let best: { id: PeerId; hostedMs: number } | null = null;
  for (const c of cands) {
    if (
      best === null ||
      c.hostedMs > best.hostedMs + SENIORITY_TIE_MS ||
      (Math.abs(c.hostedMs - best.hostedMs) <= SENIORITY_TIE_MS && c.id < best.id)
    ) {
      best = c;
    }
  }
  return best?.id ?? null;
}

function minId(ids: PeerId[]): PeerId | null {
  let best: PeerId | null = null;
  for (const id of ids) if (best === null || id < best) best = id;
  return best;
}
