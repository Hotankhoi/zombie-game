import type { Channel, PeerId } from '@shared/types';

/**
 * Lớp mạng "cắm rút được" (AGENTS.md mục 1, 2).
 * Game chỉ nói chuyện với interface này, không gọi thẳng Trystero/WebRTC,
 * để sau này đổi sang Cloudflare Durable Objects mà không phải sửa game.
 */
export interface SendOptions {
  /** 'unreliable' cho vị trí (mất gói được), 'reliable' cho sự kiện. Mặc định 'reliable'. */
  channel?: Channel;
  /** Gửi riêng cho 1 hoặc vài người. Bỏ trống = gửi cả phòng. */
  to?: PeerId | PeerId[];
}

export type Unsubscribe = () => void;

export interface Transport {
  readonly selfId: PeerId;
  /** Danh sách người khác đang kết nối (không gồm mình). */
  peers(): PeerId[];
  send(data: Uint8Array, opts?: SendOptions): void;
  onMessage(handler: (data: Uint8Array, from: PeerId) => void): Unsubscribe;
  onPeerJoin(handler: (peer: PeerId) => void): Unsubscribe;
  onPeerLeave(handler: (peer: PeerId) => void): Unsubscribe;
  leave(): Promise<void>;
}

/** Tiện ích nhỏ: quản lý danh sách handler. */
export class Emitter<A extends unknown[]> {
  private handlers = new Set<(...args: A) => void>();

  on(h: (...args: A) => void): Unsubscribe {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  emit(...args: A): void {
    for (const h of [...this.handlers]) {
      try {
        h(...args);
      } catch (err) {
        console.error('[net] handler lỗi:', err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
