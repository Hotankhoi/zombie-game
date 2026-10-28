/** Loot uses reliable transport. 124/125/126 are reserved by A. */
export const LootMessage = { Request: 110, Reply: 111, Replica: 112, Ack: 113 } as const;

export interface LootStackWire {
  /** Must be checked against the authoritative item catalogue by the decoder. */
  readonly itemId: string;
  readonly rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  readonly quantity: number;
}
export interface InventoryWire {
  readonly revision: number;
  readonly backpack: 'basic' | 'scout' | 'expedition';
  readonly slots: readonly (LootStackWire | null)[];
}
export interface ChestWire {
  /** = LOOT_VERSION của bảng sinh rương (`shared/loot/chest.ts`); 2 = bảng loot GĐ 3b có giáp. */
  readonly version: 1 | 2;
  readonly id: string;
  readonly region: 'residential' | 'market' | 'hospital' | 'police' | 'military';
  readonly revision: number;
  readonly opened: boolean;
  readonly slots: readonly (LootStackWire | null)[];
}
export interface GroundItemWire {
  readonly id: string;
  /** Vị trí (ô), làm tròn 1/32 ô khi host tạo (giao thức 11). */
  readonly x: number;
  readonly y: number;
  /**
   * Giao thức 11 (A): tick thế giới lúc đồ rơi / được gộp thêm gần nhất. Host bỏ đồ khi `tick - t ≥ GROUND.expireTicks`
   * (5 phút không ai nhặt) — tính theo tick thế giới nên đổi host / nạp save vẫn đúng hạn.
   */
  readonly t: number;
  readonly stack: LootStackWire;
}
/**
 * Giao thức 12 (A): thùng thưởng huyền thoại sau đợt tràn thắng. Mỗi người trong trận lúc thắng có PHẦN RIÊNG (`owner`
 * = ownerId) — chỉ người đó lấy được (intent `reward`), không tranh nhau. Thùng mất khi mọi phần đã rỗng.
 */
export interface RewardCrateWire {
  /** `r<số đợt>`. */
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly horde: number;
  readonly shares: readonly { readonly owner: string; readonly slots: readonly (LootStackWire | null)[] }[];
}
export interface LootReplicaWire {
  readonly drops?: readonly GroundItemWire[];
  /** Giao thức 12: thùng thưởng đợt tràn đang nằm trên đất. */
  readonly rewards?: readonly RewardCrateWire[];
  readonly version: 1;
  readonly seed: string;
  readonly revision: number;
  readonly inventories: readonly { id: string; state: InventoryWire }[];
  readonly chests: readonly ChestWire[];
}

interface ChestIntent {
  readonly chestId: string;
  readonly expectedChestRevision: number;
  readonly expectedInventoryRevision: number;
}
export type LootAction =
  | { type: 'inventory' }
  | { type: 'unequip' }
  | { type: 'drop'; slot: number; quantity: number; expectedRevision: number }
  | { type: 'pickup'; dropId: string; expectedRevision: number }
  /** Giao thức 12 (A): lấy phần của mình trong thùng thưởng `crateId` (đứng trong tầm với + nhìn thấy). */
  | { type: 'reward'; crateId: string; expectedRevision: number }
  /**
   * Nhận túi theo playerKey bí mật (v5, A). Host xác minh rồi gắn PeerId người gửi → ownerId = hash(key);
   * replica chỉ chứa ownerId, không bao giờ chứa key. Xem docs/save-format.md mục 4.
   */
  | {
      type: 'claim';
      key: string;
      /** Khóa này tab này đã dùng trước đó (tải lại trang) → host cho lấy lại túi kể cả khi kết nối cũ chưa rời. */
      resume: boolean;
    }
  | { type: 'view'; chestId: string }
  | (ChestIntent & { type: 'open' })
  | (ChestIntent & { type: 'take'; slot: number; quantity: number })
  | (ChestIntent & { type: 'takeAll' })
  | { type: 'move'; expectedRevision: number; from: number; to: number; quantity: number }
  | { type: 'sort'; expectedRevision: number }
  /**
   * GĐ 3b (A): dùng 1 món ở ô `slot` của túi mình (đồ ăn/uống/y tế; băng gạc có thể dùng cho đồng đội `target`, null =
   * cho mình). Host trừ đồ + áp hiệu ứng trong CÙNG một giao dịch: hiệu ứng chỉ áp khi revision trừ đồ đã được mọi
   * người ACK (cùng lúc gửi kết quả 111) → host mới luôn có bản túi đã trừ → không bao giờ được hiệu ứng 2 lần.
   */
  | { type: 'use'; expectedRevision: number; slot: number; target: string | null }
  /** GĐ 3b (A): nạp đạn cho súng đang cầm — host lấy đạn đúng loại trong túi (mọi độ hiếm), áp như `use`. */
  | { type: 'reload'; expectedRevision: number }
  /**
   * GĐ 3b (A): cầm vũ khí / mặc giáp là món `itemId` + `rarity` đang có trong túi. Không đổi túi (món vẫn nằm trong túi,
   * chiếm ô); host kiểm tra có món đó rồi đổi trạng thái người chơi ngay.
   */
  | { type: 'equip'; itemId: string; rarity: LootStackWire['rarity'] };

/** Authority term must change on every host activation, even if the same peer returns. */
interface LootEnvelope {
  readonly term: string;
}
export interface LootRequest extends LootEnvelope {
  readonly type: typeof LootMessage.Request;
  readonly requestId: string;
  /** The sender's identity is obtained from Transport, never from this payload. */
  readonly action: LootAction;
}
export interface LootReply extends LootEnvelope {
  readonly type: typeof LootMessage.Reply;
  readonly requestId: string;
  readonly ok: boolean;
  readonly error?: string;
  readonly revision: number;
  readonly inventory?: InventoryWire;
  readonly chest?: ChestWire;
}
export interface LootReplica extends LootEnvelope {
  readonly type: typeof LootMessage.Replica;
  /** Atomic inventory + chest snapshot. Receiver validates the entire snapshot before ACK. */
  readonly state: LootReplicaWire;
}
export interface LootAck extends LootEnvelope {
  readonly type: typeof LootMessage.Ack;
  readonly revision: number;
}
export type LootPacket = LootRequest | LootReply | LootReplica | LootAck;
