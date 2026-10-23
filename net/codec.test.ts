import { describe, expect, it } from 'vitest';
import { MsgType, decode, encode, hello } from './codec';
import { PROTOCOL_VERSION } from '@shared/types';

describe('codec', () => {
  it('Hello mã hóa rồi giải mã giữ nguyên (cả tiếng Việt)', () => {
    const m = hello('Khôi 🧟', 0xf06292);
    expect(decode(encode(m))).toEqual({
      type: MsgType.Hello,
      version: PROTOCOL_VERSION,
      name: 'Khôi 🧟',
      color: 0xf06292,
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
