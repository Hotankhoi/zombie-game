import { KNIFE } from '@shared/data/melee';
import { PLAYER } from '@shared/data/player';
import { ZOMBIE_NORMAL as Z } from '@shared/data/zombies';
import { SIM_TICK_MS, type PeerId, type Vec2 } from '@shared/types';
import { Rng, hashString } from '@shared/util/rng';
import { pushOut, type BlockedFn } from './collision';
import { dayClock } from './dayNight';
import { meleeAttack } from './combat';
import { Doors, circleOverlapsTile, nearestDoor } from './doors';
import { FlowField } from './flowField';
import type { MapSource } from './grid';
import { Btn, hasBtn, type PlayerInput } from './input';
import { createPlayer, isAlive, isDowned, isUp, stepPlayer, type PlayerState } from './player';
import { moveCircle } from './collision';
import { NOISE } from './tuning/night';
import { PARTY } from './tuning/party';
import { KIND, SPECIAL, ZOMBIE_KINDS, type ZombieKind } from './tuning/zombieKinds';
import { countdown } from './timer';
import { createZombie, hearNoise, radiusOf, stepZombie, type ZombieState } from './zombie';

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
    }
  | { type: 'bite'; zombie: number; player: PeerId; x: number; y: number }
  | { type: 'door'; x: number; y: number; open: boolean }
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
  noises?: Noise[];
}

