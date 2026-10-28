import type { GroundItemWire, RewardCrateWire } from '../types/loot';
import { MAX_REWARD_CRATES, isRewardCrates, takeShare } from './reward';
import { isGroundItems, placeGround, sweepGround } from './ground';
import type { ItemStack } from '../inventory/inventory';
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
  readonly drops?: readonly GroundItemWire[];
  /** Giao thức 12 (A): thùng thưởng đợt tràn. */
  readonly rewards?: readonly RewardCrateWire[];
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
  private drops: GroundItemWire[] = [];
  private rewards: RewardCrateWire[] = [];

  constructor(
    readonly seed: string,
    restore?: LootSave,
  ) {
    if (!seed.trim() || seed.length > 256) throw new RangeError('Invalid world seed');
    if (restore) {
      if (!isLootSave(restore, seed)) throw new RangeError('Invalid loot save');
      const saved = clone(restore);
      this.revision = saved.revision;
      this.drops = [...(saved.drops ?? [])];
      this.rewards = [...(saved.rewards ?? [])];
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
      ...(this.drops.length ? { drops: this.drops } : {}),
      ...(this.rewards.length ? { rewards: this.rewards } : {}),
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

  /**
   * Host-only (GĐ 3b, A): apply a pure inventory reducer (use an item, reload ammo, broken armour) to one inventory and
   * commit it as one revision. The caller has already authenticated the actor and checked game rules.
   */
  update(
    id: string,
    change: (state: InventoryState) => { ok: boolean; state: InventoryState; error?: string },
  ) {
    const inventory = this.inventories.get(id);
    if (!inventory) return { ok: false, error: 'unknown_player' } as AuthorityResult;
    if (!this.canAdvance()) return { ok: false, error: 'state_limit' } as AuthorityResult;
    const result = change(clone(inventory));
    if (!result.ok) return { ok: false, error: result.error ?? 'invalid_command' } as AuthorityResult;
    this.inventories.set(id, result.state);
    this.revision++;
    return { ok: true, inventory: clone(result.state) } as AuthorityResult;
  }

  /** Store revision (+1 per committed change) — the replication sequence number. */
  currentRevision(): number {
    return this.revision;
  }

  /** Stored chest, or a freshly generated one (NOT stored) if untouched; null for an unknown ID. */
  chest(id: string): ChestState | null {
    const stored = this.chests.get(id);
    if (stored) return clone(stored);
    const location = findChest(this.seed, id);
    return location ? generateChest(this.seed, location.id, location.region) : null;
  }

  /** Read-only `view`: same player/reach/sight checks as `loot`, never stores or advances revision. */
  view(actor: LootActor, chestId: string, visible: (chest: ChestLocation) => boolean): AuthorityResult {
    const inventory = this.inventories.get(actor.id);
    if (!inventory) return { ok: false, error: 'unknown_player' };
    if (!actor.canInteract) return { ok: false, error: 'player_not_up' };
    const location = findChest(this.seed, chestId);
    if (!location) return { ok: false, error: 'unknown_chest' };
    const distance = Math.hypot(actor.x - location.x, actor.y - location.y);
    if (!Number.isFinite(distance) || distance > LOOT_INTERACTION.reach)
      return { ok: false, error: 'out_of_reach' };
    if (!visible(location)) return { ok: false, error: 'blocked' };
    return { ok: true, chest: this.chest(location.id)!, inventory: clone(inventory) };
  }

  groundItems(): readonly GroundItemWire[] {
    return clone(this.drops);
  }
  drop(
    actor: LootActor,
    slot: number,
    quantity: number,
    expectedRevision: number,
    at: { x: number; y: number },
    refund?: ItemStack,
    /** Tick thế giới lúc thả (A, giao thức 11: đồ tự dọn sau GROUND.expireTicks). */
    tick = 0,
  ): AuthorityResult {
    const bag = this.inventory(actor.id);
    if (!bag) return { ok: false, error: 'unknown_player' };
    if (!actor.canInteract) return { ok: false, error: 'player_not_up' };
    if (bag.revision !== expectedRevision) return { ok: false, error: 'stale_revision' };
    if (!Number.isInteger(slot) || slot < 0 || slot >= bag.slots.length)
      return { ok: false, error: 'invalid_slot' };
    const stack = bag.slots[slot];
    if (!stack) return { ok: false, error: 'empty_slot' };
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > stack.quantity)
      return { ok: false, error: 'invalid_quantity' };
    if (!this.canAdvance()) return { ok: false, error: 'state_limit' };
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y) || Math.hypot(at.x - actor.x, at.y - actor.y) > 2)
      return { ok: false, error: 'out_of_reach' };
    // A (giao thức 11): gộp vào đống cùng loại gần đó; chỉ hết chỗ khi cần đống mới mà đã đủ GROUND.max
    const placed = placeGround(this.drops, { ...stack, quantity }, at, tick, 'd' + (this.revision + 1));
    if (!placed) return { ok: false, error: 'state_limit' };
    const slots = [...bag.slots];
    slots[slot] = stack.quantity === quantity ? null : { ...stack, quantity: stack.quantity - quantity };
    let next = { ...bag, slots, revision: bag.revision + 1 };
    if (refund) {
      const r = addItems(next, refund, next.revision);
      if (!r.ok) return { ok: false, error: r.error };
      next = { ...r.state, slots: [...r.state.slots] };
    }
    this.revision++;
    this.inventories.set(actor.id, next);
    this.drops = placed;
    return { ok: true, inventory: clone(next) };
  }
  /**
   * Host-only (A, giao thức 11): đặt đồ xuống đất không qua túi ai (zombie rơi đồ…), gộp như `drop`. false = hết chỗ.
   */
  spawnGround(stack: ItemStack, at: { x: number; y: number }, tick: number): boolean {
    if (!this.canAdvance() || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return false;
    if (!Number.isSafeInteger(tick) || tick < 0) return false;
    const placed = placeGround(this.drops, stack, at, tick, 'd' + (this.revision + 1));
    if (!placed) return false;
    this.drops = placed;
    this.revision++;
    return true;
  }
  /** Host-only (A, giao thức 11): bỏ đồ nằm quá GROUND.expireTicks, gộp đống gần nhau. true = có đổi (revision + 1). */
  sweepGround(tick: number, expireTicks?: number): boolean {
    if (!this.canAdvance()) return false;
    const next = sweepGround(this.drops, tick, expireTicks);
    if (!next) return false;
    this.drops = next;
    this.revision++;
    return true;
  }
  pickup(
    actor: LootActor,
    id: string,
    expectedRevision: number,
    visible: (at: { x: number; y: number }) => boolean,
  ): AuthorityResult {
    const bag = this.inventory(actor.id);
    if (!bag) return { ok: false, error: 'unknown_player' };
    if (!actor.canInteract) return { ok: false, error: 'player_not_up' };
    if (bag.revision !== expectedRevision) return { ok: false, error: 'stale_revision' };
    const i = this.drops.findIndex((d) => d.id === id),
      d = this.drops[i];
    if (!d) return { ok: false, error: 'invalid_item' };
    if (Math.hypot(actor.x - d.x, actor.y - d.y) > 2) return { ok: false, error: 'out_of_reach' };
    if (!visible(d)) return { ok: false, error: 'blocked' };
    if (!this.canAdvance()) return { ok: false, error: 'state_limit' };
    const result = addItems(bag, d.stack as ItemStack, expectedRevision);
    if (!result.ok) return { ok: false, error: result.error };
    this.inventories.set(actor.id, result.state);
    this.drops.splice(i, 1);
    this.revision++;
    return { ok: true, inventory: clone(result.state) };
  }
  rewardCrates(): readonly RewardCrateWire[] {
    return clone(this.rewards);
  }
  /** Host-only (A, giao thức 12): đặt thùng thưởng. false = đã có thùng id này / đủ MAX_REWARD_CRATES / dữ liệu sai. */
  addReward(crate: RewardCrateWire): boolean {
    if (!this.canAdvance() || this.rewards.length >= MAX_REWARD_CRATES) return false;
    if (this.rewards.some((c) => c.id === crate.id) || !isRewardCrates([...this.rewards, crate]))
      return false;
    this.rewards.push(clone(crate));
    this.revision++;
    return true;
  }
  /**
   * Lấy phần của mình trong thùng thưởng (A, giao thức 12): chỉ phần có `owner` = người gửi; món không vừa túi ở lại.
   * Thùng mất khi mọi phần đã rỗng.
   */
  takeReward(
    actor: LootActor,
    crateId: string,
    expectedRevision: number,
    visible: (at: { x: number; y: number }) => boolean,
  ): AuthorityResult {
    const bag = this.inventories.get(actor.id);
    if (!bag) return { ok: false, error: 'unknown_player' };
    if (!actor.canInteract) return { ok: false, error: 'player_not_up' };
    if (bag.revision !== expectedRevision) return { ok: false, error: 'stale_revision' };
    const i = this.rewards.findIndex((c) => c.id === crateId);
    const crate = this.rewards[i];
    if (!crate) return { ok: false, error: 'no_reward' };
    if (Math.hypot(actor.x - crate.x, actor.y - crate.y) > LOOT_INTERACTION.reach)
      return { ok: false, error: 'out_of_reach' };
    if (!visible(crate)) return { ok: false, error: 'blocked' };
    const share = crate.shares.findIndex((s) => s.owner === actor.id);
    if (share < 0 || crate.shares[share]!.slots.every((s) => !s)) return { ok: false, error: 'no_reward' };
    if (!this.canAdvance()) return { ok: false, error: 'state_limit' };
    const r = takeShare(bag, crate.shares[share]!.slots);
    if (r.moved === 0) return { ok: false, error: 'inventory_full' };
    const shares = crate.shares.map((s, k) => (k === share ? { owner: s.owner, slots: r.left } : s));
    if (shares.every((s) => s.slots.every((x) => !x))) this.rewards.splice(i, 1);
    else this.rewards[i] = { ...crate, shares };
    this.inventories.set(actor.id, r.inventory);
    this.revision++;
    return { ok: true, inventory: clone(r.inventory) };
  }
  private canAdvance() {
    return this.revision < Number.MAX_SAFE_INTEGER - 1;
  }
}

export function isLootSave(value: unknown, seed: string): value is LootSave {
  if (!value || typeof value !== 'object') return false;
  const s = value as LootSave;
  if (
    !isGroundItems(s.drops ?? []) ||
    !isRewardCrates(s.rewards ?? []) ||
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
