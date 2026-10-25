import { describe, expect, it } from 'vitest';
import { Rng } from '@shared/util/rng';
import { arenaMap } from './grid';
import { Btn, type PlayerInput } from './input';
import { Predictor } from './prediction';
import { SimWorld } from './world';

function randomInputs(n: number, seed = 'pred'): PlayerInput[] {
  const r = new Rng(seed);
  const out: PlayerInput[] = [];
  let cur: PlayerInput = { seq: 0, moveX: 0, moveY: 0, aim: 0, buttons: 0 };
  for (let i = 1; i <= n; i++) {
    if (i % 7 === 0 || i === 1) {
      cur = {
        seq: 0,
        moveX: r.int(-1, 1),
        moveY: r.int(-1, 1),
        aim: r.int(0, 255),
        buttons: (r.chance(0.4) ? Btn.Sprint : 0) | (r.chance(0.4) ? Btn.Attack : 0),
      };
    }
    out.push({ ...cur, seq: i });
  }
  return out;
}

/** Host (SimWorld không zombie) nhận input trễ `lag` tick; client dự đoán và reconcile mỗi tick. */
function run(lag: number, inputs: PlayerInput[]) {
  const host = new SimWorld({ seed: 's', map: arenaMap(), zombieCount: 0 });
  host.addPlayer('me');
  const pred = new Predictor(host.blocked);
  pred.reconcile(host.players.get('me')!, 0);
  let maxErr = 0;
  for (let t = 0; t < inputs.length + lag; t++) {
    if (t < inputs.length) pred.step(inputs[t]!);
    const arrived = inputs[t - lag];
    if (arrived) {
      host.step(new Map([['me', arrived]]));
      pred.reconcile(host.players.get('me')!, arrived.seq);
      maxErr = Math.max(maxErr, pred.lastError);
    }
  }
  return { host, pred, maxErr };
}

describe('Predictor', () => {
  it('host và client cùng input → không lệch, dù host nhận trễ', () => {
    const inputs = randomInputs(300);
    for (const lag of [0, 3, 8]) {
      const { host, pred, maxErr } = run(lag, inputs);
      expect(maxErr).toBe(0);
      expect(pred.state!.x).toBe(host.players.get('me')!.x);
      expect(pred.state!.stamina).toBe(host.players.get('me')!.stamina);
      expect(pred.pendingCount).toBe(0);
    }
  });

  it('dự đoán chạy trước host: vị trí dự đoán = host sau khi chạy hết input', () => {
    const inputs = randomInputs(40);
    const { pred } = run(5, inputs.slice(0, 35));
    const ref = run(0, inputs.slice(0, 35));
    expect(pred.state!.x).toBeCloseTo(ref.pred.state!.x, 10);
  });

  it('host khác client → sửa theo host, độ lệch hiển thị giảm dần (không giật)', () => {
    const host = new SimWorld({ seed: 's', map: arenaMap(), zombieCount: 0 });
    host.addPlayer('me');
    const pred = new Predictor(host.blocked);
    pred.reconcile(host.players.get('me')!, 0);
    const right: PlayerInput = { seq: 1, moveX: 1, moveY: 0, aim: 0, buttons: 0 };
    pred.step(right);
    // host không nhận được input → nhân vật đứng yên
    host.step(new Map());
    pred.reconcile(host.players.get('me')!, 1);
    expect(pred.lastError).toBeGreaterThan(0.1);
    expect(pred.state!.x).toBe(host.players.get('me')!.x);
    const drawnBefore = pred.state!.x + pred.offsetX;
    expect(drawnBefore).toBeGreaterThan(pred.state!.x); // vẫn vẽ ở chỗ cũ
    pred.decay(500);
    expect(Math.abs(pred.offsetX)).toBeLessThan(0.01);
  });

  it('đang gục: không dự đoán đòn chém (host cũng chặn)', () => {
    const host = new SimWorld({ seed: 's', map: arenaMap(), zombieCount: 0 });
    const p = host.addPlayer('me');
    const pred = new Predictor(host.blocked);
    pred.reconcile({ ...p, downedFor: 20 }, 0);
    expect(pred.step({ seq: 1, moveX: 0, moveY: 0, aim: 0, buttons: Btn.Attack })).toBe(false);
    expect(pred.state!.attackCd).toBe(0);
  });

  it('lệch quá xa (hồi sinh) thì nhảy luôn', () => {
    const host = new SimWorld({ seed: 's', map: arenaMap(), zombieCount: 0 });
    const p = host.addPlayer('me');
    const pred = new Predictor(host.blocked);
    pred.reconcile(p, 0);
    pred.reconcile({ ...p, x: p.x + 10 }, 0);
    expect(pred.offsetX).toBe(0);
  });
});
