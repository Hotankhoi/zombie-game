import Phaser from 'phaser';
import { PLAYER } from '@shared/data/player';
import { MAX_PLAYERS, type PeerId } from '@shared/types';
import { dayClock } from '@shared/sim/dayNight';
import { isAlive, isDowned } from '@shared/sim/player';
import { VISION } from '@shared/sim/tuning/night';
import { PARTY } from '@shared/sim/tuning/party';
import type { WorldScene } from './WorldScene';

const FONT = 'Segoe UI, system-ui, sans-serif';
/** Mũi tên đồng đội cách mép màn hình (px). */
const ARROW_MARGIN = 30;

/**
 * HUD TẠM của A: thanh máu/stamina, FPS, chữ hồi sinh/gục, gợi ý phím, và phần đồng đội của GĐ 2c
 * (AGENTS.md mục 3 "Hợp tác & định vị"): mũi tên mép màn hình (tên, khoảng cách, màu riêng),
 * khung trạng thái đội (máu, gục, đang được cứu).
 * Không zoom (camera riêng). HUD thật (túi đồ, chỉ số đói/khát…) là của B trong /client/ui.
 */
export class HudScene extends Phaser.Scene {
  private world!: WorldScene;
  private gfx!: Phaser.GameObjects.Graphics;
  private fpsText!: Phaser.GameObjects.Text;
  private respawnText!: Phaser.GameObjects.Text;
  private subText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private barText!: Phaser.GameObjects.Text;
  /** Chữ dùng lại cho mũi tên và khung đội (tối đa MAX_PLAYERS - 1 đồng đội). */
  private arrowTexts: Phaser.GameObjects.Text[] = [];
  private teamTexts: Phaser.GameObjects.Text[] = [];
  private fpsShown = 0;
  private fpsAt = 0;
  /** Lớp bóng tối + nón tầm nhìn (GĐ 4): tô tối cả màn hình rồi "khoét" phần nhìn thấy. */
  private vision!: Phaser.GameObjects.RenderTexture;
  private visionShape!: Phaser.GameObjects.Graphics;
  private clockText!: Phaser.GameObjects.Text;

  constructor() {
    super('hud');
  }

