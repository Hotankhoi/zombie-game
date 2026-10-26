import { describe, expect, it } from 'vitest';
import { addItems, createInventory, type InventoryState } from '@shared/inventory/inventory';
import { createPlayer } from '@shared/sim/player';
import { findSlot, pickQuickUse, type Mate } from './quickUse';

function inv(items: [string, string, number][]): InventoryState {
  let s = createInventory();
  for (const [itemId, rarity, quantity] of items)
    s = addItems(s, { itemId, rarity, quantity } as never, s.revision).state;
  return s;
}
const mate = (id: string, dx: number, extra: Partial<Mate> = {}): Mate => ({
  id,
  x: 10 + dx,
  y: 10,
  hp: 100,
  alive: true,
  downedFor: 0,
  ...extra,
});

describe('thanh dùng nhanh 1–4', () => {
  it('chọn ô độ hiếm thấp nhất; không có → báo lỗi', () => {
    const s = inv([
      ['bandage', 'rare', 2],
      ['bandage', 'common', 1],
    ]);
    expect(findSlot(s, 'bandage')).toBe(1);
    const me = createPlayer('me', { x: 10, y: 10 });
    expect(pickQuickUse(3, me, s, [])).toEqual({ error: 'Không còn kháng sinh trong túi.' });
  });

  it('phím 1 băng gạc: ưu tiên đồng đội gục trong tầm, rồi mình, rồi đồng đội bị thương', () => {
    const s = inv([['bandage', 'common', 3]]);
    const me = createPlayer('me', { x: 10, y: 10 });
    const mates = [mate('far', 5, { downedFor: 9, hp: 0 }), mate('hurt', 1, { hp: 40 })];
    expect('error' in pickQuickUse(1, me, s, mates.slice(0, 1))).toBe(true); // gục nhưng quá xa, mình khỏe
    expect(pickQuickUse(1, me, s, [...mates, mate('down', -1, { downedFor: 9, hp: 0 })])).toMatchObject({
      target: 'down',
    });
    me.hp = 50;
    expect(pickQuickUse(1, me, s, mates)).toMatchObject({ target: null });
    me.hp = 100;
    expect(pickQuickUse(1, me, s, mates.slice(1))).toMatchObject({ target: 'hurt' });
  });

  it('phím 4: uống nếu khát hơn đói, ăn nếu đói hơn; thiếu thì dùng cái còn lại', () => {
    const me = createPlayer('me', { x: 0, y: 0 });
    me.water = 20;
    me.food = 60;
    const both = inv([
      ['water', 'common', 1],
      ['canned_food', 'common', 1],
    ]);
    expect(pickQuickUse(4, me, both, [])).toMatchObject({ itemId: 'water' });
    me.food = 10;
    expect(pickQuickUse(4, me, both, [])).toMatchObject({ itemId: 'canned_food' });
    expect(pickQuickUse(4, me, inv([['water', 'common', 1]]), [])).toMatchObject({ itemId: 'water' });
  });
});
