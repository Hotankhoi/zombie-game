import { KNIFE } from '@shared/data/melee';
import { PLAYER } from '@shared/data/player';
import { ZOMBIE_NORMAL as Z } from '@shared/data/zombies';
import { SIM_TICK_MS, type PeerId, type Vec2 } from '@shared/types';
import { Rng, hashString } from '@shared/util/rng';
import { pushOut, type BlockedFn } from './collision';
import { meleeAttack } from './combat';
import { Doors, circleOverlapsTile, nearestDoor } from './doors';
import { FlowField } from './flowField';
import type { MapSource } from './grid';
import { Btn, IDLE_INPUT, hasBtn, type PlayerInput } from './input';
import { createPlayer, isAlive, stepPlayer, type PlayerState } from './player';
import { countdown } from './timer';
import { createZombie, stepZombie, type ZombieState } from './zombie';

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

export interface SimWorldOptions {
  seed: number | string;
  map: MapSource;
  /** Số zombie giữ trên bản đồ (mặc định ZOMBIE_NORMAL.population). */
  zombieCount?: number;
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
  private nextZombieId = 1;

  /** Ô chặn: tường, hoặc cửa đang đóng. */
  readonly blocked: BlockedFn = (tx, ty) =>
    this.map.isWall(tx, ty) || (this.map.isDoor(tx, ty) && !this.doors.isOpen(tx, ty));

  constructor(opts: SimWorldOptions) {
    this.map = opts.map;
    this.rng = new Rng(opts.seed);
    this.zombieCount = opts.zombieCount ?? Z.population;
    this.refillZombies();
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

  /** Chạy 1 tick (SIM_TICK_MS). Người chơi thiếu input thì coi như đứng yên. */
  step(inputs: ReadonlyMap<PeerId, PlayerInput>): void {
    this.events = [];
    const players = this.sortedPlayers();

    for (const p of players) {
      const input = inputs.get(p.id) ?? IDLE_INPUT;
      if (!isAlive(p)) {
        p.respawnIn = countdown(p.respawnIn, DT);
        if (p.respawnIn === 0) this.respawn(p);
      }
      stepPlayer(p, input, DT, this.blocked);
      if (isAlive(p)) {
        if (hasBtn(input, Btn.Interact) && (p.prevButtons & Btn.Interact) === 0) this.toggleDoor(p);
        if (hasBtn(input, Btn.Attack)) this.attack(p);
      }
      p.prevButtons = input.buttons;
    }
    this.zombies = this.zombies.filter((z) => z.hp > 0);

    const alive = players.filter(isAlive);
    if (this.flowDirty || this.tick % FLOW_EVERY === 0) {
      this.flow.build(alive, this.blocked);
      this.flowDirty = false;
    }
    const ctx = {
      dt: DT,
      rng: this.rng,
      blocked: this.blocked,
      flow: this.flow,
      players,
      onBite: (z: ZombieState, p: PlayerState) => this.bite(z, p),
    };
    for (const z of this.zombies) stepZombie(z, ctx);
    this.separate(alive);
    this.refillZombies();
    this.tick++;
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
    ];
    for (const p of this.sortedPlayers()) {
      parts.push(
        `p${p.id}:${f(p.x)},${f(p.y)},${f(p.facing)},${f(p.hp)},${f(p.stamina)},${b(p.exhausted)},` +
          `${f(p.staminaIdle)},${b(p.sprinting)},${f(p.attackCd)},${p.prevButtons},${f(p.respawnIn)}`,
      );
    }
    for (const z of this.zombies) {
      parts.push(
        `z${z.id}:${f(z.x)},${f(z.y)},${f(z.facing)},${f(z.hp)},${z.mode},${z.target ?? ''},` +
          `${f(z.wanderIn)},${b(z.wanderMoving)},${f(z.biteCd)}`,
      );
    }
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
    this.flowDirty = true;
    this.events.push({ type: 'respawn', player: p.id });
  }

  private toggleDoor(p: PlayerState): void {
    const d = nearestDoor(this.map, p, PLAYER.interactRange);
    if (!d) return;
    const open = !this.doors.isOpen(d.x, d.y);
    // không đóng được khi có người hoặc zombie chồng lên khung cửa
    if (!open && this.doorOccupied(d)) return;
    this.doors.set(d.x, d.y, open);
    this.flowDirty = true;
    this.events.push({ type: 'door', x: d.x, y: d.y, open });
  }

  private doorOccupied(d: Vec2): boolean {
    for (const p of this.players.values()) {
      if (isAlive(p) && circleOverlapsTile(p.x, p.y, PLAYER.radius, d.x, d.y)) return true;
    }
    return this.zombies.some((z) => z.hp > 0 && circleOverlapsTile(z.x, z.y, Z.radius, d.x, d.y));
  }

  private attack(p: PlayerState): void {
    const res = meleeAttack(p, KNIFE, this.zombies, this.blocked);
    if (!res) return;
    this.events.push({ type: 'swing', player: p.id, x: p.x, y: p.y, facing: p.facing });
    if (!res.hit) return;
    const { zombie: z, killed, assassination, silent } = res.hit;
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
    p.hp = Math.max(0, p.hp - Z.biteDamage);
    this.events.push({ type: 'bite', zombie: z.id, player: p.id, x: p.x, y: p.y });
    if (p.hp === 0) {
      p.respawnIn = PLAYER.respawnSec;
      p.sprinting = false;
      this.flowDirty = true;
      this.events.push({ type: 'death', player: p.id });
    }
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
    const minD = Z.radius * 2;
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
    const minPD = Z.radius + PLAYER.radius;
    for (const z of zs) {
      for (const p of alive) {
        const dx = z.x - p.x;
        const dy = z.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d >= minPD || d < 1e-6) continue;
        z.x = p.x + (dx / d) * minPD;
        z.y = p.y + (dy / d) * minPD;
      }
      pushOut(z, Z.radius, this.blocked);
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
      this.zombies.push(createZombie(this.nextZombieId++, x, y, this.rng));
    }
  }
}
