import { joinRoom, selfId as trysteroSelfId, type Room } from '@trystero-p2p/nostr';
import type { PeerId, RoomCode } from '@shared/types';
import { STUN_SERVERS } from './ice';
import { Emitter, type SendOptions, type Transport } from './transport';

/**
 * Transport P2P qua WebRTC, dùng Trystero (mạng Nostr công cộng chỉ để 2 máy tìm thấy nhau).
 * Dữ liệu game đi thẳng giữa các máy, mã hóa đầu cuối. Miễn phí, không cần server.
 *
 * Kênh 'reliable': action của Trystero (DataChannel có thứ tự, gửi lại khi mất).
 * Kênh 'unreliable' (AGENTS.md mục 2.8): DataChannel riêng `ordered: false, maxRetransmits: 0` mở trên chính
 * kết nối WebRTC của Trystero — mất gói thì thôi, không chờ gửi lại nên không làm trễ gói sau.
 * Kênh này chưa mở (vừa vào phòng, trình duyệt cũ) thì gói 'unreliable' đi tạm kênh reliable.
 */
export const APP_ID = 'zombie-coop-game-v1';

/**
 * id cố định của DataChannel unreliable. `negotiated: true` = hai bên tự tạo cùng id, không cần trao đổi
 * SDP lại (kết nối đã có SCTP nhờ kênh của Trystero). Trystero tự đánh số kênh của nó từ 0 nên không trùng.
 */
const UNRELIABLE_CHANNEL_ID = 77;

export interface TrysteroOptions {
  /** STUN + TURN, lấy bằng loadIceServers() trong ./ice. */
  iceServers?: RTCIceServer[];
  /** Chỉ đi qua TURN (link ?relay=1) — để thử relay ngay trên một máy. */
  forceRelay?: boolean;
  onError?: (message: string) => void;
}

export class TrysteroTransport implements Transport {
  readonly selfId: PeerId = trysteroSelfId;
  private room: Room;
  private sendAction: (data: Uint8Array, opts?: { target?: string | string[] | null }) => Promise<void>;
  private msg = new Emitter<[Uint8Array, PeerId]>();
  private joinE = new Emitter<[PeerId]>();
  private leaveE = new Emitter<[PeerId]>();
  private known = new Set<PeerId>();
  private unreliable = new Map<PeerId, RTCDataChannel>();

  constructor(
    code: RoomCode,
    { iceServers = STUN_SERVERS, forceRelay = false, onError }: TrysteroOptions = {},
  ) {
    const rtcConfig: RTCConfiguration = { iceServers };
    if (forceRelay) rtcConfig.iceTransportPolicy = 'relay';
    this.room = joinRoom(
      // password = mã phòng → người ngoài không biết mã thì không đọc được gói tìm nhau
      { appId: APP_ID, password: `zg:${code}`, rtcConfig },
      code,
      { onJoinError: (e) => onError?.(e.error) },
    );
    const action = this.room.makeAction<Uint8Array>('g', {
      onMessage: (data, ctx) => this.msg.emit(toBytes(data), ctx.peerId),
    });
    this.sendAction = (data, opts) => action.send(data, opts);
    this.room.onPeerJoin = (id) => {
      this.known.add(id);
      this.openUnreliable(id);
      this.joinE.emit(id);
    };
    this.room.onPeerLeave = (id) => {
      this.known.delete(id);
      this.unreliable.get(id)?.close();
      this.unreliable.delete(id);
      this.leaveE.emit(id);
    };
  }

  peers(): PeerId[] {
    return [...this.known];
  }

  /** Số người đang có kênh unreliable mở (bảng F3). */
  get unreliableOpen(): number {
    let n = 0;
    for (const ch of this.unreliable.values()) if (ch.readyState === 'open') n++;
    return n;
  }

  send(data: Uint8Array, opts: SendOptions = {}): void {
    let target: PeerId | PeerId[] | null = opts.to === undefined ? null : opts.to;
    if (opts.channel === 'unreliable') {
      // gửi thẳng qua kênh unreliable cho ai đã mở; ai chưa mở thì dồn sang kênh reliable
      const fallback: PeerId[] = [];
      const targets = target === null ? [...this.known] : Array.isArray(target) ? target : [target];
      for (const id of targets) {
        const ch = this.unreliable.get(id);
        if (ch?.readyState === 'open' && sendRaw(ch, data)) continue;
        fallback.push(id);
      }
      if (fallback.length === 0) return;
      target = fallback;
    }
    this.sendAction(data, { target }).catch((err) => console.warn('[net] gửi lỗi:', err));
  }

  private openUnreliable(id: PeerId): void {
    const pc = this.room.getPeers()[id];
    if (!pc || this.unreliable.has(id)) return;
    try {
      const ch = pc.createDataChannel('u', {
        negotiated: true,
        id: UNRELIABLE_CHANNEL_ID,
        ordered: false,
        maxRetransmits: 0,
      });
      ch.binaryType = 'arraybuffer';
      ch.onmessage = (e: MessageEvent) => this.msg.emit(toBytes(e.data), id);
      ch.onclose = () => {
        if (this.unreliable.get(id) === ch) this.unreliable.delete(id);
      };
      this.unreliable.set(id, ch);
    } catch (err) {
      // trình duyệt không hỗ trợ / kết nối đang đóng: vẫn chơi được qua kênh reliable
      console.warn('[net] không mở được kênh unreliable:', err);
    }
  }

  onMessage(h: (data: Uint8Array, from: PeerId) => void) {
    return this.msg.on(h);
  }
  onPeerJoin(h: (peer: PeerId) => void) {
    return this.joinE.on(h);
  }
  onPeerLeave(h: (peer: PeerId) => void) {
    return this.leaveE.on(h);
  }

  async leave(): Promise<void> {
    this.msg.clear();
    this.joinE.clear();
    this.leaveE.clear();
    this.known.clear();
    for (const ch of this.unreliable.values()) ch.close();
    this.unreliable.clear();
    await this.room.leave();
  }
}

/** Gửi qua DataChannel; đầy bộ đệm/đang đóng thì trả false để gửi tạm kênh reliable. */
function sendRaw(ch: RTCDataChannel, data: Uint8Array): boolean {
  try {
    ch.send(data as Uint8Array<ArrayBuffer>);
    return true;
  } catch {
    return false;
  }
}

function toBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(0);
}
