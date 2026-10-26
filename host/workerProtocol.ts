import type { WorldState } from '@shared/sim/world';
import type { Channel, PeerId } from '@shared/types';
import type { LootReplicaWire } from '@shared/types/loot';
import type { ItemStack } from '@shared/inventory/inventory';

/** Tin nhắn luồng chính → Web Worker host. */
export type ToWorker =
  /** seed = seed thế giới (worldSeedForRoom(mã phòng)), dùng cho cả map lẫn mô phỏng. */
  | {
      t: 'init';
      seed: string;
      zombieCount?: number;
      startTick?: number;
      restore?: WorldState;
      /** Loot của host trước (replica đã kiểm tra) + số thứ tự lần lên host. */
      loot?: {
        restore?: LootReplicaWire;
        epoch?: number;
        recover?: { expected: PeerId[] };
        /** CHỈ bản dev (`?kit=1`). */
        starterKit?: ItemStack[];
      };
    }
  | { t: 'in'; from: PeerId; data: Uint8Array }
  /** Vừa nhận gói bất kỳ của người này (≤ 2 lần/giây) — tab ẩn vẫn còn sống (host/hostLoot.ts LOOT_TAKEOVER_IDLE_TICKS). */
  | { t: 'seen'; peer: PeerId }
  | { t: 'leave'; peer: PeerId };

export interface HostStats {
  /** Thời gian chạy 1 tick (ms): trung bình và lớn nhất trong 1 giây vừa qua. */
  tickAvgMs: number;
  tickMaxMs: number;
  ticks: number;
  clients: number;
  zombies: number;
}

/** Tin nhắn Web Worker host → luồng chính. */
export type FromWorker =
  | { t: 'out'; items: { to: PeerId; data: Uint8Array; channel: Channel }[] }
  /** Nhịp 1 giây: worker không bị dừng khi tab ẩn → luồng chính dựa vào đây để vẫn nhắc "tôi là host". */
  | { t: 'beat'; stats: HostStats };
