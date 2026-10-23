import { joinRoom, selfId as trysteroSelfId, type Room } from '@trystero-p2p/nostr';
import type { PeerId, RoomCode } from '@shared/types';
import { Emitter, type SendOptions, type Transport } from './transport';

/**
 * Transport P2P qua WebRTC, dùng Trystero (mạng Nostr công cộng chỉ để 2 máy tìm thấy nhau).
 * Dữ liệu game đi thẳng giữa các máy, mã hóa đầu cuối. Miễn phí, không cần server.
 *
 * Lưu ý: Trystero hiện chỉ có kênh reliable. Gói 'unreliable' tạm đi chung kênh reliable;
 * giai đoạn 2 sẽ mở thêm DataChannel unordered/maxRetransmits=0 cho vị trí.
 */
export const APP_ID = 'zombie-coop-game-v1';

const ICE_SERVERS: RTCIceServer[] = [
  // STUN miễn phí, không giới hạn của Cloudflare
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
  // TURN (relay khi 4G/NAT chặn kết nối thẳng) sẽ thêm ở giai đoạn 7 — xem AGENTS.md
];

export class TrysteroTransport implements Transport {
  readonly selfId: PeerId = trysteroSelfId;
  private room: Room;
  private sendAction: (data: Uint8Array, opts?: { target?: string | string[] | null }) => Promise<void>;
  private msg = new Emitter<[Uint8Array, PeerId]>();
  private joinE = new Emitter<[PeerId]>();
  private leaveE = new Emitter<[PeerId]>();
  private known = new Set<PeerId>();

  constructor(code: RoomCode, onError?: (message: string) => void) {
    this.room = joinRoom(
      // password = mã phòng → người ngoài không biết mã thì không đọc được gói tìm nhau
      { appId: APP_ID, password: `zg:${code}`, rtcConfig: { iceServers: ICE_SERVERS } },
      code,
      { onJoinError: (e) => onError?.(e.error) },
    );
    const action = this.room.makeAction<Uint8Array>('g', {
      onMessage: (data, ctx) => this.msg.emit(toBytes(data), ctx.peerId),
    });
    this.sendAction = (data, opts) => action.send(data, opts);
    this.room.onPeerJoin = (id) => {
      this.known.add(id);
      this.joinE.emit(id);
    };
    this.room.onPeerLeave = (id) => {
      this.known.delete(id);
      this.leaveE.emit(id);
    };
  }

  peers(): PeerId[] {
    return [...this.known];
  }

  send(data: Uint8Array, opts: SendOptions = {}): void {
    const target = opts.to === undefined ? null : opts.to;
    this.sendAction(data, { target }).catch((err) => console.warn('[net] gửi lỗi:', err));
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
    await this.room.leave();
  }
}

function toBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(0);
}
