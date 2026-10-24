import { PLAYER } from '@shared/data/player';
import { ZOMBIE_NORMAL as Z } from '@shared/data/zombies';
import type { PeerId } from '@shared/types';
import type { Rng } from '@shared/util/rng';
import { angleDiff, hasLineOfSight, moveCircle, type BlockedFn } from './collision';
import type { FlowField } from './flowField';
import { isAlive, isUp, type PlayerState } from './player';
import { countdown } from './timer';
import { BOSS } from './tuning/horde';
import { NOISE, ZOMBIE_NIGHT } from './tuning/night';
import { KIND, SPECIAL, breaksDoors, type ZombieKind } from './tuning/zombieKinds';

/** wander: lang thang · investigate: đi tới chỗ có tiếng ồn · chase: đuổi người. */
export type ZombieMode = 'wander' | 'investigate' | 'chase';

export interface ZombieState {
  id: number;
  kind: ZombieKind;
  x: number;
  y: number;
  facing: number;
  hp: number;
  mode: ZombieMode;
  /** Người đang bị đuổi (mode = 'chase'). */
  target: PeerId | null;
  /** Lang thang: còn bao lâu (giây) thì đổi hướng. */
  wanderIn: number;
  /** Lang thang: đang đứng yên hay đi. */
  wanderMoving: boolean;
  biteCd: number;
  /** Chỗ có tiếng ồn đang đi tới (mode = 'investigate') và còn đi bao lâu (giây). */
  goalX: number;
  goalY: number;
  investigateFor: number;
  /** Zombie trốn đang nấp: không di chuyển, không hiện trên máy người chơi. */
  hidden: boolean;
  /** Đang lao ra (zombie trốn vừa lộ): còn tăng tốc bao lâu (giây). */
  burstFor: number;
  /** Zombie phun axit: hồi chiêu (giây). */
  spitCd: number;
  /** Zombie của đợt tràn (GĐ 5): không bỏ đuổi vì xa, được dẫn tới người chơi, không tính vào dân số thường. */
  horde: boolean;
  /** Boss: hồi chiêu đập đất / gầm (giây). */
  slamCd: number;
  roarCd: number;
  /**
   * Zombie từ xác đồng đội (GĐ 6): id người chơi đó, null nếu là zombie thường. B dùng để thả lại đồ
   * của người đó khi zombie này bị giết ("mặc nguyên đồ của mình").
   */
  turnedFrom: PeerId | null;
}

const DEG = Math.PI / 180;

export function createZombie(
  id: number,
  x: number,
  y: number,
  rng: Rng,
  kind: ZombieKind = 'normal',
): ZombieState {
  return {
    id,
    kind,
    x,
    y,
    facing: rng.next() * Math.PI * 2,
    hp: maxHpOf(kind),
    mode: 'wander',
    target: null,
    wanderIn: 1 + rng.next() * 3,
    wanderMoving: rng.chance(0.5),
    biteCd: 0,
    goalX: x,
    goalY: y,
    investigateFor: 0,
    hidden: kind === 'hider',
    burstFor: 0,
    spitCd: 0,
    horde: false,
    slamCd: 0,
    roarCd: 0,
    turnedFrom: null,
  };
}

export function maxHpOf(kind: ZombieKind): number {
  return Z.maxHp * KIND[kind].hp;
}

export function radiusOf(z: { kind: ZombieKind }): number {
  return Z.radius * KIND[z.kind].radius;
}

/**
 * Zombie có phát hiện người chơi p không: thấy ở phía trước (tầm nhìn giảm ban đêm), nghe tiếng chạy
 * ở gần, hoặc thấy ánh đèn pin trong bóng tối (mọi hướng, rất xa).
 */
export function canDetect(z: ZombieState, p: PlayerState, blocked: BlockedFn, darkness = 0): boolean {
  if (!isAlive(p)) return false;
  const dx = p.x - z.x;
  const dy = p.y - z.y;
  const d = Math.hypot(dx, dy);
  if (p.sprinting && d <= Z.hearSprintRange) return true;
  if (p.flashlight && darkness >= ZOMBIE_NIGHT.flashlightDarkness && d <= ZOMBIE_NIGHT.flashlightSeenRange) {
    return hasLineOfSight(z, p, blocked);
  }
  const sight = Z.sightRange * (1 - ZOMBIE_NIGHT.sightPenalty * darkness);
  if (d > sight) return false;
  if (angleDiff(z.facing, Math.atan2(dy, dx)) > Z.sightHalfAngleDeg * DEG) return false;
  return hasLineOfSight(z, p, blocked);
}

