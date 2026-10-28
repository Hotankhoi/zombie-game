import { GroundLayer } from '../loot/groundLayer';
import Phaser from 'phaser';
import { KNIFE } from '@shared/data/melee';
import { PLAYER } from '@shared/data/player';
import { ZOMBIE_NORMAL } from '@shared/data/zombies';
import { CHUNK_SIZE, TILE_SIZE, WorldMap, type Chunk } from '@shared/mapgen/world';
import { SIM_TICK_MS, type PeerId, type Vec2 } from '@shared/types';
import { Btn, radToAim, type PlayerInput } from '@shared/sim/input';
import { isAlive, isDowned, isUp, type PlayerState } from '@shared/sim/player';
import { meleeOf, type WeaponId } from '@shared/sim/guns';
import { hasLineOfSight } from '@shared/sim/collision';
import { dayClock } from '@shared/sim/dayNight';
import { PARTY } from '@shared/sim/tuning/party';
import { seesPoint, visionShapes } from '@shared/sim/vision';
import { KIND, ZOMBIE_KINDS, type ZombieKind } from '@shared/sim/tuning/zombieKinds';
import { keyTile, type SimEvent } from '@shared/sim/world';
import type { Session } from '@net/session';
import type { RemotePlayerView } from '@net/clientSync';
import type { NetGame } from '../net/netGame';
import { MapRenderer, preloadMapTiles } from '../render/mapRenderer';
import { ChestLayer, preloadChestSprites } from '../loot/chestLayer';
import { LootUi } from '../loot/lootUi';
import { canKeepChestOpen } from '../loot/nearChest';

/** 1 ô mô phỏng = 16 px = 1 tile Kenney (TILE_SIZE của map B). Tọa độ sim tính theo ô. */
export { TILE_SIZE };
const ZOOM = 3;
/** Texture zombie vẽ to gấp bấy nhiêu lần rồi thu nhỏ lại → nét khi zoom. */
const TEX_SCALE = ZOOM;
/** Màu thân zombie theo loại (lang thang / đang đuổi) — hình tạm, thay bằng sprite sau. */
const KIND_COLORS: Record<ZombieKind, [number, number]> = {
  normal: [0x5e7560, 0x7d9a5c],
  runner: [0x8a9a5b, 0xa9bd6c],
  screamer: [0x7a5c8a, 0xa070bb],
  bloater: [0x9aa84a, 0xbccb57],
  spitter: [0x4f8a7f, 0x62b3a2],
  hider: [0x3f4a42, 0x5a6b5e],
  giant: [0x6e4a3e, 0x93604c],
  boss: [0x7f1d1d, 0xc62828],
};
const zombieTex = (kind: ZombieKind, state: 'wander' | 'chase' | 'flash') => `zombie-${kind}-${state}`;
/** Tối đa bao nhiêu tick chạy bù trong 1 frame (tab bị treo lâu thì bỏ, không chạy dồn). */
const MAX_CATCHUP_TICKS = 5;

export interface WorldSceneData {
  session: Session;
  net: NetGame;
  name: string;
  color: number;
}

/** Hiệu ứng tạm thời vẽ bằng code (thay bằng sprite/particle sau). */
interface Fx {
  kind: 'swing' | 'hit' | 'blood' | 'tracer' | 'muzzle';
  x: number;
  y: number;
  facing: number;
  born: number;
  life: number;
  /** tia đạn: dài bao nhiêu ô; vết chém: tầm + nửa góc quạt (theo vũ khí). */
  dist?: number;
  arc?: number;
}

/**
 * Cảnh thế giới (GĐ 2a): map thật của B (MapRenderer), trận online qua NetGame.
 * Nhân vật mình: dự đoán 20Hz + nội suy giữa 2 tick. Zombie/đồng đội: nội suy từ snapshot host.
 * Hình người/zombie vẽ tạm bằng code — tên hàm draw* để sau thay bằng sprite Kenney.
 */