  create() {
    this.world = this.scene.get('world') as WorldScene;
    const { width, height } = this.scale;
    // tạo trước để nằm dưới mọi chữ/thanh của HUD
    this.vision = this.add.renderTexture(0, 0, width, height).setOrigin(0, 0);
    this.visionShape = this.make.graphics({}, false);
    this.scale.on('resize', (size: Phaser.Structs.Size) => this.vision.resize(size.width, size.height));
    this.gfx = this.add.graphics();
    const style = { fontFamily: FONT, fontSize: '13px', color: '#e6ebe7' };
    this.fpsText = this.add.text(0, 0, '', { ...style, fontFamily: 'Consolas, monospace' }).setOrigin(1, 0);
    this.barText = this.add.text(0, 0, '', { ...style, fontSize: '11px', color: '#8d9891' });
    this.hintText = this.add.text(
      0,
      0,
      'WASD đi · Shift chạy · Chuột trái chém · E mở/đóng cửa · F đèn pin · R cứu · G kéo người gục · F3 mạng',
      { ...style, fontSize: '12px', color: '#8d9891' },
    );
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
    this.clockText = this.add
      .text(0, 10, '', { ...style, fontSize: '14px', fontStyle: 'bold', stroke: '#000', strokeThickness: 3 })
      .setOrigin(0.5, 0);
    this.subText = this.add
      .text(0, 0, '', { ...style, fontSize: '15px', stroke: '#000', strokeThickness: 3 })
      .setOrigin(0.5);
    for (let i = 0; i < MAX_PLAYERS - 1; i++) {
      this.arrowTexts.push(
        this.add
          .text(0, 0, '', { ...style, fontSize: '11px', stroke: '#000', strokeThickness: 3 })
          .setOrigin(0.5),
      );
      this.teamTexts.push(this.add.text(0, 0, '', { ...style, fontSize: '11px' }));
    }
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
    const net = this.world.net;
    const zombies = net?.sync.zombieCount ?? 0;
    const role = net?.role === 'host' ? 'Host' : net?.role === 'client' ? 'Khách' : 'Đang tìm host…';
    this.fpsText
      .setText(`${Math.round(this.fpsShown)} FPS · ${zombies} zombie gần · ${role}`)
      .setPosition(width - 16, 12);

    const others = net ? net.sync.sample().others : [];
    const clock = dayClock(net ? net.sync.serverTick() : 0);
    this.drawVision(clock.darkness, others);
    const hh = Math.floor(clock.time * 24);
    const mm = Math.floor((clock.time * 24 - hh) * 60);
    this.clockText
      .setText(
        `Ngày ${clock.day} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}${clock.night ? ' · Đêm' : ''}`,
      )
      .setColor(clock.night ? '#9fa8da' : '#ffe082')
      .setPosition(width / 2, 10);
    this.drawTeam(g, others, me ? { x: me.x, y: me.y } : null);

    if (!me) {
      const full = net?.roomFull;
      this.respawnText
        .setVisible(true)
        .setText(full ? `Phòng đã đủ ${full} người` : 'Đang vào trận…')
        .setPosition(width / 2, height / 2 - 60);
      this.subText
        .setVisible(!!full)
        .setText('Bạn đang xem. Khi có người rời phòng, bạn sẽ tự vào trận.')
        .setPosition(width / 2, height / 2 - 28);
      return;
    }
    const x = 16;
    const w = Math.min(220, width - 32);
    const yHp = height - 44;
    const yStam = height - 28;
    this.bar(g, x, yHp, w, 10, me.hp / PLAYER.maxHp, 0xe53935);
    this.bar(g, x, yStam, w, 6, me.stamina / PLAYER.maxStamina, me.exhausted ? 0x6d6d6d : 0xfdd835);
    this.barText.setText(`Máu ${Math.ceil(me.hp)}`).setPosition(x + w + 8, yHp - 3);
    this.hintText.setPosition(x, height - 66);

    this.subText.setVisible(false);
    if (!isAlive(me)) {
      this.respawnText
        .setVisible(true)
        .setText(`Bạn đã chết · hồi sinh sau ${Math.ceil(me.respawnIn)}s`)
        .setPosition(width / 2, height / 2 - 60);
    } else if (isDowned(me)) {
      this.respawnText
        .setVisible(true)
        .setText(`Bạn đang gục · chết sau ${Math.ceil(me.downedFor)}s`)
        .setPosition(width / 2, height / 2 - 60);
      const saving = me.reviveProgress > 0;
      this.subText
        .setVisible(true)
        .setText(
          saving
            ? `Đồng đội đang cứu… ${Math.round((me.reviveProgress / PARTY.reviveSec) * 100)}%`
            : 'Bò về phía đồng đội · đồng đội giữ R cạnh bạn để cứu',
        )
        .setPosition(width / 2, height / 2 - 28);
    } else {
      this.respawnText.setVisible(false);
    }
  }

  /**
   * Tầm nhìn hình nón + đèn pin (AGENTS.md mục 3): ngoài nón bị tô tối — ban ngày mờ nhẹ, ban đêm gần như đen.
   * Đêm không đèn chỉ thấy rất gần; bật đèn (F) soi xa trong nón hẹp. Đèn của đồng đội cũng soi sáng.
   * Chưa tính tường che khuất (tia nhìn xuyên tường) — để sau.
   */
  private drawVision(
    darkness: number,
    others: readonly { x: number; y: number; facing: number; alive: boolean; flashlight: boolean }[],
  ) {
    const rt = this.vision;
    rt.clear();
    const view = this.world.myView();
    const me = this.world.me();
    if (!view || !me || !isAlive(me)) return;
    const cam = this.world.cameras.main;
    const wv = cam.worldView;
    const px = 16 * cam.zoom; // pixel màn hình mỗi ô
    const toScreen = (x: number, y: number) => ({
      x: (x * 16 - wv.x) * cam.zoom,
      y: (y * 16 - wv.y) * cam.zoom,
    });
    const lerp = (a: number, b: number) => a + (b - a) * darkness;

    rt.fill(0x05070c, lerp(VISION.dimDay, VISION.dimNight));
    const g = this.visionShape;
    g.clear();
    g.fillStyle(0xffffff, 1);
    const cone = (x: number, y: number, facing: number, range: number, halfDeg: number) => {
      const s = toScreen(x, y);
      const half = (halfDeg * Math.PI) / 180;
      g.slice(s.x, s.y, range * px, facing - half, facing + half, false);
      g.fillPath();
    };
    const lit = me.flashlight && darkness > 0.05;
    cone(view.x, view.y, view.facing, lerp(VISION.dayRange, VISION.nightRange), VISION.coneHalfDeg);
    if (lit) cone(view.x, view.y, view.facing, VISION.flashlightRange, VISION.flashlightHalfDeg);
    const s = toScreen(view.x, view.y);
    g.fillCircle(s.x, s.y, lerp(VISION.aroundDay, VISION.aroundNight) * px);
    for (const o of others) {
      if (o.alive && o.flashlight && darkness > 0.05) {
        cone(o.x, o.y, o.facing, VISION.flashlightRange, VISION.flashlightHalfDeg);
      }
    }
    rt.erase(g);
  }

