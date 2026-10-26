import { LootAuthority } from '@shared/loot/authority';
import { chestLocations } from '@shared/mapgen/chests';
import { generateChunk } from '@shared/mapgen/world';
import { LootMessage, type LootAction, type LootReplicaWire } from '@shared/types/loot';
import { describe, expect, it } from 'vitest';
import {
  BACKPACK_CODES,
  ITEM_CODES,
  LOOT_ERRORS,
  RARITY_CODES,
  REGION_CODES,
  applyLootPatch,
  decodeLoot,
  encodeLoot,
  isValidPatch,
  isValidReplica,
  parseChestId,
  type LootWirePacket,
} from './lootCodec';

const seed = 'codec-test';
const chests = chestLocations(generateChunk(seed, 0, 0));
const at = chests[0]!;
const actor = { id: 'peerA', x: at.x, y: at.y, canInteract: true };

/** Thế giới có 2 túi, 1 rương đã mở và lấy 1 món. */
function world(): LootReplicaWire {
  const host = new LootAuthority(seed);
  host.join('peerA');
  host.join('peerB');
  const open = {
    type: 'open' as const,
    chestId: at.id,
    expectedChestRevision: 0,
    expectedInventoryRevision: 1,
  };
  const opened = host.loot(actor, open, () => true);
  if (!opened.ok || !opened.chest) throw Error('open');
  const slot = opened.chest.slots.findIndex((s) => s !== null);
  host.loot(
    actor,
    { ...open, type: 'take', slot, quantity: 1, expectedChestRevision: opened.chest.revision },
    () => true,
  );
  return host.snapshot();
}
const roundTrip = (p: LootWirePacket) => decodeLoot(encodeLoot(p));

