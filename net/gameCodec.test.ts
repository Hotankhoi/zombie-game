import { describe, expect, it } from 'vitest';
import { GameMsg, POS_SCALE, decodeGame, encodeGame, type GameMessage, type SnapshotMsg } from './gameCodec';

const snap: SnapshotMsg = {
  type: GameMsg.Snapshot,
  tick: 1234,
  ack: 99,
  originX: -40,
  originY: 1000,
  players: [
    {
      slot: 2,
      x: -39.123456789,
      y: 1001.5,
      aim: 200,
      hp: 70,
      stamina: 42.5,
      staminaIdle: 0.25,
      attackCd: 0.15,
      respawnIn: 0,
      exhausted: true,
      sprinting: false,
      prevButtons: 3,
    },
  ],
  zombies: [
    { id: 70000, x: -30.5, y: 990.25, facing: Math.PI, chasing: true },
    { id: 5, x: -40, y: 1000, facing: 0, chasing: false },
  ],
  doors: [{ x: -38, y: 1003 }],
};

describe('gameCodec', () => {
  it('snapshot: người chơi chính xác (để reconcile), zombie lượng tử hóa 1/64 ô', () => {
    const out = decodeGame(encodeGame(snap)) as SnapshotMsg;
    expect(out.tick).toBe(1234);
    expect(out.ack).toBe(99);
    expect(out.players[0]).toEqual({ ...snap.players[0], stamina: 42.5, attackCd: Math.fround(0.15) });
    expect(out.players[0]!.x).toBe(-39.123456789);
    expect(out.zombies[0]!.id).toBe(70000 & 0xffff);
    expect(out.zombies[0]!.x).toBeCloseTo(-30.5, 5);
    expect(Math.abs(out.zombies[0]!.y - 990.25)).toBeLessThanOrEqual(1 / POS_SCALE);
    expect(out.zombies[0]!.facing).toBeCloseTo(Math.PI, 1);
    expect(out.zombies[0]!.chasing).toBe(true);
    expect(out.doors).toEqual([{ x: -38, y: 1003 }]);
  });

  it('kích thước: 200 zombie ≈ 1.6 KB mỗi snapshot', () => {
    const many: SnapshotMsg = {
      ...snap,
      zombies: Array.from({ length: 200 }, (_, i) => ({
        id: i,
        x: i % 30,
        y: 1000,
        facing: 1,
        chasing: false,
      })),
    };
    expect(encodeGame(many).length).toBeLessThan(200 * 8 + 120);
  });

  it('input, sự kiện, roster, host claim đi về nguyên vẹn', () => {
    const msgs: GameMessage[] = [
      {
        type: GameMsg.Input,
        inputs: [
          { seq: 7, moveX: -1, moveY: 1, aim: 255, buttons: 5 },
          { seq: 6, moveX: 0, moveY: -1, aim: 0, buttons: 0 },
        ],
      },
      {
        type: GameMsg.Events,
        tick: 5,
        events: [
          {
            kind: 'hit',
            slot: 1,
            zombie: 9,
            x: 2.5,
            y: -3.5,
            killed: true,
            assassination: true,
            silent: true,
          },
          { kind: 'bite', zombie: 3, slot: 0, x: 1, y: 2 },
          { kind: 'door', x: -100, y: 7, open: true },
          { kind: 'death', slot: 3 },
          { kind: 'respawn', slot: 3 },
          { kind: 'swing', slot: 0, x: 1, y: 1, facing: 0 },
        ],
      },
      {
        type: GameMsg.Roster,
        slots: [
          { slot: 0, id: 'abc' },
          { slot: 3, id: 'Người-chơi' },
        ],
      },
      { type: GameMsg.HostClaim, hostedMs: 42 },
    ];
    for (const m of msgs) expect(decodeGame(encodeGame(m))).toEqual(m);
  });

  it('gói hỏng / cụt / lạ → null, không ném lỗi', () => {
    const full = encodeGame(snap);
    for (let n = 0; n < full.length; n++) expect(decodeGame(full.subarray(0, n))).toBeNull();
    expect(decodeGame(new Uint8Array([1, 2, 3]))).toBeNull(); // gói phòng chờ
    expect(decodeGame(new Uint8Array([GameMsg.Events, 0, 0, 0, 0, 0, 1, 99]))).toBeNull();
  });
});
