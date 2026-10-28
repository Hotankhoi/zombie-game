import { describe, expect, it, vi } from 'vitest';
import { ITEMS, RARITIES, type ItemId, type Rarity } from '../data/items';
import { LOOT_REGIONS, type LootRegion } from '../data/loot';
import {
  addItems,
  applyInventoryCommand,
  createInventory,
  isInventoryState,
  type InventoryState,
  type ItemStack,
} from '../inventory/inventory';
import { Rng } from '../util/rng';
import {
  CHEST_SLOTS,
  LOOT_VERSION,
  applyLootCommand,
  generateChest,
  isChestState,
  type ChestState,
  type LootCommand,
  type LootError,
  type LootResult,
} from './chest';

const regions = Object.keys(LOOT_REGIONS) as LootRegion[];
const bandage = (quantity: number, rarity: Rarity = 'common'): ItemStack => ({
  itemId: 'bandage',
  rarity,
  quantity,
});
const knife: ItemStack = { itemId: 'knife', rarity: 'common', quantity: 1 };
function chestWith(items: ItemStack[], opened = true): ChestState {
  return {
    ...generateChest('test-world', 'building:3/chest:0', 'hospital'),
    opened,
    slots: [...items, ...Array<null>(CHEST_SLOTS - items.length).fill(null)],
  };
}
function base(chest: ChestState, inventory: InventoryState) {
  return {
    chestId: chest.id,
    expectedChestRevision: chest.revision,
    expectedInventoryRevision: inventory.revision,
  };
}
function take(chest: ChestState, inventory: InventoryState, slot: number, quantity: number) {
  return applyLootCommand(chest, inventory, { ...base(chest, inventory), type: 'take', slot, quantity });
}
function takeAll(chest: ChestState, inventory: InventoryState) {
  return applyLootCommand(chest, inventory, { ...base(chest, inventory), type: 'takeAll' });
}
function success(result: LootResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result;
}
function failure(result: LootResult, chest: ChestState, inventory: InventoryState, error?: LootError) {
  expect(result.ok).toBe(false);
  if (error) expect(result).toMatchObject({ error });
  expect(result.chest).toBe(chest);
  expect(result.inventory).toBe(inventory);
}
function grant(inventory: InventoryState, item: ItemStack) {
  const result = addItems(inventory, item, inventory.revision);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}
function totals(...states: { slots: readonly (ItemStack | null)[] }[]) {
  const result: Record<string, number> = {};
  for (const state of states) {
    for (const item of state.slots) {
      if (!item) continue;
      const key = `${item.itemId}:${item.rarity}`;
      result[key] = (result[key] ?? 0) + item.quantity;
    }
  }
  return result;
}
function freeze<T extends { slots: readonly (ItemStack | null)[] }>(state: T): T {
  for (const slot of state.slots) if (slot) Object.freeze(slot);
  Object.freeze(state.slots);
  return Object.freeze(state);
}

