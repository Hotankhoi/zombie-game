import type Phaser from 'phaser';
import type { ClientLoot } from '@net/clientLoot';
import { LOOT_INTERACTION } from '@shared/data/lootInteraction';
import { TILE_SIZE } from '@shared/mapgen/world';
import { isUp, type PlayerState } from '@shared/sim/player';
import type { RewardCrateWire } from '@shared/types/loot';
import { lootErrorText } from './lootMessages';
import { gainedItems, pickupText } from './outcome';
import { directionText, myCrates } from './reward';
import type { InventoryState } from '@shared/inventory/inventory';

/**
 * Thùng thưởng đợt tràn (A, giao thức 12): vẽ thùng vàng, F cạnh thùng = nhận phần của mình, dòng HUD "Thùng thưởng đợt
 * X · 12 ô ↗" khi còn phần chưa lấy, thông báo khi thùng mới xuất hiện. Trạng thái lấy từ replica loot (host quyết).
 */
export class RewardLayer {
  private graphics: Phaser.GameObjects.Graphics;
  private hint: Phaser.GameObjects.Text;
  private hud = document.createElement('div');
  private known = new Set<string>();
  private first = true;
  private lastKey = '';
  /** Thùng còn phần của mình trong tầm với + nhìn thấy (F nhận). */
  nearest: RewardCrateWire | null = null;

  constructor(
    scene: Phaser.Scene,
    private loot: ClientLoot,
    zoom: number,
    private toast: (text: string, error?: boolean, color?: string) => void,
  ) {
    this.graphics = scene.add.graphics().setDepth(3.4);
    this.hint = scene.add
      .text(0, 0, 'F: nhận thưởng', {
        fontFamily: 'Segoe UI, system-ui',
        fontSize: '6px',
        fontStyle: 'bold',
        color: '#ffd76a',
        stroke: '#000000',
        strokeThickness: 2,
      })
      .setOrigin(0.5, 1)
      .setDepth(5)
      .setResolution(zoom * window.devicePixelRatio)
      .setVisible(false);
    this.hud.className = 'reward-hud';
    this.hud.hidden = true;
    document.body.append(this.hud);
  }

  update(me: PlayerState | null, seen: (p: { x: number; y: number }) => boolean): void {
    const crates = this.loot.replica?.rewards ?? [];
    // thùng mới xuất hiện (không báo những thùng đã có lúc vào trận)
    for (const c of crates) {
      if (this.known.has(c.id)) continue;
      this.known.add(c.id);
      if (!this.first && c.shares.some((s) => s.owner === this.loot.owner))
        this.toast(`Thắng đợt tràn ${c.horde}! Thùng thưởng huyền thoại đã xuất hiện.`, false, '#efc76b');
    }
    if (this.loot.replica) this.first = false;
    const mine = myCrates(crates, this.loot.owner);
    this.nearest = null;
    if (me && isUp(me))
      for (const c of mine)
        if (Math.hypot(c.x - me.x, c.y - me.y) <= LOOT_INTERACTION.reach && seen(c)) this.nearest = c;

    const key = crates.map((c) => `${c.id}:${mine.includes(c)}`).join(',') + ':' + this.nearest?.id;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.graphics.clear();
      for (const c of crates) {
        const x = c.x * TILE_SIZE,
          y = c.y * TILE_SIZE,
          gold = mine.includes(c);
        this.graphics.fillStyle(gold ? 0xe0a526 : 0x6d6a5f).fillRect(x - 6, y - 5, 12, 10);
        this.graphics.fillStyle(gold ? 0xffe28a : 0x8f8b80).fillRect(x - 6, y - 5, 12, 3);
        this.graphics.lineStyle(1, c === this.nearest ? 0xffffff : 0x3a2a08).strokeRect(x - 6, y - 5, 12, 10);
      }
    }
    if (this.nearest) this.hint.setPosition(this.nearest.x * TILE_SIZE, this.nearest.y * TILE_SIZE - 7);
    this.hint.setVisible(!!this.nearest);

    const target = me && mine[0];
    this.hud.hidden = !target;
    if (target) this.hud.textContent = `Thùng thưởng đợt ${target.horde} · ${directionText(me, target)}`;
  }

  /** F cạnh thùng: lấy phần của mình. true = đã xử lý phím F. */
  take(): boolean {
    const c = this.nearest,
      bag = this.loot.inventory;
    if (!c || !bag || this.loot.busy) return !!c;
    void this.loot.request({ type: 'reward', crateId: c.id, expectedRevision: bag.revision }).then((r) => {
      if (!r.ok) return this.toast(lootErrorText(r.error), true);
      for (const g of gainedItems(bag as InventoryState, r.inventory)) {
        const { text, color } = pickupText(g);
        this.toast(text, false, color);
      }
      if (myCrates(this.loot.replica?.rewards ?? [], this.loot.owner).some((x) => x.id === c.id))
        this.toast('Túi đầy — phần còn lại vẫn trong thùng.', true);
    });
    return true;
  }

  destroy(): void {
    this.graphics.destroy();
    this.hint.destroy();
    this.hud.remove();
  }
}
