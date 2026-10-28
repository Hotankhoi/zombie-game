import { GUNS } from '@shared/data/guns';
import { PLAYER } from '@shared/data/player';
import { ZOMBIE_NORMAL as Z } from '@shared/data/zombies';
import { SIM_TICK_MS, type PeerId, type Vec2 } from '@shared/types';
import { Rng, hashString } from '@shared/util/rng';
import { angleDiff, pushOut, type BlockedFn } from './collision';
import { dayClock, tickOfDay } from './dayNight';
import { meleeAttack } from './combat';
import { Doors, circleOverlapsTile, nearestDoor } from './doors';
import { FlowField } from './flowField';
import type { MapSource } from './grid';
import { Btn, hasBtn, type PlayerInput } from './input';
import { createPlayer, isAlive, isDowned, isUp, stepPlayer, type PlayerState } from './player';
import { moveCircle } from './collision';
import { BOSS, HORDE } from './tuning/horde';
import { DAY, NOISE } from './tuning/night';
import { PARTY } from './tuning/party';
import { KIND, SPECIAL, ZOMBIE_KINDS, breaksDoors, type ZombieKind } from './tuning/zombieKinds';
import { applyUse, checkUse, type UseError } from './items';
import { fireGun, isGun, magOf, meleeOf, startReload, type WeaponId } from './guns';
import { absorb, infectionFactor, wearArmor } from './armor';
import type { GunId } from '@shared/data/guns';
import { infectFromBite, respawnSurvival } from './survival';
import type { ItemId, Rarity } from '@shared/data/items';
import { countdown } from './timer';
import { createZombie, hearNoise, radiusOf, stepZombie, type ZombieState } from './zombie';
import { rollZombieDrop, type ZombieDrop } from './zombieDrops';

/** Vũng nguy hiểm (GĐ 4): độc của zombie phình nổ, axit của zombie phun. Người đứng trong mất máu. */
export interface Pool {
  id: number;
  kind: 'poison' | 'acid';
  x: number;
  y: number;
  radius: number;
  /** Còn tồn tại bao lâu (giây). */
  ttl: number;
  /** Axit đang bay tới: chưa gây sát thương trong bấy nhiêu giây. */
  armIn: number;
  /** Sát thương mỗi giây. */
  dps: number;
}

/**
 * Đợt tràn (GĐ 5) đang diễn ra hoặc vừa xong. Mỗi 15 ngày, từ lúc tối hẳn ngày 15k tới sáng hẳn hôm sau,
 * hoặc tới khi giết hết. Thắng = còn ít nhất 1 người chưa chết hẳn lúc kết thúc.
 */
export interface HordeState {
  /** Đợt thứ mấy (1, 2, …). */
  number: number;
  active: boolean;
  startTick: number;
  endTick: number;
  /** Số zombie thường của đợt (chưa tính Boss) và đã sinh bao nhiêu. */
  quota: number;
  spawned: number;
  bosses: number;
  bossesSpawned: number;
  /** Phần lẻ "zombie cần sinh" dồn qua các tick. */
  spawnBudget: number;
  /** Kết quả khi xong: true = sống sót, false = cả đội chết; null = đang diễn ra. */
  survived: boolean | null;
  /** Bảng thành tích đội: số zombie giết / số lần gục trong đợt, theo người. */
  kills: Record<PeerId, number>;
  downs: Record<PeerId, number>;
}

/** Xác người chơi chết hẳn, chờ thành zombie (GĐ 6). */
export interface Corpse {
  player: PeerId;
  x: number;
  y: number;
  /** Còn bao lâu (giây) thì đứng dậy thành zombie. */
  turnIn: number;
}

/** Tiếng ồn chờ zombie nghe (tick sau). */
export interface Noise {
  x: number;
  y: number;
  radius: number;
}

/** Sự kiện trong một tick — client dùng để vẽ hiệu ứng (GĐ 2 gửi qua kênh reliable). */
export type SimEvent =
  | { type: 'swing'; player: PeerId; x: number; y: number; facing: number }
  | {
      type: 'hit';
      player: PeerId;
      zombie: number;
      x: number;
      y: number;
      killed: boolean;
      assassination: boolean;
      silent: boolean;
      /** Máu zombie còn lại sau đòn — máy khách nhớ để chuyển host không hồi máu zombie. */
      hp: number;
    }
  | { type: 'bite'; zombie: number; player: PeerId; x: number; y: number }
  | { type: 'door'; x: number; y: number; open: boolean }
  /** Bắn 1 phát (GĐ 3b): tia từ (x, y) theo `angle`, dài `dist` ô; `hit` = trúng zombie. */
  | { type: 'shot'; player: PeerId; x: number; y: number; angle: number; dist: number; hit: boolean }
  | { type: 'death'; player: PeerId }
  | { type: 'respawn'; player: PeerId };

/** Toàn bộ trạng thái cần để dựng lại thế giới (vd: chuyển host — AGENTS.md mục 2.1). */
export interface WorldState {
  tick: number;
  /** Trạng thái RNG (Rng.stateValue). `new Rng(rngState)` chạy tiếp đúng dãy số. */
  rngState: number;
  nextZombieId: number;
  players: PlayerState[];
  zombies: ZombieState[];
  openDoors: Vec2[];
  /** Vị trí người chơi lúc dựng flow field gần nhất — để dựng lại đúng flow field đó. */
  flowTargets: Vec2[];
  flowDirty: boolean;
  /** GĐ 4 (không bắt buộc để đọc được bản lưu cũ). */
  pools?: Pool[];
  nextPoolId?: number;
  /** Cửa bị khổng lồ phá: mở mãi, không đóng lại được. */
  brokenDoors?: Vec2[];
  /** Tường bị khổng lồ/Boss húc vỡ → ô trống mãi mãi (chỉ gửi danh sách ô đã đổi, không gửi lại map). */
  brokenWalls?: Vec2[];
  /** Tường đang bị húc dở: máu còn lại. */
  wallDamage?: { x: number; y: number; hp: number }[];
  noises?: Noise[];
  /** GĐ 5. */
  horde?: HordeState | null;
  /** GĐ 6. */
  corpses?: Corpse[];
}

export interface SimWorldOptions {
  seed: number | string;
  map: MapSource;
  /** Số zombie giữ trên bản đồ (mặc định ZOMBIE_NORMAL.population). */
  zombieCount?: number;
  /** Dựng tiếp từ trạng thái có sẵn thay vì thế giới mới (seed khi đó không dùng cho RNG). */
  restore?: WorldState;
  /** CHỈ bản dev (`?roido=`): nhân tỉ lệ zombie rơi đồ. */
  dropChanceScale?: number;
}

/** Bắn súng: lùi vị trí zombie tối đa bấy nhiêu tick (500 ms) về lúc người bắn nhìn thấy (bù trễ). */
export const SHOT_REWIND_TICKS = 10;
/** Tính lại flow field mỗi bao nhiêu tick (10 tick = 0.5s). */
const FLOW_EVERY = 10;
/** Số lần thử tìm chỗ sinh zombie cho mỗi con còn thiếu, trong một tick. */
const SPAWN_TRIES = 20;
const DT = SIM_TICK_MS / 1000;

