import type { ClientLoot } from '@net/clientLoot';
import type { ChestLocation } from '@shared/mapgen/chests';
import { mountInventoryPanel } from '../ui/inventory/inventoryPanel';
import { mountLootPanel } from '../ui/loot/lootPanel';
import { lootErrorText } from './lootMessages';
import { toInventoryResult, toLootResult } from './outcome';
import './lootUi.css';

type LootPanel = ReturnType<typeof mountLootPanel>;
type InventoryPanel = ReturnType<typeof mountInventoryPanel>;

/** Thông báo ngắn ở giữa dưới màn hình (lỗi khi mở rương…) — hiện bấy nhiêu ms. */
const TOAST_MS = 2600;

/**
 * Panel túi/rương trong trận (phần 2B): dùng nguyên panel của B (`client/ui`), nối vào `NetGame.loot`.
 * Panel rương mở bằng F (WorldScene gọi `openChest`), túi bằng I (`toggleInventory`), Esc đóng hết.
 * Khi `open` = true, WorldScene khóa di chuyển/chém/ngắm; thế giới online vẫn chạy.
 * Trạng thái panel chỉ lấy từ ClientLoot (đã xác nhận); host đổi/đồng đội lấy đồ → panel tự cập nhật.
 */
export class LootUi {
  private overlay: HTMLDivElement;
  private slots: HTMLDivElement;
  private toasts: HTMLDivElement;
  private chestPanel: LootPanel | null = null;
  private invPanel: InventoryPanel | null = null;
  /** Rương đang mở panel (hoặc đang chờ host mở). */
  private _chest: ChestLocation | null = null;
  private opening = false;

  constructor(
    parent: HTMLElement,
    private loot: ClientLoot,
  ) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'loot-ui';
    this.overlay.hidden = true;
    this.slots = document.createElement('div');
    this.slots.className = 'loot-ui-panels';
    this.overlay.append(this.slots);
    this.toasts = document.createElement('div');
    this.toasts.className = 'loot-ui-toasts';
    this.toasts.setAttribute('role', 'status');
    this.toasts.setAttribute('aria-live', 'polite');
    parent.append(this.overlay, this.toasts);
    // bấm ra ngoài panel (nền mờ) = đóng hết, không xuyên xuống gameplay
    this.overlay.addEventListener('pointerdown', (e) => {
      if (e.target === this.overlay || e.target === this.slots) this.closeAll();
    });
    // Esc: bắt ở pha capture (panel của B chặn Esc ở pha nổi để bỏ chọn) → luôn đóng mọi panel
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape' || !this.open) return;
        e.preventDefault();
        e.stopPropagation();
        this.closeAll();
      },
      true,
    );
    loot.changed.on((e) => {
      if (e.kind === 'chest' && e.chestId !== this._chest?.id) return;
      this.refresh();
    });
  }

  /** Có panel nào đang mở (hoặc đang chờ host mở rương) → khóa điều khiển nhân vật. */
  get open(): boolean {
    return this.chestPanel !== null || this.invPanel !== null || this.opening;
  }
  /** Rương đang mở panel. */
  get chest(): ChestLocation | null {
    return this._chest;
  }

  /** F: mở rương (gửi `open` nếu chưa mở) rồi hiện panel rương. Đang mở chính rương này thì đóng lại. */
  async openChest(loc: ChestLocation): Promise<void> {
    if (this.opening) return;
    if (this._chest?.id === loc.id && this.chestPanel) {
      this.closeChest();
      return;
    }
    this.closeChest();
    if (!this.loot.ready || !this.loot.inventory) {
      this.toast(lootErrorText(this.loot.claimError ?? 'not_ready'), true);
      return;
    }
    this._chest = loc;
    this.opening = true;
    this.overlay.hidden = false;
    try {
      if (!this.loot.chest(loc.id)?.opened) {
        const o = await this.loot.open(loc.id);
        if (!o.ok && this._chest === loc) this.toast(lootErrorText(o.error), true);
      }
    } finally {
      this.opening = false;
    }
    // đóng giữa chừng (Esc, gục, đi xa) → thôi (ẩn lớp nền nếu không còn panel nào)
    if (this._chest !== loc) {
      this.afterClose();
      return;
    }
    const chest = this.loot.chest(loc.id);
    const inventory = this.loot.inventory;
    if (!chest?.opened || !inventory) {
      this.closeChest();
      return;
    }
    const panel = mountLootPanel(this.slots, {
      initial: { chest, inventory },
      onCommand: async (cmd) => {
        const shown = {
          chest: this.loot.chest(loc.id) ?? chest,
          inventory: this.loot.inventory ?? inventory,
        };
        return toLootResult(await this.loot.command(cmd), shown);
      },
      describeError: lootErrorText,
    });
    this.chestPanel = panel;
    this.slots.prepend(this.slots.lastElementChild!); // rương bên trái, túi bên phải
    this.focusFirst();
  }

  /** I: mở/đóng túi. */
  toggleInventory(): void {
    if (this.invPanel) {
      this.invPanel.destroy();
      this.invPanel = null;
      this.afterClose();
      return;
    }
    const inventory = this.loot.inventory;
    if (!this.loot.ready || !inventory) {
      this.toast(lootErrorText(this.loot.claimError ?? 'not_ready'), true);
      return;
    }
    this.overlay.hidden = false;
    this.invPanel = mountInventoryPanel(this.slots, {
      initial: inventory,
      onCommand: async (cmd) =>
        toInventoryResult(await this.loot.command(cmd), this.loot.inventory ?? inventory),
      describeError: lootErrorText,
    });
    if (!this.chestPanel) this.focusFirst();
  }

  /** Đóng panel rương (đi xa, bị che, F lần nữa). Kết quả đang chờ vẫn về ClientLoot, không mất. */
  closeChest(): void {
    this.chestPanel?.destroy();
    this.chestPanel = null;
    this._chest = null;
    this.afterClose();
  }

  /** Esc / gục / chết: đóng hết. */
  closeAll(): void {
    this.invPanel?.destroy();
    this.invPanel = null;
    this.closeChest();
  }

  /** Thông báo ngắn (lỗi = viền đỏ). `color`: màu chữ (độ hiếm). */
  toast(text: string, error = false, color?: string): void {
    const el = document.createElement('div');
    el.className = `loot-ui-toast${error ? ' loot-ui-toast-error' : ''}`;
    el.textContent = text;
    if (color) el.style.color = color;
    this.toasts.append(el);
    while (this.toasts.childElementCount > 4) this.toasts.firstElementChild?.remove();
    setTimeout(() => el.remove(), TOAST_MS);
  }

  /** Đọc lại trạng thái đã xác nhận → panel (panel tự bỏ bản cũ hơn bản đang hiện). */
  private refresh(): void {
    const inventory = this.loot.inventory;
    if (!inventory) return;
    this.invPanel?.update(inventory);
    const chest = this._chest ? this.loot.chest(this._chest.id) : null;
    if (chest && this.chestPanel) this.chestPanel.update({ chest, inventory });
  }

  private afterClose(): void {
    if (this.open) return;
    this.overlay.hidden = true;
    // trả bàn phím cho game (nút trong panel vừa bị xóa)
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body)
      document.activeElement.blur();
  }

  private focusFirst(): void {
    this.slots.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }
}
