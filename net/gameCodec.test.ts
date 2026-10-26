import { describe, expect, it } from 'vitest';
import {
  GameMsg,
  POS_SCALE,
  VITAL_FIELDS,
  decodeGame,
  encodeGame,
  type GameMessage,
  type SnapshotMsg,
} from './gameCodec';

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
      downedFor: 12.5,
      reviveProgress: 1.5,
      dragging: true,
      flashlight: true,
    },
  ],
  zombies: [
    { id: 70000, x: -30.5, y: 990.25, facing: Math.PI, chasing: true, kind: 'giant', turnedSlot: 3 },
    { id: 5, x: -40, y: 1000, facing: 0, chasing: false, kind: 'normal', turnedSlot: null },
  ],
  doors: [{ x: -38, y: 1003 }],
  pools: [{ kind: 'acid', x: -35.5, y: 1002.25, radius: 1.125, arming: true, ttl: 3.2 }],
  vitals: [
    {
      slot: 2,
      food: 42.5,
      water: 7.25,
      infection: 63,
      maxHp: 81.5,
      healLeft: 11.5,
      healRate: 2.5,
      stillFor: 1.75,
    },
  ],
  horde: {
    number: 2,
    active: true,
    survived: null,
    remaining: 321,
    bossAlive: true,
    rows: [{ slot: 2, kills: 45, downs: 1 }],
  },
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
    expect(out.zombies.map((z) => [z.kind, z.turnedSlot])).toEqual([
      ['giant', 3],
      ['normal', null],
    ]);
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
        kind: 'normal' as const,
        turnedSlot: null,
      })),
    };
    expect(encodeGame(many).length).toBeLessThan(200 * 8 + 120);
  });

  it('zombie xa (> FAR_ZOMBIE_TILES ô) gửi gọn 5 byte, sai số ≤ 1/8 ô; zombie-từ-đồng-đội xa vẫn gửi đủ', () => {
    const o = { x: snap.originX, y: snap.originY };
    const far: SnapshotMsg = {
      ...snap,
      zombies: [
        { id: 1, x: o.x + 25.3, y: o.y - 31.9, facing: 2, chasing: true, kind: 'spitter', turnedSlot: null },
        { id: 2, x: o.x - 21, y: o.y + 3.14, facing: 5, chasing: false, kind: 'boss', turnedSlot: null },
        { id: 3, x: o.x + 30, y: o.y, facing: 0, chasing: false, kind: 'normal', turnedSlot: 1 },
        { id: 4, x: o.x + 5.5, y: o.y + 5.5, facing: 1, chasing: false, kind: 'normal', turnedSlot: null },
      ],
    };
    const near = { ...far, zombies: far.zombies.slice(2) };
    expect(encodeGame(far).length - encodeGame(near).length).toBe(2 * 5);
    const out = decodeGame(encodeGame(far)) as SnapshotMsg;
    const byId = new Map(out.zombies.map((z) => [z.id, z]));
    expect([...byId.keys()].sort()).toEqual([1, 2, 3, 4]);
    for (const z of far.zombies) {
      const got = byId.get(z.id)!;
      expect(Math.abs(got.x - z.x)).toBeLessThanOrEqual(1 / 8 + 1e-9);
      expect(Math.abs(got.y - z.y)).toBeLessThanOrEqual(1 / 8 + 1e-9);
      expect([got.kind, got.chasing, got.turnedSlot]).toEqual([z.kind, z.chasing, z.turnedSlot]);
      expect(
        Math.abs(Math.atan2(Math.sin(got.facing - z.facing), Math.cos(got.facing - z.facing))),
      ).toBeLessThan(0.2);
    }
    // zombie-từ-đồng-đội và zombie gần: chính xác 1/64 ô như cũ
    expect(Math.abs(byId.get(4)!.x - (o.x + 5.5))).toBeLessThanOrEqual(1 / POS_SCALE);
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
            hp: 0,
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
      {
        type: GameMsg.MapDelta,
        tiles: [
          { x: -5, y: 70000, change: 1 },
          { x: 12, y: -3, change: 1 },
        ],
      },
    ];
    for (const m of msgs) expect(decodeGame(encodeGame(m))).toEqual(m);
  });

  it('gói hỏng / cụt / lạ → null, không ném lỗi', () => {
    const full = encodeGame(snap);
    // khối mở rộng nối cuối gói: GĐ 2c (người chơi), GĐ 4 (vũng), GĐ 5 (đợt tràn), zombie xa (gói này không có con nào)
    const vitalsExt = 1 + snap.vitals!.length * (1 + 2 * VITAL_FIELDS.length);
    const farExt = 2 + vitalsExt;
    const hordeExt = 1 + 5 + snap.horde!.rows.length * 4 + farExt;
    const poolsExt = 1 + snap.pools.length * 8;
    const ext = 1 + snap.players.length * 10 + poolsExt + hordeExt;
    for (let n = 0; n < full.length; n++) {
      // cắt đúng ranh giới khối mở rộng = gói bản cũ hơn, vẫn hợp lệ
      const boundary = [ext, poolsExt + hordeExt, hordeExt, farExt, vitalsExt].some(
        (e) => n === full.length - e,
      );
      if (!boundary) expect(decodeGame(full.subarray(0, n))).toBeNull();
    }
    expect(decodeGame(new Uint8Array([1, 2, 3]))).toBeNull(); // gói phòng chờ
    expect(decodeGame(new Uint8Array([GameMsg.Events, 0, 0, 0, 0, 0, 1, 99]))).toBeNull();
  });

  it('snapshot bản cũ (không có khối mở rộng gục/cứu) vẫn đọc được, trạng thái gục = 0', () => {
    const full = encodeGame(snap);
    const old = decodeGame(
      full.subarray(
        0,
        full.length -
          (1 +
            snap.players.length * 10 +
            1 +
            snap.pools.length * 8 +
            1 +
            5 +
            4 +
            2 +
            1 +
            snap.vitals!.length * (1 + 2 * VITAL_FIELDS.length)),
      ),
    ) as SnapshotMsg;
    expect(old.players[0]).toMatchObject({ slot: 2, downedFor: 0, reviveProgress: 0, dragging: false });
    const now = decodeGame(full) as SnapshotMsg;
    expect(now.players[0]).toMatchObject({ downedFor: 12.5, reviveProgress: 1.5, dragging: true });
  });
});