/**
 * Toàn bộ thế giới mô phỏng (AGENTS.md mục 2.2): tick cố định, tất định theo seed + chuỗi input.
 * UI chỉ đọc trạng thái + events; GĐ 2 chạy cùng code này trên host (Web Worker) và client.
 */
export class SimWorld {
  tick = 0;
  readonly map: MapSource;
  readonly rng: Rng;
  readonly players = new Map<PeerId, PlayerState>();
  zombies: ZombieState[] = [];
  readonly doors = new Doors();
  readonly zombieCount: number;
  /** Sự kiện của tick vừa chạy (xóa đầu mỗi step). */
  events: SimEvent[] = [];
  private flow = new FlowField();
  private flowDirty = true;
  private flowTargets: Vec2[] = [];
  private nextZombieId = 1;
  /** Vũng độc/axit đang có. */
  pools: Pool[] = [];
  private nextPoolId = 1;
  /** Cửa đã bị phá ("x,y"). */
  private brokenDoors = new Set<string>();
  /** Tường đã vỡ (khóa số `tileKey`) và tường đang bị húc dở (khóa → máu còn). */
  private brokenWalls = new Set<number>();
  private wallHp = new Map<number, number>();
  /** Ô map vừa đổi trong tick (tường vỡ) — host gửi cho mọi người dạng danh sách ô (GameMsg.MapDelta). */
  mapChanges: Vec2[] = [];
  /** Giáp vừa vỡ trong tick (GĐ 3b) — host trừ 1 món đó khỏi túi người chơi. */
  armorBreaks: { player: PeerId; item: ItemId; rarity: Rarity }[] = [];
  /** Zombie chết trong tick rơi đồ (host đặt xuống đất — hệ thả/nhặt của B). */
  zombieDrops: ZombieDrop[] = [];
  private dropChanceScale: number;
  /** Tiếng ồn phát ra trong tick, zombie nghe ở đầu pha zombie (cùng tick hoặc tick sau). */
  private noises: Noise[] = [];
  /** Đợt tràn đang diễn ra hoặc đợt gần nhất (GĐ 5). */
  horde: HordeState | null = null;
  /** Xác chờ thành zombie (GĐ 6). */
  corpses: Corpse[] = [];

  /** Ô chặn: tường, hoặc cửa đang đóng. */
  readonly blocked: BlockedFn = (tx, ty) => {
    const m = this.map;
    if (m.tileKind) {
      const k = m.tileKind(tx, ty);
      return (k === 1 && !this.isBroken(tx, ty)) || (k === 2 && !this.doors.isOpen(tx, ty));
    }
    return this.isWall(tx, ty) || (m.isDoor(tx, ty) && !this.doors.isOpen(tx, ty));
  };
  /** Chỉ tường — khổng lồ đi xuyên cửa đóng (và phá nó). */
  readonly wallsOnly: BlockedFn = (tx, ty) => this.isWall(tx, ty);

  /** Tường còn nguyên (tường của map trừ tường đã vỡ). */
  isWall(tx: number, ty: number): boolean {
    return this.map.isWall(tx, ty) && !this.isBroken(tx, ty);
  }

  private isBroken(tx: number, ty: number): boolean {
    return this.brokenWalls.size > 0 && this.brokenWalls.has(tileKey(tx, ty));
  }

  /** Danh sách tường đã vỡ (sắp xếp — tất định). */
  brokenWallList(): Vec2[] {
    return [...this.brokenWalls].sort((a, b) => a - b).map(keyTile);
  }

  constructor(opts: SimWorldOptions) {
    this.map = opts.map;
    this.zombieCount = opts.zombieCount ?? Z.population;
    this.dropChanceScale = opts.dropChanceScale ?? 1;
    const s = opts.restore;
    if (!s) {
      this.rng = new Rng(opts.seed);
      this.refillZombies();
      return;
    }
    this.rng = new Rng(s.rngState);
    this.tick = s.tick;
    this.nextZombieId = s.nextZombieId;
    for (const p of s.players) this.players.set(p.id, { ...p });
    this.zombies = s.zombies.map((z) => ({ ...z }));
    for (const d of s.openDoors) this.doors.set(d.x, d.y, true);
    this.flowTargets = s.flowTargets.map((t) => ({ ...t }));
    for (const w of s.brokenWalls ?? []) this.brokenWalls.add(tileKey(w.x, w.y));
    for (const w of s.wallDamage ?? []) this.wallHp.set(tileKey(w.x, w.y), w.hp);
    this.flow.build(this.flowTargets, this.blocked);
    this.flowDirty = s.flowDirty;
    this.pools = (s.pools ?? []).map((p) => ({ ...p }));
    this.nextPoolId = s.nextPoolId ?? 1;
    for (const d of s.brokenDoors ?? []) this.brokenDoors.add(`${d.x},${d.y}`);
    this.noises = (s.noises ?? []).map((n) => ({ ...n }));
    this.horde = s.horde ? structuredCopy(s.horde) : null;
    this.corpses = (s.corpses ?? []).map((c) => ({ ...c }));
  }

  /** Chụp trạng thái (bản sao) — ngược với `restore`. */
  state(): WorldState {
    return {
      tick: this.tick,
      rngState: this.rng.stateValue,
      nextZombieId: this.nextZombieId,
      players: this.sortedPlayers().map((p) => ({ ...p })),
      zombies: this.zombies.map((z) => ({ ...z })),
      openDoors: this.doors.openList().map((k) => {
        const [x, y] = k.split(',').map(Number);
        return { x: x as number, y: y as number };
      }),
      flowTargets: this.flowTargets.map((t) => ({ ...t })),
      flowDirty: this.flowDirty,
      pools: this.pools.map((p) => ({ ...p })),
      nextPoolId: this.nextPoolId,
      brokenDoors: [...this.brokenDoors].sort().map((k) => {
        const [x, y] = k.split(',').map(Number);
        return { x: x as number, y: y as number };
      }),
      brokenWalls: this.brokenWallList(),
      wallDamage: [...this.wallHp].sort((a, b) => a[0] - b[0]).map(([k, hp]) => ({ ...keyTile(k), hp })),
      noises: this.noises.map((n) => ({ ...n })),
      horde: this.horde ? structuredCopy(this.horde) : null,
      corpses: this.corpses.map((c) => ({ ...c })),
    };
  }

  /** Độ tối hiện tại 0..1 (ngày/đêm, GĐ 4). */
  get darkness(): number {
    return dayClock(this.tick).darkness;
  }

  /**
   * Phát tiếng ồn ở (x, y): zombie chưa đuổi ai trong bán kính sẽ đi tới xem (AGENTS.md mục 3 "Tiếng ồn").
   * Dùng chung cho mọi nguồn — súng/giảm thanh của B (GĐ 3) gọi hàm này với bán kính của súng.
   */
  emitNoise(x: number, y: number, radius: number): void {
    if (radius > 0) this.noises.push({ x, y, radius });
  }

