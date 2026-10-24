import { ITEMS, RARITIES } from '../data/items';
import { LOOT_REGIONS, LOOT_STACK_COUNT, type LootRegion } from '../data/loot';
import {
  addItems,
  isInventoryState,
  type InventoryError,
  type InventoryState,
  type ItemStack,
} from '../inventory/inventory';
import { Rng } from '../util/rng';

export const LOOT_VERSION = 1;
export const CHEST_SLOTS = 6;
export interface ChestState {
  readonly version: typeof LOOT_VERSION;
  readonly id: string;
  readonly region: LootRegion;
  readonly revision: number;
  readonly opened: boolean;
  readonly slots: readonly (ItemStack | null)[];
}
interface LootIntent {
  readonly chestId: string;
  readonly expectedChestRevision: number;
  readonly expectedInventoryRevision: number;
}
export type LootCommand = LootIntent &
  ({ type: 'open' } | { type: 'take'; slot: number; quantity: number } | { type: 'takeAll' });
export type LootError = InventoryError | 'invalid_chest' | 'wrong_chest' | 'chest_closed' | 'empty_chest';
export type LootResult =
  | { ok: true; chest: ChestState; inventory: InventoryState }
  | { ok: false; chest: ChestState; inventory: InventoryState; error: LootError };

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
const known = <T extends object>(table: T, key: unknown): key is keyof T =>
  typeof key === 'string' && Object.hasOwn(table, key);
const textId = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;

/** Reject invalid wire/save snapshots before rendering or applying an intent. */
export function isChestState(value: unknown): value is ChestState {
  if (
    !record(value) ||
    value.version !== LOOT_VERSION ||
    !textId(value.id, 128) ||
    !known(LOOT_REGIONS, value.region) ||
    !integer(value.revision) ||
    value.revision < 0 ||
    value.revision >= Number.MAX_SAFE_INTEGER ||
    typeof value.opened !== 'boolean' ||
    !Array.isArray(value.slots) ||
    value.slots.length !== CHEST_SLOTS
  )
    return false;
  return Array.from(value.slots).every(
    (slot: unknown) =>
      slot === null ||
      (record(slot) &&
        known(ITEMS, slot.itemId) &&
        known(RARITIES, slot.rarity) &&
        integer(slot.quantity) &&
        slot.quantity > 0 &&
        slot.quantity <= ITEMS[slot.itemId].maxStack),
  );
}

function weighted<T extends { readonly weight: number }>(rng: Rng, entries: readonly T[]): T {
  let roll = rng.int(
    1,
    entries.reduce((sum, entry) => sum + entry.weight, 0),
  );
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) return entry;
  }
  throw new Error('Invalid loot weights');
}

/** Generate once on the host using a stable world chest ID, then retain this snapshot. */
export function generateChest(seed: string, id: string, region: LootRegion): ChestState {
  if (!textId(seed, 256) || !textId(id, 128) || !known(LOOT_REGIONS, region))
    throw new RangeError('Invalid loot seed, chest ID or region');
  // Tuple encoding avoids ambiguous concatenation; each chest is independent of visit order.
  const rng = new Rng(JSON.stringify([LOOT_VERSION, seed, id, region]));
  const table = LOOT_REGIONS[region];
  const count = rng.int(LOOT_STACK_COUNT.min, LOOT_STACK_COUNT.max);
  const slots: (ItemStack | null)[] = Array<null>(CHEST_SLOTS).fill(null);
  for (let i = 0; i < count; i++) {
    const item = weighted<(typeof table.entries)[number]>(rng, table.entries);
    const { rarity } = weighted<(typeof table.rarities)[number]>(rng, table.rarities);
    slots[i] = { itemId: item.itemId, rarity, quantity: rng.int(item.min, item.max) };
  }
  return { version: LOOT_VERSION, id, region, revision: 0, opened: false, slots };
}

/**
 * Pure host-side transaction: publish BOTH resulting snapshots together, or neither.
 * The caller must serialize requests and verify player ownership, distance and alive status.
 * Clients submit only an intent; never accept a client-supplied chest or inventory as authority.
 */
export function applyLootCommand(
  chest: ChestState,
  inventory: InventoryState,
  command: LootCommand,
): LootResult {
  const fail = (error: LootError): LootResult => ({ ok: false, chest, inventory, error });
  if (!isChestState(chest)) return fail('invalid_chest');
  if (!isInventoryState(inventory)) return fail('invalid_state');
  if (
    !record(command) ||
    !['open', 'take', 'takeAll'].includes(command.type) ||
    !textId(command.chestId, 128) ||
    !integer(command.expectedChestRevision) ||
    command.expectedChestRevision < 0 ||
    !integer(command.expectedInventoryRevision) ||
    command.expectedInventoryRevision < 0
  )
    return fail('invalid_command');
  if (command.chestId !== chest.id) return fail('wrong_chest');
  if (
    command.expectedChestRevision !== chest.revision ||
    command.expectedInventoryRevision !== inventory.revision
  )
    return fail('stale_revision');

  if (command.type === 'open' && chest.opened) return { ok: true, chest, inventory };
  if (chest.revision >= Number.MAX_SAFE_INTEGER - 1) return fail('invalid_chest');
  if (command.type === 'open')
    return { ok: true, chest: { ...chest, revision: chest.revision + 1, opened: true }, inventory };
  if (!chest.opened) return fail('chest_closed');
  if (inventory.revision >= Number.MAX_SAFE_INTEGER - 1) return fail('invalid_state');

  let nextInventory = inventory;
  const slots = [...chest.slots];
  if (command.type === 'take') {
    const { slot, quantity } = command;
    if (!integer(slot) || slot < 0 || slot >= CHEST_SLOTS) return fail('invalid_slot');
    const source = slots[slot];
    if (!source) return fail('empty_slot');
    if (!integer(quantity) || quantity <= 0 || quantity > source.quantity) return fail('invalid_quantity');
    const result = addItems(inventory, { ...source, quantity }, inventory.revision);
    if (!result.ok) return fail(result.error);
    nextInventory = result.state;
    slots[slot] = quantity === source.quantity ? null : { ...source, quantity: source.quantity - quantity };
  } else {
    if (!slots.some((slot) => slot !== null)) return fail('empty_chest');
    for (let i = 0; i < slots.length; i++) {
      const item = slots[i];
      if (!item) continue;
      // Provisional grants share the original revision. Only the atomic batch advances it,
      // so even a near-limit revision can transfer six stacks without intermediate overflow.
      const provisional = { ...nextInventory, revision: inventory.revision };
      const result = addItems(provisional, item, inventory.revision);
      if (!result.ok) return fail(result.error);
      nextInventory = result.state;
      slots[i] = null;
    }
  }
  return {
    ok: true,
    chest: { ...chest, revision: chest.revision + 1, slots },
    inventory: nextInventory,
  };
}