describe('deterministic chest generation', () => {
  it('keeps the version 2 contents stable for a known world and chest', () => {
    expect(generateChest('world:2026', 'building:7/chest:2', 'military')).toMatchInlineSnapshot(`
      {
        "id": "building:7/chest:2",
        "opened": false,
        "region": "military",
        "revision": 0,
        "slots": [
          {
            "itemId": "pants",
            "quantity": 1,
            "rarity": "epic",
          },
          {
            "itemId": "pants",
            "quantity": 1,
            "rarity": "uncommon",
          },
          {
            "itemId": "vest",
            "quantity": 1,
            "rarity": "common",
          },
          {
            "itemId": "pistol",
            "quantity": 1,
            "rarity": "rare",
          },
          {
            "itemId": "rifle",
            "quantity": 1,
            "rarity": "rare",
          },
          {
            "itemId": "helmet",
            "quantity": 1,
            "rarity": "uncommon",
          },
        ],
        "version": 2,
      }
    `);
  });
  it('produces the same independent snapshots without depending on random, clock, or generation order', () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Global random used');
    });
    const now = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Clock used');
    });
    try {
      const first = generateChest('world:2026', 'building:7/chest:2', 'military');
      for (const region of [...regions].reverse()) generateChest('other-world', region, region);
      const again = generateChest('world:2026', 'building:7/chest:2', 'military');
      expect(again).toEqual(first);
      expect(again).not.toBe(first);
      expect(again.slots).not.toBe(first.slots);
      expect(first.version).toBe(LOOT_VERSION);
      expect(first.revision).toBe(0);
      expect(first.opened).toBe(false);
      expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    } finally {
      random.mockRestore();
      now.mockRestore();
    }
  });
  it('scopes contents by seed, stable chest ID and region', () => {
    const contents = new Set<string>();
    for (let i = 0; i < 40; i++) {
      contents.add(JSON.stringify(generateChest(`world:${i}`, 'fixed-chest', 'residential').slots));
      contents.add(JSON.stringify(generateChest('fixed-world', `chest:${i}`, 'residential').slots));
    }
    expect(contents.size).toBeGreaterThan(60);
    expect(generateChest('a:b', 'c', 'market').slots).not.toEqual(generateChest('a', 'b:c', 'market').slots);
    expect(generateChest('world', 'chest', 'market').slots).not.toEqual(
      generateChest('world', 'chest', 'hospital').slots,
    );
  });
  it('generates valid bounded stacks using the area tables across 2500 chests', () => {
    for (const region of regions) {
      const definition = LOOT_REGIONS[region];
      for (let i = 0; i < 500; i++) {
        const chest = generateChest(`validation-world:${i % 7}`, `chest:${i}`, region);
        expect(isChestState(chest)).toBe(true);
        expect(chest.slots).toHaveLength(CHEST_SLOTS);
        expect(chest.slots.filter(Boolean).length).toBeGreaterThanOrEqual(3);
        expect(chest.slots.filter(Boolean).length).toBeLessThanOrEqual(6);
        for (const slot of chest.slots) {
          if (!slot) continue;
          const entry = definition.entries.find((entry) => entry.itemId === slot.itemId);
          expect(entry).toBeDefined();
          expect(slot.quantity).toBeGreaterThanOrEqual(entry!.min);
          expect(slot.quantity).toBeLessThanOrEqual(entry!.max);
          expect(slot.quantity).toBeLessThanOrEqual(ITEMS[slot.itemId].maxStack);
          expect(definition.rarities.some((entry) => entry.rarity === slot.rarity && entry.weight > 0)).toBe(
            true,
          );
        }
      }
    }
  });
  it('gives each area its intended supplies and better rare finds in military caches', () => {
    const counts = new Map<LootRegion, { total: number; specialty: number; highRarity: number }>();
    for (const region of regions) {
      const count = { total: 0, specialty: 0, highRarity: 0 };
      for (let i = 0; i < 500; i++) {
        for (const slot of generateChest('area-bias-v1', `chest:${i}`, region).slots) {
          if (!slot) continue;
          count.total++;
          const category = ITEMS[slot.itemId].category;
          if (
            (region === 'hospital' && category === 'medical') ||
            (region === 'market' && category === 'food') ||
            (region === 'police' && (category === 'weapon' || category === 'ammo'))
          )
            count.specialty++;
          if (RARITIES[slot.rarity].rank >= RARITIES.epic.rank) count.highRarity++;
        }
      }
      counts.set(region, count);
    }
    for (const region of ['hospital', 'market', 'police'] as const) {
      const count = counts.get(region)!;
      expect(count.specialty / count.total).toBeGreaterThan(0.5);
    }
    const military = counts.get('military')!,
      residential = counts.get('residential')!;
    expect(military.highRarity / military.total).toBeGreaterThan(residential.highRarity / residential.total);
  });
  it('rejects ambiguous or unsupported generation inputs', () => {
    for (const seed of ['', '   ', 's'.repeat(257), 123, null, undefined])
      expect(() => generateChest(seed as string, 'chest', 'market')).toThrow(RangeError);
    for (const id of ['', '\n', 'i'.repeat(129), 123, null, undefined])
      expect(() => generateChest('world', id as string, 'market')).toThrow(RangeError);
    for (const region of ['__proto__', 'constructor', 'unknown', null])
      expect(() => generateChest('world', 'chest', region as LootRegion)).toThrow(RangeError);
  });
});

