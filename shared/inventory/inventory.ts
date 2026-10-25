import { BACKPACKS, ITEMS, RARITIES, type BackpackId, type ItemId, type Rarity } from '../data/items';

export interface ItemStack {
  readonly itemId: ItemId;
  readonly rarity: Rarity;
  readonly quantity: number;
}
export interface InventoryState {
  readonly revision: number;
  readonly backpack: BackpackId;
  readonly slots: readonly (ItemStack | null)[];
}
export type InventoryError =
  | 'invalid_state'
  | 'invalid_command'
  | 'stale_revision'
  | 'invalid_item'
  | 'invalid_quantity'
  | 'invalid_slot'
  | 'empty_slot'
  | 'same_slot'
  | 'stack_full'
  | 'partial_swap'
  | 'inventory_full'
  | 'invalid_backpack';
export type InventoryResult =
  { ok: true; state: InventoryState } | { ok: false; state: InventoryState; error: InventoryError };
export type InventoryCommand =
  | { type: 'move'; expectedRevision: number; from: number; to: number; quantity: number }
  | { type: 'sort'; expectedRevision: number };

const integer = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n);
const known = <T extends object>(table: T, key: unknown): key is keyof T =>
  typeof key === 'string' && Object.hasOwn(table, key);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Validate deserialized snapshots before they reach UI or authoritative logic. */
export function isInventoryState(value: unknown): value is InventoryState {
  if (
    !record(value) ||
    !integer(value.revision) ||
    value.revision < 0 ||
    value.revision >= Number.MAX_SAFE_INTEGER ||
    !known(BACKPACKS, value.backpack) ||
    !Array.isArray(value.slots) ||
    value.slots.length !== BACKPACKS[value.backpack].capacity
  )
    return false;
  // Array.from visits holes too; a sparse array is not a valid snapshot.
  return Array.from(value.slots).every(
    (s: unknown) =>
      s === null ||
      (record(s) &&
        known(ITEMS, s.itemId) &&
        known(RARITIES, s.rarity) &&
        integer(s.quantity) &&
        s.quantity > 0 &&
        s.quantity <= ITEMS[s.itemId].maxStack),
  );
}

export function createInventory(backpack: BackpackId = 'basic'): InventoryState {
  if (!known(BACKPACKS, backpack)) throw new RangeError('Unknown backpack');
  return { revision: 0, backpack, slots: Array<null>(BACKPACKS[backpack].capacity).fill(null) };
}
const fail = (state: InventoryState, error: InventoryError): InventoryResult => ({ ok: false, state, error });
const sameItem = (a: ItemStack, b: ItemStack) => a.itemId === b.itemId && a.rarity === b.rarity;
const finish = (
  state: InventoryState,
  slots: (ItemStack | null)[],
  backpack = state.backpack,
): InventoryResult => ({ ok: true, state: { revision: state.revision + 1, backpack, slots } });
function check(state: InventoryState, revision: number): InventoryError | null {
  if (!isInventoryState(state) || state.revision >= Number.MAX_SAFE_INTEGER - 1) return 'invalid_state';
  return revision === state.revision ? null : 'stale_revision';
}