/** Người chơi p đang đứng sau lưng zombie (để ám sát). */
export function isBehind(z: ZombieState, p: { x: number; y: number }): boolean {
  return angleDiff(z.facing, Math.atan2(p.y - z.y, p.x - z.x)) > Z.behindAngleDeg * DEG;
}

/** Nghe tiếng ồn ở (x, y) bán kính r: zombie chưa đuổi ai thì đi tới xem. Trả về true nếu nghe thấy. */
export function hearNoise(z: ZombieState, x: number, y: number, r: number): boolean {
  if (z.mode === 'chase' || z.hidden || Math.hypot(z.x - x, z.y - y) > r) return false;
  z.mode = 'investigate';
  z.goalX = x;
  z.goalY = y;
  z.investigateFor = NOISE.investigateSec;
  return true;
}

export interface ZombieStepCtx {
  dt: number;
  rng: Rng;
  /** Tường + cửa đóng. */
  blocked: BlockedFn;
  /** Chỉ tường (khổng lồ đi xuyên cửa đóng — cửa bị phá). */
  wallsOnly: BlockedFn;
  flow: FlowField;
  /** Người chơi theo thứ tự id (tất định). */
  players: readonly PlayerState[];
  /** Độ tối 0..1 (dayClock). */
  darkness: number;
  /** Zombie cắn người → báo cho SimWorld trừ máu. */
  onBite: (z: ZombieState, p: PlayerState) => void;
  /** Zombie phát tiếng ồn (thét khi phát hiện người, Boss gầm) → SimWorld cho zombie khác nghe. */
  onNoise: (x: number, y: number, radius: number) => void;
  /** Boss đập đất quanh mình. */
  onSlam: (z: ZombieState) => void;
  /** Zombie phun axit vào điểm (x, y). */
  onSpit: (z: ZombieState, x: number, y: number) => void;
}

export function stepZombie(z: ZombieState, ctx: ZombieStepCtx): void {
  const { dt, blocked } = ctx;
  z.biteCd = countdown(z.biteCd, dt);
  z.spitCd = countdown(z.spitCd, dt);
  z.burstFor = countdown(z.burstFor, dt);
  z.slamCd = countdown(z.slamCd, dt);
  z.roarCd = countdown(z.roarCd, dt);

  if (z.hidden) {
    // nấp: chỉ lộ ra khi có người đứng được tới sát
    for (const p of ctx.players) {
      if (isUp(p) && Math.hypot(p.x - z.x, p.y - z.y) <= SPECIAL.hider.revealRange) {
        startChase(z, p.id);
        z.burstFor = SPECIAL.hider.burstSec;
        z.facing = Math.atan2(p.y - z.y, p.x - z.x);
        break;
      }
    }
    if (z.hidden) return;
  }

  if (z.mode !== 'chase') {
    for (const p of ctx.players) {
      if (canDetect(z, p, blocked, ctx.darkness)) {
        startChase(z, p.id);
        if (z.kind === 'screamer') ctx.onNoise(z.x, z.y, NOISE.scream);
        break;
      }
    }
  }

  let target = z.mode === 'chase' ? ctx.players.find((p) => p.id === z.target) : undefined;
  const tooFar = !z.horde && target !== undefined && dist(z, target) > Z.loseRange;
  if (z.mode === 'chase' && (!target || !isAlive(target) || tooFar)) {
    z.mode = 'wander';
    z.target = null;
    target = undefined;
  }

  if (!target) {
    if (z.mode === 'investigate') investigate(z, ctx);
    else wander(z, ctx);
    return;
  }

  const r = radiusOf(z);
  const d = dist(z, target);
  if (z.kind === 'boss') {
    if (z.roarCd === 0) {
      z.roarCd = BOSS.roarEverySec;
      ctx.onNoise(z.x, z.y, BOSS.roarRadius);
    }
    if (z.slamCd === 0 && d - r <= BOSS.slamRange) {
      z.slamCd = BOSS.slamCooldownSec;
      ctx.onSlam(z);
    }
  }
  if (z.kind === 'spitter' && z.spitCd === 0 && d >= SPECIAL.spit.minRange && d <= SPECIAL.spit.maxRange) {
    if (hasLineOfSight(z, target, blocked)) {
      z.spitCd = SPECIAL.spit.cooldownSec;
      z.facing = Math.atan2(target.y - z.y, target.x - z.x);
      ctx.onSpit(z, target.x, target.y);
    }
  }

  const gap = d - r - PLAYER.radius;
  if (gap <= Z.biteRange) {
    // trong tầm cắn: quay mặt về phía người, đứng lại cắn
    z.facing = Math.atan2(target.y - z.y, target.x - z.x);
    if (z.biteCd === 0) {
      z.biteCd = Z.biteCooldownSec;
      ctx.onBite(z, target);
    }
    return;
  }

  const speed =
    Z.chaseSpeed *
    KIND[z.kind].speed *
    (1 + ZOMBIE_NIGHT.speedBonus * ctx.darkness) *
    (z.burstFor > 0 ? SPECIAL.hider.burstSpeed : 1);
  // thấy thẳng thì lao tới, bị che thì đi theo flow field (vòng qua tường, không qua cửa đóng)
  let goal: { x: number; y: number } | null = hasLineOfSight(z, target, blocked)
    ? target
    : ctx.flow.nextStep(z, blocked);
  // khổng lồ/Boss không có đường (bị cửa đóng chặn) thì đi thẳng tới, phá cửa
  const smash = breaksDoors(z.kind);
  const moveBlocked = smash ? ctx.wallsOnly : blocked;
  if (!goal && smash) goal = target;
  if (!goal) return;
  walkToward(z, goal.x, goal.y, speed * dt, r, moveBlocked);
}

