import type { LootClientError, LootOutcome } from '@net/clientLoot';
import type { InventoryState, ItemStack } from '@shared/inventory/inventory';
import { ITEMS, RARITIES } from '@shared/data/items';
import type { ChestState } from '@shared/loot/chest';

/** Kết quả đưa cho panel rương của B (`onCommand`): luôn có rương + túi; lỗi có thể là mã mạng/host. */
export type PanelLootResult =
  | { ok: true; chest: ChestState; inventory: InventoryState }
  | { ok: false; chest: ChestState; inventory: InventoryState; error: LootClientError };
export type PanelInventoryResult =
  { ok: true; state: InventoryState } | { ok: false; state: InventoryState; error: LootClientError };

/**
 * `LootOutcome` của ClientLoot → kết quả cho panel. Khi lỗi trước lúc có trạng thái (vd `not_ready`), giữ trạng
 * thái panel đang hiện (`shown`) để panel vẽ lại như cũ và chỉ hiện lý do.
 */
export function toLootResult(
  o: LootOutcome,
  shown: { chest: ChestState; inventory: InventoryState },
): PanelLootResult {
  const chest = o.chest && o.chest.id === shown.chest.id ? o.chest : shown.chest;
  const inventory = o.inventory ?? shown.inventory;
  return o.ok ? { ok: true, chest, inventory } : { ok: false, chest, inventory, error: o.error };
}

export function toInventoryResult(o: LootOutcome, shown: InventoryState): PanelInventoryResult {
  const state = o.inventory ?? shown;
  return o.ok ? { ok: true, state } : { ok: false, state, error: o.error };
}

/** Món vừa vào túi: so tổng số lượng theo (món, độ hiếm) trước/sau. Chỉ tính phần tăng; sắp xếp/gộp ô không tính. */
export function gainedItems(before: InventoryState, after: InventoryState): ItemStack[] {
  const totals = new Map<string, ItemStack>();
  const add = (s: ItemStack | null, sign: 1 | -1) => {
    if (!s) return;
    const key = `${s.itemId}|${s.rarity}`;
    const cur = totals.get(key);
    totals.set(key, {
      itemId: s.itemId,
      rarity: s.rarity,
      quantity: (cur?.quantity ?? 0) + sign * s.quantity,
    });
  };
  for (const s of after.slots) add(s, 1);
  for (const s of before.slots) add(s, -1);
  return [...totals.values()].filter((s) => s.quantity > 0);
}

/** Dòng thông báo khi nhặt: "+2 Đồ hộp (Tốt)", màu chữ = màu độ hiếm. */
export function pickupText(s: ItemStack): { text: string; color: string } {
  const rarity = RARITIES[s.rarity];
  return { text: `+${s.quantity} ${ITEMS[s.itemId].name} (${rarity.name})`, color: rarity.color };
}

/** Số ô túi đã dùng / tổng — cho HUD. */
export function bagUsage(inv: InventoryState): { used: number; size: number } {
  return { used: inv.slots.filter(Boolean).length, size: inv.slots.length };
}
