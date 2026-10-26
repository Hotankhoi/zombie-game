import { PLAYER } from '@shared/data/player';
import { SURVIVAL as S } from '@shared/data/survival';
import type { PlayerState } from './player';

/**
 * Chỉ số sinh tồn của 1 người cho 1 tick (GĐ 3b). Chạy trong `stepPlayer` (theo input như stamina) để dự đoán phía
 * máy khách khớp host. Đói/khát: giảm theo thời gian, thấp thì stamina hồi chậm (`staminaRegenFactor`), cạn thì mất máu
 * chậm. Nhiễm trùng: tự nặng dần, cao thì máu tối đa giảm dần; khỏi hẳn thì máu tối đa hồi dần.
 * Máu về 0 vì đói/khát → SimWorld cho gục như bị cắn.
 */
export function stepSurvival(p: PlayerState, dt: number): void {
  p.food = Math.max(0, p.food - S.food.drainPerSec * dt);
  p.water = Math.max(0, p.water - S.water.drainPerSec * (p.sprinting ? S.water.sprintFactor : 1) * dt);
  const inf = S.infection;
  if (p.infection > 0) p.infection = Math.min(100, p.infection + inf.growPerSec * dt);
  if (p.infection >= inf.maxHpLossAt) p.maxHp = Math.max(inf.minMaxHp, p.maxHp - inf.maxHpLossPerSec * dt);
  else if (p.infection === 0 && p.maxHp < PLAYER.maxHp)
    p.maxHp = Math.min(PLAYER.maxHp, p.maxHp + inf.maxHpRecoverPerSec * dt);
  if (p.downedFor > 0) return; // gục: máu đã 0, chỉ đếm giờ
  let starve = 0;
  if (p.food === 0) starve += S.food.starveDps;
  if (p.water === 0) starve += S.water.starveDps;
  p.hp = Math.min(p.maxHp, Math.max(0, p.hp - starve * dt));
}

/** Hệ số hồi stamina: no/nước dưới ngưỡng thấp → chậm hơn (nhân cho từng thứ). */
export function staminaRegenFactor(p: PlayerState): number {
  let f = 1;
  if (p.food < S.food.lowAt) f *= S.lowStaminaRegenFactor;
  if (p.water < S.water.lowAt) f *= S.lowStaminaRegenFactor;
  return f;
}

/** Bị cắn: nhiễm trùng tăng theo hệ số sát thương cắn của loại zombie (giáp giảm ở GĐ 3b phần giáp). */
export function infectFromBite(p: PlayerState, biteFactor: number): void {
  p.infection = Math.min(100, p.infection + S.infection.perBite * biteFactor);
}

/** Hồi sinh (phạt nhẹ): hết nhiễm trùng, máu tối đa đầy, no/nước tối thiểu. */
export function respawnSurvival(p: PlayerState): void {
  p.infection = 0;
  p.maxHp = PLAYER.maxHp;
  p.food = Math.max(p.food, S.respawn.minFood);
  p.water = Math.max(p.water, S.respawn.minWater);
}