  /** Dùng đồ (GĐ 3b): kiểm tra trước khi host trừ đồ. `target` = PeerId đồng đội (băng gạc) hoặc null = mình. */
  checkItemUse(user: PeerId, itemId: ItemId, target: PeerId | null): UseError | null {
    const u = this.players.get(user);
    if (!u) return 'player_not_up';
    const t = target === null || target === user ? null : (this.players.get(target) ?? null);
    if (target !== null && target !== user && !t) return 'no_target';
    return checkUse(u, t, itemId, this.blocked);
  }

  /** Áp hiệu ứng món đã trừ khỏi túi (host gọi khi giao dịch đã được mọi người xác nhận). */
  applyItemUse(user: PeerId, itemId: ItemId, rarity: Rarity, target: PeerId | null): void {
    const u = this.players.get(user);
    if (!u) return;
    const t = target === null || target === user ? null : (this.players.get(target) ?? null);
    if (target !== null && target !== user && !t) return;
    applyUse(u, t, itemId, rarity, (p, hp) => {
      this.standUp(p);
      p.hp = Math.min(p.maxHp, hp);
    });
  }

  addPlayer(id: PeerId): PlayerState {
    let p = this.players.get(id);
    if (!p) {
      p = createPlayer(id, this.freeSpawn(id));
      this.players.set(id, p);
      this.flowDirty = true;
    }
    return p;
  }

  removePlayer(id: PeerId): void {
    this.players.delete(id);
    this.flowDirty = true;
  }

  /**
   * Chạy 1 tick (SIM_TICK_MS). Người chơi thiếu input (input chưa tới host) thì đứng yên và
   * "đóng băng": không hồi stamina/hồi chiêu — vì mọi thứ của nhân vật chỉ đổi theo input,
   * dự đoán phía client mới khớp được với host khi input tới muộn.
   */
  step(inputs: ReadonlyMap<PeerId, PlayerInput>): void {
    this.events = [];
    this.mapChanges = [];
    this.armorBreaks = [];
    this.zombieDrops = [];
    const players = this.sortedPlayers();

    for (const p of players) {
      const input = inputs.get(p.id);
      if (p.shield > 0) p.shield = countdown(p.shield, DT);
      if (!isAlive(p)) {
        p.respawnIn = countdown(p.respawnIn, DT);
        if (p.respawnIn === 0) this.respawn(p);
      } else if (isDowned(p)) {
        p.downedFor = countdown(p.downedFor, DT);
        if (p.downedFor === 0) this.die(p);
      }
      if (input) this.applyInput(p, input);
      else p.sprinting = false;
    }
    this.partyActions(players, inputs);
    this.reapZombies();
    this.stepPools(players);
    this.stepCorpses();

    const alive = players.filter(isAlive);
    if (this.flowDirty || this.tick % FLOW_EVERY === 0) {
      this.flowTargets = alive.map((p) => ({ x: p.x, y: p.y }));
      this.flow.build(this.flowTargets, this.blocked);
      this.flowDirty = false;
    }
    // tiếng ồn tới giờ (của người chơi tick này + của zombie tick trước) → zombie đi xem
    const heard = this.noises;
    this.noises = [];
    for (const n of heard) for (const z of this.zombies) hearNoise(z, n.x, n.y, n.radius);
    const ctx = {
      dt: DT,
      rng: this.rng,
      blocked: this.blocked,
      wallsOnly: this.wallsOnly,
      flow: this.flow,
      players,
      darkness: this.darkness,
      onBite: (z: ZombieState, p: PlayerState) => this.bite(z, p),
      onNoise: (x: number, y: number, r: number) => this.emitNoise(x, y, r),
      onSlam: (z: ZombieState) => this.slam(z),
      onSpit: (z: ZombieState, x: number, y: number) => this.spit(x, y),
    };
    for (const z of this.zombies) stepZombie(z, ctx);
    this.smashDoors();
    this.smashWalls();
    this.separate(alive);
    this.directHorde(alive);
    this.refillZombies();
    this.recordHistory();
    this.tick++;
  }

  /**
   * Chạy thêm 1 input cho 1 người ngay trong tick vừa rồi, thế giới không trôi thêm thời gian.
   * Host dùng khi input của một người dồn lại (mạng giật) để bắt kịp mà không phải bỏ input nào
   * → mỗi input chạy đúng 1 lần, đúng thứ tự, nên dự đoán phía client khớp tuyệt đối.
   * Sự kiện sinh ra được nối vào `events` của tick vừa chạy.
   */
  catchUp(id: PeerId, input: PlayerInput): void {
    const p = this.players.get(id);
    if (!p) return;
    this.applyInput(p, input);
    this.reapZombies();
  }

  /** Bỏ zombie đã chết; zombie phình chết thì nổ vũng độc + tiếng nổ. */
  private reapZombies(): void {
    if (!this.zombies.some((z) => z.hp <= 0)) return;
    const night = dayClock(this.tick).night;
    for (const z of this.zombies) {
      if (z.hp > 0) continue;
      const items = rollZombieDrop(z, this.tick, night, this.dropChanceScale);
      if (items.length > 0) this.zombieDrops.push({ x: z.x, y: z.y, items });
      if (z.kind !== 'bloater') continue;
      const b = SPECIAL.bloaterPool;
      this.addPool('poison', z.x, z.y, b.radius, b.ttlSec, 0, b.dps);
      this.emitNoise(z.x, z.y, NOISE.bloaterBurst);
    }
    this.zombies = this.zombies.filter((z) => z.hp > 0);
  }

  private addPool(
    kind: Pool['kind'],
    x: number,
    y: number,
    radius: number,
    ttl: number,
    armIn: number,
    dps: number,
  ) {
    this.pools.push({ id: this.nextPoolId++, kind, x, y, radius, ttl, armIn, dps });
  }

  /** Zombie phun axit: vũng axit rơi xuống chỗ người đứng sau thời gian bay (né được). */
  private spit(x: number, y: number): void {
    const s = SPECIAL.spit;
    this.addPool('acid', x, y, s.radius, s.ttlSec + s.flightSec, s.flightSec, s.dps);
  }

  /** Vũng độc/axit: người đứng được trong vũng mất máu; hết máu thì gục như bị cắn. */
  private stepPools(players: readonly PlayerState[]): void {
    if (this.pools.length === 0) return;
    for (const pool of this.pools) {
      pool.armIn = countdown(pool.armIn, DT);
      pool.ttl = countdown(pool.ttl, DT);
      if (pool.armIn > 0) continue;
      for (const p of players) {
        if (!isUp(p) || p.shield > 0 || Math.hypot(p.x - pool.x, p.y - pool.y) > pool.radius) continue;
        p.hp = Math.max(0, p.hp - this.hurt(p, pool.dps * DT, pool.kind === 'acid'));
        if (p.hp === 0) this.down(p);
      }
    }
    this.pools = this.pools.filter((p) => p.ttl > 0);
  }