export class WorldScene extends Phaser.Scene {
  private session!: Session;
  net!: NetGame;
  private myColor = 0xffffff;
  private myName = '';

  private worldMap!: WorldMap;
  private mapRenderer!: MapRenderer;
  /** Rương (phần 2B loot): thùng trong nhà, gợi ý F khi tới gần. */
  ground!: GroundLayer;
  chests!: ChestLayer;
  /** Panel túi (I) / rương (F); mở thì khóa điều khiển nhân vật. */
  lootUi!: LootUi;
  /** Vùng chunk đang vẽ "x0,y0,x1,y1" — chỉ sync renderer khi đổi. */
  private chunkRange = '';
  private acc = 0;
  private seq = 0;
  private hitFlash = new Map<number, number>();
  /** Người vừa hồi sinh → bất tử tới lúc này (ms, đồng hồ scene) — vẽ vòng bảo vệ quanh họ. */
  private shieldUntil = new Map<PeerId, number>();
  private fx: Fx[] = [];
  /** Thời gian xử lý 1 frame (ms, làm mượt) — bảng F3. */
  frameMs = 0;

  private gfxDoors!: Phaser.GameObjects.Graphics;
  private gfxDecals!: Phaser.GameObjects.Graphics;
  private gfxDyn!: Phaser.GameObjects.Graphics;
  /** Zombie vẽ bằng sprite từ texture dựng sẵn (Graphics vẽ lại 200 hình tròn mỗi frame tốn ~13ms). */
  private zombieSprites: Phaser.GameObjects.Image[] = [];
  private camTarget!: Phaser.GameObjects.Zone;
  private keys!: Record<
    'W' | 'A' | 'S' | 'D' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'SHIFT' | 'E',
    Phaser.Input.Keyboard.Key
  >;
  /** R cứu, G kéo người gục (GĐ 2c) — đăng ký riêng, không đụng phím E. */
  private partyKeys!: Record<'R' | 'G', Phaser.Input.Keyboard.Key>;
  /** F bật/tắt đèn pin (GĐ 4); đứng cạnh rương thì F mở rương thay vì đèn pin. */
  private lightKey!: Phaser.Input.Keyboard.Key;
  /** Lần nhấn F này đã dùng để mở/đóng rương → không tính là bật đèn pin tới khi nhả phím. */
  private fForChest = false;
  /** Vũng độc/axit (vẽ lại mỗi frame). */
  private gfxPools!: Phaser.GameObjects.Graphics;
  /** Bấm nhanh giữa 2 tick vẫn được tính. */
  private attackQueued = false;
  /** Chuột đang giữ từ lúc panel túi/rương còn mở (vd bấm nền để đóng) → không tính là chém tới khi nhả. */
  private mouseHeldFromPanel = false;
  private interactQueued = false;
  private myAim = 0;
  /** Lần đổi vũ khí bằng lăn chuột gần nhất (ms) — 1 nấc lăn có thể bắn nhiều sự kiện. */
  private wheelAt = -Infinity;

  constructor() {
    super('world');
  }

  init(data: WorldSceneData) {
    this.session = data.session;
    this.net = data.net;
    this.myColor = data.color;
    this.myName = data.name;
  }

  preload() {
    preloadMapTiles(this);
    preloadChestSprites(this);
  }

  setMe(name: string, color: number) {
    this.myName = name;
    this.myColor = color;
  }

  get playerName(): string {
    return this.myName;
  }

  /** Nhân vật của mình (HUD đọc) — bản dự đoán; undefined khi chưa nhận snapshot đầu tiên. */
  me(): PlayerState | undefined {
    return this.net?.sync.predictor.state ?? undefined;
  }

