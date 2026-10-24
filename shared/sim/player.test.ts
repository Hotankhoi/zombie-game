import { describe, expect, it } from 'vitest';
import { PLAYER } from '@shared/data/player';
import { SIM_TICK_MS } from '@shared/types';
import { Btn, type PlayerInput } from './input';
import { createPlayer, spendStamina, stepPlayer } from './player';

const DT = SIM_TICK_MS / 1000;
const open = () => false;
const walkRight: PlayerInput = { seq: 0, moveX: 1, moveY: 0, aim: 0, buttons: 0 };
const sprintRight: PlayerInput = { ...walkRight, buttons: Btn.Sprint };
const idle: PlayerInput = { seq: 0, moveX: 0, moveY: 0, aim: 0, buttons: 0 };

function run(p: ReturnType<typeof createPlayer>, input: PlayerInput, ticks: number) {
  for (let i = 0; i < ticks; i++) stepPlayer(p, input, DT, open);
}

describe('stepPlayer', () => {
  it('đi bộ 1 giây được walkSpeed ô, chạy nhanh hơn', () => {
    const a = createPlayer('a', { x: 0, y: 0 });
    run(a, walkRight, 20);
    expect(a.x).toBeCloseTo(PLAYER.walkSpeed, 5);
    const b = createPlayer('b', { x: 0, y: 0 });
    run(b, sprintRight, 20);
    expect(b.x).toBeCloseTo(PLAYER.sprintSpeed, 5);
  });

  it('đi chéo không nhanh hơn đi thẳng', () => {
    const p = createPlayer('a', { x: 0, y: 0 });
    run(p, { ...walkRight, moveY: 1 }, 20);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(PLAYER.walkSpeed, 5);
  });

  it('chạy tốn stamina, đứng yên thì chưa hồi ngay', () => {
    const p = createPlayer('a', { x: 0, y: 0 });
    run(p, sprintRight, 20);
    expect(p.stamina).toBeCloseTo(PLAYER.maxStamina - PLAYER.sprintCostPerSec, 5);
    run(p, idle, 10); // 0.5s < staminaRegenDelaySec
    expect(p.stamina).toBeCloseTo(PLAYER.maxStamina - PLAYER.sprintCostPerSec, 5);
    run(p, idle, 20);
    expect(p.stamina).toBeGreaterThan(PLAYER.maxStamina - PLAYER.sprintCostPerSec);
  });

  it('chạy đứng yên tại chỗ (không đi) thì không tốn stamina', () => {
    const p = createPlayer('a', { x: 0, y: 0 });
    run(p, { ...idle, buttons: Btn.Sprint }, 20);
    expect(p.stamina).toBe(PLAYER.maxStamina);
  });

  it('cạn stamina thì bị khoá chạy tới khi hồi đủ', () => {
    const p = createPlayer('a', { x: 0, y: 0 });
    run(p, sprintRight, PLAYER.maxStamina / PLAYER.sprintCostPerSec / DT);
    expect(p.stamina).toBe(0);
    expect(p.exhausted).toBe(true);
    // vẫn giữ Shift: chỉ đi bộ được, stamina hồi dần
    const x0 = p.x;
    run(p, sprintRight, 20);
    expect(p.sprinting).toBe(false);
    expect(p.x - x0).toBeCloseTo(PLAYER.walkSpeed, 5);
    // vẫn giữ Shift: tới khi hồi đủ sprintResumeFraction mới tự chạy lại
    let guard = 0;
    while (!p.sprinting && guard++ < 200) {
      expect(p.stamina).toBeLessThan(PLAYER.maxStamina * PLAYER.sprintResumeFraction + 1);
      run(p, sprintRight, 1);
    }
    expect(p.sprinting).toBe(true);
    expect(p.exhausted).toBe(false);
  });

  it('spendStamina từ chối khi không đủ', () => {
    const p = createPlayer('a', { x: 0, y: 0 });
    p.stamina = 5;
    expect(spendStamina(p, 8)).toBe(false);
    expect(p.stamina).toBe(5);
    expect(spendStamina(p, 5)).toBe(true);
    expect(p.stamina).toBe(0);
  });
});
