import type Phaser from 'phaser';
import type { ClientLoot } from '@net/clientLoot';
import { ITEMS, RARITIES, type ItemId } from '@shared/data/items';
import { TILE_SIZE } from '@shared/mapgen/world';
import type { GroundItemWire } from '@shared/types/loot';
import { isUp, type PlayerState } from '@shared/sim/player';

export class GroundLayer {
  private graphics: Phaser.GameObjects.Graphics;
  private button = document.createElement('button');
  private nearest: GroundItemWire | null = null;
  private last = '';
  constructor(
    scene: Phaser.Scene,
    private loot: ClientLoot,
    private blocked: () => boolean,
    private toast: (s: string) => void,
  ) {
    this.graphics = scene.add.graphics().setDepth(3.3);
    this.button.className = 'ground-pickup';
    this.button.hidden = true;
    this.button.type = 'button';
    this.button.onclick = () => void this.pickup();
    document.body.append(this.button);
  }
  update(me: PlayerState | null, seen: (p: { x: number; y: number }) => boolean): void {
    const drops = this.loot.replica?.drops ?? [];
    this.nearest = null;
    let distance = 2;
    const shown = drops.filter((d) => !!me && Math.hypot(d.x - me.x, d.y - me.y) < 35 && seen(d));
    if (me && isUp(me))
      for (const d of shown) {
        const n = Math.hypot(d.x - me.x, d.y - me.y);
        if (n <= distance) {
          distance = n;
          this.nearest = d;
        }
      }
    const key = shown.map((d) => d.id).join(',') + ':' + this.nearest?.id;
    if (key !== this.last) {
      this.last = key;
      this.graphics.clear();
      for (const d of shown) {
        const x = d.x * TILE_SIZE,
          y = d.y * TILE_SIZE;
        this.graphics
          .fillStyle(PhaserColor(RARITIES[d.stack.rarity].color))
          .fillRoundedRect(x - 4, y - 3, 8, 6, 1);
        this.graphics.lineStyle(1, d === this.nearest ? 0xffffff : 0x332d22).strokeRect(x - 4, y - 3, 8, 6);
      }
    }
    this.button.hidden = !this.nearest || this.blocked() || !this.loot.ready;
    if (this.nearest)
      this.button.textContent =
        'V · Nhặt ' + ITEMS[this.nearest.stack.itemId as ItemId].name + ' ×' + this.nearest.stack.quantity;
  }
  async pickup(): Promise<void> {
    const d = this.nearest,
      bag = this.loot.inventory;
    if (!d || !bag || this.loot.busy || this.blocked()) return;
    const r = await this.loot.request({ type: 'pickup', dropId: d.id, expectedRevision: bag.revision });
    this.toast(
      r.ok
        ? 'Đã nhặt vật phẩm.'
        : r.error === 'inventory_full'
          ? 'Túi đầy; đồ vẫn ở dưới đất.'
          : 'Chưa nhặt được: ' + r.error,
    );
  }
  destroy(): void {
    this.graphics.destroy();
    this.button.remove();
  }
}
function PhaserColor(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}