describe('authoritative chest transactions', () => {
  it('opens once without changing contents or inventory, then reopens without rerolling', () => {
    const chest = chestWith([bandage(7)], false),
      inventory = createInventory();
    const command: LootCommand = { ...base(chest, inventory), type: 'open' };
    const opened = success(applyLootCommand(chest, inventory, command));
    expect(opened.chest.opened).toBe(true);
    expect(opened.chest.revision).toBe(chest.revision + 1);
    expect(opened.chest.slots).toEqual(chest.slots);
    expect(opened.inventory).toBe(inventory);
    failure(applyLootCommand(opened.chest, inventory, command), opened.chest, inventory, 'stale_revision');
    const reopened = success(
      applyLootCommand(opened.chest, inventory, { ...base(opened.chest, inventory), type: 'open' }),
    );
    expect(reopened.chest).toBe(opened.chest);
    expect(reopened.inventory).toBe(inventory);
  });
  it('requires opening before either transfer operation', () => {
    const chest = chestWith([bandage(2)], false),
      inventory = createInventory();
    failure(take(chest, inventory, 0, 1), chest, inventory, 'chest_closed');
    failure(takeAll(chest, inventory), chest, inventory, 'chest_closed');
  });
  it('partially takes into an existing stack, then clears the chest slot on the final take', () => {
    const chest = chestWith([bandage(7)]),
      inventory = grant(createInventory(), bandage(8));
    const initial = totals(chest, inventory);
    const partial = success(take(chest, inventory, 0, 4));
    expect(partial.chest.slots[0]).toEqual(bandage(3));
    expect(partial.inventory.slots.slice(0, 2)).toEqual([bandage(10), bandage(2)]);
    expect(partial.chest.revision).toBe(chest.revision + 1);
    expect(partial.inventory.revision).toBe(inventory.revision + 1);
    expect(totals(partial.chest, partial.inventory)).toEqual(initial);
    const rest = success(take(partial.chest, partial.inventory, 0, 3));
    expect(rest.chest.slots[0]).toBeNull();
    expect(totals(rest.chest, rest.inventory)).toEqual(initial);
  });
  it('takes all stacks as one revision while preserving separate rarities', () => {
    const chest = chestWith([bandage(7), bandage(3, 'rare'), knife]);
    const inventory = grant(createInventory(), bandage(5));
    const result = success(takeAll(chest, inventory));
    expect(result.chest.slots.every((slot) => slot === null)).toBe(true);
    expect(result.chest.revision).toBe(chest.revision + 1);
    expect(result.inventory.revision).toBe(inventory.revision + 1);
    expect(totals(result.chest, result.inventory)).toEqual(totals(chest, inventory));
  });
  it('keeps emptied chests empty after serialization and reopening', () => {
    const empty = success(takeAll(chestWith([knife]), createInventory()));
    const chest = JSON.parse(JSON.stringify(empty.chest)) as ChestState;
    const reopened = success(
      applyLootCommand(chest, empty.inventory, { ...base(chest, empty.inventory), type: 'open' }),
    );
    expect(reopened.chest).toBe(chest);
    expect(chest.slots.every((slot) => slot === null)).toBe(true);
    failure(takeAll(chest, empty.inventory), chest, empty.inventory, 'empty_chest');
  });
  it('rejects an entire requested stack when only part fits, while permitting a smaller take', () => {
    const chest = chestWith([bandage(3)]),
      inventory = grant(createInventory(), bandage(119));
    failure(take(chest, inventory, 0, 2), chest, inventory, 'inventory_full');
    const partial = success(take(chest, inventory, 0, 1));
    expect(partial.chest.slots[0]).toEqual(bandage(2));
    expect(totals(partial.inventory)).toEqual({ 'bandage:common': 120 });
  });
  it('rolls back every stack when takeAll runs out of space after an earlier stack fits', () => {
    const chest = chestWith([bandage(1), knife]),
      inventory = grant(createInventory(), bandage(119));
    failure(takeAll(chest, inventory), chest, inventory, 'inventory_full');
    expect(totals(chest, inventory)).toEqual({ 'bandage:common': 120, 'knife:common': 1 });
  });
  it('rejects duplicate intents and two players racing for the same shared chest', () => {
    const chest = chestWith([knife]),
      firstBag = createInventory(),
      secondBag = createInventory();
    const command: LootCommand = { ...base(chest, firstBag), type: 'takeAll' };
    const first = success(applyLootCommand(chest, firstBag, command));
    failure(
      applyLootCommand(first.chest, first.inventory, command),
      first.chest,
      first.inventory,
      'stale_revision',
    );
    failure(applyLootCommand(first.chest, secondBag, command), first.chest, secondBag, 'stale_revision');
    expect(totals(first.chest, first.inventory, secondBag)).toEqual({ 'knife:common': 1 });
  });
  it('checks both chest and inventory revisions and the intended chest ID', () => {
    const chest = chestWith([knife]),
      inventory = createInventory();
    const command: LootCommand = { ...base(chest, inventory), type: 'takeAll' };
    for (const override of [{ expectedChestRevision: 1 }, { expectedInventoryRevision: 1 }])
      failure(
        applyLootCommand(chest, inventory, { ...command, ...override }),
        chest,
        inventory,
        'stale_revision',
      );
    failure(
      applyLootCommand(chest, inventory, { ...command, chestId: 'other-chest' }),
      chest,
      inventory,
      'wrong_chest',
    );
  });
  it.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 8])(
    'rejects invalid take quantity %s',
    (quantity) => {
      const chest = chestWith([bandage(7)]),
        inventory = createInventory();
      failure(take(chest, inventory, 0, quantity), chest, inventory, 'invalid_quantity');
    },
  );
  it.each([-1, CHEST_SLOTS, 0.5, NaN, Infinity])('rejects invalid chest slot %s', (slot) => {
    const chest = chestWith([bandage(7)]),
      inventory = createInventory();
    failure(take(chest, inventory, slot, 1), chest, inventory, 'invalid_slot');
  });
  it('rejects empty slots and malformed commands without changing state', () => {
    const chest = chestWith([bandage(7)]),
      inventory = createInventory();
    failure(take(chest, inventory, 5, 1), chest, inventory, 'empty_slot');
    for (const command of [null, [], {}, { ...base(chest, inventory), type: 'grant' }])
      failure(
        applyLootCommand(chest, inventory, command as LootCommand),
        chest,
        inventory,
        'invalid_command',
      );
    for (const revision of [undefined, '0', -1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      for (const key of ['expectedChestRevision', 'expectedInventoryRevision']) {
        const command = { ...base(chest, inventory), type: 'takeAll', [key]: revision } as LootCommand;
        failure(applyLootCommand(chest, inventory, command), chest, inventory, 'invalid_command');
      }
    }
  });
  it('rejects malformed snapshots, sparse arrays and unknown catalogue keys', () => {
    const valid = chestWith([bandage(7)]),
      inventory = createInventory();
    const invalid: unknown[] = [
      null,
      [],
      {},
      { ...valid, version: LOOT_VERSION + 1 },
      { ...valid, opened: 1 },
      { ...valid, id: '' },
      { ...valid, id: ' ' },
      { ...valid, id: 'x'.repeat(129) },
      { ...valid, region: '__proto__' },
      { ...valid, region: 'constructor' },
      { ...valid, revision: -1 },
      { ...valid, revision: NaN },
      { ...valid, revision: Number.MAX_SAFE_INTEGER },
      { ...valid, slots: new Array(CHEST_SLOTS) },
      { ...valid, slots: valid.slots.slice(1) },
      ...[
        bandage(0),
        bandage(11),
        bandage(1.5),
        { ...knife, quantity: 2 },
        { ...knife, itemId: '__proto__' as ItemId },
        { ...knife, rarity: 'constructor' as Rarity },
        undefined,
      ].map((slot) => ({ ...valid, slots: [slot, ...valid.slots.slice(1)] })),
    ];
    for (const value of invalid) {
      expect(isChestState(value)).toBe(false);
      const chest = value as ChestState;
      failure(
        applyLootCommand(chest, inventory, { ...base(valid, inventory), type: 'takeAll' }),
        chest,
        inventory,
        'invalid_chest',
      );
    }
    const badBag = { ...inventory, slots: new Array(12) } as InventoryState;
    failure(takeAll(valid, badBag), valid, badBag, 'invalid_state');
  });
  it('rejects revision overflow but permits read-only reopening at the limit', () => {
    const limit = Number.MAX_SAFE_INTEGER - 1;
    const chest = chestWith([knife]),
      inventory = createInventory();
    const oldChest = { ...chest, revision: limit },
      oldBag = { ...inventory, revision: limit };
    expect(isChestState(oldChest)).toBe(true);
    failure(takeAll(oldChest, inventory), oldChest, inventory, 'invalid_chest');
    failure(takeAll(chest, oldBag), chest, oldBag, 'invalid_state');
    const reopened = success(applyLootCommand(oldChest, oldBag, { ...base(oldChest, oldBag), type: 'open' }));
    expect(reopened.chest).toBe(oldChest);
    expect(reopened.inventory).toBe(oldBag);
    const nearLimit = { ...inventory, revision: limit - 1 };
    const batch = success(takeAll(chestWith([knife, bandage(1), bandage(1, 'rare')]), nearLimit));
    expect(batch.inventory.revision).toBe(limit);
    expect(isInventoryState(batch.inventory)).toBe(true);
  });
  it('never mutates frozen caller-owned snapshots during success or failure', () => {
    const chest = freeze(chestWith([bandage(7), knife])),
      inventory = freeze(createInventory());
    success(take(chest, inventory, 0, 4));
    success(takeAll(chest, inventory));
    const full = freeze(grant(createInventory(), bandage(120)));
    failure(takeAll(chest, full), chest, full, 'inventory_full');
    expect(chest.slots.slice(0, 2)).toEqual([bandage(7), knife]);
    expect(inventory.slots.every((slot) => slot === null)).toBe(true);
  });
  it('conserves all items across mixed transfers, sorting, rejected replays and serialization', () => {
    const rng = new Rng('loot-conservation-v1');
    let inventory = createInventory('expedition');
    let chests = Array.from({ length: 15 }, (_, i) => ({
      ...generateChest('loot-conservation-world', `cache:${i}`, regions[i % regions.length]!),
      opened: true,
    }));
    const initial = totals(inventory, ...chests);
    let transfers = 0,
      rejected = 0;
    for (let i = 0; i < 1000; i++) {
      if (i % 7 === 0) {
        const sorted = applyInventoryCommand(inventory, {
          type: 'sort',
          expectedRevision: inventory.revision,
        });
        if (!sorted.ok) throw new Error(sorted.error);
        inventory = sorted.state;
      } else {
        const index = rng.int(0, chests.length - 1),
          chest = chests[index]!;
        const slot = rng.int(0, CHEST_SLOTS - 1);
        const command: LootCommand =
          i % 5 === 0
            ? { ...base(chest, inventory), type: 'takeAll' }
            : {
                ...base(chest, inventory),
                type: 'take',
                slot,
                quantity: rng.int(1, chest.slots[slot]?.quantity ?? 1),
              };
        const result = applyLootCommand(chest, inventory, command);
        if (result.ok) {
          transfers++;
          chests[index] = result.chest;
          inventory = result.inventory;
          failure(
            applyLootCommand(result.chest, inventory, command),
            result.chest,
            inventory,
            'stale_revision',
          );
        } else {
          rejected++;
          failure(result, chest, inventory);
        }
      }
      expect(isInventoryState(inventory)).toBe(true);
      expect(chests.every(isChestState)).toBe(true);
      expect(totals(inventory, ...chests)).toEqual(initial);
      if (i % 50 === 0) {
        inventory = JSON.parse(JSON.stringify(inventory)) as InventoryState;
        chests = JSON.parse(JSON.stringify(chests)) as ChestState[];
      }
    }
    expect(transfers).toBeGreaterThan(5);
    expect(rejected).toBeGreaterThan(100);
  });
});
