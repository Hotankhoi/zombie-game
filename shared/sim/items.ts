import { CONSUMABLES, RARITY_POTENCY, USE_STILL_TOLERANCE_SEC } from '@shared/data/consumables';
import type { ItemId, Rarity } from '@shared/data/items';
import { hasLineOfSight, type BlockedFn } from './collision';
import { isAlive, isDowned, isUp, type PlayerState } from './player';

/**
 * Dùng đồ (GĐ 3b): kiểm tra và áp hiệu ứng — thuần, tất định. Host gọi `checkUse` lúc nhận yêu cầu (trước khi trừ đồ),
 * `applyUse` khi giao dịch trừ đồ đã được mọi người xác nhận (host/hostLoot.ts) → không bao giờ áp 2 lần.
 */
export type UseError = 'not_usable' | 'player_not_up' | 'not_still' | 'no_target' | 'not_needed';

/** null = dùng được. `target` = đồng đội (băng gạc), null = cho mình. */
export function checkUse(
  user: PlayerState,
  target: PlayerState | null,
  itemId: ItemId,
  blocked: BlockedFn,
): UseError | null {
  const def = CONSUMABLES[itemId];
  if (!def) return 'not_usable';
  if (!isUp(user)) return 'player_not_up';
  if (target && target !== user) {
    if (!def.allyRange || !isAlive(target)) return 'no_target';
    if (Math.hypot(target.x - user.x, target.y - user.y) > def.allyRange) return 'no_target';
    if (!hasLineOfSight(user, target, blocked)) return 'no_target';
    if (!isDowned(target) && target.hp >= target.maxHp - 1e-6) return 'not_needed';
    return null;
  }
  if (def.stillSec && user.stillFor < def.stillSec - USE_STILL_TOLERANCE_SEC) return 'not_still';
  const hurt = user.hp < user.maxHp - 1e-6;
  const wanted =
    ((def.heal !== undefined || def.healOverTime !== undefined) && hurt) ||
    (def.cure !== undefined && user.infection > 0) ||
    (def.food !== undefined && user.food < 99.5) ||
    (def.water !== undefined && user.water < 99.5);
  return wanted ? null : 'not_needed';
}

/**
 * Áp hiệu ứng của 1 món lên `target ?? user`. `standUp` = SimWorld đỡ người gục dậy (băng cho đồng đội gục).
 * Người nhận đã chết hẳn (host rời/đổi giữa chừng…) → không có gì xảy ra (món đã trừ: mất, không nhân đôi).
 */
export function applyUse(
  user: PlayerState,
  target: PlayerState | null,
  itemId: ItemId,
  rarity: Rarity,
  standUp: (p: PlayerState, hp: number) => void,
): void {
  const def = CONSUMABLES[itemId];
  const p = target ?? user;
  if (!def || !isAlive(p)) return;
  const pot = RARITY_POTENCY[rarity];
  const ally = p !== user;
  if (ally && isDowned(p) && def.reviveHp) standUp(p, def.reviveHp);
  if (def.heal) p.hp = Math.min(p.maxHp, p.hp + def.heal * pot);
  if (def.healOverTime) {
    const amount = def.healOverTime.hp * pot;
    const sec = ally ? def.healOverTime.allySec : def.healOverTime.selfSec;
    p.healLeft += amount;
    p.healRate = Math.max(p.healRate, amount / sec);
  }
  if (def.cure) p.infection = Math.max(0, p.infection - def.cure * pot);
  if (def.food) p.food = Math.min(100, p.food + def.food * pot);
  if (def.water) p.water = Math.min(100, p.water + def.water * pot);
}
