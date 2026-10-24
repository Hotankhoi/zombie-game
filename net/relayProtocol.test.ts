import { describe, expect, it } from 'vitest';
import {
  RELAY_MAX_PEERS,
  decodeClientBatch,
  decodeServer,
  encodeClientBatch,
  encodeJoin,
  encodeLeave,
  encodeServerData,
  encodeWelcome,
  freeSlot,
  relayRoomUrl,
  routeBatch,
} from './relayProtocol';

const b = (...n: number[]) => Uint8Array.from(n);

describe('relayProtocol', () => {
  it('khung gộp gửi lên: mã hóa rồi giải mã giữ nguyên gói và người nhận', () => {
    const entries = [
      { targets: [], data: b(1, 2, 3) },
      { targets: [2, 5], data: b(9) },
      { targets: [1], data: new Uint8Array(0) },
    ];
    const back = decodeClientBatch(encodeClientBatch(entries));
    expect(back?.map((e) => ({ targets: e.targets, data: [...e.data] }))).toEqual(
      entries.map((e) => ({ targets: e.targets, data: [...e.data] })),
    );
  });

  it('khung hỏng → null', () => {
    const frame = encodeClientBatch([{ targets: [1], data: b(1, 2, 3, 4) }]);
    expect(decodeClientBatch(frame.subarray(0, frame.length - 1))).toBeNull();
    expect(decodeClientBatch(b(3, 1))).toBeNull();
  });

  it('khung relay → máy chơi', () => {
    expect(decodeServer(encodeWelcome(3))).toEqual({ t: 'welcome', slot: 3 });
    expect(decodeServer(encodeJoin(2, 'abcXYZ09'))).toEqual({ t: 'join', slot: 2, id: 'abcXYZ09' });
    expect(decodeServer(encodeLeave(7))).toEqual({ t: 'leave', slot: 7 });
    const d = decodeServer(
      encodeServerData([
        { from: 1, data: b(5, 6) },
        { from: 1, data: b(7) },
      ]),
    );
    expect(d?.t).toBe('data');
    if (d?.t === 'data')
      expect(d.entries.map((e) => [e.from, ...e.data])).toEqual([
        [1, 5, 6],
        [1, 7],
      ]);
    expect(decodeServer(b(99, 1))).toBeNull();
  });

  it('chia gói cho người nhận: cả phòng / riêng / bỏ người không có', () => {
    const out = routeBatch(
      0,
      [
        { targets: [], data: b(1) },
        { targets: [2], data: b(2) },
        { targets: [9, 0], data: b(3) },
      ],
      [1, 2],
    );
    expect([...out.keys()].sort()).toEqual([1, 2]);
    expect(out.get(1)!.map((e) => e.data[0])).toEqual([1]);
    expect(out.get(2)!.map((e) => e.data[0])).toEqual([1, 2]);
  });

  it('ghế trống nhỏ nhất, đầy thì -1', () => {
    expect(freeSlot([0, 1, 3])).toBe(2);
    expect(freeSlot(Array.from({ length: RELAY_MAX_PEERS }, (_, i) => i))).toBe(-1);
  });

  it('địa chỉ phòng: https → wss, bỏ / cuối', () => {
    expect(relayRoomUrl('https://r.example.workers.dev/', 'ABCD12', 'p1')).toBe(
      'wss://r.example.workers.dev/room/ABCD12?peer=p1&v=1',
    );
    expect(relayRoomUrl('http://127.0.0.1:8787', 'ABCD', 'x')).toBe(
      'ws://127.0.0.1:8787/room/ABCD?peer=x&v=1',
    );
  });
});
