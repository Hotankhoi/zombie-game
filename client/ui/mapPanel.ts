import type Phaser from 'phaser';
import { CHUNK_SIZE, TILE_SIZE, worldSeedForRoom, type WorldMap } from '@shared/mapgen/world';
import { DISTRICT_NAMES, TILE_COLORS, WorldView } from './worldView';
import './mapPanel.css';

export function mountMapPanel(parent: HTMLElement, game: Phaser.Game, room: string, tick: () => void) {
  const root = document.createElement('section');
  root.className = 'map-panel';
  root.setAttribute('aria-label', 'Bản đồ thế giới');
  const button = document.createElement('button');
  button.textContent = 'Xem bản đồ';
  button.setAttribute('aria-expanded', 'false');
  const details = document.createElement('div');
  details.className = 'map-details';
  details.hidden = true;
  const help = document.createElement('p');
  help.textContent =
    'Phím mũi tên hoặc kéo bản đồ để khám phá. Khung trắng trên bản đồ nhỏ là vùng đang xem.';
  const status = document.createElement('p');
  status.className = 'map-position';
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = CHUNK_SIZE * 5;
  canvas.setAttribute('aria-label', 'Bản đồ nhỏ và vùng đang xem');
  const legend = document.createElement('p');
  legend.textContent = 'Xanh: đất · Xám đậm: đường · Xám sáng: vỉa hè · Vàng: cửa';
  details.append(help, status, canvas, legend);
  root.append(button, details);
  parent.append(root);
  const ctx = canvas.getContext('2d')!;
  const terrain = document.createElement('canvas');
  terrain.width = terrain.height = canvas.width;
  const terrainCtx = terrain.getContext('2d')!;
  let lastChunk = '';
  let open = false;
  let originX = 0;
  let originY = 0;
  const lobby = parent.querySelector<HTMLElement>('.panel:not(.debug)');

  function onView(world: WorldMap, x: number, y: number, width: number, height: number) {
    const cx = Math.floor((x + width / 2) / TILE_SIZE / CHUNK_SIZE);
    const cy = Math.floor((y + height / 2) / TILE_SIZE / CHUNK_SIZE);
    const key = `${cx},${cy}`;
    if (key !== lastChunk) {
      lastChunk = key;
      originX = (cx - 2) * CHUNK_SIZE;
      originY = (cy - 2) * CHUNK_SIZE;
      const image = terrainCtx.createImageData(canvas.width, canvas.height);
      for (let dy = 0; dy < 5; dy++)
        for (let dx = 0; dx < 5; dx++) {
          const chunk = world.getChunk(cx - 2 + dx, cy - 2 + dy);
          chunk.tiles.forEach((tile, i) => {
            const px = dx * CHUNK_SIZE + (i % CHUNK_SIZE);
            const py = dy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
            const offset = (py * canvas.width + px) * 4;
            const color = TILE_COLORS[tile]!;
            image.data[offset] = color >> 16;
            image.data[offset + 1] = (color >> 8) & 255;
            image.data[offset + 2] = color & 255;
            image.data[offset + 3] = 255;
          });
        }
      terrainCtx.putImageData(image, 0, 0);
      status.textContent = `${DISTRICT_NAMES[world.getChunk(cx, cy).district]} · Khu ${cx}, ${cy}`;
    }
    ctx.drawImage(terrain, 0, 0);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.strokeRect(x / TILE_SIZE - originX, y / TILE_SIZE - originY, width / TILE_SIZE, height / TILE_SIZE);
  }

  game.scene.add('world-map', WorldView, false);
  button.addEventListener('click', () => {
    open = !open;
    button.textContent = open ? 'Về phòng chờ' : 'Xem bản đồ';
    button.setAttribute('aria-expanded', String(open));
    details.hidden = !open;
    if (lobby) lobby.hidden = open;
    if (open) {
      lastChunk = '';
      game.scene.sleep('lobby');
      game.scene.getScene('lobby').scene.setVisible(false);
      game.scene.start('world-map', { seed: worldSeedForRoom(room), tick, onView });
    } else {
      game.scene.stop('world-map');
      game.scene.wake('lobby');
      game.scene.getScene('lobby').scene.setVisible(true);
    }
  });
}
