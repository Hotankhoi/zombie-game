import { PLAYER } from '@shared/data/player';
import { SURVIVAL } from '@shared/data/survival';
import type { PeerId, Vec2 } from '@shared/types';
import { moveCircle, type BlockedFn } from './collision';
import { Btn, aimToRad, hasBtn, type PlayerInput } from './input';
import { staminaRegenFactor, stepSurvival } from './survival';
import { countdown, reached } from './timer';
import { PARTY } from './tuning/party';

export interface PlayerState {
  id: PeerId;
  x: number;
  y: number;
  /** Hướng nhìn (radian). */
  facing: number;
  hp: number;
  stamina: number;
  /** Đã cạn stamina, phải hồi tới PLAYER.sprintResumeFraction mới chạy lại được. */
  exhausted: boolean;
  /** Bao lâu (giây) chưa tiêu stamina — đủ PLAYER.staminaRegenDelaySec mới hồi. */
  staminaIdle: number;
  /** Đang chạy trong tick vừa rồi (zombie nghe tiếng chân). */
  sprinting: boolean;
  /** Hồi chiêu vũ khí còn lại (giây). */
  attackCd: number;
  /** Nút bấm tick trước — để bắt cạnh nhấn (vd: E chỉ mở cửa 1 lần mỗi lần bấm). */
  prevButtons: number;
  /** > 0 = đang chết, đếm ngược tới lúc hồi sinh (giây). */
  respawnIn: number;
  /** > 0 = đang gục (hết máu nhưng đồng đội còn cứu được), đếm ngược tới lúc chết hẳn (giây). */
  downedFor: number;
  /** Đang được cứu: đã giữ R được bao lâu (giây); đủ PARTY.reviveSec thì đứng dậy. */
  reviveProgress: number;
  /** Đang kéo một người gục (đi chậm, không chạy được). */
  dragging: boolean;
  /** Đèn pin đang bật (GĐ 4): soi xa ban đêm nhưng zombie thấy mình từ xa. */
  flashlight: boolean;
  /** > 0 = vừa hồi sinh, còn bất tử bấy nhiêu giây (không mất máu vì cắn/vũng/Boss). */
  shield: number;
  /** GĐ 3b — no bụng 0..100 (100 = no), nước 0..100, nhiễm trùng 0..100 (0 = sạch). Xem shared/sim/survival.ts. */
  food: number;
  water: number;
  infection: number;
  /** Máu tối đa hiện tại (nhiễm trùng nặng làm giảm dần, ≤ PLAYER.maxHp). */
  maxHp: number;
  /** GĐ 3b — máu còn hồi dần (băng gạc) và tốc độ hồi (máu/giây). */
  healLeft: number;
  healRate: number;
  /** Đã đứng yên (không đi, không đánh) bao lâu (giây) — bộ sơ cứu cần đứng yên. */
  stillFor: number;
}

export function createPlayer(id: PeerId, spawn: Vec2): PlayerState {
  return {
    id,
    x: spawn.x,
    y: spawn.y,
    facing: 0,
    hp: PLAYER.maxHp,
    stamina: PLAYER.maxStamina,
    exhausted: false,
    staminaIdle: 0,
    sprinting: false,
    attackCd: 0,
    prevButtons: 0,
    respawnIn: 0,
    downedFor: 0,
    reviveProgress: 0,
    dragging: false,
    flashlight: false,
    shield: 0,
    food: SURVIVAL.food.start,
    water: SURVIVAL.water.start,
    infection: 0,
    maxHp: PLAYER.maxHp,
    healLeft: 0,
    healRate: 0,
    stillFor: 0,
  };
}

/** Còn trong trận (kể cả đang gục). Chết hẳn = đang chờ hồi sinh. */
export function isAlive(p: PlayerState): boolean {
  return p.respawnIn <= 0;
}

export function isDowned(p: PlayerState): boolean {
  return isAlive(p) && p.downedFor > 0;
}

/** Đứng được: còn sống và không gục — mới đi/chạy/chém/mở cửa/cứu người được. */
export function isUp(p: PlayerState): boolean {
  return isAlive(p) && p.downedFor <= 0;
}

/** Di chuyển + stamina cho 1 tick. Đánh/mở cửa xử lý ở SimWorld vì cần biết zombie/cửa. */
export function stepPlayer(p: PlayerState, input: PlayerInput, dt: number, blocked: BlockedFn): void {
  p.attackCd = countdown(p.attackCd, dt);
  if (!isAlive(p)) {
    p.sprinting = false;
    p.stillFor = 0;
    return;
  }
  p.facing = aimToRad(input.aim);
  stepSurvival(p, dt);
  stepHealing(p, dt);
  if (hasBtn(input, Btn.Flashlight) && (p.prevButtons & Btn.Flashlight) === 0) p.flashlight = !p.flashlight;

  let mx = Math.sign(input.moveX);
  let my = Math.sign(input.moveY);
  const moving = mx !== 0 || my !== 0;
  p.stillFor = moving || hasBtn(input, Btn.Attack) || isDowned(p) ? 0 : p.stillFor + dt;
  if (mx !== 0 && my !== 0) {
    mx *= Math.SQRT1_2;
    my *= Math.SQRT1_2;
  }

  if (isDowned(p)) {
    // gục: chỉ bò chậm, không chạy, stamina đứng yên
    p.sprinting = false;
    const crawl = PLAYER.walkSpeed * PARTY.crawlSpeedFactor;
    if (moving) moveCircle(p, mx * crawl * dt, my * crawl * dt, PLAYER.radius, blocked);
    return;
  }

  p.sprinting = moving && hasBtn(input, Btn.Sprint) && !p.exhausted && p.stamina > 0 && !p.dragging;
  if (p.sprinting) {
    p.stamina -= PLAYER.sprintCostPerSec * dt;
    p.staminaIdle = 0;
    if (p.stamina <= 0) {
      p.stamina = 0;
      p.exhausted = true;
    }
  } else {
    regenStamina(p, dt);
  }

  const speed = p.sprinting
    ? PLAYER.sprintSpeed
    : p.dragging
      ? PLAYER.walkSpeed * PARTY.dragSpeedFactor
      : PLAYER.walkSpeed;
  if (moving) moveCircle(p, mx * speed * dt, my * speed * dt, PLAYER.radius, blocked);
}

/** Hồi máu dần (băng gạc, GĐ 3b) khi đứng được; gục thì tạm dừng. */
function stepHealing(p: PlayerState, dt: number): void {
  if (p.healLeft <= 0 || isDowned(p)) return;
  const h = Math.min(p.healLeft, p.healRate * dt);
  p.hp = Math.min(p.maxHp, p.hp + h);
  p.healLeft -= h;
  if (p.healLeft <= 1e-6) p.healLeft = p.healRate = 0;
}

function regenStamina(p: PlayerState, dt: number): void {
  p.staminaIdle += dt;
  if (reached(p.staminaIdle, PLAYER.staminaRegenDelaySec)) {
    p.stamina = Math.min(
      PLAYER.maxStamina,
      p.stamina + PLAYER.staminaRegenPerSec * staminaRegenFactor(p) * dt,
    );
  }
  if (p.exhausted && p.stamina >= PLAYER.maxStamina * PLAYER.sprintResumeFraction) {
    p.exhausted = false;
  }
}

/** Tiêu stamina cho một hành động (vd: chém). Trả về false nếu không đủ. */
export function spendStamina(p: PlayerState, amount: number): boolean {
  if (p.stamina < amount) return false;
  p.stamina -= amount;
  p.staminaIdle = 0;
  return true;
}