  /** Boss đập đất: mọi người đứng được trong tầm mất máu (hết máu thì gục như bị cắn). */
  private slam(z: ZombieState): void {
    const reach = radiusOf(z) + BOSS.slamRange;
    for (const p of this.sortedPlayers()) {
      if (!isUp(p) || p.shield > 0 || Math.hypot(p.x - z.x, p.y - z.y) > reach) continue;
      p.hp = Math.max(0, p.hp - this.hurt(p, BOSS.slamDamage));
      this.events.push({ type: 'bite', zombie: z.id, player: p.id, x: p.x, y: p.y });
      if (p.hp === 0) this.down(p);
    }
  }

  /**
   * Horde director (GĐ 5): bắt đầu đợt tràn khi tối hẳn ngày 15k, sinh dồn từng ít một quanh người chơi
   * (zombie đợt tràn biết người chơi ở đâu — được dẫn tới chỗ người gần nhất), thêm Boss giữa chừng,
   * kết thúc khi trời sáng hẳn hoặc giết hết.
   */
  private directHorde(alive: readonly PlayerState[]): void {
    const clock = dayClock(this.tick);
    const due = clock.day % HORDE.everyDays === 0 && clock.time >= DAY.nightStart;
    const number = Math.floor(clock.day / HORDE.everyDays);
    if (due && (!this.horde || this.horde.number < number) && alive.length > 0) {
      const quota = Math.min(HORDE.maxCount, HORDE.baseCount + HORDE.perHorde * (number - 1));
      const endTick =
        tickOfDay(clock.day + 1) + Math.round((DAY.dawnEnd * DAY.lengthSec * 1000) / SIM_TICK_MS);
      this.horde = {
        number,
        active: true,
        startTick: this.tick,
        endTick,
        quota,
        spawned: 0,
        bosses: Math.min(HORDE.maxBosses, number),
        bossesSpawned: 0,
        spawnBudget: 0,
        survived: null,
        kills: {},
        downs: {},
      };
    }
    const h = this.horde;
    if (!h?.active) return;

    if (alive.length > 0) {
      h.spawnBudget += HORDE.spawnPerSec * DT;
      while (h.spawnBudget >= 1 && h.spawned < h.quota) {
        h.spawnBudget -= 1;
        if (this.spawnHordeZombie(alive, this.pickHordeKind())) h.spawned++;
      }
      while (h.bossesSpawned < h.bosses && h.spawned >= h.quota * HORDE.bossAt) {
        if (!this.spawnHordeZombie(alive, 'boss')) break;
        h.bossesSpawned++;
      }
      // dẫn đường: zombie đợt tràn không đuổi ai thì được chỉ tới chỗ người gần nhất
      if (this.tick % Math.round(HORDE.homingSec / DT) === 0) {
        for (const z of this.zombies) {
          if (!z.horde || z.mode === 'chase') continue;
          const p = nearestOf(alive, z);
          if (!p) continue;
          z.mode = 'investigate';
          z.goalX = p.x;
          z.goalY = p.y;
          z.investigateFor = HORDE.homingSec + 1;
        }
      }
    }

    const left = this.zombies.some((z) => z.horde);
    const allSpawned = h.spawned >= h.quota && h.bossesSpawned >= h.bosses;
    const wiped = this.players.size > 0 && [...this.players.values()].every((p) => !isAlive(p));
    if (this.tick >= h.endTick || (allSpawned && !left) || wiped) {
      h.active = false;
      h.survived = [...this.players.values()].some(isAlive);
      // zombie còn lại thành zombie thường (lang thang, không được dẫn đường nữa)
      for (const z of this.zombies) z.horde = false;
    }
  }

  /** Còn bao nhiêu zombie của đợt tràn (chưa sinh + đang sống). */
  hordeRemaining(): number {
    const h = this.horde;
    if (!h?.active) return 0;
    const alive = this.zombies.reduce((n, z) => n + (z.horde ? 1 : 0), 0);
    return h.quota - h.spawned + (h.bosses - h.bossesSpawned) + alive;
  }

  private spawnHordeZombie(alive: readonly PlayerState[], kind: ZombieKind): boolean {
    for (let tries = 0; tries < SPAWN_TRIES; tries++) {
      const a = this.rng.pick(alive);
      const ang = this.rng.next() * Math.PI * 2;
      const r = HORDE.spawnMinDist + this.rng.next() * (HORDE.spawnMaxDist - HORDE.spawnMinDist);
      const tx = Math.floor(a.x + Math.cos(ang) * r);
      const ty = Math.floor(a.y + Math.sin(ang) * r);
      if (this.blocked(tx, ty)) continue;
      const x = tx + 0.5;
      const y = ty + 0.5;
      if (alive.some((p) => Math.hypot(p.x - x, p.y - y) < HORDE.spawnMinDist)) continue;
      const z = createZombie(this.nextZombieId++, x, y, this.rng, kind);
      z.horde = true;
      z.hidden = false;
      const target = nearestOf(alive, z);
      if (target) {
        z.mode = 'investigate';
        z.goalX = target.x;
        z.goalY = target.y;
        z.investigateFor = HORDE.homingSec + 1;
      }
      this.zombies.push(z);
      return true;
    }
    return false;
  }

  private pickHordeKind(): ZombieKind {
    const w = HORDE.kindWeights as Record<string, number>;
    let total = 0;
    for (const k of ZOMBIE_KINDS) total += w[k] ?? 0;
    let roll = this.rng.next() * total;
    for (const k of ZOMBIE_KINDS) {
      roll -= w[k] ?? 0;
      if (roll < 0) return k;
    }
    return 'normal';
  }

  /** Khổng lồ/Boss chồng lên cửa đóng → cửa vỡ (mở mãi), tiếng ồn lớn. */
  private smashDoors(): void {
    for (const z of this.zombies) {
      if (!breaksDoors(z.kind)) continue;
      const r = radiusOf(z);
      for (let ty = Math.floor(z.y - r); ty <= Math.floor(z.y + r); ty++) {
        for (let tx = Math.floor(z.x - r); tx <= Math.floor(z.x + r); tx++) {
          if (!this.map.isDoor(tx, ty) || this.doors.isOpen(tx, ty)) continue;
          if (!circleOverlapsTile(z.x, z.y, r, tx, ty)) continue;
          this.doors.set(tx, ty, true);
          this.brokenDoors.add(`${tx},${ty}`);
          this.flowDirty = true;
          this.events.push({ type: 'door', x: tx, y: ty, open: true });
          this.emitNoise(tx + 0.5, ty + 0.5, NOISE.doorBreak);
        }
      }
    }
  }

