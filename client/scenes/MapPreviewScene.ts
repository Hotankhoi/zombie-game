import Phaser from 'phaser';
import {
  CHUNK_SIZE,
  MAX_CHUNK,
  TILE_SIZE,
  WorldMap,
  worldSeedForRoom,
  type Chunk,
} from '@shared/mapgen/world';
import { MapRenderer } from '../render/mapRenderer';
import { mountMapPanel } from '../ui/mapPanel';

/** Isolated visual check for 1b. A owns the real world scene and player movement. */
export class MapPreviewScene extends Phaser.Scene {
  private world!: WorldMap;
  private mapRenderer!: MapRenderer;
  private panel!: ReturnType<typeof mountMapPanel>;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;

  constructor() {
    super('map-preview');
  }

  create() {
    const room = new URLSearchParams(window.location.search).get('room') || 'MAP001';
    this.world = new WorldMap(worldSeedForRoom(room));
    this.mapRenderer = new MapRenderer(this);
    this.panel = mountMapPanel(document.getElementById('hud')!);
    this.cameras.main.setZoom(2).centerOn((CHUNK_SIZE * TILE_SIZE) / 2, (CHUNK_SIZE * TILE_SIZE) / 2);
    this.cursors = this.input.keyboard!.createCursorKeys();
    const drag = (p: Phaser.Input.Pointer) => {
      if (p.isDown) {
        this.cameras.main.scrollX -= (p.x - p.prevPosition.x) / this.cameras.main.zoom;
        this.cameras.main.scrollY -= (p.y - p.prevPosition.y) / this.cameras.main.zoom;
      }
    };
    this.input.on('pointermove', drag);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.panel.destroy();
      this.input.off('pointermove', drag);
      this.input.keyboard?.removeAllKeys(true);
    });
  }

  override update(_time: number, delta: number) {
    const camera = this.cameras.main;
    const step = Math.min(delta, 50) * 0.25;
    camera.scrollX += (Number(this.cursors.right.isDown) - Number(this.cursors.left.isDown)) * step;
    camera.scrollY += (Number(this.cursors.down.isDown) - Number(this.cursors.up.isDown)) * step;
    const chunkPixels = CHUNK_SIZE * TILE_SIZE;
    const limit = (MAX_CHUNK - 4) * chunkPixels;
    camera.scrollX = Phaser.Math.Clamp(camera.scrollX, -limit, limit);
    camera.scrollY = Phaser.Math.Clamp(camera.scrollY, -limit, limit);
    const width = camera.width / camera.zoom;
    const height = camera.height / camera.zoom;
    const x = camera.scrollX + (camera.width - width) / 2;
    const y = camera.scrollY + (camera.height - height) / 2;
    const visible: Chunk[] = [];
    for (let cy = Math.floor(y / chunkPixels); cy <= Math.floor((y + height) / chunkPixels); cy++) {
      for (let cx = Math.floor(x / chunkPixels); cx <= Math.floor((x + width) / chunkPixels); cx++) {
        visible.push(this.world.getChunk(cx, cy));
      }
    }
    this.mapRenderer.sync(visible);
    this.panel.update(this.world, x, y, width, height);
  }
}
