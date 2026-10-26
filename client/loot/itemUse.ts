import type { ClientLoot, LootOutcome } from '@net/clientLoot';
import { CONSUMABLES } from '@shared/data/consumables';
import { ITEMS, type ItemId } from '@shared/data/items';
import type { ItemStack } from '@shared/inventory/inventory';
import { checkUse } from '@shared/sim/items';
import { isUp, type PlayerState } from '@shared/sim/player';
import type { PeerId } from '@shared/types';
import { lootErrorText } from './lootMessages';
import { pickQuickUse, type Mate, type QuickKey } from './quickUse';

/** Đang chờ đứng yên để dùng bộ sơ cứu. */
interface Channel {
  slot: number;
  itemId: ItemId;
  need: number;
  /** stillFor lần đọc trước — giảm xuống = vừa đi/đánh → hủy. */
  last: number;
}

/**
 * Dùng đồ phía máy khách (GĐ 3b): phím 1–4 và nút "Dùng" ở panel túi → `ClientLoot.use`. Bộ sơ cứu: hiện tiến độ trong
 * lúc đứng yên (`stillFor` dự đoán), đủ thời gian mới gửi; đi hoặc đánh là hủy. Kết quả/lỗi báo bằng thông báo ngắn.
 */
export class ItemUse {
  private channel: Channel | null = null;
  private me: PlayerState | null = null;
  private mates: readonly Mate[] = [];

  constructor(
    private loot: ClientLoot,
    private toast: (text: string, error?: boolean) => void,
    private nameOf: (id: PeerId) => string,
  ) {}

  /** Gọi mỗi frame: nhân vật mình (dự đoán) + đồng đội — để chọn mục tiêu và theo dõi đứng yên. */
  update(me: PlayerState | null, mates: readonly Mate[]): void {
    this.me = me;
    this.mates = mates;
    const c = this.channel;
    if (!c) return;
    if (!me || !isUp(me)) {
      this.cancel('Đã hủy sơ cứu.');
      return;
    }
    if (me.stillFor + 1e-6 < c.last) {
      this.cancel('Đã hủy sơ cứu: phải đứng yên (không đi, không đánh).');
      return;
    }
    c.last = me.stillFor;
    if (me.stillFor >= c.need) {
      this.channel = null;
      void this.send(c.slot, c.itemId, null);
    }
  }

  /** Tiến độ sơ cứu 0..1 (HUD), null = không sơ cứu. */
  get progress(): number | null {
    const c = this.channel;
    return c ? Math.min(1, (this.me?.stillFor ?? 0) / c.need) : null;
  }

  /** Phím 1–4. */
  quick(key: QuickKey): void {
    const me = this.me;
    if (!me) return;
    const pick = pickQuickUse(key, me, this.loot.inventory, this.mates);
    if ('error' in pick) {
      this.toast(pick.error, true);
      return;
    }
    this.start(pick.slot, pick.itemId, pick.target);
  }

  /** Nút "Dùng" ở panel túi (dùng cho mình). */
  useSlot(slot: number, stack: ItemStack): void {
    this.start(slot, stack.itemId, null);
  }

  /** Món có dùng được (panel hiện nút "Dùng"). */
  static usable(stack: ItemStack): boolean {
    return CONSUMABLES[stack.itemId] !== undefined;
  }

  private start(slot: number, itemId: ItemId, target: PeerId | null): void {
    const me = this.me;
    if (!me || !isUp(me)) {
      this.toast(lootErrorText('player_not_up'), true);
      return;
    }
    if (this.loot.busy || this.channel) {
      this.toast(lootErrorText('busy'), true);
      return;
    }
    // kiểm tra sớm phía mình (máu đầy, không nhiễm…) — host vẫn kiểm tra lại
    const early = target === null ? checkUse({ ...me, stillFor: Infinity }, null, itemId, () => false) : null;
    if (early) {
      this.toast(lootErrorText(early), true);
      return;
    }
    const still = CONSUMABLES[itemId]?.stillSec;
    if (still && target === null) {
      this.channel = { slot, itemId, need: still, last: me.stillFor };
      if (me.stillFor < still)
        this.toast(`Đứng yên ${still} giây để dùng ${ITEMS[itemId].name.toLowerCase()}…`);
      this.update(me, this.mates);
      return;
    }
    void this.send(slot, itemId, target);
  }

  private cancel(text: string): void {
    this.channel = null;
    this.toast(text, true);
  }

  private async send(slot: number, itemId: ItemId, target: PeerId | null): Promise<void> {
    const out: LootOutcome = await this.loot.use(slot, target);
    if (!out.ok) {
      this.toast(lootErrorText(out.error), true);
      return;
    }
    const name = ITEMS[itemId].name;
    this.toast(target ? `Đã dùng ${name.toLowerCase()} cho ${this.nameOf(target)}` : `−1 ${name}`);
  }
}
