import { describe, expect, it } from 'vitest';
import { BACKPACKS, ITEMS, type BackpackId, type ItemId } from '../data/items';
import { Rng } from '../util/rng';
import {
  addItems,
  applyInventoryCommand,
  changeBackpack,
  createInventory,
  isInventoryState,
  type InventoryCommand,
  type InventoryResult,
  type InventoryState,
  type ItemStack,
} from './inventory';

const bandage = (quantity: number): ItemStack => ({ itemId: 'bandage', rarity: 'common', quantity });
function success(result: InventoryResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}
function grant(state: InventoryState, item: ItemStack) {
  return success(addItems(state, item, state.revision));
}
function move(state: InventoryState, from: number, to: number, quantity: number) {
  return applyInventoryCommand(state, { type: 'move', from, to, quantity, expectedRevision: state.revision });
}
function totals(state: InventoryState) {
  const result: Record<string, number> = {};
  for (const s of state.slots)
    if (s) result[`${s.itemId}:${s.rarity}`] = (result[`${s.itemId}:${s.rarity}`] ?? 0) + s.quantity;
  return result;
}

describe('inventory operations', () => {
  it('creates independent empty inventories at each backpack capacity', () => {
    for (const backpack of Object.keys(BACKPACKS) as BackpackId[]) {
      const a = createInventory(backpack);
      const b = createInventory(backpack);
      expect(a.slots).toHaveLength(BACKPACKS[backpack].capacity);
      expect(a.slots.every((s) => s === null)).toBe(true);
      expect(a.slots).not.toBe(b.slots);
    }
  });
  it('fills existing stacks before empty slots and respects maximum stack size', () => {
    let state = grant(createInventory(), bandage(8));
    state = grant(state, bandage(15));
    expect(state.slots.slice(0, 3)).toEqual([bandage(10), bandage(10), bandage(3)]);
    expect(totals(state)).toEqual({ 'bandage:common': 23 });
  });
  it('rejects a grant atomically when a nearly full inventory lacks room', () => {
    const state = grant(createInventory(), bandage(119));
    const result = addItems(state, bandage(2), state.revision);
    expect(result).toMatchObject({ ok: false, error: 'inventory_full' });
    expect(result.state).toBe(state);
    expect(totals(result.state)).toEqual({ 'bandage:common': 119 });
    expect(success(addItems(state, bandage(1), state.revision)).slots.every((s) => s?.quantity === 10)).toBe(
      true,
    );
  });
  it('keeps different rarities separate and weapons unstacked', () => {
    let state = grant(createInventory(), bandage(5));
    state = grant(state, { ...bandage(5), rarity: 'rare' });
    state = grant(state, { itemId: 'knife', rarity: 'common', quantity: 2 });
    expect(state.slots.slice(0, 4).map((s) => s?.quantity)).toEqual([5, 5, 1, 1]);
    expect(move(state, 0, 1, 2)).toMatchObject({ ok: false, error: 'partial_swap' });
  });
  it('splits, merges, moves and swaps without losing or duplicating items', () => {
    let state = grant(createInventory(), bandage(9));
    state = success(move(state, 0, 5, 4));
    expect(state.slots[0]?.quantity).toBe(5);
    expect(state.slots[5]?.quantity).toBe(4);
    state = success(move(state, 5, 0, 4));
    expect(state.slots[5]).toBeNull();
    state = grant(state, { itemId: 'knife', rarity: 'epic', quantity: 1 });
    const before = totals(state);
    state = success(move(state, 0, 1, 9));
    expect(state.slots[0]?.itemId).toBe('knife');
    expect(state.slots[1]).toEqual(bandage(9));
    expect(totals(state)).toEqual(before);
  });
  it('rejects overflowing merges without modifying either stack', () => {
    const state = grant(createInventory(), bandage(15));
    const result = move(state, 1, 0, 1);
    expect(result).toMatchObject({ ok: false, error: 'stack_full' });
    expect(result.state).toBe(state);
  });
  it.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid quantities %s',
    (quantity) => {
      const state = grant(createInventory(), bandage(5));
      expect(move(state, 0, 1, quantity)).toMatchObject({ ok: false, error: 'invalid_quantity' });
      expect(addItems(state, bandage(quantity), state.revision)).toMatchObject({
        ok: false,
        error: 'invalid_quantity',
      });
    },
  );
  it.each([-1, 12, NaN, Infinity, 1.5])('rejects invalid slot %s', (slot) => {
    const state = grant(createInventory(), bandage(5));
    expect(move(state, slot, 1, 1)).toMatchObject({ ok: false, error: 'invalid_slot' });
    expect(move(state, 0, slot, 1)).toMatchObject({ ok: false, error: 'invalid_slot' });
  });
  it('rejects empty/same slots, partial swaps and quantities above the source', () => {
    let state = grant(createInventory(), bandage(5));
    state = grant(state, { itemId: 'water', rarity: 'common', quantity: 1 });
    expect(move(state, 0, 0, 1)).toMatchObject({ ok: false, error: 'same_slot' });
    expect(move(state, 5, 6, 1)).toMatchObject({ ok: false, error: 'empty_slot' });
    expect(move(state, 0, 1, 2)).toMatchObject({ ok: false, error: 'partial_swap' });
    expect(move(state, 0, 2, 6)).toMatchObject({ ok: false, error: 'invalid_quantity' });
  });
  it('rejects a replayed or stale intent, including host grants and backpack changes', () => {
    const old = grant(createInventory(), bandage(5));
    const command: InventoryCommand = {
      type: 'move',
      from: 0,
      to: 1,
      quantity: 2,
      expectedRevision: old.revision,
    };
    const next = success(applyInventoryCommand(old, command));
    expect(applyInventoryCommand(next, command)).toMatchObject({
      ok: false,
      error: 'stale_revision',
      state: next,
    });
    expect(addItems(next, bandage(1), old.revision)).toMatchObject({ ok: false, error: 'stale_revision' });
    expect(changeBackpack(next, 'scout', old.revision)).toMatchObject({ ok: false, error: 'stale_revision' });
  });
  it('compacts on shrinking and rejects a backpack that cannot hold existing items', () => {
    let state = grant(createInventory('expedition'), bandage(5));
    state = success(move(state, 0, 23, 5));
    const small = success(changeBackpack(state, 'basic', state.revision));
    expect(small.slots).toHaveLength(12);
    expect(small.slots[0]).toEqual(bandage(5));
    state = grant(state, { itemId: 'knife', rarity: 'common', quantity: 12 });
    const result = changeBackpack(state, 'basic', state.revision);
    expect(result).toMatchObject({ ok: false, error: 'inventory_full' });
    expect(result.state).toBe(state);
  });
  it('sorts deterministically, merges compatible stacks, and preserves rarity totals', () => {
    let state = grant(createInventory(), bandage(8));
    state = success(move(state, 0, 4, 3));
    state = grant(state, { itemId: 'rifle', rarity: 'epic', quantity: 1 });
    state = grant(state, { ...bandage(2), rarity: 'rare' });
    const before = totals(state);
    const sorted = success(applyInventoryCommand(state, { type: 'sort', expectedRevision: state.revision }));
    expect(sorted.slots.slice(0, 3)).toEqual([
      { itemId: 'rifle', rarity: 'epic', quantity: 1 },
      { ...bandage(2), rarity: 'rare' },
      bandage(8),
    ]);
    expect(totals(sorted)).toEqual(before);
    expect(
      success(applyInventoryCommand(sorted, { type: 'sort', expectedRevision: sorted.revision })).slots,
    ).toEqual(sorted.slots);
  });
  it('never mutates caller-owned snapshots', () => {
    const state = grant(createInventory(), bandage(7));
    state.slots.forEach((s) => s && Object.freeze(s));
    Object.freeze(state.slots);
    Object.freeze(state);
    expect(() => {
      move(state, 0, 1, 2);
      addItems(state, bandage(1), state.revision);
      changeBackpack(state, 'scout', state.revision);
      applyInventoryCommand(state, { type: 'sort', expectedRevision: state.revision });
    }).not.toThrow();
    expect(state.slots[0]).toEqual(bandage(7));
  });
  it('rejects malformed snapshots and unknown catalogue keys', () => {
    const valid = createInventory();
    for (const value of [
      null,
      {},
      { ...valid, slots: new Array(12) },
      { ...valid, revision: -1 },
      { ...valid, backpack: '__proto__' },
      { ...valid, slots: [bandage(0), ...valid.slots.slice(1)] },
      { ...valid, slots: [bandage(11), ...valid.slots.slice(1)] },
    ])
      expect(isInventoryState(value)).toBe(false);
    expect(addItems(valid, { ...bandage(1), itemId: 'constructor' as ItemId }, 0)).toMatchObject({
      ok: false,
      error: 'invalid_item',
    });
    expect(applyInventoryCommand(valid, null as unknown as InventoryCommand)).toMatchObject({
      ok: false,
      error: 'invalid_command',
    });
    expect(changeBackpack(valid, '__proto__' as BackpackId, 0)).toMatchObject({
      ok: false,
      error: 'invalid_backpack',
    });
  });
  it('conserves every item across 1000 mixed moves/sorts and snapshot serialization', () => {
    const rng = new Rng('inventory-stress-v1');
    let state = createInventory('expedition');
    for (const itemId of Object.keys(ITEMS) as ItemId[])
      state = grant(state, {
        itemId,
        rarity: rng.pick(['common', 'rare', 'epic'] as const),
        quantity: ITEMS[itemId].maxStack,
      });
    const initial = totals(state);
    for (let i = 0; i < 1000; i++) {
      const from = rng.int(0, 23),
        to = rng.int(0, 23);
      const result =
        i % 17 === 0
          ? applyInventoryCommand(state, { type: 'sort', expectedRevision: state.revision })
          : move(state, from, to, rng.int(1, state.slots[from]?.quantity ?? 1));
      state = result.state;
      expect(isInventoryState(state)).toBe(true);
      expect(totals(state)).toEqual(initial);
      if (i % 50 === 0) state = JSON.parse(JSON.stringify(state)) as InventoryState;
    }
  });
});
