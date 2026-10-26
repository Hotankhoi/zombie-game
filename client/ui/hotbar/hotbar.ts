import type { ClientLoot } from '@net/clientLoot';
import { ITEMS, RARITIES } from '@shared/data/items';
import type { ItemStack } from '@shared/inventory/inventory';
import { HOTBAR_SIZE, nextSlot, resolveBinding, type Binding } from './model';
import { icon } from '../inventory/inventoryPanel';
import './hotbar.css';

/** Local bindings refer to authoritative inventory; selecting equipment always goes through the host. */
export class Hotbar {
  readonly root = document.createElement('nav');
  private bindings: (Binding | null)[] = Array.from({ length: HOTBAR_SIZE }, () => null);
  private selected = -1;
  private assignPending: Binding | null = null;
  private serial = 0;
  private sending = false;
  private wanted = -1;
  private dragFrom = -1;
  private landed = false;
  private off: () => void;
  constructor(
    private loot: ClientLoot,
    private blocked: () => boolean,
    private use: (slot: number) => void,
    private toast: (s: string) => void,
  ) {
    this.root.className = 'hotbar';
    this.root.setAttribute('aria-label', 'Thanh nhanh 5 ô');
    document.body.append(this.root);
    this.off = loot.changed.on(() => this.refresh());
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.root.addEventListener(
      'wheel',
      (e) => {
        if (this.blocked()) return;
        e.preventDefault();
        if (e.deltaY) this.cycle(Math.sign(e.deltaY));
      },
      { passive: false },
    );
    this.refresh();
  }
  assign(item: ItemStack): void {
    this.assignPending = { itemId: item.itemId, rarity: item.rarity };
    this.toast('Chọn ô 1–5 trên thanh nhanh để gán.');
    this.render();
  }
  cycle(direction: number): void {
    if (!this.blocked()) void this.select(nextSlot(this.selected < 0 ? 0 : this.selected, direction));
  }
  async select(index: number): Promise<void> {
    if (index < 0 || index >= HOTBAR_SIZE || !Number.isInteger(index)) return;
    if (this.assignPending) {
      this.bindings[index] = this.assignPending;
      this.assignPending = null;
      this.render();
      return;
    }
    if (this.blocked() || !this.loot.ready) return;
    this.selected = index;
    this.wanted = index;
    this.serial++;
    this.render();
    await this.pump();
  }
  private async pump(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.wanted >= 0) {
        const i = this.wanted;
        this.wanted = -1;
        const serial = this.serial;
        const binding = this.bindings[i] ?? null;
        const resolved = resolveBinding(this.loot.inventory, binding);
        const weapon = resolved && binding && ITEMS[binding.itemId].category === 'weapon';
        const result = weapon
          ? await this.loot.equip(binding.itemId, binding.rarity)
          : await this.loot.request({ type: 'unequip' });
        if (serial !== this.serial) continue;
        if (!result.ok) {
          this.toast('Chưa đổi được vật phẩm: ' + result.error);
          this.selected = -1;
        } else if (resolved && binding && !weapon) this.use(resolved.slot);
        this.render();
      }
    } finally {
      this.sending = false;
    }
  }
  private refresh(): void {
    if (!this.loot.ready) {
      this.wanted = -1;
      this.serial++;
      this.render();
      return;
    }
    const bag = this.loot.inventory;
    for (let i = 0; i < HOTBAR_SIZE; i++)
      if (this.bindings[i] && !resolveBinding(bag, this.bindings[i]!)) {
        this.bindings[i] = null;
        if (i === this.selected) {
          this.wanted = i;
          this.serial++;
          void this.pump();
        }
      }
    this.render();
  }
  private render(): void {
    const bag = this.loot.inventory;
    this.root.replaceChildren();
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const b = this.bindings[i] ?? null,
        r = resolveBinding(bag, b),
        el = document.createElement('button');
      el.type = 'button';
      el.className = 'hotbar-slot';
      el.classList.toggle('selected', i === this.selected);
      el.classList.toggle('assigning', !!this.assignPending);
      el.setAttribute('aria-pressed', String(i === this.selected));
      el.title = b ? ITEMS[b.itemId].name : 'Ô trống — tay không';
      const key = document.createElement('small');
      key.textContent = String(i + 1);
      const label = document.createElement('span');
      label.textContent = b ? ITEMS[b.itemId].name : '—';
      const count = document.createElement('strong');
      count.textContent = r ? String(r.quantity) : '';
      if (b) el.style.setProperty('--item-color', RARITIES[b.rarity].color);
      if (b) el.append(icon(ITEMS[b.itemId].category, b.itemId));
      el.append(key, label, count);
      el.onclick = () => void this.select(i);
      el.draggable = !!b;
      el.ondragstart = (e) => {
        this.dragFrom = i;
        this.landed = false;
        e.dataTransfer?.setData('text/plain', 'hotbar:' + i);
      };
      el.ondragover = (e) => {
        e.preventDefault();
      };
      el.ondrop = (e) => {
        e.preventDefault();
        if (this.dragFrom < 0) return;
        this.landed = true;
        const a = this.dragFrom;
        [this.bindings[a], this.bindings[i]] = [this.bindings[i] ?? null, this.bindings[a] ?? null];
        if (this.selected === a) this.selected = i;
        else if (this.selected === i) this.selected = a;
        this.render();
      };
      el.ondragend = () => {
        if (!this.landed && this.dragFrom >= 0) {
          const a = this.dragFrom;
          this.bindings[a] = null;
          if (this.selected === a) {
            this.wanted = a;
            void this.pump();
          }
          this.render();
        }
        this.dragFrom = -1;
      };
      el.oncontextmenu = (e) => {
        e.preventDefault();
        this.bindings[i] = null;
        if (i === this.selected) {
          this.wanted = i;
          void this.pump();
        }
        this.render();
      };
      this.root.append(el);
    }
  }
  cancelAssignment(): void {
    this.assignPending = null;
    this.render();
  }
  destroy(): void {
    this.off();
    this.root.remove();
    this.wanted = -1;
    this.serial++;
  }
}
