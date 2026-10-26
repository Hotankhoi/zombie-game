import { describe, expect, it } from 'vitest';
import {
  addItems,
  countItem,
  createInventory,
  removeFromSlot,
  removeItemUpTo,
  type InventoryState,
} from './inventory';

function bag(): InventoryState {
  let s = createInventory();
  for (const item of [
    { itemId: 'bandage', rarity: 'common', quantity: 3 },
    { itemId: 'pistol_ammo', rarity: 'rare', quantity: 10 },
    { itemId: 'pistol_ammo', rarity: 'common', quantity: 4 },
  ] as const)
    s = addItems(s, item, s.revision).state;
  return s;
}

describe('trừ đồ khi dùng (GĐ 3b, host)', () => {
  it('removeFromSlot: trừ đúng ô, hết thì ô trống, revision +1; sai revision / ô trống → giữ nguyên', () => {
    const s = bag();
    const r = removeFromSlot(s, 0, 1, s.revision);
    expect(r.ok).toBe(true);
    expect(r.state.slots[0]).toMatchObject({ itemId: 'bandage', quantity: 2 });
    expect(r.state.revision).toBe(s.revision + 1);
    const all = removeFromSlot(s, 0, 3, s.revision);
    expect(all.state.slots[0]).toBeNull();
    expect(removeFromSlot(s, 0, 1, s.revision - 1)).toMatchObject({ ok: false, error: 'stale_revision' });
    expect(removeFromSlot(s, 5, 1, s.revision)).toMatchObject({ ok: false, error: 'empty_slot' });
    expect(removeFromSlot(s, 0, 4, s.revision)).toMatchObject({ ok: false, error: 'invalid_quantity' });
    expect(s.slots[0]).toMatchObject({ quantity: 3 }); // bản gốc không đổi
  });

  it('removeItemUpTo: lấy đạn mọi độ hiếm, ưu tiên thường + chồng nhỏ; không có → lỗi', () => {
    const s = bag();
    expect(countItem(s, 'pistol_ammo')).toBe(14);
    const r = removeItemUpTo(s, 'pistol_ammo', 6, s.revision);
    expect(r.ok && r.removed).toBe(6);
    expect(countItem(r.state, 'pistol_ammo')).toBe(8);
    expect(r.state.slots.find((x) => x?.itemId === 'pistol_ammo' && x.rarity === 'common')).toBeUndefined();
    const most = removeItemUpTo(s, 'pistol_ammo', 99, s.revision);
    expect(most.removed).toBe(14);
    expect(removeItemUpTo(s, 'rifle_ammo', 5, s.revision)).toMatchObject({
      ok: false,
      error: 'invalid_quantity',
    });
  });
});
