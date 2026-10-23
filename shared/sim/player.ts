import { PLAYER } from '@shared/data/player';
import type { PeerId, Vec2 } from '@shared/types';
import { moveCircle, type BlockedFn } from './collision';
import { Btn, aimToRad, hasBtn, type PlayerInput } from './input';

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
  };
}

export function isAlive(p: PlayerState): boolean {
  return p.respawnIn <= 0;
}

/** Di chuyển + stamina cho 1 tick. Đánh/mở cửa xử lý ở SimWorld vì cần biết zombie/cửa. */
export function stepPlayer(p: PlayerState, input: PlayerInput, dt: number, blocked: BlockedFn): void {
  p.attackCd = Math.max(0, p.attackCd - dt);
  if (!isAlive(p)) {
    p.sprinting = false;
    return;
  }
  p.facing = aimToRad(input.aim);

  let mx = Math.sign(input.moveX);
  let my = Math.sign(input.moveY);
  const moving = mx !== 0 || my !== 0;
  if (mx !== 0 && my !== 0) {
    mx *= Math.SQRT1_2;
    my *= Math.SQRT1_2;
  }

  p.sprinting = moving && hasBtn(input, Btn.Sprint) && !p.exhausted && p.stamina > 0;
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

  const speed = p.sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
  if (moving) moveCircle(p, mx * speed * dt, my * speed * dt, PLAYER.radius, blocked);
}

function regenStamina(p: PlayerState, dt: number): void {
  p.staminaIdle += dt;
  if (p.staminaIdle >= PLAYER.staminaRegenDelaySec) {
    p.stamina = Math.min(PLAYER.maxStamina, p.stamina + PLAYER.staminaRegenPerSec * dt);
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
