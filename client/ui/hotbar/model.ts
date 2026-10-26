import type { InventoryState, ItemStack } from '@shared/inventory/inventory';
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