  /**
   * Khổng lồ/Boss đang đuổi người ở gần (SPECIAL.wallSmash.range) húc tường trước mặt: tường mất máu, hết máu
   * thì vỡ thành ô trống (flow field dựng lại, tiếng ồn lớn, ghi vào `mapChanges` để host gửi đi).
   */
  private smashWalls(): void {
    const W = SPECIAL.wallSmash;
    const front = (W.frontDeg * Math.PI) / 180;
    for (const z of this.zombies) {
      if (!breaksDoors(z.kind) || z.mode !== 'chase' || z.target === null || z.hp <= 0) continue;
      const t = this.players.get(z.target);
      if (!t || Math.hypot(t.x - z.x, t.y - z.y) > W.range) continue;
      const r = radiusOf(z) + W.reach;
      const dmg = W.dps * DT * (z.kind === 'boss' ? W.bossFactor : 1);
      for (let ty = Math.floor(z.y - r); ty <= Math.floor(z.y + r); ty++) {
        for (let tx = Math.floor(z.x - r); tx <= Math.floor(z.x + r); tx++) {
          if (!this.isWall(tx, ty) || !circleOverlapsTile(z.x, z.y, r, tx, ty)) continue;
          if (angleDiff(z.facing, Math.atan2(ty + 0.5 - z.y, tx + 0.5 - z.x)) > front) continue;
          const key = tileKey(tx, ty);
          const hp = (this.wallHp.get(key) ?? W.wallHp) - dmg;
          if (hp > 0) {
            this.wallHp.set(key, hp);
            continue;
          }
          this.wallHp.delete(key);
          this.brokenWalls.add(key);
          this.flowDirty = true;
          this.mapChanges.push({ x: tx, y: ty });
          this.emitNoise(tx + 0.5, ty + 0.5, NOISE.doorBreak);
        }
      }
    }
  }

  /** Phần "theo input" của người chơi: đi/chạy, mở cửa, chém. Giống hệt Predictor phía client. */
  private applyInput(p: PlayerState, input: PlayerInput): void {
    stepPlayer(p, input, DT, this.blocked);
    // đói/khát cạn làm hết máu → gục như bị cắn
    if (isUp(p) && p.hp <= 0) this.down(p);
    if (isAlive(p)) {
      if (isUp(p) && hasBtn(input, Btn.Interact) && (p.prevButtons & Btn.Interact) === 0) this.toggleDoor(p);
      // gục thì không chém được (luồng E ở trên giữ nguyên — B đang nối loot vào đó)
      if (hasBtn(input, Btn.Attack) && isUp(p)) this.attack(p, input);
    }
    p.prevButtons = input.buttons;
  }

  /**
   * Cứu và kéo người gục (GĐ 2c). Người đứng được, giữ R và đứng yên cạnh người gục → cộng thời gian cứu;
   * đủ PARTY.reviveSec thì người gục đứng dậy. Không ai cứu trong tick thì thời gian cứu giảm dần
   * (PARTY.reviveDecayRate lần nhanh hơn lúc cứu) — mạng giật mất 1–2 input của người cứu không làm mất hết.
   * Giữ G cạnh người gục → kéo họ theo sau lưng (người kéo đi chậm lại từ tick sau).
   * Duyệt theo thứ tự id → tất định.
   */
  private partyActions(players: readonly PlayerState[], inputs: ReadonlyMap<PeerId, PlayerInput>): void {
    const reviving = new Set<PeerId>();
    for (const p of players) {
      const input = inputs.get(p.id);
      p.dragging = false;
      if (!input || !isUp(p)) continue;
      const still = input.moveX === 0 && input.moveY === 0;
      if (hasBtn(input, Btn.Revive) && still) {
        const d = this.nearestDowned(p, PARTY.reviveRange);
        if (!d || reviving.has(d.id)) continue;
        reviving.add(d.id);
        d.reviveProgress += DT;
        if (d.reviveProgress >= PARTY.reviveSec - 1e-6) this.standUp(d);
      } else if (hasBtn(input, Btn.Drag)) {
        const d = this.nearestDowned(p, PARTY.dragRange);
        if (!d) continue;
        p.dragging = true;
        const tx = p.x - Math.cos(p.facing) * PARTY.dragOffset;
        const ty = p.y - Math.sin(p.facing) * PARTY.dragOffset;
        moveCircle(d, tx - d.x, ty - d.y, PLAYER.radius, this.blocked);
      }
    }
    for (const p of players) {
      if (isDowned(p) && !reviving.has(p.id)) {
        p.reviveProgress = Math.max(0, p.reviveProgress - DT * PARTY.reviveDecayRate);
      }
    }
  }

