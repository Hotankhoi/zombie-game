import { LOOT_INTERACTION } from '../data/lootInteraction';
import {
  addItems,
  applyInventoryCommand,
  createInventory,
  isInventoryState,
  type InventoryCommand,
  type InventoryState,
} from '../inventory/inventory';
import { findChest, type ChestLocation } from '../mapgen/chests';
import { applyLootCommand, generateChest, isChestState, type ChestState, type LootCommand } from './chest';

export interface LootActor {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly canInteract: boolean;
}
export interface LootSave {
  readonly version: 1;
  readonly seed: string;
  readonly revision: number;
  readonly inventories: readonly { id: string; state: InventoryState }[];
  readonly chests: readonly ChestState[];
}
export type AuthorityResult =
  { ok: true; inventory: InventoryState; chest?: ChestState } | { ok: false; error: string };
const clone = <T>(value: T): T => structuredClone(value);

/** Pure authority storage. Caller supplies authenticated actor and authoritative line-of-sight. */
export class LootAuthority {
  private inventories = new Map<string, InventoryState>();
  private chests = new Map<string, ChestState>();
  private revision = 0;

  constructor(
    readonly seed: string,
    restore?: LootSave,
  ) {
    if (!seed.trim() || seed.length > 256) throw new RangeError('Invalid world seed');
    if (restore) {
      if (!isLootSave(restore, seed)) throw new RangeError('Invalid loot save');
      const saved = clone(restore);
      this.revision = saved.revision;
      for (const entry of saved.inventories) this.inventories.set(entry.id, entry.state);
      for (const chest of saved.chests) this.chests.set(chest.id, chest);
    }
  }

  /** Call only after the host admits the player; never implicitly admit a loot packet sender. */
  join(id: string): boolean {
    if (!id || id.length > 255) return false;
    if (this.inventories.has(id)) return true;
    if (this.inventories.size >= LOOT_INTERACTION.maxInventories || !this.canAdvance()) return false;
    const state = createInventory();
    const result = addItems(state, { itemId: 'knife', rarity: 'common', quantity: 1 }, state.revision);
    this.inventories.set(id, result.state);
    this.revision++;
    return true;
  }

  inventory(id: string): InventoryState | null {
    const state = this.inventories.get(id);
    return state ? clone(state) : null;
  }

  /** Full atomic pair state for replication/save, including emptied chests. No cache eviction. */
  snapshot(): LootSave {
    return clone({
      version: 1,
      seed: this.seed,
      revision: this.revision,
      inventories: [...this.inventories].map(([id, state]) => ({ id, state })),
      chests: [...this.chests.values()],
    });
  }

  move(actor: LootActor, command: InventoryCommand): AuthorityResult {
    const inventory = this.inventories.get(actor.id);
    if (!inventory) return { ok: false, error: 'unknown_player' };
    if (!actor.canInteract) return { ok: false, error: 'player_not_up' };
    if (!this.canAdvance()) return { ok: false, error: 'state_limit' };
    const result = applyInventoryCommand(inventory, command);
    if (!result.ok) return { ok: false, error: result.error };
    this.inventories.set(actor.id, result.state);
    this.revision++;
    return { ok: true, inventory: clone(result.state) };
  }

  loot(actor: LootActor, command: LootCommand, visible: (chest: ChestLocation) => boolean): AuthorityResult {
    const inventory = this.inventories.get(actor.id);
    if (!inventory) return { ok: false, error: 'unknown_player' };
    if (!actor.canInteract) return { ok: false, error: 'player_not_up' };
    if (!command || typeof command !== 'object') return { ok: false, error: 'invalid_command' };
    const location = findChest(this.seed, command.chestId);
    if (!location) return { ok: false, error: 'unknown_chest' };
    const distance = Math.hypot(actor.x - location.x, actor.y - location.y);
    if (!Number.isFinite(distance) || distance > LOOT_INTERACTION.reach)
      return { ok: false, error: 'out_of_reach' };
    if (!visible(location)) return { ok: false, error: 'blocked' };
    if (!this.canAdvance()) return { ok: false, error: 'state_limit' };
    const existing = this.chests.get(location.id);
    if (!existing && this.chests.size >= LOOT_INTERACTION.maxChests)
      return { ok: false, error: 'state_limit' };
    const chest = existing ?? generateChest(this.seed, location.id, location.region);
    const result = applyLootCommand(chest, inventory, command);
    if (!result.ok) return { ok: false, error: result.error };
    if (!existing || result.chest !== chest || result.inventory !== inventory) {
      this.chests.set(location.id, result.chest);
      this.inventories.set(actor.id, result.inventory);
      this.revision++;
    }
    return { ok: true, chest: clone(result.chest), inventory: clone(result.inventory) };
  }

  private canAdvance() {
    return this.revision < Number.MAX_SAFE_INTEGER - 1;
  }
}

export function isLootSave(value: unknown, seed: string): value is LootSave {
  if (!value || typeof value !== 'object') return false;
  const s = value as LootSave;
  if (
    s.version !== 1 ||
    s.seed !== seed ||
    !Number.isSafeInteger(s.revision) ||
    s.revision < 0 ||
    s.revision >= Number.MAX_SAFE_INTEGER ||
    !Array.isArray(s.inventories) ||
    !Array.isArray(s.chests) ||
    s.inventories.length > LOOT_INTERACTION.maxInventories ||
    s.chests.length > LOOT_INTERACTION.maxChests
  )
    return false;
  const ids = new Set<string>(),
    chestIds = new Set<string>();
  for (const entry of s.inventories) {
    if (
      !entry ||
      typeof entry.id !== 'string' ||
      !entry.id ||
      entry.id.length > 255 ||
      ids.has(entry.id) ||
      !isInventoryState(entry.state)
    )
      return false;
    ids.add(entry.id);
  }
  for (const chest of s.chests) {
    if (!isChestState(chest) || chestIds.has(chest.id)) return false;
    const location = findChest(seed, chest.id);
    if (!location || location.region !== chest.region) return false;
    chestIds.add(chest.id);
  }
  return true;
}