export interface SimWorldOptions {
  seed: number | string;
  map: MapSource;
  /** Số zombie giữ trên bản đồ (mặc định ZOMBIE_NORMAL.population). */
  zombieCount?: number;
  /** Dựng tiếp từ trạng thái có sẵn thay vì thế giới mới (seed khi đó không dùng cho RNG). */
  restore?: WorldState;
}

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
  /** Tiếng ồn phát ra trong tick, zombie nghe ở đầu pha zombie (cùng tick hoặc tick sau). */
  private noises: Noise[] = [];

  /** Ô chặn: tường, hoặc cửa đang đóng. */
  readonly blocked: BlockedFn = (tx, ty) =>
    this.map.isWall(tx, ty) || (this.map.isDoor(tx, ty) && !this.doors.isOpen(tx, ty));
  /** Chỉ tường — khổng lồ đi xuyên cửa đóng (và phá nó). */
  readonly wallsOnly: BlockedFn = (tx, ty) => this.map.isWall(tx, ty);

  constructor(opts: SimWorldOptions) {
    this.map = opts.map;
    this.zombieCount = opts.zombieCount ?? Z.population;
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
    this.flow.build(this.flowTargets, this.blocked);
    this.flowDirty = s.flowDirty;
    this.pools = (s.pools ?? []).map((p) => ({ ...p }));
    this.nextPoolId = s.nextPoolId ?? 1;
    for (const d of s.brokenDoors ?? []) this.brokenDoors.add(`${d.x},${d.y}`);
    this.noises = (s.noises ?? []).map((n) => ({ ...n }));
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
      noises: this.noises.map((n) => ({ ...n })),
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

  addPlayer(id: PeerId): PlayerState {
    let p = this.players.get(id);
    if (!p) {
      p = createPlayer(id, this.map.spawn);
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
    const players = this.sortedPlayers();

    for (const p of players) {
      const input = inputs.get(p.id);
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
      onScream: (z: ZombieState) => this.emitNoise(z.x, z.y, NOISE.scream),
      onSpit: (z: ZombieState, x: number, y: number) => this.spit(x, y),
    };
    for (const z of this.zombies) stepZombie(z, ctx);
    this.smashDoors();
    this.separate(alive);
    this.refillZombies();
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
    for (const z of this.zombies) {
      if (z.hp > 0 || z.kind !== 'bloater') continue;
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
        if (!isUp(p) || Math.hypot(p.x - pool.x, p.y - pool.y) > pool.radius) continue;
        p.hp = Math.max(0, p.hp - pool.dps * DT);
        if (p.hp === 0) this.down(p);
      }
    }
    this.pools = this.pools.filter((p) => p.ttl > 0);
  }

  /** Khổng lồ chồng lên cửa đóng → cửa vỡ (mở mãi), tiếng ồn lớn. */
  private smashDoors(): void {
    for (const z of this.zombies) {
      if (z.kind !== 'giant') continue;
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

  /** Phần "theo input" của người chơi: đi/chạy, mở cửa, chém. Giống hệt Predictor phía client. */
  private applyInput(p: PlayerState, input: PlayerInput): void {
    stepPlayer(p, input, DT, this.blocked);
    if (isAlive(p)) {
      if (hasBtn(input, Btn.Interact) && (p.prevButtons & Btn.Interact) === 0) this.toggleDoor(p);
      // gục thì không chém được (luồng E ở trên giữ nguyên — B đang nối loot vào đó)
      if (hasBtn(input, Btn.Attack) && isUp(p)) this.attack(p);
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
    p.hp = PARTY.reviveHp;
  }

  /** Hết máu: còn đồng đội đứng được thì gục (chờ cứu), không thì chết hẳn. */
  private down(p: PlayerState): void {
    const someoneUp = [...this.players.values()].some((o) => o !== p && isUp(o));
    if (!someoneUp) {
      this.die(p);
      return;
    }
    p.hp = 0;
    p.downedFor = PARTY.downedSec;
    p.reviveProgress = 0;
    p.sprinting = false;
  }

  private die(p: PlayerState): void {
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
          `${f(p.downedFor)},${f(p.reviveProgress)},${b(p.dragging)},${b(p.flashlight)}`,
      );
    }
    for (const z of this.zombies) {
      parts.push(
        `z${z.id}:${z.kind},${f(z.x)},${f(z.y)},${f(z.facing)},${f(z.hp)},${z.mode},${z.target ?? ''},` +
          `${f(z.wanderIn)},${b(z.wanderMoving)},${f(z.biteCd)},${f(z.goalX)},${f(z.goalY)},` +
          `${f(z.investigateFor)},${b(z.hidden)},${f(z.burstFor)},${f(z.spitCd)}`,
      );
    }
    for (const p of this.pools) {
      parts.push(
        `o${p.id}:${p.kind},${f(p.x)},${f(p.y)},${f(p.radius)},${f(p.ttl)},${f(p.armIn)},${f(p.dps)}`,
      );
    }
    parts.push(`n${this.noises.map((n) => `${f(n.x)},${f(n.y)},${f(n.radius)}`).join(';')}`);
    parts.push(`x${[...this.brokenDoors].sort().join(';')}`);
    parts.push(`d${this.doors.openList().join(';')}`);
    return hashString(parts.join('|')).toString(16).padStart(8, '0');
  }

  private sortedPlayers(): PlayerState[] {
    return [...this.players.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  private respawn(p: PlayerState): void {
    p.x = this.map.spawn.x;
    p.y = this.map.spawn.y;
    p.hp = PLAYER.maxHp;
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

  private attack(p: PlayerState): void {
    const res = meleeAttack(p, KNIFE, this.zombies, this.blocked);
    if (!res) return;
    this.events.push({ type: 'swing', player: p.id, x: p.x, y: p.y, facing: p.facing });
    if (!res.hit) return;
    const { zombie: z, killed, assassination, silent } = res.hit;
    if (!silent) this.emitNoise(z.x, z.y, NOISE.meleeHit);
    this.events.push({
      type: 'hit',
      player: p.id,
      zombie: z.id,
      x: z.x,
      y: z.y,
      killed,
      assassination,
      silent,
    });
  }

  private bite(z: ZombieState, p: PlayerState): void {
    this.events.push({ type: 'bite', zombie: z.id, player: p.id, x: p.x, y: p.y });
    if (isDowned(p)) {
      p.downedFor = Math.max(0, p.downedFor - PARTY.downedBitePenaltySec);
      if (p.downedFor === 0) this.die(p);
      return;
    }
    p.hp = Math.max(0, p.hp - Z.biteDamage * KIND[z.kind].biteDamage);
    if (p.hp === 0) this.down(p);
  }

  /** Tách zombie chồng lên nhau (spatial hash ô 1×1) và đẩy zombie ra khỏi người chơi. */
  private separate(alive: readonly PlayerState[]): void {
    const zs = this.zombies;
    const cells = new Map<number, number[]>();
    const cellKey = (cx: number, cy: number) => ((cx & 0xffff) << 16) | (cy & 0xffff);
    for (let i = 0; i < zs.length; i++) {
      const z = zs[i] as ZombieState;
      const k = cellKey(Math.floor(z.x), Math.floor(z.y));
      const list = cells.get(k);
      if (list) list.push(i);
      else cells.set(k, [i]);
    }
    for (let i = 0; i < zs.length; i++) {
      const a = zs[i] as ZombieState;
      const cx = Math.floor(a.x);
      const cy = Math.floor(a.y);
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const list = cells.get(cellKey(cx + ox, cy + oy));
          if (!list) continue;
          for (const j of list) {
            if (j <= i) continue;
            const b = zs[j] as ZombieState;
            const minD = radiusOf(a) + radiusOf(b);
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const d = Math.hypot(dx, dy);
            if (d >= minD) continue;
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
          }
        }
      }
    }
    for (const z of zs) {
      const minPD = radiusOf(z) + PLAYER.radius;
      for (const p of alive) {
        const dx = z.x - p.x;
        const dy = z.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d >= minPD || d < 1e-6) continue;
        z.x = p.x + (dx / d) * minPD;
        z.y = p.y + (dy / d) * minPD;
      }
      pushOut(z, radiusOf(z), z.kind === 'giant' ? this.wallsOnly : this.blocked);
    }
  }

  /** Sinh thêm zombie cho đủ số: cách người chơi spawnMinDist–spawnMaxDist, trên ô không bị chặn. */
  private refillZombies(): void {
    const missing = this.zombieCount - this.zombies.length;
    if (missing <= 0) return;
    const alive = this.sortedPlayers().filter(isAlive);
    const anchors: readonly Vec2[] = alive.length > 0 ? alive : [this.map.spawn];
    let tries = missing * SPAWN_TRIES;
    while (this.zombies.length < this.zombieCount && tries-- > 0) {
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
