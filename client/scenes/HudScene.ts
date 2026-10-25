import Phaser from 'phaser';
import { PLAYER } from '@shared/data/player';
import { MAX_PLAYERS, type PeerId } from '@shared/types';
import { dayClock } from '@shared/sim/dayNight';
import { isAlive, isDowned } from '@shared/sim/player';
import type { WireHorde } from '@net/gameCodec';
import { HORDE } from '@shared/sim/tuning/horde';
import { DAY, VISION } from '@shared/sim/tuning/night';
import { PARTY } from '@shared/sim/tuning/party';
import { visionPolygon, visionShapes } from '@shared/sim/vision';
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
  /** Số ô túi đã dùng (phần 2B loot). */
  private bagText!: Phaser.GameObjects.Text;
  /** Chữ dùng lại cho mũi tên và khung đội (tối đa MAX_PLAYERS - 1 đồng đội). */
  private arrowTexts: Phaser.GameObjects.Text[] = [];
  private teamTexts: Phaser.GameObjects.Text[] = [];
  private fpsShown = 0;
  private fpsAt = 0;
  /**
   * Lớp bóng tối + nón tầm nhìn (GĐ 4): lớp tối phủ cả màn hình, che bằng mặt nạ hình học đảo ngược
   * (stencil GPU): phần nón tầm nhìn bị "khoét". Rẻ hơn hẳn RenderTexture (đo GĐ 7: ~11 ms → ~2 ms/frame).
   */
  private vision!: Phaser.GameObjects.Rectangle;
  /**
   * Máy không có WebGL (Phaser.AUTO lùi về Canvas): Canvas không hỗ trợ mặt nạ đảo ngược (nó sẽ cắt NGƯỢC
   * lại) → dùng RenderTexture tô tối rồi xóa phần nhìn thấy như trước (chậm hơn nhưng đúng).
   */
  private visionRt: Phaser.GameObjects.RenderTexture | null = null;
  private visionShape!: Phaser.GameObjects.Graphics;
  private clockText!: Phaser.GameObjects.Text;
  /** Trời đỏ dần trước đợt tràn (GĐ 5). */
  private sky!: Phaser.GameObjects.Graphics;
  /** Bảng thành tích đội sau đợt tràn: hiện tới thời điểm này (ms). */
  private resultText!: Phaser.GameObjects.Text;
  private resultUntil = 0;
  private resultFor = 0;

  constructor() {
    super('hud');
  }

  create() {
    this.world = this.scene.get('world') as WorldScene;
    const { width, height } = this.scale;
    // tạo trước để nằm dưới mọi chữ/thanh của HUD
    this.vision = this.add.rectangle(0, 0, width, height, 0x05070c, 0).setOrigin(0, 0);
    this.visionShape = this.make.graphics({}, false);
    if (this.game.renderer.type === Phaser.CANVAS) {
      this.vision.setVisible(false);
      this.visionRt = this.add.renderTexture(0, 0, width, height).setOrigin(0, 0);
    } else {
      this.vision.setMask(this.visionShape.createGeometryMask().setInvertAlpha(true));
    }
    this.sky = this.add.graphics();
    this.scale.on('resize', (size: Phaser.Structs.Size) => {
      this.vision.setSize(size.width, size.height);
      this.visionRt?.resize(size.width, size.height);
    });
    this.gfx = this.add.graphics();
    const style = { fontFamily: FONT, fontSize: '13px', color: '#e6ebe7' };
    this.fpsText = this.add.text(0, 0, '', { ...style, fontFamily: 'Consolas, monospace' }).setOrigin(1, 0);
    this.barText = this.add.text(0, 0, '', { ...style, fontSize: '11px', color: '#8d9891' });
    this.bagText = this.add.text(0, 0, '', { ...style, fontSize: '11px', color: '#8d9891' });
    this.hintText = this.add.text(
      0,
      0,
      'WASD đi · Shift chạy · Chuột trái chém · E cửa · F đèn pin/mở rương · I túi · Esc đóng · R cứu · G kéo · F3 mạng',
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
    this.resultText = this.add
      .text(0, 0, '', {
        ...style,
        fontSize: '14px',
        align: 'center',
        backgroundColor: '#000000aa',
        padding: { x: 14, y: 10 },
      })
      .setOrigin(0.5, 0)
      .setVisible(false);
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

  /** Thời gian vẽ HUD mỗi frame (ms, làm mượt) — bảng F3 (lớp tối/tầm nhìn nằm ở đây). */
  hudMs = 0;

  override update(time: number) {
    const t0 = performance.now();
    this.drawHud(time);
    this.hudMs = this.hudMs * 0.9 + (performance.now() - t0) * 0.1;
  }

  private drawHud(time: number) {
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
    const horde = net?.sync.latest?.horde ?? null;
    this.drawSky(clock.day + clock.time, horde);
    this.topBar(clock, horde);
    this.hordeResult(time, horde);
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
    const bag = this.world.lootUi.bag;
    this.bagText
      .setVisible(bag !== null)
      .setText(bag ? `Túi ${bag.used}/${bag.size} ô` : '')
      .setColor(bag && bag.used >= bag.size ? '#ffb74d' : '#8d9891')
      .setPosition(x + w + 8, yStam - 4);
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
    const view = this.world.myView();
    const me = this.world.me();
    this.visionRt?.clear();
    if (!view || !me || !isAlive(me)) {
      this.vision.setVisible(false);
      return;
    }
    const cam = this.world.cameras.main;
    const wv = cam.worldView;
    const toScreen = (p: { x: number; y: number }) => ({
      x: (p.x * 16 - wv.x) * cam.zoom,
      y: (p.y * 16 - wv.y) * cam.zoom,
    });
    const dim = VISION.dimDay + (VISION.dimNight - VISION.dimDay) * darkness;
    if (!this.visionRt) this.vision.setVisible(true).setFillStyle(0x05070c, dim);
    const g = this.visionShape;
    g.clear();
    g.fillStyle(0xffffff, 1);
    // mỗi vùng = đa giác bắn tia theo lưới ô: tường/cửa đóng chặn tầm nhìn (shared/sim/vision.ts)
    const blocked = this.world.net.sync.blocked;
    for (const v of visionShapes({ ...view, flashlight: me.flashlight }, darkness, others)) {
      const poly = visionPolygon(v, v.facing, v.halfAngle, v.range, blocked).map(toScreen);
      g.fillPoints(poly, true);
    }
    if (this.visionRt) this.visionRt.fill(0x05070c, dim).erase(g);
  }

  /**
   * Thanh trên cùng (AGENTS.md mục 3): "Ngày X · HH:MM · Đợt tràn còn Y ngày"; trong đợt tràn:
   * "ĐỢT TRÀN #n · còn R zombie · BOSS".
   */
  private topBar(clock: { day: number; time: number; night: boolean }, horde: WireHorde | null) {
    const { width } = this.scale;
    if (horde?.active) {
      this.clockText
        .setText(
          `⚠ ĐỢT TRÀN #${horde.number} · còn ${horde.remaining} zombie${horde.bossAlive ? ' · BOSS!' : ''}`,
        )
        .setColor('#ff5252')
        .setPosition(width / 2, 10);
      return;
    }
    const hh = Math.floor(clock.time * 24);
    const mm = Math.floor((clock.time * 24 - hh) * 60);
    const nextDay = Math.ceil(clock.day / HORDE.everyDays) * HORDE.everyDays;
    const daysLeft = nextDay - clock.day;
    // đúng ngày 15 trước lúc tối hẳn: "đêm nay"; đã qua giờ (đợt vừa xong) thì tính tới đợt sau
    const left =
      daysLeft > 0
        ? `còn ${daysLeft} ngày`
        : clock.time < DAY.nightStart
          ? 'ĐÊM NAY'
          : `còn ${HORDE.everyDays} ngày`;
    this.clockText
      .setText(
        `Ngày ${clock.day} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}${clock.night ? ' · Đêm' : ''} · Đợt tràn ${left}`,
      )
      .setColor(daysLeft <= 2 ? '#ff8a65' : clock.night ? '#9fa8da' : '#ffe082')
      .setPosition(width / 2, 10);
  }

  /** Trời đỏ dần từ ngày 13 của chu kỳ tới đêm ngày 15; đỏ hẳn trong lúc đợt tràn. */
  private drawSky(dayFloat: number, horde: WireHorde | null) {
    const { width, height } = this.scale;
    const g = this.sky;
    g.clear();
    const cycle = ((dayFloat - 1) % HORDE.everyDays) + 1; // 1.0 … 15.99
    const ramp = (cycle - HORDE.redSkyFromDay) / (HORDE.everyDays + DAY.nightStart - HORDE.redSkyFromDay);
    const red = horde?.active ? 1 : Math.max(0, Math.min(1, ramp));
    if (red > 0) g.fillStyle(0xb71c1c, 0.22 * red).fillRect(0, 0, width, height);
  }

  /** Bảng thành tích đội khi đợt tràn vừa xong (20 giây). */
  private hordeResult(now: number, horde: WireHorde | null) {
    if (horde && !horde.active && horde.survived !== null && this.resultFor !== horde.number) {
      this.resultFor = horde.number;
      this.resultUntil = now + 20000;
      const rows = horde.rows
        .map((r) => {
          const id = this.world.net.sync.peerOfSlot(r.slot);
          const name = id ? this.world.peerInfo(id).name : `Người chơi ${r.slot + 1}`;
          return `${name}: ${r.kills} zombie · gục ${r.downs} lần`;
        })
        .join('\n');
      const title = horde.survived
        ? `SỐNG SÓT ĐỢT TRÀN #${horde.number}!`
        : `THẤT BẠI ĐỢT TRÀN #${horde.number}`;
      this.resultText
        .setText(
          `${title}\n\n${rows}${horde.survived ? '\n\n(Thùng thưởng huyền thoại: chờ GĐ 3 của B)' : ''}`,
        )
        .setColor(horde.survived ? '#ffe082' : '#ef9a9a');
    }
    const show = now < this.resultUntil;
    this.resultText.setVisible(show).setPosition(this.scale.width / 2, this.scale.height * 0.28);
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
