import Phaser from 'phaser';
import type { ClientLoot } from '@net/clientLoot';
import { TILE_SIZE, type Chunk } from '@shared/mapgen/world';
import { chestLocations, type ChestLocation } from '@shared/mapgen/chests';
import type { Vec2 } from '@shared/types';
import { ChestViewer, nearestChest } from './nearChest';

import tilesheetUrl from '../../assets/kenney/roguelike-modern-city/tilemap_packed.png?url';

/** Cùng tilesheet Kenney với map của B, nạp thêm dạng spritesheet (16×16) để lấy từng hình thùng. */
const SHEET = 'kenney-modern-city-frames';
/** Thùng các-tông đóng / mở nắp trong Roguelike Modern City (index theo hàng, 37 cột). */
const FRAME_CLOSED = 606;
const FRAME_OPEN = 569;
/** Rương đã mở mà hết đồ: tô xám cho dễ bỏ qua. */
const EMPTY_TINT = 0x8a8a8a;
const DEPTH = 2.2;

/** Gọi trong preload() của scene. */
export function preloadChestSprites(scene: Phaser.Scene) {
  if (!scene.textures.exists(SHEET))
    scene.load.spritesheet(SHEET, tilesheetUrl, { frameWidth: TILE_SIZE, frameHeight: TILE_SIZE });
}

/**
 * Rương trong thế giới (phần 2B): vẽ thùng ở vị trí `chestLocations(chunk)` của các chunk đang vẽ — đóng nắp
 * khi chưa ai mở, mở nắp khi đã mở (xám nếu hết đồ), ẩn khi bị tường/cửa đóng che. Rương gần nhất trong tầm với
 * thì gọi `loot.view(id)` (nếu chưa biết) và hiện gợi ý "F: mở rương". Trạng thái lấy từ `NetGame.loot`.
 */
export class ChestLayer {
  private sprites = new Map<string, { loc: ChestLocation; img: Phaser.GameObjects.Image }>();
  private hint: Phaser.GameObjects.Text;
  private viewer: ChestViewer;
  /** Rương đang trong tầm với + nhìn thấy (F mở rương này). */
  nearest: ChestLocation | null = null;

  constructor(
    private scene: Phaser.Scene,
    private loot: ClientLoot,
    zoom: number,
  ) {
    scene.textures.get(SHEET).setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.hint = scene.add
      .text(0, 0, 'F: mở rương', {
        fontFamily: 'Segoe UI, system-ui',
        fontSize: '6px',
        fontStyle: 'bold',
        color: '#ffe9a8',
        stroke: '#000000',
        strokeThickness: 2,
      })
      .setOrigin(0.5, 1)
      .setDepth(5)
      .setResolution(zoom * window.devicePixelRatio)
      .setVisible(false);
    this.viewer = new ChestViewer(
      (id) => void loot.view(id),
      (id) => loot.chest(id) !== null,
    );
    // trạng thái rương chỉ đổi khi có replica/kết quả → vẽ lại lúc đó, không đọc mỗi frame
    loot.changed.on((e) => {
      if (e.kind === 'reset') this.viewer.reset();
      if (e.kind === 'chest') {
        const s = this.sprites.get(e.chestId);
        if (s) this.paint(s.loc.id, s.img);
      } else if (e.kind !== 'inventory') for (const s of this.sprites.values()) this.paint(s.loc.id, s.img);
    });
  }

  /** Các chunk đang vẽ (cùng lúc với MapRenderer.sync). */
  sync(chunks: readonly Chunk[]) {
    const wanted = new Set<string>();
    for (const chunk of chunks) {
      for (const loc of chestLocations(chunk)) {
        wanted.add(loc.id);
        if (this.sprites.has(loc.id)) continue;
        const img = this.scene.add
          .image(loc.x * TILE_SIZE, loc.y * TILE_SIZE, SHEET, FRAME_CLOSED)
          .setDepth(DEPTH);
        this.paint(loc.id, img);
        this.sprites.set(loc.id, { loc, img });
      }
    }
    for (const [id, s] of this.sprites) {
      if (wanted.has(id)) continue;
      s.img.destroy();
      this.sprites.delete(id);
    }
  }

  /**
   * Mỗi frame. `me` = vị trí mình (null khi chết/gục → không tương tác), `seen` = mình nhìn thấy điểm đó không
   * (cùng luật với zombie: tường/cửa đóng che). `hideHint`: đang mở panel.
   */
  update(me: Vec2 | null, seen: (p: Vec2) => boolean, hideHint: boolean) {
    for (const { loc, img } of this.sprites.values()) img.setVisible(seen(loc));
    this.nearest = me ? nearestChest(this.locations(), me, seen) : null;
    this.viewer.update(this.loot.ready ? this.nearest : null, this.scene.time.now);
    const n = this.nearest;
    this.hint.setVisible(n !== null && !hideHint);
    if (n) this.hint.setPosition(n.x * TILE_SIZE, n.y * TILE_SIZE - TILE_SIZE * 0.6);
  }

  /** Chưa ai đụng (chưa biết) = đóng nắp. */
  private paint(id: string, img: Phaser.GameObjects.Image) {
    const state = this.loot.chest(id);
    img.setFrame(state?.opened ? FRAME_OPEN : FRAME_CLOSED);
    if (state?.opened && state.slots.every((s) => !s)) img.setTint(EMPTY_TINT);
    else img.clearTint();
  }

  private *locations(): Iterable<ChestLocation> {
    for (const s of this.sprites.values()) yield s.loc;
  }
}
