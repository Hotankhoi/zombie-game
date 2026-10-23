import Phaser from 'phaser';
import type { Session } from '@net/session';

/**
 * Cảnh phòng chờ: nền tối có lưới, mỗi người chơi là một chấm màu xếp quanh vòng tròn.
 * Giai đoạn 1a sẽ thay bằng cảnh thế giới thật.
 */
export class LobbyScene extends Phaser.Scene {
  private session!: Session;
  private gfx!: Phaser.GameObjects.Graphics;
  private labels = new Map<string, Phaser.GameObjects.Text>();
  private myColor = 0xffffff;
  private myName = '';

  constructor() {
    super('lobby');
  }

  init(data: { session: Session; name: string; color: number }) {
    this.session = data.session;
    this.myColor = data.color;
    this.myName = data.name;
  }

  setMe(name: string, color: number) {
    this.myName = name;
    this.myColor = color;
  }

  create() {
    this.gfx = this.add.graphics();
  }

  override update(time: number) {
    this.session.tick();
    const { width, height } = this.scale;
    const cx = width / 2 + Math.min(180, width * 0.15);
    const cy = height / 2;
    const g = this.gfx;
    g.clear();

    // lưới nền
    g.lineStyle(1, 0x1b211e, 1);
    for (let x = 0; x < width; x += 48) g.lineBetween(x, 0, x, height);
    for (let y = 0; y < height; y += 48) g.lineBetween(0, y, width, y);

    const people = [
      { id: this.session.selfId, name: `${this.myName} (bạn)`, color: this.myColor },
      ...[...this.session.peers.values()].map((p) => ({ id: p.id, name: p.name, color: p.color })),
    ];
    const r = Math.min(140, Math.min(width, height) * 0.22);
    const seen = new Set<string>();
    people.forEach((p, i) => {
      const a = (i / Math.max(1, people.length)) * Math.PI * 2 - Math.PI / 2;
      const bob = Math.sin(time / 500 + i) * 4;
      const x = cx + (people.length > 1 ? Math.cos(a) * r : 0);
      const y = cy + (people.length > 1 ? Math.sin(a) * r : 0) + bob;
      g.fillStyle(p.color, 0.18).fillCircle(x, y, 30);
      g.fillStyle(p.color, 1).fillCircle(x, y, 14);
      seen.add(p.id);
      let t = this.labels.get(p.id);
      if (!t) {
        t = this.add.text(0, 0, '', {
          fontFamily: 'Segoe UI, system-ui',
          fontSize: '14px',
          color: '#e6ebe7',
        });
        t.setOrigin(0.5, 0);
        this.labels.set(p.id, t);
      }
      t.setText(p.name).setPosition(x, y + 34);
    });
    for (const [id, t] of this.labels) {
      if (!seen.has(id)) {
        t.destroy();
        this.labels.delete(id);
      }
    }
  }
}