describe('codec loot 110–113', () => {
  it('ghim thứ tự danh mục trên dây (đổi thì phải tăng PROTOCOL_VERSION)', () => {
    expect(ITEM_CODES).toEqual([
      'knife',
      'bat',
      'pistol',
      'rifle',
      'pistol_ammo',
      'rifle_ammo',
      'bandage',
      'medkit',
      'antibiotics',
      'water',
      'canned_food',
      'scrap',
    ]);
    expect(RARITY_CODES).toEqual(['common', 'uncommon', 'rare', 'epic', 'legendary']);
    expect(BACKPACK_CODES).toEqual(['basic', 'scout', 'expedition']);
    expect(REGION_CODES).toEqual(['residential', 'market', 'hospital', 'police', 'military']);
    expect(LOOT_ERRORS[0]).toBe('internal_error');
  });

  it('mã hóa → giải mã giữ nguyên mọi loại gói và mọi hành động', () => {
    const state = world();
    const actions: LootAction[] = [
      { type: 'inventory' },
      { type: 'view', chestId: at.id },
      { type: 'open', chestId: at.id, expectedChestRevision: 3, expectedInventoryRevision: 2 ** 40 },
      {
        type: 'take',
        chestId: at.id,
        expectedChestRevision: 1,
        expectedInventoryRevision: 2,
        slot: 5,
        quantity: 60,
      },
      { type: 'takeAll', chestId: chests[3]!.id, expectedChestRevision: 0, expectedInventoryRevision: 0 },
      { type: 'move', expectedRevision: 9, from: 0, to: 23, quantity: 3 },
      { type: 'sort', expectedRevision: Number.MAX_SAFE_INTEGER - 1 },
      { type: 'claim', key: 'AbCdEfGhIjKlMnOpQrSt_-', resume: true },
      { type: 'use', expectedRevision: 4, slot: 11, target: null },
      { type: 'use', expectedRevision: 0, slot: 0, target: 'peer-Xy_9' },
      { type: 'reload', expectedRevision: 12 },
      { type: 'equip', itemId: 'rifle', rarity: 'epic' },
    ];
    for (const action of actions) {
      const p = { type: LootMessage.Request, term: '1.abc', requestId: 'r-1', action } as const;
      expect(roundTrip(p)).toEqual(p);
    }
    const inv = state.inventories[0]!.state;
    const chest = state.chests[0]!;
    const packets: LootWirePacket[] = [
      { type: LootMessage.Reply, term: '2.x', requestId: 'q', ok: true, revision: 7, inventory: inv, chest },
      {
        type: LootMessage.Reply,
        term: '2.x',
        requestId: 'q',
        ok: false,
        error: 'stale_revision',
        revision: 7,
      },
      {
        type: LootMessage.Reply,
        term: '2.x',
        requestId: 'q',
        ok: false,
        error: 'blocked',
        revision: 0,
        inventory: inv,
      },
      { type: LootMessage.Replica, term: '3.y', state },
      {
        type: LootMessage.Replica,
        term: '3.y',
        patch: { baseRevision: 4, revision: 5, inventories: [state.inventories[1]!], chests: [chest] },
      },
      { type: LootMessage.Ack, term: '3.y', revision: 12345 },
    ];
    for (const p of packets) expect(roundTrip(p)).toEqual(p);
    // mã lỗi lạ không lộ ra gói: thành 'internal_error'
    const odd = roundTrip({
      type: LootMessage.Reply,
      term: 't',
      requestId: 'q',
      ok: false,
      error: 'xyz',
      revision: 0,
    });
    expect(odd).toMatchObject({ ok: false, error: 'internal_error' });
  });

  it('gói gọn: 1 rương đã lấy hết ~ 10 byte, replica 200 rương < 4 KB', () => {
    const state = world();
    const empty = { ...state.chests[0]!, slots: state.chests[0]!.slots.map(() => null) };
    const many: LootReplicaWire = {
      ...state,
      chests: Array.from({ length: 50 }, (_, i) => chestLocations(generateChunk(seed, i, 1)))
        .flat()
        .map((c) => ({ ...empty, id: c.id, region: c.region })),
    };
    const one = encodeLoot({ type: LootMessage.Replica, term: 't', state: { ...state, chests: [] } }).length;
    const full = encodeLoot({ type: LootMessage.Replica, term: 't', state: many }).length;
    expect((full - one) / 200).toBeLessThanOrEqual(10);
    expect(full).toBeLessThan(4096);
    expect(isValidReplica(many, seed)).toBe(true);
  });

  it('độ hiếm, vật phẩm, số lượng lấy theo danh mục: số lạ hoặc vượt maxStack → bỏ cả gói', () => {
    const inv = { revision: 0, backpack: 'basic' as const, slots: Array(12).fill(null) };
    inv.slots[0] = { itemId: 'knife', rarity: 'legendary', quantity: 1 };
    const good = encodeLoot({
      type: LootMessage.Reply,
      term: 't',
      requestId: 'q',
      ok: true,
      revision: 0,
      inventory: inv,
    });
    expect(decodeLoot(good)).not.toBeNull();
    // bố cục: [111][1,'t'][1,'q'][cờ][rev][balo][rev túi][mặt nạ 2 byte][món][độ hiếm][số lượng]
    const item = 1 + 2 + 2 + 1 + 1 + 1 + 1 + 2;
    const tamper = (offset: number, value: number) => {
      const b = good.slice();
      b[offset] = value;
      return decodeLoot(b);
    };
    expect(tamper(item, ITEM_CODES.length)).toBeNull(); // món không có trong danh mục
    expect(tamper(item + 1, RARITY_CODES.length)).toBeNull(); // độ hiếm lạ
    expect(tamper(item + 2, 2)).toBeNull(); // dao maxStack 1
    expect(tamper(item + 2, 0)).toBeNull(); // số lượng 0
    expect(tamper(item - 1, 0x10)).toBeNull(); // bit ô thứ 13 của túi 12 ô
    expect(tamper(item - 4, BACKPACK_CODES.length)).toBeNull(); // balo lạ
    expect(tamper(item - 4, 2)).toBeNull(); // balo 24 ô → mặt nạ 3 byte → gói thiếu byte
    // độ hiếm đọc ra luôn là chuỗi của danh mục, không phải byte trong gói
    const b = good.slice();
    b[item + 1] = 4;
    const decoded = decodeLoot(b) as unknown as { inventory: { slots: { rarity: string }[] } };
    expect(decoded.inventory.slots[0]!.rarity).toBe(RARITY_CODES[4]);
    // mã hóa dữ liệu sai = lỗi lập trình → ném
    expect(() =>
      encodeLoot({
        type: LootMessage.Reply,
        term: 't',
        requestId: 'q',
        ok: true,
        revision: 0,
        inventory: { ...inv, slots: inv.slots.slice(1) },
      }),
    ).toThrow(RangeError);
  });

  it('bỏ gói hỏng: cụt, thừa byte, loại lạ, token sai, revision không an toàn, ô/số lượng ngoài giới hạn', () => {
    const req = (action: LootAction, term = '1.a', requestId = 'r') =>
      encodeLoot({ type: LootMessage.Request, term, requestId, action });
    const good = req({ type: 'sort', expectedRevision: 1 });
    expect(decodeLoot(good)).not.toBeNull();
    for (let n = 0; n < good.length; n++) expect(decodeLoot(good.subarray(0, n))).toBeNull();
    expect(decodeLoot(new Uint8Array([...good, 0]))).toBeNull();
    expect(decodeLoot(new Uint8Array([109, ...good.subarray(1)]))).toBeNull();
    expect(decodeLoot(new Uint8Array([114, ...good.subarray(1)]))).toBeNull();
    expect(decodeLoot(new Uint8Array(0))).toBeNull();
    expect(() => req({ type: 'sort', expectedRevision: 1 }, 'có dấu')).toThrow();
    expect(() => req({ type: 'sort', expectedRevision: 1 }, 'x'.repeat(41))).toThrow();
    const bad = good.slice();
    bad[2] = 0x20; // dấu cách trong term
    expect(decodeLoot(bad)).toBeNull();
    // revision 2^53 (varint 8 byte) → bỏ
    const big = new Uint8Array([
      ...good.subarray(0, good.length - 1),
      0x80,
      0x80,
      0x80,
      0x80,
      0x80,
      0x80,
      0x80,
      0x10,
    ]);
    expect(decodeLoot(big)).toBeNull();
    // hành động lạ
    const act = good.slice();
    act[good.length - 2] = 8;
    expect(decodeLoot(act)).toBeNull();
    // ô rương ≥ 6, ô túi ≥ 24, số lượng 0 / > 60
    const take = req({
      type: 'take',
      chestId: at.id,
      expectedChestRevision: 0,
      expectedInventoryRevision: 0,
      slot: 5,
      quantity: 60,
    });
    const t1 = take.slice();
    t1[take.length - 2] = 6;
    expect(decodeLoot(t1)).toBeNull();
    const t2 = take.slice();
    t2[take.length - 1] = 61;
    expect(decodeLoot(t2)).toBeNull();
    const t3 = take.slice();
    t3[take.length - 1] = 0;
    expect(decodeLoot(t3)).toBeNull();
    const move = req({ type: 'move', expectedRevision: 0, from: 23, to: 0, quantity: 1 });
    const m1 = move.slice();
    m1[move.length - 3] = 24;
    expect(decodeLoot(m1)).toBeNull();
    expect(() => req({ type: 'move', expectedRevision: 0, from: 24, to: 0, quantity: 1 })).toThrow();
  });

  it('ID rương: chỉ nhận dạng chuẩn, giải mã dựng lại đúng dạng chuẩn', () => {
    expect(parseChestId(at.id)).not.toBeNull();
    expect(parseChestId('v1:-5,1000000:1,0:chest:0')).toEqual({ cx: -5, cy: 1000000, bx: 1, by: 0 });
    for (const id of [
      'v1:00,0:0,0:chest:0',
      'v2:0,0:0,0:chest:0',
      'v1:0,1000001:0,0:chest:0',
      'v1:0,0:2,0:chest:0',
      '__proto__',
      7,
    ])
      expect(parseChestId(id)).toBeNull();
    expect(() =>
      encodeLoot({
        type: LootMessage.Request,
        term: 't',
        requestId: 'r',
        action: { type: 'view', chestId: 'v1:00,0:0,0:chest:0' },
      }),
    ).toThrow(RangeError);
    const far = {
      type: LootMessage.Request,
      term: 't',
      requestId: 'r',
      action: { type: 'view', chestId: 'v1:-1000000,999999:1,1:chest:0' },
    } as const;
    expect(roundTrip(far)).toEqual(far);
  });

  it('trùng ID túi/rương, quá 4 túi → bỏ; replica sai seed / rương sai khu / rương không có trong map → không hợp lệ', () => {
    const state = world();
    const dupInv = { ...state, inventories: [state.inventories[0]!, state.inventories[0]!] };
    expect(decodeLoot(encodeLoot({ type: LootMessage.Replica, term: 't', state: dupInv }))).toBeNull();
    const dupChest = { ...state, chests: [state.chests[0]!, state.chests[0]!] };
    expect(decodeLoot(encodeLoot({ type: LootMessage.Replica, term: 't', state: dupChest }))).toBeNull();
    const four = {
      ...state,
      inventories: ['a', 'b', 'c', 'd'].map((id) => ({ ...state.inventories[0]!, id })),
    };
    const buf = encodeLoot({ type: LootMessage.Replica, term: 't', state: four });
    expect(decodeLoot(buf)).not.toBeNull();
    // [112][1,'t'][dạng][phiên bản][u16 + seed][revision 1 byte][số túi]
    const at5 = 1 + 2 + 1 + 1 + 2 + seed.length + 1;
    expect(buf[at5]).toBe(4);
    const five = buf.slice();
    five[at5] = 5;
    expect(decodeLoot(five)).toBeNull();
    expect(() =>
      encodeLoot({
        type: LootMessage.Replica,
        term: 't',
        state: { ...four, inventories: [...four.inventories, { ...four.inventories[0]!, id: 'e' }] },
      }),
    ).toThrow();

    expect(isValidReplica(state, seed)).toBe(true);
    expect(isValidReplica(state, 'other-seed')).toBe(false);
    const c = state.chests[0]!;
    const wrongRegion = REGION_CODES.find((r) => r !== c.region)!;
    expect(isValidReplica({ ...state, chests: [{ ...c, region: wrongRegion }] }, seed)).toBe(false);
    expect(
      isValidPatch(
        { baseRevision: 0, revision: 1, inventories: [], chests: [{ ...c, region: wrongRegion }] },
        seed,
      ),
    ).toBe(false);
    expect(isValidPatch({ baseRevision: 0, revision: 1, inventories: [], chests: [c] }, seed)).toBe(true);
  });

  it('ghép phần đổi: đúng revision gốc mới ghép, thay nguyên khối túi/rương, không sửa bản gốc', () => {
    const state = world();
    const inv = state.inventories[1]!;
    const changed = { ...inv, state: { ...inv.state, revision: inv.state.revision + 1 } };
    const newChest = { ...state.chests[0]!, id: chests[1]!.id, region: chests[1]!.region };
    const patch = {
      baseRevision: state.revision,
      revision: state.revision + 2,
      inventories: [changed],
      chests: [newChest],
    };
    expect(applyLootPatch(state, { ...patch, baseRevision: state.revision - 1 })).toBeNull();
    const next = applyLootPatch(state, patch)!;
    expect(next.revision).toBe(state.revision + 2);
    expect(next.inventories.find((e) => e.id === inv.id)).toEqual(changed);
    expect(next.chests.map((c) => c.id)).toEqual([state.chests[0]!.id, newChest.id]);
    expect(state.inventories[1]).toBe(inv);
    expect(isValidReplica(next, seed)).toBe(true);
    const tooMany = { ...patch, inventories: ['x', 'y', 'z'].map((id) => ({ ...changed, id })) };
    expect(applyLootPatch(state, tooMany)).toBeNull();
  });
});
