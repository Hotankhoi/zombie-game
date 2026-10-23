import Phaser from 'phaser';
import { CHUNK_SIZE, TILE_SIZE, Tile, type TileId, type Chunk, type District } from '@shared/mapgen/world';

import tilesheetUrl from '../../assets/kenney/roguelike-modern-city/tilemap_packed.png?url';

// Minimap palette is independent of the visual atlas.
export const TILE_COLORS = [0x304b36, 0x343b40, 0x7c8177, 0x9d8965, 0x546775, 0xb98b46];
export const DISTRICT_NAMES: Record<District, string> = {
  residential: 'Khu dân cư',
  market: 'Siêu thị',
  hospital: 'Bệnh viện',
  police: 'Đồn cảnh sát',
  military: 'Khu quân sự',
};
const ATLAS = 'kenney-modern-city-v2';
const TILE_FRAMES: Record<TileId, number> = {
  [Tile.Grass]: 963,
  [Tile.Road]: 750,
  [Tile.Pavement]: 741,
  [Tile.Floor]: 743,
  [Tile.Wall]: 190,
  [Tile.Door]: 653,
};

/** Call from the owning scene's preload(). Assets are bundled locally by Vite. */
export function preloadMapTiles(scene: Phaser.Scene) {
  if (!scene.textures.exists(ATLAS)) scene.load.image(ATLAS, tilesheetUrl);
}

/** Reusable static map renderer. The caller supplies visible chunks and owns the camera. */
export class MapRenderer {
  private chunks = new Map<string, { map: Phaser.Tilemaps.Tilemap; labels: Phaser.GameObjects.Text[] }>();

  constructor(private readonly scene: Phaser.Scene) {
    if (!scene.textures.exists(ATLAS)) {
      throw new Error('MapRenderer requires preloadMapTiles(scene) in scene.preload()');
    }
    scene.textures.get(ATLAS).setFilter(Phaser.Textures.FilterMode.NEAREST);
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
        chunk.tiles.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE).map((tile) => TILE_FRAMES[tile]),
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
