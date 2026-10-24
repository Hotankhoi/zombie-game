import Phaser from 'phaser';
import { PLAYER } from '@shared/data/player';
import { isAlive } from '@shared/sim/player';
import type { WorldScene } from './WorldScene';

const FONT = 'Segoe UI, system-ui, sans-serif';

/**
 * HUD TẠM của GĐ 1a: thanh máu/stamina, FPS, chữ hồi sinh, gợi ý phím.
 * Không zoom (camera riêng). HUD thật (túi đồ, chỉ số đói/khát…) là của B ở GĐ 3 trong /client/ui.
 */
export class HudScene extends Phaser.Scene {
  private world!: WorldScene;
  private gfx!: Phaser.GameObjects.Graphics;
  private fpsText!: Phaser.GameObjects.Text;
  private respawnText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private barText!: Phaser.GameObjects.Text;
  private fpsShown = 0;
  private fpsAt = 0;

  constructor() {
    super('hud');
  }

  create() {
    this.world = this.scene.get('world') as WorldScene;
    this.gfx = this.add.graphics();
    const style = { fontFamily: FONT, fontSize: '13px', color: '#e6ebe7' };
    this.fpsText = this.add.text(0, 0, '', { ...style, fontFamily: 'Consolas, monospace' }).setOrigin(1, 0);
    this.barText = this.add.text(0, 0, '', { ...style, fontSize: '11px', color: '#8d9891' });
    this.hintText = this.add.text(0, 0, 'WASD đi · Shift chạy · Chuột trái chém · E mở/đóng cửa · F3 mạng', {
      ...style,
      fontSize: '12px',
      color: '#8d9891',
    });
    this.respawnText = this.add
      .text(0, 0, '', {
        ...style,
        fontSize: '26px',
        fontStyle: 'bold',
        color: '#ef5350',
        stroke: '#000',
        strokeThickness: 4,
      })
      .setOrigin(0.5);
  }

  override update(time: number) {
    const { width, height } = this.scale;
    const me = this.world.me();
    const g = this.gfx;
    g.clear();

    // FPS (cập nhật 2 lần/giây cho dễ đọc)
    if (time - this.fpsAt > 500) {
      this.fpsShown = this.game.loop.actualFps;
      this.fpsAt = time;
    }
    const zombies = this.world.sim?.zombies.length ?? 0;
    this.fpsText.setText(`${Math.round(this.fpsShown)} FPS · ${zombies} zombie`).setPosition(width - 16, 12);

    if (!me) return;
    const x = 16;
    const w = Math.min(220, width - 32);
    const yHp = height - 44;
    const yStam = height - 28;
    this.bar(g, x, yHp, w, 10, me.hp / PLAYER.maxHp, 0xe53935);
    this.bar(g, x, yStam, w, 6, me.stamina / PLAYER.maxStamina, me.exhausted ? 0x6d6d6d : 0xfdd835);
    this.barText.setText(`Máu ${Math.ceil(me.hp)}`).setPosition(x + w + 8, yHp - 3);
    this.hintText.setPosition(x, height - 66);

    if (isAlive(me)) {
      this.respawnText.setVisible(false);
    } else {
      this.respawnText
        .setVisible(true)
        .setText(`Bạn đã chết · hồi sinh sau ${Math.ceil(me.respawnIn)}s`)
        .setPosition(width / 2, height / 2 - 60);
    }
  }

  private bar(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    w: number,
    h: number,
    frac: number,
    color: number,
  ) {
    g.fillStyle(0x000000, 0.55).fillRect(x - 1, y - 1, w + 2, h + 2);
    g.fillStyle(color).fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
  }
}
