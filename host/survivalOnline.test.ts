import { describe, expect, it } from 'vitest';
import { TestMatch } from './testMatch';

const key = (id: string) => `key${id}`.padEnd(22, 'x').slice(0, 22);

describe('chỉ số sinh tồn online (GĐ 3b): người nhận thấy đúng, đổi host không mất', () => {
  it('máy khách dự đoán/HUD có chỉ số của mình; đồng đội xoay vòng; host mới giữ chỉ số của cả đội', () => {
    const m = new TestMatch('SURVIVE', { latencyMs: 75, jitterMs: 0, loss: 0.05 });
    const ids = ['a', 'b', 'c'];
    const nodes = ids.map((id) => m.join(id, key(id)));
    m.until(() => nodes.every((n) => n.game.loot.ready));
    const host = m.hostNode()!;
    const vit = { a: [30, 12, 55, 77], b: [80, 60, 0, 100], c: [5, 95, 20, 64] } as const;
    for (const id of ids) {
      const p = m.server().world.players.get(id)!;
      [p.food, p.water, p.infection, p.maxHp] = vit[id as keyof typeof vit];
      p.hp = Math.min(p.hp, p.maxHp);
    }
    m.step(20);
    for (const n of nodes) {
      const me = n.game.sync.predictor.state!;
      const want = vit[n.id as keyof typeof vit];
      expect(me.food).toBeCloseTo(want[0], 0);
      expect(me.water).toBeCloseTo(want[1], 0);
      expect(me.infection).toBeCloseTo(want[2], 0);
      expect(me.maxHp).toBeCloseTo(want[3], 0);
    }
    m.leave(host.id);
    m.until(() => m.hostNode() !== null && m.server().world.players.size === 2);
    m.step(5);
    for (const [id, p] of m.server().world.players) {
      const want = vit[id as keyof typeof vit];
      expect(p.food).toBeCloseTo(want[0], 0);
      expect(p.water).toBeCloseTo(want[1], 0);
      expect(p.infection).toBeCloseTo(want[2], 0);
      expect(p.maxHp).toBeCloseTo(want[3], 0);
    }
  });
});
