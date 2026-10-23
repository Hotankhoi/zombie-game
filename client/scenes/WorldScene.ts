import Phaser from 'phaser';
import { KNIFE } from '@shared/data/melee';
import { PLAYER } from '@shared/data/player';
import { ZOMBIE_NORMAL } from '@shared/data/zombies';
import { SIM_TICK_MS, type PeerId, type Vec2 } from '@shared/types';
import { arenaMap, type GridMap } from '@shared/sim/grid';
import { Btn, radToAim, type PlayerInput } from '@shared/sim/input';
import { isAlive, type PlayerState } from '@shared/sim/player';
import { SimWorld, type SimEvent } from '@shared/sim/world';
import type { Session } from '@net/session';

/** 1 ô mô phỏng = 16 px (khớp tile Kenney 16×16). Tọa độ sim tính theo ô. */
export const TILE_SIZE = 16;
const ZOOM = 3;
/** Tối đa bao nhiêu tick chạy bù trong 1 frame (tab bị treo lâu thì bỏ, không chạy dồn). */
const MAX_CATCHUP_TICKS = 5;

export interface WorldSceneData {
  session: Session;
  name: string;
  color: number;
  /** Seed thế giới (mã phòng). */
  seed: string;
  zombieCount?: number;
}

/** Hiệu ứng tạm thời vẽ bằng code (thay bằng sprite/particle sau). */
interface Fx {
  kind: 'swing' | 'hit' | 'blood';
  x: number;
  y: number;
  facing: number;
  born: number;
  life: number;
}

/**
 * Cảnh thế giới (GĐ 1a): chạy SimWorld tick cố định 20Hz, vẽ 60fps có nội suy.
 * Hình vẽ tạm bằng code — tên hàm draw* để sau thay bằng sprite Kenney.
 * GĐ 1a chưa đồng bộ mạng: mỗi máy chạy mô phỏng riêng (cùng seed phòng).
 */
export class WorldScene extends Phaser.Scene {
  private session!: Session;
  private myColor = 0xffffff;
  private myName = '';
  private seed = '';
  private zombieCount: number | undefined;

  sim!: SimWorld;
  private map!: GridMap;
  private doorTiles: Vec2[] = [];
  private acc = 0;
  private seq = 0;
  /** Vị trí trước tick vừa chạy — để nội suy khi vẽ. */
  private prevPlayers = new Map<PeerId, Vec2>();
  private prevZombies = new Map<number, Vec2>();
  private hitFlash = new Map<number, number>();
  private fx: Fx[] = [];

  private gfxDoors!: Phaser.GameObjects.Graphics;
  private gfxDecals!: Phaser.GameObjects.Graphics;
  private gfxDyn!: Phaser.GameObjects.Graphics;
  private camTarget!: Phaser.GameObjects.Zone;
  private keys!: Record<
    'W' | 'A' | 'S' | 'D' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'SHIFT' | 'E',
    Phaser.Input.Keyboard.Key
  >;
  /** Bấm nhanh giữa 2 tick vẫn được tính. */
  private attackQueued = false;
  private interactQueued = false;
  private myAim = 0;

  constructor() {
    super('world');
  }

  init(data: WorldSceneData) {
    this.session = data.session;
    this.myColor = data.color;
    this.myName = data.name;
    this.seed = data.seed;
    this.zombieCount = data.zombieCount;
  }

  setMe(name: string, color: number) {
    this.myName = name;
    this.myColor = color;
  }

  get playerName(): string {
    return this.myName;
  }

  /** Nhân vật của mình (HUD đọc). */
  me(): PlayerState | undefined {
    return this.sim?.players.get(this.session.selfId);
  }

