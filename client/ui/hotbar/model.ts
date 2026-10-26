import type { InventoryState, ItemStack } from '@shared/inventory/inventory';
import { ITEMS, type Rarity } from '@shared/data/items';
export const HOTBAR_SIZE = 5;
export type Binding = Pick<ItemStack, 'itemId' | 'rarity'>;
export function resolveBinding(
  inventory: InventoryState | null,
  binding: Binding | null,
): { slot: number; quantity: number } | null {
  if (!inventory || !binding) return null;
  const slot = inventory.slots.findIndex((s) => s?.itemId === binding.itemId && s.rarity === binding.rarity);
  if (slot < 0) return null;
  return {
    slot,
    quantity: inventory.slots.reduce(
      (n, s) => n + (s?.itemId === binding.itemId && s.rarity === binding.rarity ? s.quantity : 0),
      0,
    ),
  };
}
export function nextSlot(current: number, direction: number): number {
  return (current + Math.sign(direction) + HOTBAR_SIZE) % HOTBAR_SIZE;
}

/** Follow equipment changed outside the bar too (inventory action, X, migration). */
export function selectedForWeapon(
  bindings: readonly (Binding | null)[],
  current: number,
  weapon: string,
  rarity: Rarity,
): number {
  const currentBinding = bindings[current];
  if (weapon === 'fists')
    return !currentBinding || ITEMS[currentBinding.itemId].category !== 'weapon' ? current : -1;
  if (currentBinding?.itemId === weapon && currentBinding.rarity === rarity) return current;
  return bindings.findIndex((b) => b?.itemId === weapon && b.rarity === rarity);
}