  private nearestDowned(p: PlayerState, range: number): PlayerState | null {
    let best: PlayerState | null = null;
    let bestD = range;
    for (const o of this.sortedPlayers()) {
      if (o === p || !isDowned(o)) continue;
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d <= bestD && (best === null || d < bestD)) {
        best = o;
        bestD = d;
      }
    }
    return best;
  }

  private standUp(p: PlayerState): void {
    p.downedFor = 0;
    p.reviveProgress = 0;
    p.hp = Math.min(PARTY.reviveHp, p.maxHp);
  }

  /** Hết máu: còn đồng đội đứng được thì gục (chờ cứu), không thì chết hẳn. */
  private down(p: PlayerState): void {
    const someoneUp = [...this.players.values()].some((o) => o !== p && isUp(o));
    if (!someoneUp) {
      this.die(p);
      return;
    }
    if (this.horde?.active) this.horde.downs[p.id] = (this.horde.downs[p.id] ?? 0) + 1;
    p.hp = 0;
    p.downedFor = PARTY.downedSec;
    p.reviveProgress = 0;
    p.sprinting = false;
    p.healLeft = p.healRate = 0;
  }

  /** Xác đủ giờ → zombie đứng dậy tại chỗ, mang id người chơi (GĐ 6). */
  private stepCorpses(): void {
    if (this.corpses.length === 0) return;
    for (const c of this.corpses) {
      c.turnIn = countdown(c.turnIn, DT);
      if (c.turnIn > 0) continue;
      const z = createZombie(this.nextZombieId++, c.x, c.y, this.rng, 'normal');
      z.hp *= PARTY.turnedHpFactor;
      z.turnedFrom = c.player;
      // vừa đứng dậy: đi lang thang ngay tại chỗ (không biết ai ở đâu)
      this.zombies.push(z);
      this.emitNoise(c.x, c.y, NOISE.meleeHit);
    }
    this.corpses = this.corpses.filter((c) => c.turnIn > 0);
  }

  private die(p: PlayerState): void {
    // xác ở lại chỗ chết, sau PARTY.turnSec thành zombie
    this.corpses.push({ player: p.id, x: p.x, y: p.y, turnIn: PARTY.turnSec });
    p.hp = 0;
    p.downedFor = 0;
    p.reviveProgress = 0;
    p.dragging = false;
    p.respawnIn = PLAYER.respawnSec;
    p.sprinting = false;
    this.flowDirty = true;
    this.events.push({ type: 'death', player: p.id });
  }

  /**
   * Mã băm trạng thái — để test tính tất định (và GĐ 2 so khớp host/client).
   * Gồm MỌI trường ảnh hưởng tới tick sau (cả trạng thái ẩn: nút tick trước, bộ đếm, RNG),
   * để hai bản cùng hash thì chạy tiếp cùng input sẽ ra cùng kết quả.
   */
  hash(): string {
    const f = (n: number) => n.toFixed(4);
    const b = (v: boolean) => (v ? 1 : 0);
    const parts: string[] = [
      `t${this.tick}`,
      `r${this.rng.stateValue}`,
      `n${this.nextZombieId}`,
      `f${b(this.flowDirty)}`,
      `ft${this.flowTargets.map((t) => `${f(t.x)},${f(t.y)}`).join(';')}`,
    ];
    for (const p of this.sortedPlayers()) {
      parts.push(
        `p${p.id}:${f(p.x)},${f(p.y)},${f(p.facing)},${f(p.hp)},${f(p.stamina)},${b(p.exhausted)},` +
          `${f(p.staminaIdle)},${b(p.sprinting)},${f(p.attackCd)},${p.prevButtons},${f(p.respawnIn)},` +
          `${f(p.downedFor)},${f(p.reviveProgress)},${b(p.dragging)},${b(p.flashlight)},${f(p.shield)},` +
          `${f(p.food)},${f(p.water)},${f(p.infection)},${f(p.maxHp)},${f(p.healLeft)},${f(p.healRate)},` +
          `${f(p.stillFor)},${p.weapon},${p.weaponRarity},${p.magPistol},${p.magRifle},${p.reloadGun},` +
          `${f(p.reloadLeft)},${p.reloadAmount},${f(p.recoil)},${p.shots},${p.armorHead},${p.armorBody},` +
          `${p.armorLegs},${f(p.durHead)},${f(p.durBody)},${f(p.durLegs)}`,
      );
    }
    for (const z of this.zombies) {
      parts.push(
        `z${z.id}:${z.kind},${f(z.x)},${f(z.y)},${f(z.facing)},${f(z.hp)},${z.mode},${z.target ?? ''},` +
          `${f(z.wanderIn)},${b(z.wanderMoving)},${f(z.biteCd)},${f(z.goalX)},${f(z.goalY)},` +
          `${f(z.investigateFor)},${b(z.hidden)},${f(z.burstFor)},${f(z.spitCd)},${b(z.horde)},` +
          `${f(z.slamCd)},${f(z.roarCd)},${z.turnedFrom ?? ''}`,
      );
    }
    for (const p of this.pools) {
      parts.push(
        `o${p.id}:${p.kind},${f(p.x)},${f(p.y)},${f(p.radius)},${f(p.ttl)},${f(p.armIn)},${f(p.dps)}`,
      );
    }
    parts.push(`n${this.noises.map((n) => `${f(n.x)},${f(n.y)},${f(n.radius)}`).join(';')}`);
    parts.push(`x${[...this.brokenDoors].sort().join(';')}`);
    parts.push(
      `w${this.brokenWallList()
        .map((t) => `${t.x},${t.y}`)
        .join(';')}`,
    );
    parts.push(
      `wd${[...this.wallHp]
        .sort((a, b) => a[0] - b[0])
        .map(([k, hp]) => `${k}:${f(hp)}`)
        .join(';')}`,
    );
    if (this.horde) parts.push(`h${JSON.stringify(sortKeys(this.horde))}`);
    for (const c of this.corpses) parts.push(`c${c.player}:${f(c.x)},${f(c.y)},${f(c.turnIn)}`);
    parts.push(`d${this.doors.openList().join(';')}`);
    return hashString(parts.join('|')).toString(16).padStart(8, '0');
  }

  private sortedPlayers(): PlayerState[] {
    return [...this.players.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** Chỗ xuất phát chưa có ai đứng (rải người chơi ra, không chồng lên nhau); hết chỗ thì chỗ đầu. */
  private freeSpawn(self: PeerId): Vec2 {
    const spots = this.map.spawns?.length ? this.map.spawns : [this.map.spawn];
    const taken = (s: Vec2) => {
      for (const p of this.players.values()) {
        if (p.id !== self && isAlive(p) && Math.hypot(p.x - s.x, p.y - s.y) < PLAYER.radius * 2) return true;
      }
      return false;
    };
    return { ...(spots.find((s) => !taken(s)) ?? (spots[0] as Vec2)) };
  }

  /**
   * Chỗ hồi sinh an toàn: ô đường (MapSource.isRoad, thiếu thì ô trống) gần đồng đội còn sống nhất (không còn
   * ai thì gần điểm xuất phát), không zombie nào trong PARTY.respawnSafeRadius, không trùng chỗ ai đang đứng.
   * Duyệt vòng vuông nở dần quanh từng mốc, dừng khi vòng đã xa hơn chỗ tốt nhất. Không có chỗ nào an toàn
   * trong PARTY.respawnSearchRadius thì về chỗ xuất phát như cũ.
   */
  private safeRespawn(self: PeerId): Vec2 {
    const team = this.sortedPlayers().filter((q) => q.id !== self && isAlive(q));
    const anchors: readonly Vec2[] = team.length > 0 ? team : [this.map.spawn];
    const safe2 = PARTY.respawnSafeRadius ** 2;
    const zs = this.zombies;
    const road = this.map.isRoad?.bind(this.map);
    const ok = (tx: number, ty: number, x: number, y: number) => {
      if (this.blocked(tx, ty) || (road && !road(tx, ty))) return false;
      for (const z of zs) if (z.hp > 0 && (z.x - x) ** 2 + (z.y - y) ** 2 < safe2) return false;
      for (const q of this.players.values()) {
        if (q.id !== self && isAlive(q) && Math.hypot(q.x - x, q.y - y) < PLAYER.radius * 2) return false;
      }
      return true;
    };
    let best: Vec2 | null = null;
    let bestD = Infinity;
    for (const a of anchors) {
      const ax = Math.floor(a.x);
      const ay = Math.floor(a.y);
      for (let r = 0; r <= PARTY.respawnSearchRadius && r <= bestD + 1; r++) {
        for (let ty = ay - r; ty <= ay + r; ty++) {
          const edge = ty === ay - r || ty === ay + r;
          for (let tx = ax - r; tx <= ax + r; tx += edge || r === 0 ? 1 : 2 * r) {
            const x = tx + 0.5;
            const y = ty + 0.5;
            const d = Math.min(...anchors.map((b) => Math.hypot(b.x - x, b.y - y)));
            if (d < bestD && ok(tx, ty, x, y)) {
              best = { x, y };
              bestD = d;
            }
          }
        }
      }
    }
    return best ?? this.freeSpawn(self);
  }

  private respawn(p: PlayerState): void {
    const at = this.safeRespawn(p.id);
    p.x = at.x;
    p.y = at.y;
    p.shield = PARTY.respawnShieldSec;
    respawnSurvival(p);
    p.hp = p.maxHp;
    p.healLeft = p.healRate = 0;
    p.stamina = PLAYER.maxStamina;
    p.exhausted = false;
    p.staminaIdle = 0;
    p.attackCd = 0;
    p.respawnIn = 0;
    p.downedFor = 0;
    p.reviveProgress = 0;
    p.dragging = false;
    this.flowDirty = true;
    this.events.push({ type: 'respawn', player: p.id });
  }

  private toggleDoor(p: PlayerState): void {
    const d = nearestDoor(this.map, p, PLAYER.interactRange);
    if (!d) return;
    const open = !this.doors.isOpen(d.x, d.y);
    // không đóng được khi có người hoặc zombie chồng lên khung cửa, hoặc cửa đã bị khổng lồ phá
    if (!open && (this.doorOccupied(d) || this.brokenDoors.has(`${d.x},${d.y}`))) return;
    this.doors.set(d.x, d.y, open);
    this.flowDirty = true;
    this.events.push({ type: 'door', x: d.x, y: d.y, open });
    this.emitNoise(d.x + 0.5, d.y + 0.5, NOISE.doorToggle);
  }

  private doorOccupied(d: Vec2): boolean {
    for (const p of this.players.values()) {
      if (isAlive(p) && circleOverlapsTile(p.x, p.y, PLAYER.radius, d.x, d.y)) return true;
    }
    return this.zombies.some((z) => z.hp > 0 && circleOverlapsTile(z.x, z.y, radiusOf(z), d.x, d.y));
  }

  /**
   * Vị trí zombie ở vài tick trước (bù trễ khi bắn súng): chỉ ghi khi có người cầm súng, giữ SHOT_REWIND_TICKS tick.
   * Không nằm trong trạng thái/hash: chỉ phụ thuộc chuỗi tick đã chạy (host dựng lại sau đổi host thì bắt đầu trống).
   */
  private history: { tick: number; pos: Map<number, { x: number; y: number }> }[] = [];

  private recordHistory(): void {
    if (![...this.players.values()].some((p) => isGun(p.weapon))) {
      this.history.length = 0;
      return;
    }
    const pos = new Map<number, { x: number; y: number }>();
    for (const z of this.zombies) pos.set(z.id, { x: z.x, y: z.y });
    // = trạng thái sau tick này, snapshot gắn nhãn tick + 1 (tick tăng ngay sau đây)
    this.history.push({ tick: this.tick + 1, pos });
    if (this.history.length > SHOT_REWIND_TICKS) this.history.shift();
  }

  /**
   * Cầm vũ khí (GĐ 3b, host đã kiểm tra có món trong túi). Đang nạp súng khác thì vẫn nạp tiếp: đạn đã trừ khỏi túi
   * vào băng súng đó khi hết giờ.
   */
  equip(id: PeerId, weapon: WeaponId, rarity: Rarity): void {
    const p = this.players.get(id);
    if (!p) return;
    p.weapon = weapon;
    p.weaponRarity = rarity;
  }

  /**
   * Nạp đạn (GĐ 3b): súng đang cầm + số viên còn thiếu, hoặc lỗi. Host trừ đúng số đó (hoặc ít hơn nếu túi ít đạn),
   * rồi khi giao dịch đã xác nhận gọi `beginReload`.
   */
  reloadNeed(
    id: PeerId,
  ): { gun: GunId; need: number } | { error: 'no_gun' | 'mag_full' | 'reloading' | 'player_not_up' } {
    const p = this.players.get(id);
    if (!p || !isUp(p)) return { error: 'player_not_up' };
    if (!isGun(p.weapon)) return { error: 'no_gun' };
    if (p.reloadLeft > 0) return { error: 'reloading' };
    const need = GUNS[p.weapon].magazine - magOf(p, p.weapon);
    return need > 0 ? { gun: p.weapon, need } : { error: 'mag_full' };
  }

  beginReload(id: PeerId, gun: GunId, amount: number): void {
    const p = this.players.get(id);
    if (p && amount > 0) startReload(p, gun, amount);
  }

  private attack(p: PlayerState, input: PlayerInput): void {
    if (isGun(p.weapon)) {
      this.shoot(p, p.weapon, input);
      return;
    }
    const res = meleeAttack(p, meleeOf(p.weapon, p.weaponRarity), this.zombies, this.blocked);
    if (!res) return;
    this.events.push({ type: 'swing', player: p.id, x: p.x, y: p.y, facing: p.facing });
    if (!res.hit) return;
    const { zombie: z, killed, assassination, silent } = res.hit;
    if (!silent) this.emitNoise(z.x, z.y, NOISE.meleeHit);
    if (killed && this.horde?.active) this.horde.kills[p.id] = (this.horde.kills[p.id] ?? 0) + 1;
    this.events.push({
      type: 'hit',
      player: p.id,
      zombie: z.id,
      x: z.x,
      y: z.y,
      killed,
      assassination,
      silent,
      hp: Math.max(0, z.hp),
    });
  }

  /** Bắn súng: trúng do mô phỏng quyết, vị trí zombie lùi về lúc người bắn nhìn thấy (`input.view`). Súng ồn. */
  private shoot(p: PlayerState, gun: GunId, input: PlayerInput): void {
    const pressed = (p.prevButtons & Btn.Attack) === 0;
    let at: ((z: ZombieState) => { x: number; y: number }) | undefined;
    if (input.view !== undefined && input.view < this.tick) {
      const back = Math.max(input.view, this.tick - SHOT_REWIND_TICKS);
      const h = this.history.find((e) => e.tick >= back);
      if (h) at = (z) => h.pos.get(z.id) ?? z;
    }
    const shot = fireGun(p, gun, p.weaponRarity, this.zombies, this.blocked, pressed, at);
    if (!shot) return;
    this.emitNoise(p.x, p.y, GUNS[gun].noise);
    this.events.push({
      type: 'shot',
      player: p.id,
      x: shot.x,
      y: shot.y,
      angle: shot.angle,
      dist: shot.dist,
      hit: shot.hits.length > 0,
    });
    for (const { zombie: z, killed } of shot.hits) {
      if (killed && this.horde?.active) this.horde.kills[p.id] = (this.horde.kills[p.id] ?? 0) + 1;
      this.events.push({
        type: 'hit',
        player: p.id,
        zombie: z.id,
        x: z.x,
        y: z.y,
        killed,
        assassination: false,
        silent: false,
        hp: Math.max(0, z.hp),
      });
    }
  }

  /** Sát thương qua giáp (GĐ 3b): giảm theo bộ đang mặc, giáp mòn; món vỡ → `armorBreaks` (host trừ khỏi túi). */
  private hurt(p: PlayerState, damage: number, acid = false): number {
    const r = absorb(p, damage, acid);
    for (const b of r.broken) this.armorBreaks.push({ player: p.id, ...b });
    return r.damage;
  }

  /** Mặc giáp (GĐ 3b, host đã kiểm tra có món trong túi). */
  wearArmor(id: PeerId, itemId: ItemId, rarity: Rarity): boolean {
    const p = this.players.get(id);
    return !!p && wearArmor(p, itemId, rarity);
  }

  private bite(z: ZombieState, p: PlayerState): void {
    if (p.shield > 0) return; // vừa hồi sinh: bất tử
    this.events.push({ type: 'bite', zombie: z.id, player: p.id, x: p.x, y: p.y });
    if (isDowned(p)) {
      p.downedFor = Math.max(0, p.downedFor - PARTY.downedBitePenaltySec);
      if (p.downedFor === 0) this.die(p);
      return;
    }
    const factor = infectionFactor(p);
    p.hp = Math.max(0, p.hp - this.hurt(p, Z.biteDamage * KIND[z.kind].biteDamage));
    infectFromBite(p, KIND[z.kind].biteDamage * factor);
    if (p.hp === 0) this.down(p);
  }

  /**
   * Tách zombie chồng lên nhau (spatial hash ô 1×1) và đẩy zombie ra khỏi người chơi.
   * Đợt tràn 650 con dồn sát là chỗ nóng nhất của host (GĐ 7): danh sách ô dạng liên kết (không tạo mảng
   * mỗi tick), so bình phương khoảng cách trước khi lấy căn, chỉ đẩy khỏi tường những con vừa bị xê dịch
   * (con tự đi đã được moveCircle đẩy rồi).
   */
  private separate(alive: readonly PlayerState[]): void {
    const zs = this.zombies;
    const n = zs.length;
    const head = new Map<number, number>();
    const next = new Int32Array(n);
    const radius = new Float64Array(n);
    const moved = new Uint8Array(n);
    const cellKey = (cx: number, cy: number) => ((cx & 0xffff) << 16) | (cy & 0xffff);
    // duyệt ngược để danh sách mỗi ô theo thứ tự chỉ số tăng dần (tất định, giống bản cũ)
    for (let i = n - 1; i >= 0; i--) {
      const z = zs[i] as ZombieState;
      radius[i] = radiusOf(z);
      const k = cellKey(Math.floor(z.x), Math.floor(z.y));
      next[i] = head.get(k) ?? -1;
      head.set(k, i);
    }
    for (let i = 0; i < n; i++) {
      const a = zs[i] as ZombieState;
      const ra = radius[i] as number;
      const cx = Math.floor(a.x);
      const cy = Math.floor(a.y);
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          for (let j = head.get(cellKey(cx + ox, cy + oy)) ?? -1; j !== -1; j = next[j] as number) {
            if (j <= i) continue;
            const b = zs[j] as ZombieState;
            const minD = ra + (radius[j] as number);
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const d2 = dx * dx + dy * dy;
            if (d2 >= minD * minD) continue;
            const d = Math.sqrt(d2);
            let nx: number;
            let ny: number;
            if (d < 1e-6) {
              // trùng tâm: tách theo hướng cố định suy từ id (tất định)
              const ang = a.id * 2.399963;
              nx = Math.cos(ang);
              ny = Math.sin(ang);
            } else {
              nx = dx / d;
              ny = dy / d;
            }
            const half = (minD - d) / 2;
            a.x -= nx * half;
            a.y -= ny * half;
            b.x += nx * half;
            b.y += ny * half;
            moved[i] = 1;
            moved[j] = 1;
          }
        }
      }
    }
    for (let i = 0; i < n; i++) {
      const z = zs[i] as ZombieState;
      const minPD = (radius[i] as number) + PLAYER.radius;
      for (const p of alive) {
        const dx = z.x - p.x;
        const dy = z.y - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minPD * minPD || d2 < 1e-12) continue;
        const d = Math.sqrt(d2);
        z.x = p.x + (dx / d) * minPD;
        z.y = p.y + (dy / d) * minPD;
        moved[i] = 1;
      }
      if (moved[i]) pushOut(z, radius[i] as number, breaksDoors(z.kind) ? this.wallsOnly : this.blocked);
    }
  }

  /** Sinh thêm zombie cho đủ số: cách người chơi spawnMinDist–spawnMaxDist, trên ô không bị chặn. */
  private refillZombies(): void {
    // zombie đợt tràn không tính vào dân số thường
    const normal = () => this.zombies.reduce((n, z) => n + (z.horde ? 0 : 1), 0);
    const missing = this.zombieCount - normal();
    if (missing <= 0) return;
    const alive = this.sortedPlayers().filter(isAlive);
    const anchors: readonly Vec2[] = alive.length > 0 ? alive : [this.map.spawn];
    let tries = missing * SPAWN_TRIES;
    while (normal() < this.zombieCount && tries-- > 0) {
      const a = this.rng.pick(anchors);
      const ang = this.rng.next() * Math.PI * 2;
      const r = Z.spawnMinDist + this.rng.next() * (Z.spawnMaxDist - Z.spawnMinDist);
      const tx = Math.floor(a.x + Math.cos(ang) * r);
      const ty = Math.floor(a.y + Math.sin(ang) * r);
      if (this.blocked(tx, ty)) continue;
      const x = tx + 0.5;
      const y = ty + 0.5;
      if (anchors.some((p) => Math.hypot(p.x - x, p.y - y) < Z.spawnMinDist)) continue;
      this.zombies.push(createZombie(this.nextZombieId++, x, y, this.rng, this.pickKind()));
    }
  }

  /** Chọn loại zombie mới theo tỉ lệ ngày/đêm (tất định theo RNG của thế giới). */
  private pickKind(): ZombieKind {
    const dark = this.darkness;
    const weight = (k: ZombieKind) => KIND[k].weightDay * (1 - dark) + KIND[k].weightNight * dark;
    let total = 0;
    for (const k of ZOMBIE_KINDS) total += weight(k);
    let roll = this.rng.next() * total;
    for (const k of ZOMBIE_KINDS) {
      roll -= weight(k);
      if (roll < 0) return k;
    }
    return 'normal';
  }
}

function nearestOf<T extends { x: number; y: number }>(
  list: readonly T[],
  from: { x: number; y: number },
): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const p of list) {
    const d = Math.hypot(p.x - from.x, p.y - from.y);
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

function structuredCopy(h: HordeState): HordeState {
  return { ...h, kills: { ...h.kills }, downs: { ...h.downs } };
}

/** Sắp khóa object (đệ quy 1 cấp) để JSON.stringify ra cùng chuỗi trên mọi máy — dùng cho hash. */
function sortKeys(h: HordeState): unknown {
  const sorted = (o: Record<string, number>) =>
    Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
  return { ...h, kills: sorted(h.kills), downs: sorted(h.downs) };
}

/** Khóa số của ô (tx, ty) — chính xác với mọi tọa độ map hỗ trợ (|tx|, |ty| < 2^25). */
const KEY_OFF = 2 ** 25;
const KEY_MUL = 2 ** 26;
export function tileKey(tx: number, ty: number): number {
  return (tx + KEY_OFF) * KEY_MUL + (ty + KEY_OFF);
}
export function keyTile(k: number): Vec2 {
  return { x: Math.floor(k / KEY_MUL) - KEY_OFF, y: (k % KEY_MUL) - KEY_OFF };
}