/** Bị đánh hoặc phát hiện → chuyển sang đuổi (zombie trốn cũng lộ ra). */
export function startChase(z: ZombieState, target: PeerId): void {
  z.mode = 'chase';
  z.target = target;
  z.hidden = false;
}

function investigate(z: ZombieState, ctx: ZombieStepCtx): void {
  z.investigateFor = countdown(z.investigateFor, ctx.dt);
  const d = Math.hypot(z.goalX - z.x, z.goalY - z.y);
  if (z.investigateFor === 0 || d < 0.8) {
    z.mode = 'wander';
    z.wanderIn = 1;
    return;
  }
  const speed = ((Z.wanderSpeed + Z.chaseSpeed) / 2) * KIND[z.kind].speed;
  const before = { x: z.x, y: z.y };
  walkToward(z, z.goalX, z.goalY, speed * ctx.dt, radiusOf(z), ctx.blocked);
  // kẹt tường → thôi
  if (Math.hypot(z.x - before.x, z.y - before.y) < speed * ctx.dt * 0.2)
    z.investigateFor = Math.min(z.investigateFor, 0.5);
}

function wander(z: ZombieState, ctx: ZombieStepCtx): void {
  z.wanderIn = countdown(z.wanderIn, ctx.dt);
  if (z.wanderIn === 0) {
    z.wanderIn = 2 + ctx.rng.next() * 3;
    z.wanderMoving = ctx.rng.chance(0.6);
    z.facing = ctx.rng.next() * Math.PI * 2;
  }
  if (!z.wanderMoving) return;
  const step = Z.wanderSpeed * KIND[z.kind].speed * ctx.dt;
  const before = { x: z.x, y: z.y };
  moveCircle(z, Math.cos(z.facing) * step, Math.sin(z.facing) * step, radiusOf(z), ctx.blocked);
  // đâm vào tường → lần sau đổi hướng sớm
  if (Math.hypot(z.x - before.x, z.y - before.y) < step * 0.3) z.wanderIn = Math.min(z.wanderIn, 0.3);
}

function walkToward(
  z: ZombieState,
  gx: number,
  gy: number,
  step: number,
  r: number,
  blocked: BlockedFn,
): void {
  const dx = gx - z.x;
  const dy = gy - z.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return;
  z.facing = Math.atan2(dy, dx);
  const s = Math.min(step, d);
  moveCircle(z, (dx / d) * s, (dy / d) * s, r, blocked);
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
