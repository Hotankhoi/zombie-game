import Phaser from 'phaser';
import { CHUNK_SIZE, TILE_SIZE, type Chunk, type District } from '@shared/mapgen/world';

// Temporary original artwork. Replace this atlas with licensed Kenney tiles later.
export const TILE_COLORS = [0x304b36, 0x343b40, 0x7c8177, 0x9d8965, 0x546775, 0xb98b46];
export const DISTRICT_NAMES: Record<District, string> = {
  residential: 'Khu dân cư',
  market: 'Siêu thị',
  hospital: 'Bệnh viện',
  police: 'Đồn cảnh sát',
  military: 'Khu quân sự',
};
const ATLAS = 'world-placeholder-v1';

/** Reusable static map renderer. The caller supplies visible chunks and owns the camera. */
export class MapRenderer {
  private chunks = new Map<string, { map: Phaser.Tilemaps.Tilemap; labels: Phaser.GameObjects.Text[] }>();

  constructor(private readonly scene: Phaser.Scene) {
    if (!this.scene.textures.exists(ATLAS)) {
      const texture = this.scene.textures.createCanvas(ATLAS, TILE_SIZE * TILE_COLORS.length, TILE_SIZE)!;
      const ctx = texture.context;
      TILE_COLORS.forEach((color, i) => {
        const x = i * TILE_SIZE;
        ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
        ctx.fillRect(x, 0, TILE_SIZE, TILE_SIZE);
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        if (i === 4) {
          ctx.fillRect(x, 7, 16, 1);
          ctx.fillRect(x + 7, 0, 1, 8);
          ctx.fillRect(x + 3, 8, 1, 8);
        } else if (i === 5) {
          ctx.fillRect(x + 3, 0, 1, 16);
          ctx.fillRect(x + 12, 0, 1, 16);
          ctx.fillStyle = '#edd49e';
          ctx.fillRect(x + 10, 7, 2, 2);
        } else {
          ctx.fillRect(x, 15, 16, 1);
          ctx.fillRect(x + 15, 0, 1, 16);
        }
      });
      texture.refresh();
      texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  /** Supply the complete set of visible chunks; chunks outside it are released. */
  sync(visibleChunks: Iterable<Chunk>) {
    const wanted = new Set<string>();
    for (const chunk of visibleChunks) {
      const key = `${chunk.x},${chunk.y}`;
      wanted.add(key);
      if (this.chunks.has(key)) continue;
      const rows = Array.from({ length: CHUNK_SIZE }, (_, i) =>
        chunk.tiles.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
      );
      const map = this.scene.make.tilemap({ data: rows, tileWidth: TILE_SIZE, tileHeight: TILE_SIZE });
      const tiles = map.addTilesetImage(ATLAS, ATLAS, TILE_SIZE, TILE_SIZE)!;
      map.createLayer(0, tiles, chunk.x * CHUNK_SIZE * TILE_SIZE, chunk.y * CHUNK_SIZE * TILE_SIZE);
      const labels = chunk.buildings
        .filter((b) => b.kind !== 'residential')
        .map((b) =>
          this.scene.add
            .text((b.x + b.width / 2) * TILE_SIZE, (b.y + b.height / 2) * TILE_SIZE, DISTRICT_NAMES[b.kind], {
              fontSize: '9px',
              color: '#ffffff',
              backgroundColor: '#17231ddd',
              padding: { x: 3, y: 2 },
            })
            .setOrigin(0.5)
            .setDepth(1),
        );
      this.chunks.set(key, { map, labels });
    }
    for (const [key, chunk] of this.chunks) {
      if (!wanted.has(key)) {
        chunk.map.destroy();
        chunk.labels.forEach((label) => label.destroy());
        this.chunks.delete(key);
      }
    }
  }

  destroy() {
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    for (const chunk of this.chunks.values()) {
      chunk.map.destroy();
      chunk.labels.forEach((label) => label.destroy());
    }
    this.chunks.clear();
  }
}
