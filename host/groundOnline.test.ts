import { describe, expect, it } from 'vitest';
import { applyLootPatch, decodeLoot, encodeLoot } from '@net/lootCodec';
import { GROUND } from '@shared/data/ground';
import { LootMessage, type LootReplicaWire } from '@shared/types/loot';
import { TestMatch } from './testMatch';

const ammo = (quantity: number) => ({ itemId: 'pistol_ammo', rarity: 'common', quantity }) as const;

function setup() {
  const m = new TestMatch('GROUND', { latencyMs: 150, jitterMs: 0, loss: 0.05 });
  const nodes = [0, 1, 2, 3].map((i) => m.join('p' + i, String(i + 1).repeat(22)));
  m.until(() => nodes.every((n) => n.game.loot.ready));
  return { m, nodes };
}
const sameAsHost = (m: TestMatch, nodes: ReturnType<typeof setup>['nodes']) => {
  const host = m.server().loot.replica();
  return nodes.every(
    (n) =>
      n.game.loot.replica?.revision === host.revision &&
      JSON.stringify(n.game.loot.replica?.drops ?? []) === JSON.stringify(host.drops ?? []),
  );
};

describe('đồ trên đất online (A, giao thức 11)', () => {
  it('phần đổi chỉ mang đống vừa đổi; 128 đống gửi gọn', () => {
    const drops = Array.from({ length: GROUND.max }, (_, i) => ({
      id: 'd' + (i + 1),
      x: 1000 + (i % 16) * 1.5,
      y: -1000 - Math.floor(i / 16) * 1.5,
      t: 123456 + i,
      stack: ammo(1 + (i % 60)),
    }));
    const state: LootReplicaWire = {
      drops,
      version: 1,
      seed: 's',
      revision: 200,
      inventories: [],
      chests: [],
    };
    const full = encodeLoot({ type: LootMessage.Replica, term: '1.a', state });
    expect(decodeLoot(full)).toEqual({ type: LootMessage.Replica, term: '1.a', state });
    // ~17 B/đống (trước: ~30 B với x/y f64 + id chữ)
    expect(full.length).toBeLessThan(GROUND.max * 18 + 40);
    const patch = {
      baseRevision: 200,
      revision: 201,
      inventories: [],
      chests: [],
      dropsSet: [
        { ...drops[5]!, stack: ammo(60) },
        { id: 'd300', x: 0, y: 0.5, t: 9, stack: ammo(1) },
      ],
      dropsRemoved: ['d1', 'd2'],
    };
    const bytes = encodeLoot({ type: LootMessage.Replica, term: '1.a', patch });
    expect(bytes.length).toBeLessThan(60);
    const decoded = decodeLoot(bytes);
    if (!decoded || !('patch' in decoded)) throw new Error('patch');
    const next = applyLootPatch(state, decoded.patch)!;
    expect(next.drops!.map((d) => d.id)).toEqual([...drops.slice(2).map((d) => d.id), 'd300']);
    expect(next.drops!.find((d) => d.id === 'd6')!.stack.quantity).toBe(60);
  });

  it('4 máy trễ 150ms + mất 5%: rơi, gộp, hết hạn đúng tick; đổi host giữ tick rơi', () => {
    const { m, nodes } = setup();
    const loot = m.server().loot;
    const t0 = m.server().world.tick;
    expect(loot.spawnGround(ammo(10), { x: 20.3, y: 20 })).toBe(true);
    m.step(5);
    expect(loot.spawnGround(ammo(5), { x: 20.6, y: 20 })).toBe(true); // ≤ 0.5 ô → gộp
    expect(loot.spawnGround({ itemId: 'water', rarity: 'common', quantity: 1 }, { x: 30, y: 30 })).toBe(true);
    m.until(() => sameAsHost(m, nodes));
    const drops = m.server().loot.replica().drops!;
    expect(drops.map((d) => d.stack.quantity)).toEqual([15, 1]);
    const tAmmo = drops[0]!.t;
    expect(tAmmo).toBeGreaterThanOrEqual(t0);

    // host rời: máy lên host giữ nguyên tick rơi (tick thế giới khôi phục từ bản sao lưu / snapshot)
    const host = m.hostNode()!;
    m.leave(host.id);
    const rest = nodes.filter((n) => n.id !== host.id);
    m.until(() => rest.every((n) => n.game.loot.ready && n.game.hostId !== host.id));
    m.until(() => sameAsHost(m, rest));
    expect(
      m
        .server()
        .loot.replica()
        .drops!.map((d) => d.t),
    ).toEqual(drops.map((d) => d.t));

    // tua thế giới tới sát hạn: chưa mất; qua hạn: mất ở lượt quét kế tiếp, mọi máy cùng thấy
    const w = m.server().world;
    w.tick = drops[1]!.t + GROUND.expireTicks - GROUND.sweepEveryTicks * 2;
    m.step(GROUND.sweepEveryTicks);
    expect(m.server().loot.replica().drops).toHaveLength(2);
    m.step(GROUND.sweepEveryTicks * 3);
    m.until(() => sameAsHost(m, rest));
    const left = m.server().loot.replica().drops ?? [];
    expect(left.map((d) => d.id)).toEqual(tAmmo > drops[1]!.t ? [drops[0]!.id] : []);
  });
});