  /** Khung trạng thái đội (góc dưới trái, trên thanh máu) + mũi tên chỉ đồng đội ngoài màn hình. */
  private drawTeam(
    g: Phaser.GameObjects.Graphics,
    others: readonly {
      id: PeerId;
      x: number;
      y: number;
      alive: boolean;
      hp: number;
      downedFor: number;
      reviveProgress: number;
    }[],
    me: { x: number; y: number } | null,
  ) {
    const { width, height } = this.scale;
    const cam = this.world.cameras.main;
    const view = cam.worldView;
    const T = 16;
    for (let i = 0; i < this.arrowTexts.length; i++) {
      const p = others[i];
      const arrow = this.arrowTexts[i] as Phaser.GameObjects.Text;
      const row = this.teamTexts[i] as Phaser.GameObjects.Text;
      if (!p) {
        arrow.setVisible(false);
        row.setVisible(false);
        continue;
      }
      const info = this.world.peerInfo(p.id);
      const downed = p.alive && p.downedFor > 0;

      // khung đội
      const rx = 16;
      const ry = height - 96 - i * 26;
      const status = !p.alive
        ? 'đã chết'
        : downed
          ? p.reviveProgress > 0
            ? `GỤC · đang được cứu ${Math.round((p.reviveProgress / PARTY.reviveSec) * 100)}%`
            : `GỤC · còn ${Math.ceil(p.downedFor)}s`
          : `${Math.ceil(p.hp)} máu`;
      row
        .setVisible(true)
        .setText(`${info.name} · ${status}`)
        .setColor(downed ? '#ef5350' : '#e6ebe7')
        .setPosition(rx + 10, ry - 2);
      g.fillStyle(info.color).fillCircle(rx + 3, ry + 5, 4);
      this.bar(g, rx + 10, ry + 12, 120, 3, p.alive && !downed ? p.hp / PLAYER.maxHp : 0, 0xe53935);

      // mũi tên mép màn hình khi đồng đội ngoài tầm nhìn
      const sx = (p.x * T - view.x) * cam.zoom;
      const sy = (p.y * T - view.y) * cam.zoom;
      const inside = sx > 0 && sy > 0 && sx < width && sy < height;
      if (inside || !p.alive) {
        arrow.setVisible(false);
        continue;
      }
      const cx = width / 2;
      const cy = height / 2;
      const dx = sx - cx;
      const dy = sy - cy;
      const k = Math.min(
        (cx - ARROW_MARGIN) / Math.abs(dx || 1e-6),
        (cy - ARROW_MARGIN) / Math.abs(dy || 1e-6),
      );
      const ax = cx + dx * k;
      const ay = cy + dy * k;
      const ang = Math.atan2(dy, dx);
      const s = 9;
      g.fillStyle(downed ? 0xef5350 : info.color, 1);
      g.fillTriangle(
        ax + Math.cos(ang) * s,
        ay + Math.sin(ang) * s,
        ax + Math.cos(ang + 2.5) * s,
        ay + Math.sin(ang + 2.5) * s,
        ax + Math.cos(ang - 2.5) * s,
        ay + Math.sin(ang - 2.5) * s,
      );
      const dist = me ? Math.round(Math.hypot(p.x - me.x, p.y - me.y)) : 0;
      arrow.setVisible(true).setText(`${info.name} · ${dist}m${downed ? ' · GỤC' : ''}`);
      // chữ đặt phía trong mũi tên, kẹp trong màn hình (không bị cắt ở mép)
      const hw = arrow.width / 2 + 4;
      const hh = arrow.height / 2 + 2;
      arrow.setPosition(
        Phaser.Math.Clamp(ax - Math.cos(ang) * 22, hw, width - hw),
        Phaser.Math.Clamp(ay - Math.sin(ang) * 16, hh, height - hh),
      );
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
