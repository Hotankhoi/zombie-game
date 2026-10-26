import { CONSUMABLES } from '@shared/data/consumables';
import { ITEMS, RARITIES, type ItemId } from '@shared/data/items';
import { PLAYER } from '@shared/data/player';
import type { InventoryState } from '@shared/inventory/inventory';
import type { PlayerState } from '@shared/sim/player';
import type { PeerId } from '@shared/types';

/**
 * Thanh dùng nhanh (GĐ 3b): phím 1 băng gạc · 2 bộ sơ cứu · 3 kháng sinh · 4 ăn/uống (cái đang thấp hơn).
 * Thuần (không DOM) để test được; LootUi gửi `ClientLoot.use(slot, target)`.
 */
export const QUICK_KEYS = [1, 2, 3, 4] as const;
export type QuickKey = (typeof QUICK_KEYS)[number];

export const QUICK_LABELS: Record<QuickKey, string> = {
  1: 'Băng gạc',
  2: 'Sơ cứu',
  3: 'Kháng sinh',
  4: 'Ăn/uống',
};

/** Đồng đội máy mình thấy (nội suy từ snapshot). */
export interface Mate {
  id: PeerId;
  x: number;
  y: number;
  hp: number;
  alive: boolean;
  downedFor: number;
}

export type QuickPick = { slot: number; itemId: ItemId; target: PeerId | null } | { error: string };

/** Ô có món này, ưu tiên độ hiếm thấp (để dành đồ tốt). -1 = không có. */
export function findSlot(inv: InventoryState, itemId: ItemId): number {
  let best = -1;
  inv.slots.forEach((s, i) => {
    if (s?.itemId !== itemId) return;
    const b = best >= 0 ? inv.slots[best]! : null;
    if (!b || RARITIES[s.rarity].rank < RARITIES[b.rarity].rank) best = i;
  });
  return best;
}

/** Tổng số món (mọi độ hiếm) — HUD thanh dùng nhanh. */
export function countOf(inv: InventoryState | null, itemId: ItemId): number {
  return (inv?.slots ?? []).reduce((n, s) => n + (s?.itemId === itemId ? s.quantity : 0), 0);
}

/** Món của phím `key` (phím 4: cái nào đang thấp hơn, thiếu thì cái còn lại). */
export function quickItem(key: QuickKey, me: PlayerState, inv: InventoryState | null): ItemId {
  if (key === 1) return 'bandage';
  if (key === 2) return 'medkit';
  if (key === 3) return 'antibiotics';
  const drink = me.water <= me.food;
  const first: ItemId = drink ? 'water' : 'canned_food';
  const second: ItemId = drink ? 'canned_food' : 'water';
  return countOf(inv, first) > 0 || countOf(inv, second) === 0 ? first : second;
}

/**
 * Chọn ô + mục tiêu cho phím dùng nhanh. Băng gạc: đồng đội đang gục trong tầm → mình đang bị thương → đồng đội bị
 * thương trong tầm (gần nhất trước).
 */
export function pickQuickUse(
  key: QuickKey,
  me: PlayerState,
  inv: InventoryState | null,
  mates: readonly Mate[],
): QuickPick {
  if (!inv) return { error: 'Chưa có túi đồ.' };
  const itemId = quickItem(key, me, inv);
  const slot = findSlot(inv, itemId);
  if (slot < 0) return { error: `Không còn ${ITEMS[itemId].name.toLowerCase()} trong túi.` };
  if (itemId !== 'bandage') return { slot, itemId, target: null };
  const range = CONSUMABLES.bandage?.allyRange ?? 0;
  const near = mates
    .filter((m) => m.alive && Math.hypot(m.x - me.x, m.y - me.y) <= range)
    .sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y));
  const downed = near.find((m) => m.downedFor > 0);
  if (downed) return { slot, itemId, target: downed.id };
  if (me.hp < me.maxHp - 0.5) return { slot, itemId, target: null };
  const hurt = near.find((m) => m.hp < PLAYER.maxHp - 0.5);
  if (hurt) return { slot, itemId, target: hurt.id };
  return { error: 'Bạn và đồng đội gần đó chưa cần băng.' };
}
