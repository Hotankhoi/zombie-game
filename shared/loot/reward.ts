import { HORDE_REWARD } from '../data/reward';
import { LOOT_INTERACTION } from '../data/lootInteraction';
import { ITEMS, RARITIES, type ItemId } from '../data/items';
import { addItems, type InventoryState, type ItemStack } from '../inventory/inventory';
import type { LootStackWire, RewardCrateWire } from '../types/loot';
import { Rng, hashString } from '../util/rng';

/** Tối đa bấy nhiêu thùng thưởng cùng lúc (thùng cũ không ai lấy vẫn nằm đó) và bấy nhiêu ô mỗi phần. */
export const MAX_REWARD_CRATES = 16;
export const MAX_SHARE_SLOTS = 8;

export const rewardCrateId = (horde: number): string => 'r' + horde;

/** Phần thưởng của `owner` ở đợt `horde` (A, giao thức 12). Tất định theo (seed, đợt, ownerId). */
export function rollRewardShare(seed: string, horde: number, owner: string): ItemStack[] {
  const rng = new Rng(hashString(`horde-reward:${seed}:${horde}:${owner}`));
  const total = HORDE_REWARD.main.reduce((n, e) => n + e.weight, 0);
  let roll = rng.next() * total;
  let main: ItemId = HORDE_REWARD.main[0]!.item;
  for (const e of HORDE_REWARD.main) {
    roll -= e.weight;
    if (roll < 0) {
      main = e.item;
      break;
    }
  }
  const ammo: ItemStack =
    main === 'rifle'
      ? { itemId: 'rifle_ammo', rarity: 'common', quantity: HORDE_REWARD.ammo.rifle }
      : { itemId: 'pistol_ammo', rarity: 'common', quantity: HORDE_REWARD.ammo.pistol };
  return [{ itemId: main, rarity: HORDE_REWARD.rarity, quantity: 1 }, ammo, ...HORDE_REWARD.extras];
}

/**
 * Lấy phần của mình: cho vào túi từng món theo thứ tự, món không vừa túi ở lại thùng. `moved` = 0 → túi đầy.
 */
export function takeShare(
  inventory: InventoryState,
  slots: readonly (LootStackWire | null)[],
): { inventory: InventoryState; left: (LootStackWire | null)[]; moved: number } {
  let inv = inventory;
  let moved = 0;
  const left = slots.map((s) => {
    if (!s) return null;
    const r = addItems(inv, s as ItemStack, inv.revision);
    if (!r.ok) return s;
    inv = r.state;
    moved++;
    return null;
  });
  return { inventory: inv, left, moved };
}

export function isRewardCrates(value: unknown): value is readonly RewardCrateWire[] {
  if (!Array.isArray(value) || value.length > MAX_REWARD_CRATES) return false;
  const ids = new Set<string>();
  return value.every((c: RewardCrateWire) => {
    if (
      !c ||
      !Number.isSafeInteger(c.horde) ||
      c.horde < 1 ||
      c.id !== rewardCrateId(c.horde) ||
      ids.has(c.id) ||
      !Number.isFinite(c.x) ||
      !Number.isFinite(c.y) ||
      Math.abs(c.x) > 1e8 ||
      Math.abs(c.y) > 1e8 ||
      !Array.isArray(c.shares) ||
      c.shares.length < 1 ||
      c.shares.length > LOOT_INTERACTION.maxInventories
    )
      return false;
    ids.add(c.id);
    const owners = new Set<string>();
    return c.shares.every((s) => {
      if (!s || typeof s.owner !== 'string' || !s.owner || s.owner.length > 255 || owners.has(s.owner))
        return false;
      owners.add(s.owner);
      return (
        Array.isArray(s.slots) &&
        s.slots.length <= MAX_SHARE_SLOTS &&
        s.slots.every(
          (x: LootStackWire | null) =>
            x === null ||
            (!!x &&
              Object.hasOwn(ITEMS, x.itemId) &&
              Object.hasOwn(RARITIES, x.rarity) &&
              Number.isSafeInteger(x.quantity) &&
              x.quantity > 0 &&
              x.quantity <= ITEMS[x.itemId as ItemId].maxStack),
        )
      );
    });
  });
}
