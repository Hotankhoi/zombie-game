import { describe, expect, it } from 'vitest';
import { MsgType, decode, encode, hello } from './codec';
import { PROTOCOL_VERSION } from '@shared/types';

describe('codec', () => {
  it('Hello mã hóa rồi giải mã giữ nguyên (cả tiếng Việt)', () => {
    const m = hello('Khôi 🧟', 0xf06292, PROTOCOL_VERSION, { id: 'abc1234def56', time: 1_790_000_000 });
    expect(decode(encode(m))).toEqual({
      type: MsgType.Hello,
      version: PROTOCOL_VERSION,
      name: 'Khôi 🧟',
      color: 0xf06292,
      build: { id: 'abc1234def56', time: 1_790_000_000 },
    });
  });

  it('Hello của bản cũ (không có khối build) vẫn đọc được, build rỗng', () => {
    const name = new TextEncoder().encode('An');
    const old = new Uint8Array([MsgType.Hello, 3, 0x11, 0x22, 0x33, name.length, ...name]);
    expect(decode(old)).toEqual({
      type: MsgType.Hello,
      version: 3,
      name: 'An',
      color: 0x112233,
      build: { id: '', time: 0 },
    });
  });

  it('Ping/Pong giữ nguyên seq và thời gian', () => {
    const m = { type: MsgType.Ping, seq: 4_000_000_000, sentAt: 123456.789 } as const;
    expect(decode(encode(m))).toEqual(m);
    expect(encode(m).length).toBe(13);
  });

  it('gói hỏng trả về null, không ném lỗi', () => {
    expect(decode(new Uint8Array([]))).toBeNull();
    expect(decode(new Uint8Array([99]))).toBeNull();
    expect(decode(new Uint8Array([MsgType.Ping, 1, 2]))).toBeNull();
    expect(decode(new Uint8Array([MsgType.Hello, 1, 0, 0, 0, 200]))).toBeNull();
  });

  it('tên quá dài bị cắt', () => {
    const m = decode(encode(hello('a'.repeat(500), 0)));
    expect(m && m.type === MsgType.Hello && m.name.length).toBe(48);
  });
});
