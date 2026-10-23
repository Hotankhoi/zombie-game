import Phaser from 'phaser';
import { CHUNK_SIZE, MAX_CHUNK, TILE_SIZE, WorldMap, type District } from '@shared/mapgen/world';

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
const CHUNK_PIXELS = CHUNK_SIZE * TILE_SIZE;

/** Rendering only: camera movement is exploration, not player simulation. */
export class WorldView extends Phaser.Scene {
  private world!: WorldMap;
  private tick!: () => void;
  private onView!: (world: WorldMap, x: number, y: number, width: number, height: number) => void;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private chunks = new Map<string, { map: Phaser.Tilemaps.Tilemap; labels: Phaser.GameObjects.Text[] }>();

  constructor() {
    super('world-map');
  }

  init(data: { seed: string; tick: () => void; onView: WorldView['onView'] }) {
    this.world = new WorldMap(data.seed);
    this.tick = data.tick;
    this.onView = data.onView;
  }

  create() {
    if (!this.textures.exists(ATLAS)) {
      const texture = this.textures.createCanvas(ATLAS, TILE_SIZE * TILE_COLORS.length, TILE_SIZE)!;
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
    this.cameras.main.setZoom(2).centerOn(CHUNK_PIXELS / 2, CHUNK_PIXELS / 2);
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.isDown) {
        this.cameras.main.scrollX -= (p.x - p.prevPosition.x) / this.cameras.main.zoom;
        this.cameras.main.scrollY -= (p.y - p.prevPosition.y) / this.cameras.main.zoom;
      }
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const chunk of this.chunks.values()) chunk.map.destroy();
      this.chunks.clear();
      this.input.off('pointermove');
      this.input.keyboard?.removeAllKeys(true);
    });
  }

  override update(_time: number, delta: number) {
    this.tick();
    const camera = this.cameras.main;
    const step = Math.min(delta, 50) * 0.25;
    camera.scrollX += (Number(this.cursors.right.isDown) - Number(this.cursors.left.isDown)) * step;
    camera.scrollY += (Number(this.cursors.down.isDown) - Number(this.cursors.up.isDown)) * step;
    const limit = (MAX_CHUNK - 4) * CHUNK_PIXELS;
    camera.scrollX = Phaser.Math.Clamp(camera.scrollX, -limit, limit);
    camera.scrollY = Phaser.Math.Clamp(camera.scrollY, -limit, limit);
    const width = camera.width / camera.zoom;
    const height = camera.height / camera.zoom;
    const x = camera.scrollX + (camera.width - width) / 2;
    const y = camera.scrollY + (camera.height - height) / 2;
    const wanted = new Set<string>();
    for (let cy = Math.floor(y / CHUNK_PIXELS); cy <= Math.floor((y + height) / CHUNK_PIXELS); cy++) {
      for (let cx = Math.floor(x / CHUNK_PIXELS); cx <= Math.floor((x + width) / CHUNK_PIXELS); cx++) {
        const key = `${cx},${cy}`;
        wanted.add(key);
        if (this.chunks.has(key)) continue;
        const chunk = this.world.getChunk(cx, cy);
        const rows = Array.from({ length: CHUNK_SIZE }, (_, i) =>
          chunk.tiles.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
        );
        const map = this.make.tilemap({ data: rows, tileWidth: TILE_SIZE, tileHeight: TILE_SIZE });
        const tiles = map.addTilesetImage(ATLAS, ATLAS, TILE_SIZE, TILE_SIZE)!;
        map.createLayer(0, tiles, cx * CHUNK_PIXELS, cy * CHUNK_PIXELS);
        const labels = chunk.buildings
          .filter((b) => b.kind !== 'residential')
          .map((b) =>
            this.add
              .text(
                (b.x + b.width / 2) * TILE_SIZE,
                (b.y + b.height / 2) * TILE_SIZE,
                DISTRICT_NAMES[b.kind],
                {
                  fontSize: '9px',
                  color: '#ffffff',
                  backgroundColor: '#17231ddd',
                  padding: { x: 3, y: 2 },
                },
              )
              .setOrigin(0.5)
              .setDepth(1),
          );
        this.chunks.set(key, { map, labels });
      }
    }
    for (const [key, chunk] of this.chunks) {
      if (!wanted.has(key)) {
        chunk.map.destroy();
        chunk.labels.forEach((label) => label.destroy());
        this.chunks.delete(key);
      }
    }
    this.onView(this.world, x, y, width, height);
  }
}
