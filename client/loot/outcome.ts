import type { LootClientError, LootOutcome } from '@net/clientLoot';
import type { InventoryState } from '@shared/inventory/inventory';
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
