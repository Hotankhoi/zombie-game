import type { MeleeWeapon } from '@shared/data/melee';
import { angleDiff, hasLineOfSight, type BlockedFn } from './collision';
import { spendStamina, type PlayerState } from './player';
import { isBehind, radiusOf, startChase, type ZombieState } from './zombie';

export interface MeleeHit {
  zombie: ZombieState;
  killed: boolean;
  /** Ám sát từ sau lưng: hạ ngay. */
  assassination: boolean;
  /** Không phát tiếng ồn (GĐ 4 nối với hệ tiếng ồn). */
  silent: boolean;
}

export interface MeleeResult {
  /** null = chém hụt. */
  hit: MeleeHit | null;
}

const DEG = Math.PI / 180;

/**
 * Người chơi p chém bằng vũ khí cận chiến. Trả về null nếu chưa chém được (hồi chiêu / thiếu stamina).
 * Chỉ trúng 1 mục tiêu: zombie gần nhất trong quạt + tầm, không bị tường che.
 */
export function meleeAttack(
  p: PlayerState,
  weapon: MeleeWeapon,
  zombies: readonly ZombieState[],
  blocked: BlockedFn,
): MeleeResult | null {
  if (p.attackCd > 0 || !spendStamina(p, weapon.staminaCost)) return null;
  p.attackCd = weapon.cooldownSec;

  const target = pickTarget(p, weapon, zombies, blocked);
  if (!target) return { hit: null };

  if (weapon.canAssassinate && target.mode === 'wander' && isBehind(target, p)) {
    target.hp = 0;
    return { hit: { zombie: target, killed: true, assassination: true, silent: true } };
  }
  target.hp = Math.max(0, target.hp - weapon.damage);
  startChase(target, p.id);
  return { hit: { zombie: target, killed: target.hp === 0, assassination: false, silent: false } };
}

function pickTarget(
  p: PlayerState,
  weapon: MeleeWeapon,
  zombies: readonly ZombieState[],
  blocked: BlockedFn,
): ZombieState | null {
  let best: ZombieState | null = null;
  let bestD = Infinity;
  for (const z of zombies) {
    if (z.hp <= 0) continue;
    const dx = z.x - p.x;
    const dy = z.y - p.y;
    const d = Math.hypot(dx, dy);
    const zr = radiusOf(z);
    if (d - zr > weapon.range) continue;
    // sát người thì góc không còn ý nghĩa → coi như trong quạt
    if (d > zr && angleDiff(p.facing, Math.atan2(dy, dx)) > (weapon.arcDeg / 2) * DEG) continue;
    if (!hasLineOfSight(p, z, blocked)) continue;
    if (d < bestD || (d === bestD && best !== null && z.id < best.id)) {
      best = z;
      bestD = d;
    }
  }
  return best;
}