  create() {
    this.worldMap = new WorldMap(this.net.seed);
    this.mapRenderer = new MapRenderer(this);
    // map của B ở depth 0 (nhãn tòa nhà depth 1); hình động vẽ đè lên
    this.gfxDecals = this.add.graphics().setDepth(2);
    this.gfxDoors = this.add.graphics().setDepth(3);
    this.gfxPools = this.add.graphics().setDepth(2.5);
    this.gfxDyn = this.add.graphics().setDepth(4);
    this.makeZombieTextures();
    this.chests = new ChestLayer(this, this.net.loot, ZOOM);
    this.lootUi = new LootUi(
      document.getElementById('hud') ?? document.body,
      this.net.loot,
      (id) => this.session.peers.get(id)?.name ?? 'đồng đội',
    );

    const cam = this.cameras.main;
    cam.setZoom(ZOOM);
    const spawn = this.net.map.spawn;
    this.camTarget = this.add.zone(spawn.x * TILE_SIZE, spawn.y * TILE_SIZE, 1, 1);
    cam.startFollow(this.camTarget, false, 0.15, 0.15);
    cam.setDeadzone(12, 12);

    this.setupInput();
    // chỉ khi chạy npm run dev: mở console gõ __world để soi trạng thái
    if (import.meta.env.DEV) (window as unknown as { __world: WorldScene }).__world = this;
  }

