import { describe, it, expect } from 'vitest';
import { createInventory, addItems, applyInventoryCommand } from '@shared/inventory/inventory';
import { HOTBAR_SIZE, resolveBinding, nextSlot, selectedForWeapon, type Binding } from './model';
describe('five slot hotbar references', () => {
  it('follows equipment changed from the inventory/X and clears a stale weapon highlight', () => {
    const bindings: (Binding | null)[] = [
      { itemId: 'knife', rarity: 'common' },
      { itemId: 'rifle', rarity: 'epic' },
      { itemId: 'bandage', rarity: 'common' },
      null,
      null,
    ];
    expect(selectedForWeapon(bindings, 0, 'rifle', 'epic')).toBe(1);
    expect(selectedForWeapon(bindings, 0, 'pistol', 'common')).toBe(-1);
    expect(selectedForWeapon(bindings, 0, 'fists', 'common')).toBe(-1);
    expect(selectedForWeapon(bindings, 3, 'fists', 'common')).toBe(3);
    expect(selectedForWeapon(bindings, 2, 'fists', 'common')).toBe(2);
  });
  it('has five keys and wraps both directions', () => {
    expect(HOTBAR_SIZE).toBe(5);
    expect(nextSlot(0, -1)).toBe(4);
    expect(nextSlot(4, 1)).toBe(0);
  });
  it('resolves counts after moving/sorting and clears exhausted references without granting items', () => {
    const binding = { itemId: 'water' as const, rarity: 'common' as const };
    const bag = addItems(createInventory(), { ...binding, quantity: 5 }, 0).state;
    const saved = structuredClone(bag);
    expect(resolveBinding(bag, binding)).toEqual({ slot: 0, quantity: 5 });
    const moved = applyInventoryCommand(bag, {
      type: 'move',
      from: 0,
      to: 4,
      quantity: 5,
      expectedRevision: bag.revision,
    }).state;
    expect(resolveBinding(moved, binding)).toEqual({ slot: 4, quantity: 5 });
    expect(bag).toEqual(saved);
    expect(resolveBinding(createInventory(), binding)).toBeNull();
  });
});