  create() {
    this.map = arenaMap();
    this.sim = new SimWorld({ seed: this.seed, map: this.map, zombieCount: this.zombieCount });
    this.sim.addPlayer(this.session.selfId);

    this.drawMapTexture();
    this.add.image(0, 0, 'arena-map').setOrigin(0, 0);
    this.gfxDecals = this.add.graphics();
    this.gfxDoors = this.add.graphics();
    this.gfxDyn = this.add.graphics();

    const cam = this.cameras.main;
    cam.setZoom(ZOOM);
    cam.setBounds(0, 0, this.map.width * TILE_SIZE, this.map.height * TILE_SIZE);
    const me = this.me()!;
    this.camTarget = this.add.zone(me.x * TILE_SIZE, me.y * TILE_SIZE, 1, 1);
    cam.startFollow(this.camTarget, false, 0.15, 0.15);
    cam.setDeadzone(12, 12);

    this.setupInput();
    // chỉ khi chạy npm run dev: mở console gõ __world để soi trạng thái mô phỏng
    if (import.meta.env.DEV) (window as unknown as { __world: WorldScene }).__world = this;
  }

  private setupInput() {
    const kb = this.input.keyboard!;
    // enableCapture = false: không chặn phím mặc định → vẫn gõ được W/A/S/D/E vào ô tên ở bảng phòng chờ
    this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,SHIFT,E', false) as typeof this.keys;
    this.keys.E.on('down', () => {
      if (!isTyping()) this.interactQueued = true;
    });
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.leftButtonDown()) this.attackQueued = true;
    });
  }

  override update(_time: number, delta: number) {
    this.session.tick();
    this.updateAim();

    this.acc += delta;
    let ticks = 0;
    while (this.acc >= SIM_TICK_MS && ticks < MAX_CATCHUP_TICKS) {
      this.stepSim();
      this.acc -= SIM_TICK_MS;
      ticks++;
    }
    if (ticks === MAX_CATCHUP_TICKS) this.acc = 0;

    this.render(this.acc / SIM_TICK_MS);
  }

  private stepSim() {
    this.prevPlayers.clear();
    for (const p of this.sim.players.values()) this.prevPlayers.set(p.id, { x: p.x, y: p.y });
    this.prevZombies.clear();
    for (const z of this.sim.zombies) this.prevZombies.set(z.id, { x: z.x, y: z.y });

    const input = this.readInput();
    this.sim.step(new Map([[this.session.selfId, input]]));
    for (const e of this.sim.events) this.onEvent(e);
  }

  private readInput(): PlayerInput {
    const k = this.keys;
    const typing = isTyping();
    let mx = 0;
    let my = 0;
    let buttons = 0;
    if (!typing) {
      mx = (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
      my = (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);
      if (k.SHIFT.isDown) buttons |= Btn.Sprint;
      if (k.E.isDown || this.interactQueued) buttons |= Btn.Interact;
      if (this.input.activePointer.leftButtonDown() || this.attackQueued) buttons |= Btn.Attack;
    }
    this.attackQueued = false;
    this.interactQueued = false;
    return { seq: ++this.seq, moveX: mx, moveY: my, aim: this.myAim, buttons };
  }

  private updateAim() {
    const me = this.me();
    if (!me) return;
    const pos = this.lerpPlayer(me, this.acc / SIM_TICK_MS);
    const ptr = this.input.activePointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    this.myAim = radToAim(Math.atan2(ptr.y - pos.y * TILE_SIZE, ptr.x - pos.x * TILE_SIZE));
  }

  private onEvent(e: SimEvent) {
    const now = this.time.now;
    switch (e.type) {
      case 'swing':
        this.fx.push({ kind: 'swing', x: e.x, y: e.y, facing: e.facing, born: now, life: 140 });
        break;
      case 'hit':
        this.hitFlash.set(e.zombie, now);
        this.fx.push({ kind: 'hit', x: e.x, y: e.y, facing: 0, born: now, life: 220 });
        if (e.killed) this.drawBloodDecal(e.x, e.y, e.zombie);
        if (e.assassination) this.floatText(e.x, e.y, 'Ám sát!', '#ffd54f');
        break;
      case 'bite':
        if (e.player === this.session.selfId) this.cameras.main.shake(90, 0.006);
        this.fx.push({ kind: 'blood', x: e.x, y: e.y, facing: 0, born: now, life: 300 });
        break;
      case 'death':
        if (e.player === this.session.selfId) this.cameras.main.flash(300, 120, 0, 0);
        break;
      case 'respawn':
      case 'door':
        break;
    }
  }

  // ---------------- Vẽ ----------------

  private render(alpha: number) {
    const g = this.gfxDyn;
    g.clear();
    const now = this.time.now;
    const T = TILE_SIZE;

    this.drawDoors();

    for (const z of this.sim.zombies) {
      const prev = this.prevZombies.get(z.id);
      const x = (prev ? prev.x + (z.x - prev.x) * alpha : z.x) * T;
      const y = (prev ? prev.y + (z.y - prev.y) * alpha : z.y) * T;
      const flash = now - (this.hitFlash.get(z.id) ?? -1e9) < 120;
      this.drawZombie(g, x, y, z.facing, z.mode === 'chase', flash);
    }

    for (const p of this.sim.players.values()) {
      if (!isAlive(p)) continue;
      const pos = this.lerpPlayer(p, alpha);
      const mine = p.id === this.session.selfId;
      const facing = mine ? (this.myAim / 256) * Math.PI * 2 : p.facing;
      this.drawPlayer(g, pos.x * T, pos.y * T, facing, mine ? this.myColor : 0xcccccc);
    }

    this.fx = this.fx.filter((f) => now - f.born < f.life);
    for (const f of this.fx) this.drawFx(g, f, (now - f.born) / f.life);

    const me = this.me();
    if (me) {
      const pos = this.lerpPlayer(me, alpha);
      this.camTarget.setPosition(pos.x * T, pos.y * T);
    }
  }

  private lerpPlayer(p: PlayerState, alpha: number): Vec2 {
    const prev = this.prevPlayers.get(p.id);
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > 2) return { x: p.x, y: p.y }; // hồi sinh: nhảy luôn
    return { x: prev.x + (p.x - prev.x) * alpha, y: prev.y + (p.y - prev.y) * alpha };
  }

  /** Nền + tường vẽ 1 lần vào texture (tạm, thay bằng tile Kenney). */
  private drawMapTexture() {
    const T = TILE_SIZE;
    const m = this.map;
    const g = this.make.graphics({}, false);
    g.fillStyle(0x1a1f1c).fillRect(0, 0, m.width * T, m.height * T);
    for (let ty = 0; ty < m.height; ty++) {
      for (let tx = 0; tx < m.width; tx++) {
        if (m.isDoor(tx, ty)) {
          this.doorTiles.push({ x: tx, y: ty });
        } else if (m.isWall(tx, ty)) {
          g.fillStyle(0x3b4540).fillRect(tx * T, ty * T, T, T);
          g.fillStyle(0x4b5751).fillRect(tx * T, ty * T, T, 3);
        } else if ((tx + ty) % 2 === 0) {
          g.fillStyle(0x1d2320).fillRect(tx * T, ty * T, T, T);
        }
      }
    }
    g.generateTexture('arena-map', m.width * T, m.height * T);
    g.destroy();
  }

  private drawDoors() {
    const T = TILE_SIZE;
    const g = this.gfxDoors;
    g.clear();
    for (const d of this.doorTiles) {
      const x = d.x * T;
      const y = d.y * T;
      if (this.sim.doors.isOpen(d.x, d.y)) {
        // cửa mở: cánh cửa áp sát một bên khung
        const horizontalWall = this.map.isWall(d.x - 1, d.y) || this.map.isWall(d.x + 1, d.y);
        g.fillStyle(0x6d4c41);
        if (horizontalWall) g.fillRect(x, y, 3, T);
        else g.fillRect(x, y, T, 3);
      } else {
        g.fillStyle(0x8d6e63).fillRect(x + 1, y + 1, T - 2, T - 2);
        g.fillStyle(0x5d4037).fillRect(x + T / 2 + 2, y + T / 2 - 1, 2, 2);
      }
    }
  }

  private drawZombie(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    facing: number,
    chasing: boolean,
    flash: boolean,
  ) {
    const r = ZOMBIE_NORMAL.radius * TILE_SIZE;
    g.fillStyle(flash ? 0xffffff : chasing ? 0x7d9a5c : 0x5e7560).fillCircle(x, y, r);
    const ex = Math.cos(facing);
    const ey = Math.sin(facing);
    const eyeColor = chasing ? 0xff5252 : 0x2c3a2e;
    for (const side of [-1, 1]) {
      g.fillStyle(eyeColor).fillCircle(
        x + ex * r * 0.55 - ey * side * r * 0.35,
        y + ey * r * 0.55 + ex * side * r * 0.35,
        1,
      );
    }
  }

  private drawPlayer(g: Phaser.GameObjects.Graphics, x: number, y: number, facing: number, color: number) {
    const r = PLAYER.radius * TILE_SIZE;
    g.fillStyle(color).fillCircle(x, y, r);
    g.lineStyle(1.5, 0xffffff, 0.9).lineBetween(
      x,
      y,
      x + Math.cos(facing) * (r + 4),
      y + Math.sin(facing) * (r + 4),
    );
  }

  private drawFx(g: Phaser.GameObjects.Graphics, f: Fx, t: number) {
    const T = TILE_SIZE;
    const x = f.x * T;
    const y = f.y * T;
    if (f.kind === 'swing') {
      const half = ((KNIFE.arcDeg / 2) * Math.PI) / 180;
      const reach = (PLAYER.radius + KNIFE.range) * T;
      g.lineStyle(2, 0xffffff, 0.7 * (1 - t));
      g.beginPath();
      g.arc(x, y, reach * (0.7 + 0.3 * t), f.facing - half, f.facing + half);
      g.strokePath();
    } else {
      const color = f.kind === 'hit' ? 0xd32f2f : 0xb71c1c;
      g.fillStyle(color, 0.8 * (1 - t)).fillCircle(x, y, 2 + 5 * t);
    }
  }

  /** Vết máu khi zombie chết (để lại trên sàn). */
  private drawBloodDecal(x: number, y: number, id: number) {
    const T = TILE_SIZE;
    const g = this.gfxDecals;
    g.fillStyle(0x4a1010, 0.7);
    for (let i = 0; i < 4; i++) {
      // vị trí giọt máu suy từ id (không cần ngẫu nhiên thật)
      const a = id * 1.7 + i * 2.1;
      g.fillCircle(x * T + Math.cos(a) * 3 * (i % 3), y * T + Math.sin(a) * 3 * (i % 3), 2 + (i % 2) * 1.5);
    }
  }

  private floatText(x: number, y: number, text: string, color: string) {
    const t = this.add
      .text(x * TILE_SIZE, y * TILE_SIZE - 8, text, {
        fontFamily: 'Segoe UI, system-ui',
        fontSize: '7px',
        fontStyle: 'bold',
        color,
        stroke: '#000000',
        strokeThickness: 2,
      })
      .setOrigin(0.5, 1)
      .setResolution(ZOOM * window.devicePixelRatio);
    this.tweens.add({ targets: t, y: t.y - 10, alpha: 0, duration: 900, onComplete: () => t.destroy() });
  }
}

/** Đang gõ chữ trong ô nhập (vd: ô tên ở bảng phòng chờ) → không coi phím là điều khiển game. */
function isTyping(): boolean {
  const el = document.activeElement;
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    (el as HTMLElement | null)?.isContentEditable === true
  );
}
