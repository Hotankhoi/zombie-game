import { describe, it, expect } from 'vitest';
import { createInventory, addItems, applyInventoryCommand } from '@shared/inventory/inventory';
import { HOTBAR_SIZE, resolveBinding, nextSlot } from './model';
describe('five slot hotbar references', () => {
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
