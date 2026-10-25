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
  readonly version: 1;
  readonly id: string;
  readonly region: 'residential' | 'market' | 'hospital' | 'police' | 'military';
  readonly revision: number;
  readonly opened: boolean;
  readonly slots: readonly (LootStackWire | null)[];
}
export interface LootReplicaWire {
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
  | { type: 'sort'; expectedRevision: number };

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