  private setupInput() {
    const kb = this.input.keyboard!;
    // enableCapture = false: không chặn phím mặc định → vẫn gõ được W/A/S/D/E vào ô tên ở bảng phòng chờ
    this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,SHIFT,E', false) as typeof this.keys;
    this.keys.E.on('down', () => {
      if (!isTyping()) this.interactQueued = true;
    });
    this.partyKeys = kb.addKeys('R,G', false) as typeof this.partyKeys;
    this.lightKey = kb.addKey('F', false);
    this.lightKey.on('down', () => {
      if (isTyping()) return;
      const me = this.me();
      if (this.lootUi.chest) {
        this.fForChest = true;
        this.lootUi.closeChest();
      } else if (this.chests.nearest && me && isUp(me)) {
        this.fForChest = true;
        void this.lootUi.openChest(this.chests.nearest);
      }
    });
    this.lightKey.on('up', () => (this.fForChest = false));
    kb.addKey('I', false).on('down', () => {
      if (!isTyping()) this.lootUi.toggleInventory();
    });
    // GĐ 3b: X / lăn chuột đổi vũ khí, Q nạp đạn (R đã là cứu người)
    kb.addKey('X', false).on('down', () => {
      if (!isTyping() && !this.lootUi.open) this.lootUi.weapons.cycle(this.me() ?? null, 1);
    });
    kb.addKey('Q', false).on('down', () => {
      if (!isTyping()) this.lootUi.weapons.reload(this.me() ?? null);
    });
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      const now = this.time.now;
      if (this.lootUi.open || dy === 0 || now - this.wheelAt < 200) return;
      this.wheelAt = now;
      if (!isTyping()) this.lootUi.hotbar.cycle(dy > 0 ? 1 : -1);
    });
    // GĐ 3b: dùng nhanh 1 băng gạc · 2 sơ cứu · 3 kháng sinh · 4 ăn/uống
    (['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'] as const).forEach((name, i) =>
      kb.addKey(name, false).on('down', () => {
        if (!isTyping() && !this.lootUi.open) void this.lootUi.hotbar.select(i);
      }),
    );
    this.ground = new GroundLayer(
      this,
      this.net.loot,
      () => this.lootUi.open,
      (s) => this.lootUi.toast(s),
    );
    kb.addKey('V', false).on('down', () => {
      if (!isTyping()) void this.ground.pickup();
    });
    this.events.once('shutdown', () => {
      this.ground.destroy();
      this.lootUi.hotbar.destroy();
    });
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.leftButtonDown()) this.attackQueued = true;
    });
  }

  override update(_time: number, delta: number) {
    const t0 = performance.now();
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

    const sync = this.net.sync;
    for (const e of sync.events) this.onEvent(e);
    sync.events = [];
    sync.predictor.decay(delta);

    this.render(this.acc / SIM_TICK_MS);
    this.syncChunks();
    this.frameMs = this.frameMs * 0.9 + (performance.now() - t0) * 0.1;
  }

  private stepSim() {
    const input = this.readInput();
    if (input.buttons & Btn.Attack) this.lootUi.weapons.onFire(this.me() ?? null, this.time.now);
    // vết chém / tia đạn của mình vẽ ngay (dự đoán), không chờ host
    const fx = this.net.tick(input);
    const me = this.me();
    if (fx?.kind === 'swing' && me) {
      const w = meleeOf(me.weapon, me.weaponRarity);
      this.fx.push({
        kind: 'swing',
        x: me.x,
        y: me.y,
        facing: me.facing,
        born: this.time.now,
        life: 140,
        dist: w.range,
        arc: w.arcDeg,
      });
    } else if (fx?.kind === 'shot') this.pushShot(fx.x, fx.y, fx.angle, fx.dist);
  }

  /** Tia đạn vàng mờ dần + chớp nòng (GĐ 3b, vẽ tạm bằng code). */
  private pushShot(x: number, y: number, angle: number, dist: number) {
    const now = this.time.now;
    this.fx.push({ kind: 'tracer', x, y, facing: angle, born: now, life: 120, dist });
    this.fx.push({ kind: 'muzzle', x, y, facing: angle, born: now, life: 60 });
  }

  /** Vẽ các chunk quanh camera (thêm 1 vòng chunk dự phòng để đi nhanh không thấy mép trống). */
  private syncChunks() {
    const v = this.cameras.main.worldView;
    const px = CHUNK_SIZE * TILE_SIZE;
    const x0 = Math.floor(v.x / px) - 1;
    const y0 = Math.floor(v.y / px) - 1;
    const x1 = Math.floor((v.x + v.width) / px) + 1;
    const y1 = Math.floor((v.y + v.height) / px) + 1;
    const key = `${x0},${y0},${x1},${y1}`;
    if (key === this.chunkRange) return;
    this.chunkRange = key;
    const chunks: Chunk[] = [];
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) chunks.push(this.worldMap.getChunk(cx, cy));
    }
    this.mapRenderer.sync(chunks);
    this.chests.sync(chunks);
  }

  private readInput(): PlayerInput {
    const k = this.keys;
    // đang gõ chữ hoặc đang mở panel túi/rương: nhân vật đứng yên, không chém/mở cửa (thế giới vẫn chạy)
    const typing = isTyping() || this.lootUi.open;
    const mouseDown = this.input.activePointer.leftButtonDown();
    if (this.lootUi.open) this.mouseHeldFromPanel = mouseDown;
    else if (!mouseDown) this.mouseHeldFromPanel = false;
    let mx = 0;
    let my = 0;
    let buttons = 0;
    if (!typing) {
      mx = (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
      my = (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);
      if (k.SHIFT.isDown) buttons |= Btn.Sprint;
      if (k.E.isDown || this.interactQueued) buttons |= Btn.Interact;
      if ((mouseDown && !this.mouseHeldFromPanel) || this.attackQueued) buttons |= Btn.Attack;
    }
    if (!typing) {
      if (this.partyKeys.R.isDown) buttons |= Btn.Revive;
      if (this.partyKeys.G.isDown) buttons |= Btn.Drag;
      if (this.lightKey.isDown && !this.fForChest) buttons |= Btn.Flashlight;
    }
    this.attackQueued = false;
    this.interactQueued = false;
    return { seq: ++this.seq, moveX: mx, moveY: my, aim: this.myAim, buttons };
  }

  private updateAim() {
    if (!this.me() || this.lootUi.open) return;
    const pos = this.myDrawPos(this.acc / SIM_TICK_MS);
    const ptr = this.input.activePointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    this.myAim = radToAim(Math.atan2(ptr.y - pos.y * TILE_SIZE, ptr.x - pos.x * TILE_SIZE));
  }

  private onEvent(e: SimEvent) {
    const now = this.time.now;
    const self = this.session.selfId;
    switch (e.type) {
      case 'swing':
        // đồng đội chém (của mình đã vẽ lúc dự đoán)
        this.fx.push({ kind: 'swing', x: e.x, y: e.y, facing: e.facing, born: now, life: 140 });
        break;
      case 'hit':
        this.hitFlash.set(e.zombie, now);
        this.fx.push({ kind: 'hit', x: e.x, y: e.y, facing: 0, born: now, life: 220 });
        if (e.killed) this.drawBloodDecal(e.x, e.y, e.zombie);
        if (e.assassination) this.floatText(e.x, e.y, 'Ám sát!', '#ffd54f');
        break;
      case 'bite':
        if (e.player === self) this.cameras.main.shake(90, 0.006);
        this.fx.push({ kind: 'blood', x: e.x, y: e.y, facing: 0, born: now, life: 300 });
        break;
      case 'death':
        if (e.player === self) this.cameras.main.flash(300, 120, 0, 0);
        break;
      case 'respawn':
        this.shieldUntil.set(e.player, now + PARTY.respawnShieldSec * 1000);
        break;
      case 'shot':
        // tia đạn của đồng đội (của mình đã vẽ lúc dự đoán)
        if (e.player !== self) this.pushShot(e.x, e.y, e.angle, e.dist);
        break;
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
    this.drawPools();

    const { zombies, others } = this.net.sync.sample();
    this.lootUi.items.update(this.me() ?? null, others);
    const seen = this.zombieSeer(others, alpha);
    const me0 = this.me();
    if (me0) this.lootUi.hotbar.observeWeapon(me0.weapon, me0.weaponRarity);
    const up = me0 && isUp(me0) ? me0 : null;
    this.ground?.update(me0 ?? null, seen);
    this.chests.update(up, seen, this.lootUi.open);
    this.autoCloseLoot(up, seen);
    let shown = 0;
    for (const z of zombies) {
      if (!seen(z)) continue; // sau tường/cửa đóng: không vẽ (lớp tối không che được hết lúc ban ngày)
      const flash = now - (this.hitFlash.get(z.id) ?? -1e9) < 120;
      let img = this.zombieSprites[shown++];
      if (!img) {
        img = this.add
          .image(0, 0, zombieTex('normal', 'wander'))
          .setDepth(3.5)
          .setScale(1 / TEX_SCALE);
        this.zombieSprites.push(img);
      }
      img
        .setTexture(zombieTex(z.kind, flash ? 'flash' : z.chasing ? 'chase' : 'wander'))
        .setPosition(z.x * T, z.y * T)
        .setRotation(z.facing)
        .setVisible(true);
      // zombie từ xác đồng đội (GĐ 6): nhuộm màu riêng của người đó để cả đội nhận ra
      if (z.turnedFrom && !flash) img.setTint(this.colorOf(z.turnedFrom));
      else img.clearTint();
    }
    for (let i = shown; i < this.zombieSprites.length; i++) this.zombieSprites[i]?.setVisible(false);
    for (const p of others) {
      if (!p.alive) continue;
      if (p.downedFor > 0) this.drawDowned(g, p.x * T, p.y * T, this.colorOf(p.id), p.reviveProgress);
      else this.drawPlayer(g, p.x * T, p.y * T, p.facing, this.colorOf(p.id), p.weapon);
      this.drawShield(g, p.x * T, p.y * T, p.id, now);
    }
    const me = this.me();
    const pos = this.myDrawPos(alpha);
    if (me && isDowned(me)) this.drawDowned(g, pos.x * T, pos.y * T, this.myColor, me.reviveProgress);
    else if (me && isAlive(me))
      this.drawPlayer(g, pos.x * T, pos.y * T, (this.myAim / 256) * Math.PI * 2, this.myColor, me.weapon);
    if (me && isAlive(me)) this.drawShield(g, pos.x * T, pos.y * T, this.session.selfId, now);

    this.fx = this.fx.filter((f) => now - f.born < f.life);
    for (const f of this.fx) this.drawFx(g, f, (now - f.born) / f.life);

    this.camTarget.setPosition(pos.x * T, pos.y * T);
  }

  /**
   * Zombie nào được vẽ: mình nhìn thẳng tới được (không bị tường/cửa đóng che), hoặc nằm trong vùng đèn pin
   * của đồng đội mà đồng đội nhìn thấy. Đã chết (đang chờ hồi sinh) thì thấy hết như trước.
   */
  private zombieSeer(others: readonly RemotePlayerView[], alpha: number): (z: Vec2) => boolean {
    const me = this.me();
    if (!me || !isAlive(me)) return () => true;
    const eye = this.myDrawPos(alpha);
    const blocked = this.net.sync.blocked;
    const darkness = dayClock(this.net.sync.serverTick()).darkness;
    const torches = visionShapes(
      { x: eye.x, y: eye.y, facing: 0, flashlight: false },
      darkness,
      others,
    ).slice(2);
    // ngoài màn hình thì vẽ hay không cũng không thấy → khỏi bắn tia (đỡ phần lớn trong 200 con)
    const view = this.cameras.main.worldView;
    const T = TILE_SIZE;
    return (z) =>
      z.x * T < view.x - T ||
      z.y * T < view.y - T ||
      z.x * T > view.right + T ||
      z.y * T > view.bottom + T ||
      hasLineOfSight(eye, z, blocked) ||
      torches.some((t) => seesPoint(t, t.facing, t.halfAngle, t.range, z, blocked));
  }

  /** Gục/chết → đóng mọi panel; đi xa rương (> tầm với) hoặc bị tường/cửa đóng che → đóng panel rương. */
  private autoCloseLoot(me: Vec2 | null, seen: (p: Vec2) => boolean) {
    if (!this.lootUi.open) return;
    if (!me) {
      if (this.me()) this.lootUi.closeAll();
      return;
    }
    const c = this.lootUi.chest;
    if (c && !canKeepChestOpen(c, me, seen)) this.lootUi.closeChest();
  }

  /** Chỗ vẽ nhân vật mình: nội suy giữa 2 tick dự đoán + độ lệch làm mượt sau khi host sửa. */
  private myDrawPos(alpha: number): Vec2 {
    const pr = this.net.sync.predictor;
    const s = pr.state;
    if (!s) return { ...this.net.map.spawn };
    return {
      x: pr.prevX + (s.x - pr.prevX) * alpha + pr.offsetX,
      y: pr.prevY + (s.y - pr.prevY) * alpha + pr.offsetY,
    };
  }

  private colorOf(id: PeerId): number {
    if (id === this.session.selfId) return this.myColor;
    return this.session.peers.get(id)?.color ?? 0xcccccc;
  }

  /** Chỗ vẽ + hướng nhìn của mình (ô) — HUD vẽ nón tầm nhìn. */
  myView(): { x: number; y: number; facing: number } | null {
    if (!this.me()) return null;
    const pos = this.myDrawPos(this.acc / SIM_TICK_MS);
    return { x: pos.x, y: pos.y, facing: (this.myAim / 256) * Math.PI * 2 };
  }

  /** Tên + màu của một người (HUD vẽ mũi tên/khung đội). */
  peerInfo(id: PeerId): { name: string; color: number } {
    const p = this.session.peers.get(id);
    return { name: p?.name ?? 'Đồng đội', color: p?.color ?? 0xcccccc };
  }

  /** Map của B vẽ cửa đóng; cửa đang mở (theo snapshot host) vẽ đè: nền trống + cánh cửa áp một bên. */
  private drawDoors() {
    const T = TILE_SIZE;
    const g = this.gfxDoors;
    const map = this.net.map;
    g.clear();
    for (const key of this.net.sync.doors.openList()) {
      const [tx, ty] = key.split(',').map(Number) as [number, number];
      const x = tx * T;
      const y = ty * T;
      g.fillStyle(0x9d8965).fillRect(x, y, T, T);
      const horizontalWall = map.isWall(tx - 1, ty) || map.isWall(tx + 1, ty);
      g.fillStyle(0x6d4c41);
      if (horizontalWall) g.fillRect(x, y, 3, T);
      else g.fillRect(x, y, T, 3);
    }
    // tường bị khổng lồ húc vỡ (TẠM vẽ bằng code: nền + gạch vụn) — chỉ vẽ ô trong khung camera
    const view = this.cameras.main.worldView;
    for (const k of this.net.sync.brokenWalls) {
      const { x: tx, y: ty } = keyTile(k);
      const x = tx * T;
      const y = ty * T;
      if (x + T < view.x || y + T < view.y || x > view.right || y > view.bottom) continue;
      g.fillStyle(0x8a8580).fillRect(x, y, T, T);
      g.fillStyle(0x5d5955);
      for (let i = 0; i < 5; i++) {
        const h = ((tx * 73856093) ^ (ty * 19349663) ^ (i * 83492791)) >>> 0;
        g.fillRect(x + (h % (T - 3)), y + ((h >>> 8) % (T - 3)), 3, 2);
      }
    }
  }

  /**
   * Hình zombie tạm (thay bằng sprite Kenney sau): vẽ 1 lần vào texture, nhìn sang phải,
   * phóng to TEX_SCALE lần cho nét khi camera zoom; sprite xoay theo hướng nhìn.
   */
  private makeZombieTextures() {
    for (const kind of ZOMBIE_KINDS) {
      const r = ZOMBIE_NORMAL.radius * KIND[kind].radius * TILE_SIZE * TEX_SCALE;
      const size = Math.ceil(r * 2 + 2);
      const c = size / 2;
      const [wander, chase] = KIND_COLORS[kind];
      const variants: [string, number, number][] = [
        [zombieTex(kind, 'wander'), wander, 0x2c3a2e],
        [zombieTex(kind, 'chase'), chase, 0xff5252],
        [zombieTex(kind, 'flash'), 0xffffff, 0xffffff],
      ];
      for (const [key, body, eye] of variants) {
        if (this.textures.exists(key)) continue;
        const g = this.make.graphics({}, false);
        g.fillStyle(body).fillCircle(c, c, r);
        if (kind === 'bloater') g.fillStyle(0xd4e157, 0.6).fillCircle(c - r * 0.2, c, r * 0.45); // bụng phình
        if (kind === 'giant') g.lineStyle(TEX_SCALE, 0x3e2723, 1).strokeCircle(c, c, r - TEX_SCALE);
        g.fillStyle(eye);
        for (const side of [-1, 1]) g.fillCircle(c + r * 0.55, c + side * r * 0.35, TEX_SCALE);
        g.generateTexture(key, size, size);
        g.destroy();
      }
    }
  }

  /** Vũng độc (xanh lá) và axit (vàng xanh); axit còn đang bay thì chỉ là vòng cảnh báo. */
  private drawPools() {
    const g = this.gfxPools;
    g.clear();
    const T = TILE_SIZE;
    for (const p of this.net.sync.latest?.pools ?? []) {
      const fade = Math.min(1, p.ttl / 1.5);
      if (p.arming) {
        g.lineStyle(1.5, 0xc6ff00, 0.9).strokeCircle(p.x * T, p.y * T, p.radius * T);
        continue;
      }
      const color = p.kind === 'acid' ? 0xc6ff00 : 0x66bb6a;
      g.fillStyle(color, 0.35 * fade).fillCircle(p.x * T, p.y * T, p.radius * T);
      g.lineStyle(1, color, 0.6 * fade).strokeCircle(p.x * T, p.y * T, p.radius * T);
    }
  }

  /** Người gục: nằm (hình dẹt, mờ) + viền đỏ nhấp nháy; đang được cứu thì có vòng tiến độ. */
  private drawDowned(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number, revive: number) {
    const r = PLAYER.radius * TILE_SIZE;
    g.fillStyle(color, 0.55).fillEllipse(x, y, r * 2.6, r * 1.3);
    const blink = 0.4 + 0.4 * Math.abs(Math.sin(this.time.now / 250));
    g.lineStyle(1, 0xef5350, blink).strokeCircle(x, y, r + 3);
    if (revive > 0) {
      const t = Math.min(1, revive / PARTY.reviveSec);
      g.lineStyle(2, 0x66bb6a, 1);
      g.beginPath();
      g.arc(x, y, r + 5, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2);
      g.strokePath();
    }
  }

  /** Vòng sáng nhấp nháy quanh người vừa hồi sinh, còn bất tử (PARTY.respawnShieldSec). */
  private drawShield(g: Phaser.GameObjects.Graphics, x: number, y: number, id: PeerId, now: number) {
    const left = (this.shieldUntil.get(id) ?? 0) - now;
    if (left <= 0) return;
    const pulse = 0.5 + 0.5 * Math.sin(now / 90);
    g.lineStyle(1.5, 0x80d8ff, 0.4 + 0.5 * pulse).strokeCircle(x, y, TILE_SIZE * 0.6);
  }

  private drawPlayer(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    facing: number,
    color: number,
    weapon: WeaponId = 'knife',
  ) {
    const r = PLAYER.radius * TILE_SIZE;
    g.fillStyle(color).fillCircle(x, y, r);
    g.lineStyle(1.5, 0xffffff, 0.9).lineBetween(
      x,
      y,
      x + Math.cos(facing) * (r + 4),
      y + Math.sin(facing) * (r + 4),
    );
    // vũ khí trên tay (TẠM vẽ bằng code): súng = nòng đen dài, gậy = thanh nâu
    if (weapon === 'fists' || weapon === 'knife') return;
    const len = weapon === 'rifle' ? 9 : weapon === 'pistol' ? 6 : 7;
    const col = weapon === 'bat' ? 0x8d6e63 : 0x212121;
    const sx = x + Math.cos(facing + 0.6) * r * 0.6;
    const sy = y + Math.sin(facing + 0.6) * r * 0.6;
    g.lineStyle(weapon === 'bat' ? 2 : 1.6, col, 1).lineBetween(
      sx,
      sy,
      sx + Math.cos(facing) * len,
      sy + Math.sin(facing) * len,
    );
  }

  private drawFx(g: Phaser.GameObjects.Graphics, f: Fx, t: number) {
    const T = TILE_SIZE;
    const x = f.x * T;
    const y = f.y * T;
    if (f.kind === 'tracer') {
      const d = (f.dist ?? 0) * T;
      g.lineStyle(1, 0xffe082, 0.9 * (1 - t)).lineBetween(
        x,
        y,
        x + Math.cos(f.facing) * d,
        y + Math.sin(f.facing) * d,
      );
    } else if (f.kind === 'muzzle') {
      const mx = x + Math.cos(f.facing) * (PLAYER.radius * T + 8);
      const my = y + Math.sin(f.facing) * (PLAYER.radius * T + 8);
      g.fillStyle(0xfff59d, 0.9 * (1 - t)).fillCircle(mx, my, 2.5 + 1.5 * (1 - t));
    } else if (f.kind === 'swing') {
      const half = (((f.arc ?? KNIFE.arcDeg) / 2) * Math.PI) / 180;
      const reach = (PLAYER.radius + (f.dist ?? KNIFE.range)) * T;
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
      .setDepth(5)
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
