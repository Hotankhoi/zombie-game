import type { LootStackWire } from './loot';

/** GĐ 3, v6: trạng thái này được sao chép nguyên khối cùng túi đồ. */
export interface GameplayProfileWire {
  readonly version: 1;
  readonly survival: {
    readonly version: 1;
    readonly hunger: number;
    readonly thirst: number;
    readonly infection: number;
    readonly treatment: {
      readonly itemId: 'bandage' | 'medkit';
      readonly remainingSec: number;
      readonly heal: number;
    } | null;
  };
  readonly equipment: {
    readonly version: 1;
    readonly revision: number;
    readonly weapon: {
      readonly item: LootStackWire;
      readonly loaded: readonly LootStackWire[];
      readonly reloadSec: number;
      readonly fireCd: number;
    } | null;
    readonly armor: LootStackWire | null;
  };
  /** Chỉ số tại tick này để phục hồi giao dịch dùng đồ khi đổi host. */
  readonly hp: number;
  readonly stamina: number;
  readonly tick: number;
}
