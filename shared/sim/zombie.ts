import { PLAYER } from '@shared/data/player';
import { ZOMBIE_NORMAL as Z } from '@shared/data/zombies';
import type { PeerId } from '@shared/types';
import type { Rng } from '@shared/util/rng';
import { angleDiff, hasLineOfSight, moveCircle, type BlockedFn } from './collision';
import type { FlowField } from './flowField';
import { isAlive, type PlayerState } from './player';

export type ZombieMode = 'wander' | 'chase';

export interface ZombieState {
  id: number;
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
}

const DEG = Math.PI / 180;

export function createZombie(id: number, x: number, y: number, rng: Rng): ZombieState {
  return {
    id,
    x,
    y,
    facing: rng.next() * Math.PI * 2,
    hp: Z.maxHp,
    mode: 'wander',
    target: null,
    wanderIn: 1 + rng.next() * 3,
    wanderMoving: rng.chance(0.5),
    biteCd: 0,
  };
}

/** Zombie có phát hiện người chơi p không: thấy ở phía trước, hoặc nghe tiếng chạy ở gần. */
export function canDetect(z: ZombieState, p: PlayerState, blocked: BlockedFn): boolean {
  if (!isAlive(p)) return false;
  const dx = p.x - z.x;
  const dy = p.y - z.y;
  const d = Math.hypot(dx, dy);
  if (p.sprinting && d <= Z.hearSprintRange) return true;
  if (d > Z.sightRange) return false;
  if (angleDiff(z.facing, Math.atan2(dy, dx)) > Z.sightHalfAngleDeg * DEG) return false;
  return hasLineOfSight(z, p, blocked);
}

/** Người chơi p đang đứng sau lưng zombie (để ám sát). */
export function isBehind(z: ZombieState, p: { x: number; y: number }): boolean {
  return angleDiff(z.facing, Math.atan2(p.y - z.y, p.x - z.x)) > Z.behindAngleDeg * DEG;
}

export interface ZombieStepCtx {
  dt: number;
  rng: Rng;
  blocked: BlockedFn;
  flow: FlowField;
  /** Người chơi theo thứ tự id (tất định). */
  players: readonly PlayerState[];
  /** Zombie cắn người → báo cho SimWorld trừ máu. */
  onBite: (z: ZombieState, p: PlayerState) => void;
}

export function stepZombie(z: ZombieState, ctx: ZombieStepCtx): void {
  const { dt, blocked } = ctx;
  z.biteCd = Math.max(0, z.biteCd - dt);

  if (z.mode === 'wander') {
    for (const p of ctx.players) {
      if (canDetect(z, p, blocked)) {
        startChase(z, p.id);
        break;
      }
    }
  }

  let target = z.mode === 'chase' ? ctx.players.find((p) => p.id === z.target) : undefined;
  if (z.mode === 'chase' && (!target || !isAlive(target) || dist(z, target) > Z.loseRange)) {
    z.mode = 'wander';
    z.target = null;
    target = undefined;
  }

  if (!target) {
    wander(z, ctx);
    return;
  }

  const gap = dist(z, target) - Z.radius - PLAYER.radius;
  if (gap <= Z.biteRange) {
    // trong tầm cắn: quay mặt về phía người, đứng lại cắn
    z.facing = Math.atan2(target.y - z.y, target.x - z.x);
    if (z.biteCd === 0) {
      z.biteCd = Z.biteCooldownSec;
      ctx.onBite(z, target);
    }
    return;
  }

  // thấy thẳng thì lao tới, bị che thì đi theo flow field (vòng qua tường, không qua cửa đóng)
  const goal = hasLineOfSight(z, target, blocked) ? target : ctx.flow.nextStep(z, blocked);
  if (!goal) return;
  walkToward(z, goal.x, goal.y, Z.chaseSpeed * dt, blocked);
}

/** Bị đánh hoặc phát hiện → chuyển sang đuổi. */
export function startChase(z: ZombieState, target: PeerId): void {
  z.mode = 'chase';
  z.target = target;
}

function wander(z: ZombieState, ctx: ZombieStepCtx): void {
  z.wanderIn -= ctx.dt;
  if (z.wanderIn <= 0) {
    z.wanderIn = 2 + ctx.rng.next() * 3;
    z.wanderMoving = ctx.rng.chance(0.6);
    z.facing = ctx.rng.next() * Math.PI * 2;
  }
  if (!z.wanderMoving) return;
  const step = Z.wanderSpeed * ctx.dt;
  const before = { x: z.x, y: z.y };
  moveCircle(z, Math.cos(z.facing) * step, Math.sin(z.facing) * step, Z.radius, ctx.blocked);
  // đâm vào tường → lần sau đổi hướng sớm
  if (Math.hypot(z.x - before.x, z.y - before.y) < step * 0.3) z.wanderIn = Math.min(z.wanderIn, 0.3);
}

function walkToward(z: ZombieState, gx: number, gy: number, step: number, blocked: BlockedFn): void {
  const dx = gx - z.x;
  const dy = gy - z.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return;
  z.facing = Math.atan2(dy, dx);
  const s = Math.min(step, d);
  moveCircle(z, (dx / d) * s, (dy / d) * s, Z.radius, blocked);
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
