import { ITEMS, RARITIES } from '../data/items';
import type { GroundItemWire } from '../types/loot';
export function isGroundItems(value: unknown): value is readonly GroundItemWire[] {
  if (!Array.isArray(value) || value.length > 128) return false;
  const ids = new Set<string>();
  return value.every((d) => {
    if (
      !d ||
      typeof d.id !== 'string' ||
      !/^d[1-9][0-9]{0,15}$/.test(d.id) ||
      ids.has(d.id) ||
      !Number.isFinite(d.x) ||
      !Number.isFinite(d.y) ||
      Math.abs(d.x) > 1e8 ||
      Math.abs(d.y) > 1e8
    )
      return false;
    ids.add(d.id);
    const s = d.stack;
    return (
      !!s &&
      Object.hasOwn(ITEMS, s.itemId) &&
      Object.hasOwn(RARITIES, s.rarity) &&
      Number.isSafeInteger(s.quantity) &&
      s.quantity > 0 &&
      s.quantity <= ITEMS[s.itemId as keyof typeof ITEMS].maxStack
    );
  });
}
