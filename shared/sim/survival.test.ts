import { describe, expect, it } from 'vitest';
import { PLAYER } from '@shared/data/player';
import { SURVIVAL } from '@shared/data/survival';
import { SIM_TICK_MS } from '@shared/types';
import { arenaMap } from './grid';
import { Btn, type PlayerInput } from './input';
import { createPlayer, isDowned, stepPlayer } from './player';
import { Predictor } from './prediction';
import { staminaRegenFactor, stepSurvival } from './survival';
import { testZombie } from './testMaps';
import { SimWorld } from './world';

const DT = SIM_TICK_MS / 1000;
const idle: PlayerInput = { seq: 0, moveX: 0, moveY: 0, aim: 0, buttons: 0 };
const open = () => false;
const sec = (s: number) => Math.round(s / DT);

describe('chỉ số sinh tồn (GĐ 3b)', () => {
  it('no/nước giảm theo thời gian; chạy làm khát nhanh hơn', () => {
    const p = createPlayer('a', { x: 0, y: 0 });
    for (let i = 0; i < sec(60); i++) stepSurvival(p, DT);
    expect(p.food).toBeCloseTo(100 - SURVIVAL.food.drainPerSec * 60, 6);
    expect(p.water).toBeCloseTo(100 - SURVIVAL.water.drainPerSec * 60, 6);
    const q = createPlayer('b', { x: 0, y: 0 });
    q.sprinting = true;
    for (let i = 0; i < sec(60); i++) stepSurvival(q, DT);
    expect(100 - q.water).toBeCloseTo((100 - p.water) * SURVIVAL.water.sprintFactor, 6);
    // hết hẳn sau ~25 / ~18 phút
    for (let i = 0; i < sec(25 * 60); i++) stepSurvival(p, DT);
    expect(p.food).toBe(0);
    expect(p.water).toBe(0);
  });

  it('đói/khát dưới ngưỡng → stamina hồi chậm (mỗi thứ ×0.5)', () => {
    const p = createPlayer('a', { x: 0, y: 0 });
    expect(staminaRegenFactor(p)).toBe(1);
    p.food = SURVIVAL.food.lowAt - 1;
    expect(staminaRegenFactor(p)).toBe(0.5);
    p.water = SURVIVAL.water.lowAt - 1;
    expect(staminaRegenFactor(p)).toBe(0.25);
    const fed = createPlayer('b', { x: 0, y: 0 });
    for (const q of [p, fed]) {
      q.stamina = 10;
      for (let i = 0; i < sec(3); i++) stepPlayer(q, idle, DT, open);
    }
    expect(fed.stamina - 10).toBeCloseTo((p.stamina - 10) * 4, 4);
  });

  it('cạn no và nước → mất máu chậm; hết máu thì gục (còn đồng đội) như bị cắn', () => {
    const w = new SimWorld({ seed: 's', map: arenaMap(), zombieCount: 0 });
    const a = w.addPlayer('a');
    w.addPlayer('b');
    a.food = 0;
    a.water = 0;
    const inputs = new Map([
      ['a', idle],
      ['b', idle],
    ]);
    for (let i = 0; i < sec(10); i++) w.step(inputs);
    expect(a.hp).toBeCloseTo(PLAYER.maxHp - (SURVIVAL.food.starveDps + SURVIVAL.water.starveDps) * 10, 3);
    a.hp = 0.2;
    for (let i = 0; i < sec(1); i++) w.step(inputs);
    expect(isDowned(a)).toBe(true);
  });

  it('bị cắn → nhiễm trùng tăng (theo loại zombie), tự nặng dần, cao thì máu tối đa giảm, khỏi thì hồi', () => {
    const w = new SimWorld({ seed: 's', map: arenaMap(), zombieCount: 0 });
    const a = w.addPlayer('a');
    w.addPlayer('b');
    w.zombies.push(testZombie(1, a.x + 0.5, a.y, { mode: 'chase', target: 'a' }));
    const inputs = new Map([
      ['a', idle],
      ['b', idle],
    ]);
    let ticks = 0;
    while (a.infection === 0 && ticks++ < 200) w.step(inputs);
    expect(a.infection).toBeCloseTo(SURVIVAL.infection.perBite, 1);
    w.zombies = [];
    a.infection = SURVIVAL.infection.maxHpLossAt;
    a.hp = 50;
    for (let i = 0; i < sec(60); i++) w.step(inputs);
    expect(a.infection).toBeGreaterThan(SURVIVAL.infection.maxHpLossAt);
    expect(a.maxHp).toBeCloseTo(PLAYER.maxHp - SURVIVAL.infection.maxHpLossPerSec * 60, 1);
    expect(a.hp).toBeLessThanOrEqual(a.maxHp);
    a.infection = 0; // kháng sinh (PR sau)
    for (let i = 0; i < sec(20); i++) w.step(inputs);
    expect(a.maxHp).toBeGreaterThan(PLAYER.maxHp - SURVIVAL.infection.maxHpLossPerSec * 60);
    // máu tối đa không xuống dưới mức sàn
    a.infection = 100;
    for (let i = 0; i < sec(3600); i++) stepSurvival(a, DT);
    expect(a.maxHp).toBe(SURVIVAL.infection.minMaxHp);
  });

  it('hồi sinh (phạt nhẹ): hết nhiễm trùng, máu tối đa đầy, no/nước tối thiểu 60', () => {
    const w = new SimWorld({ seed: 's', map: arenaMap(), zombieCount: 0 });
    const a = w.addPlayer('a');
    a.infection = 90;
    a.maxHp = 55;
    a.food = 5;
    a.water = 80;
    a.hp = 0;
    a.respawnIn = DT; // đang chết, tick sau hồi sinh
    w.step(new Map([['a', idle]]));
    expect(a.respawnIn).toBe(0);
    expect(a.infection).toBe(0);
    expect(a.maxHp).toBe(PLAYER.maxHp);
    expect(a.hp).toBe(PLAYER.maxHp);
    expect(a.food).toBeCloseTo(SURVIVAL.respawn.minFood, 1);
    expect(a.water).toBeCloseTo(80, 1);
  });

  it('tất định: cùng input → cùng hash; chỉ số khác nhau → hash khác', () => {
    const run = () => {
      const w = new SimWorld({ seed: 'det', map: arenaMap(), zombieCount: 5 });
      w.addPlayer('a');
      for (let i = 0; i < 400; i++)
        w.step(new Map([['a', { ...idle, seq: i, moveX: i % 40 < 20 ? 1 : -1, buttons: Btn.Sprint }]]));
      return w;
    };
    const x = run();
    const y = run();
    expect(x.hash()).toBe(y.hash());
    y.players.get('a')!.water -= 0.01;
    expect(x.hash()).not.toBe(y.hash());
  });

  it('dự đoán phía máy khách khớp host khi đói (stamina hồi chậm)', () => {
    const w = new SimWorld({ seed: 'pred', map: arenaMap(), zombieCount: 0 });
    const host = w.addPlayer('a');
    host.food = 10;
    host.stamina = 20;
    const pr = new Predictor(w.blocked);
    pr.reconcile({ ...host }, 0);
    for (let i = 1; i <= 60; i++) {
      const input = { ...idle, seq: i, moveX: i < 30 ? 1 : 0 };
      pr.step(input);
      w.step(new Map([['a', input]]));
    }
    expect(pr.state!.stamina).toBeCloseTo(host.stamina, 6);
    expect(pr.state!.food).toBeCloseTo(host.food, 6);
    expect(pr.state!.x).toBeCloseTo(host.x, 6);
  });
});
