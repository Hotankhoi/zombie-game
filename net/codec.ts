import { PROTOCOL_VERSION } from '@shared/types';

/**
 * Mã hóa gói tin nhị phân (AGENTS.md mục 2.8). Byte đầu = loại gói.
 * Giai đoạn 0 chỉ có Hello / Ping / Pong. Giai đoạn 2 sẽ thêm input, snapshot, sự kiện.
 */
export const enum MsgType {
  Hello = 1,
  Ping = 2,
  Pong = 3,
}

export type Msg =
  | { type: MsgType.Hello; version: number; name: string; color: number }
  | { type: MsgType.Ping; seq: number; sentAt: number }
  | { type: MsgType.Pong; seq: number; sentAt: number };

const enc = new TextEncoder();
const dec = new TextDecoder();
const MAX_NAME_BYTES = 48;

export function encode(msg: Msg): Uint8Array {
  switch (msg.type) {
    case MsgType.Hello: {
      const name = enc.encode(msg.name).subarray(0, MAX_NAME_BYTES);
      const buf = new Uint8Array(1 + 1 + 3 + 1 + name.length);
      const v = new DataView(buf.buffer);
      v.setUint8(0, msg.type);
      v.setUint8(1, msg.version);
      v.setUint8(2, (msg.color >> 16) & 0xff);
      v.setUint8(3, (msg.color >> 8) & 0xff);
      v.setUint8(4, msg.color & 0xff);
      v.setUint8(5, name.length);
      buf.set(name, 6);
      return buf;
    }
    case MsgType.Ping:
    case MsgType.Pong: {
      const buf = new Uint8Array(1 + 4 + 8);
      const v = new DataView(buf.buffer);
      v.setUint8(0, msg.type);
      v.setUint32(1, msg.seq >>> 0);
      v.setFloat64(5, msg.sentAt);
      return buf;
    }
  }
}

/** Giải mã. Trả về null nếu gói hỏng/lạ (không bao giờ ném lỗi vì dữ liệu từ mạng). */
export function decode(buf: Uint8Array): Msg | null {
  if (buf.length < 1) return null;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const type = v.getUint8(0);
  switch (type) {
    case MsgType.Hello: {
      if (buf.length < 6) return null;
      const len = v.getUint8(5);
      if (len > MAX_NAME_BYTES || buf.length < 6 + len) return null;
      return {
        type,
        version: v.getUint8(1),
        color: (v.getUint8(2) << 16) | (v.getUint8(3) << 8) | v.getUint8(4),
        name: dec.decode(buf.subarray(6, 6 + len)),
      };
    }
    case MsgType.Ping:
    case MsgType.Pong: {
      if (buf.length < 13) return null;
      return { type, seq: v.getUint32(1), sentAt: v.getFloat64(5) };
    }
    default:
      return null;
  }
}

export function hello(name: string, color: number): Msg {
  return { type: MsgType.Hello, version: PROTOCOL_VERSION, name, color };
}
