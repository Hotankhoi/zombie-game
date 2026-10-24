import { describe, expect, it } from 'vitest';
import { PLAYER } from '@shared/data/player';
import { SIM_TICK_MS } from '@shared/types';
import { arenaMap } from './grid';
import { Btn, type PlayerInput } from './input';
import { isAlive, isDowned, isUp } from './player';
import { Predictor } from './prediction';
import { testZombie } from './testMaps';
import { PARTY } from './tuning/party';
import { SimWorld } from './world';
import type { ZombieState } from './zombie';

const TICKS_PER_SEC = 1000 / SIM_TICK_MS;
const idle: PlayerInput = { seq: 0, moveX: 0, moveY: 0, aim: 0, buttons: 0 };
const hold = (buttons: number, moveX = 0): PlayerInput => ({ ...idle, buttons, moveX });

/** 2 người đứng cạnh nhau ở sân giữa map thử, không zombie. */
function duo() {
  const w = new SimWorld({ seed: 'party', map: arenaMap(), zombieCount: 0 });
  const a = w.addPlayer('a');
  const b = w.addPlayer('b');
  b.x = a.x + 1;
  return { w, a, b };
}

function biter(w: SimWorld, x: number, y: number): ZombieState {
  const z = testZombie(999, x, y, { mode: 'chase', target: 'a' });
  w.zombies.push(z);
  return z;
}

function run(w: SimWorld, ticks: number, inputs: Record<string, PlayerInput> = {}) {
  for (let t = 0; t < ticks; t++) w.step(new Map(Object.entries(inputs)));
}

describe('gục / cứu / kéo (GĐ 2c)', () => {
  it('hết máu khi còn đồng đội đứng được → gục, chưa chết', () => {
    const { w, a } = duo();
    a.hp = 5;
    biter(w, a.x - 0.6, a.y);
    run(w, 1);
    expect(isDowned(a)).toBe(true);
    expect(isAlive(a)).toBe(true);
    expect(a.downedFor).toBeCloseTo(PARTY.downedSec - 0, 0);
    expect(w.events.some((e) => e.type === 'death')).toBe(false);
  });

  it('chơi một mình hết máu → chết hẳn luôn (không ai cứu)', () => {
    const w = new SimWorld({ seed: 'solo', map: arenaMap(), zombieCount: 0 });
    const a = w.addPlayer('a');
    a.hp = 5;
    biter(w, a.x - 0.6, a.y);
    run(w, 1);
    expect(isAlive(a)).toBe(false);
    expect(a.respawnIn).toBe(PLAYER.respawnSec);
  });

  it('đồng đội giữ R đứng yên đủ 4s → đứng dậy với 30 máu; buông giữa chừng thì tiến độ giảm dần', () => {
    const { w, a } = duo();
    w['down'](a);
    run(w, 2 * TICKS_PER_SEC, { b: hold(Btn.Revive) });
    expect(a.reviveProgress).toBeCloseTo(2, 5);
    run(w, 1, { b: hold(Btn.Revive, 1) }); // đi → không cứu: lỡ 1 tick chỉ mất một chút
    expect(a.reviveProgress).toBeCloseTo(2 - (PARTY.reviveDecayRate * SIM_TICK_MS) / 1000, 5);
    run(w, TICKS_PER_SEC, { b: hold(0) }); // bỏ hẳn 1s → về 0
    expect(a.reviveProgress).toBe(0);
    run(w, PARTY.reviveSec * TICKS_PER_SEC, { b: hold(Btn.Revive) });
    expect(isUp(a)).toBe(true);
    expect(a.hp).toBe(PARTY.reviveHp);
  });

  it('không ai cứu: hết 30s thì chết hẳn; bị cắn khi gục thì mất thêm 5s', () => {
    const { w, a } = duo();
    w['down'](a);
    biter(w, a.x - 0.6, a.y).biteCd = 0;
    run(w, 1);
    expect(a.downedFor).toBeCloseTo(PARTY.downedSec - PARTY.downedBitePenaltySec - SIM_TICK_MS / 1000, 5);
    w.zombies = [];
    run(w, 26 * TICKS_PER_SEC);
    expect(isAlive(a)).toBe(false);
    expect(w.events.some((e) => e.type === 'death' && e.player === 'a') || a.respawnIn > 0).toBe(true);
  });

  it('người gục chỉ bò chậm, không chạy, không chém', () => {
    const { w, a } = duo();
    w['down'](a);
    const x0 = a.x;
    run(w, TICKS_PER_SEC, { a: hold(Btn.Sprint | Btn.Attack, -1) });
    expect(x0 - a.x).toBeCloseTo(PLAYER.walkSpeed * PARTY.crawlSpeedFactor, 5);
    expect(w.events.some((e) => e.type === 'swing')).toBe(false);
  });

  it('giữ G: kéo người gục theo sau lưng, người kéo đi chậm và không chạy được', () => {
    const { w, a, b } = duo();
    w['down'](a);
    run(w, 1, { b: hold(Btn.Drag) });
    expect(b.dragging).toBe(true);
    const bx0 = b.x;
    run(w, TICKS_PER_SEC, { b: hold(Btn.Drag | Btn.Sprint, 1) });
    // tick đầu (cờ dragging từ tick trước) đã chậm → cả giây đi đúng tốc độ kéo
    expect(b.x - bx0).toBeCloseTo(PLAYER.walkSpeed * PARTY.dragSpeedFactor, 5);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(PARTY.dragOffset + 0.01);
    expect(a.x).toBeLessThan(b.x);
  });

  it('tất định: cùng chuỗi input → cùng mã băm (có gục/cứu/kéo)', () => {
    const play = () => {
      const { w, a } = duo();
      w['down'](a);
      run(w, 40, { b: hold(Btn.Drag, 1) });
      run(w, 100, { b: hold(Btn.Revive) });
      return w.hash();
    };
    expect(play()).toBe(play());
  });

  it('dự đoán phía client của người gục (bò) khớp host', () => {
    const { w, a } = duo();
    w['down'](a);
    const pred = new Predictor(w.blocked);
    pred.reconcile({ ...a }, 0);
    for (let i = 1; i <= 20; i++) {
      const input = { ...hold(0, i % 3 === 0 ? 0 : 1), seq: i };
      pred.step(input);
      w.step(new Map([['a', input]]));
      pred.reconcile({ ...a }, i);
      expect(pred.lastError).toBe(0);
    }
  });
});