/** Pure all-or-nothing operation. The host validates ownership before applying a client intent. */
export function applyInventoryCommand(state: InventoryState, command: InventoryCommand): InventoryResult {
  if (!record(command) || (command.type !== 'move' && command.type !== 'sort'))
    return fail(state, 'invalid_command');
  const error = check(state, command.expectedRevision);
  if (error) return fail(state, error);
  if (command.type === 'sort') return sortInventory(state);
  const { from, to, quantity } = command;
  if (![from, to].every((i) => integer(i) && i >= 0 && i < state.slots.length))
    return fail(state, 'invalid_slot');
  if (from === to) return fail(state, 'same_slot');
  const source = state.slots[from]!;
  const target = state.slots[to]!;
  if (!source) return fail(state, 'empty_slot');
  if (!integer(quantity) || quantity <= 0 || quantity > source.quantity)
    return fail(state, 'invalid_quantity');
  const slots = [...state.slots];
  if (!target) {
    slots[to] = { ...source, quantity };
    slots[from] = quantity === source.quantity ? null : { ...source, quantity: source.quantity - quantity };
  } else if (sameItem(source, target)) {
    if (target.quantity + quantity > ITEMS[target.itemId].maxStack) return fail(state, 'stack_full');
    slots[to] = { ...target, quantity: target.quantity + quantity };
    slots[from] = quantity === source.quantity ? null : { ...source, quantity: source.quantity - quantity };
  } else {
    if (quantity !== source.quantity) return fail(state, 'partial_swap');
    slots[from] = target;
    slots[to] = source;
  }
  return finish(state, slots);
}

/** Host-only grant (loot/reward). A failed grant leaves the complete input unchanged. */
export function addItems(state: InventoryState, item: ItemStack, expectedRevision: number): InventoryResult {
  const error = check(state, expectedRevision);
  if (error) return fail(state, error);
  if (!record(item) || !known(ITEMS, item.itemId) || !known(RARITIES, item.rarity))
    return fail(state, 'invalid_item');
  if (!integer(item.quantity) || item.quantity <= 0) return fail(state, 'invalid_quantity');
  const max = ITEMS[item.itemId].maxStack;
  const available = state.slots.reduce(
    (n, s) => n + (!s ? max : sameItem(s, item) ? max - s.quantity : 0),
    0,
  );
  if (available < item.quantity) return fail(state, 'inventory_full');
  const slots = [...state.slots];
  let remaining = item.quantity;
  for (let i = 0; i < slots.length && remaining > 0; i++) {
    const s = slots[i];
    if (!s || !sameItem(s, item)) continue;
    const count = Math.min(max - s.quantity, remaining);
    slots[i] = { ...s, quantity: s.quantity + count };
    remaining -= count;
  }
  for (let i = 0; i < slots.length && remaining > 0; i++) {
    if (slots[i]) continue;
    const count = Math.min(max, remaining);
    slots[i] = { itemId: item.itemId, rarity: item.rarity, quantity: count };
    remaining -= count;
  }
  return finish(state, slots);
}

/** Host-only equipment operation. Shrinking compacts slots but never drops an item. */
export function changeBackpack(
  state: InventoryState,
  backpack: BackpackId,
  expectedRevision: number,
): InventoryResult {
  const error = check(state, expectedRevision);
  if (error) return fail(state, error);
  if (!known(BACKPACKS, backpack)) return fail(state, 'invalid_backpack');
  const capacity = BACKPACKS[backpack].capacity;
  const occupied = state.slots.filter((s): s is ItemStack => s !== null);
  if (occupied.length > capacity) return fail(state, 'inventory_full');
  const slots = capacity < state.slots.length ? [...occupied] : [...state.slots];
  while (slots.length < capacity) slots.push(null);
  return finish(state, slots, backpack);
}

function sortInventory(state: InventoryState): InventoryResult {
  const stacks = state.slots.filter((s): s is ItemStack => s !== null).map((s) => ({ ...s }));
  // ASCII IDs and numeric ranks give the same order regardless of browser locale.
  stacks.sort(
    (a, b) =>
      RARITIES[b.rarity].rank - RARITIES[a.rarity].rank ||
      (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0),
  );
  const slots: (ItemStack | null)[] = [];
  for (const s of stacks) {
    const last = slots[slots.length - 1];
    if (last && sameItem(last, s)) {
      const take = Math.min(ITEMS[s.itemId].maxStack - last.quantity, s.quantity);
      slots[slots.length - 1] = { ...last, quantity: last.quantity + take };
      s.quantity -= take;
    }
    if (s.quantity > 0) slots.push(s);
  }
  while (slots.length < state.slots.length) slots.push(null);
  return finish(state, slots);
}
