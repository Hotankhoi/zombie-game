import { describe, expect, it } from 'vitest';
import { decodeLoot, encodeLoot } from '@net/lootCodec';
import type { LootOutcome } from '@net/clientLoot';
import { LootMessage } from '@shared/types/loot';
import type { HordeState } from '@shared/sim/world';
import { TestMatch } from './testMatch';

async function settle(m: TestMatch, ps: Promise<LootOutcome>[]) {
  const out: LootOutcome[] = [];
  ps.forEach((p, i) => void p.then((r) => (out[i] = r)));
  for (let i = 0; i < 600 && out.filter(Boolean).length < ps.length; i++) {
    m.step();
    await Promise.resolve();
  }
  expect(out.filter(Boolean)).toHaveLength(ps.length);
  return out;
}
const won = (number: number): HordeState => ({
  number,
  active: false,
  startTick: 0,
  endTick: 0,
  quota: 1,
  spawned: 1,
  bosses: 0,
  bossesSpawned: 0,
  spawnBudget: 0,
  survived: true,
  kills: {},
  downs: {},
});

describe('thùng thưởng sau đợt tràn (4 máy, trễ 150 ms + mất 5%)', () => {
  it('host đặt 1 thùng khi thắng; mỗi người lấy phần mình; đổi host giữ thùng; không đặt lại', async () => {
    const m = new TestMatch('REWARD', { latencyMs: 150, jitterMs: 0, loss: 0.05 });
    const nodes = [0, 1, 2, 3].map((i) => m.join('p' + i, String(i + 1).repeat(22)));
    m.until(() => nodes.every((n) => n.game.loot.ready));
    m.server().world.horde = won(1);
    m.step();
    const crates = m.server().loot.replica().rewards!;
    expect(crates).toHaveLength(1);
    const c = crates[0]!;
    expect(c.shares).toHaveLength(4);
    m.until(() => nodes.every((n) => n.game.loot.replica?.rewards?.[0]?.id === 'r1'));
    // phần thưởng gửi qua mạng y hệt host
    const bytes = encodeLoot({ type: LootMessage.Replica, term: '1.a', state: m.server().loot.replica() });
    expect(decodeLoot(bytes)).toMatchObject({ state: { rewards: crates } });

    for (const n of nodes) m.place(n.id, c.x + 0.6, c.y);
    const [a, b] = nodes;
    // cả 2 cùng bấm 1 lúc: không tranh nhau, ai cũng được phần mình
    const got = await settle(
      m,
      [a!, b!].map((n) =>
        n.game.loot.request({
          type: 'reward',
          crateId: c.id,
          expectedRevision: n.game.loot.inventory!.revision,
        }),
      ),
    );
    expect(got.map((r) => r.ok)).toEqual([true, true]);
    for (const n of [a!, b!]) {
      const share = c.shares.find((s) => s.owner === n.game.loot.owner)!;
      for (const s of share.slots.filter(Boolean))
        expect(n.game.loot.inventory!.slots).toContainEqual(expect.objectContaining({ itemId: s!.itemId }));
    }
    const again = await settle(m, [
      a!.game.loot.request({
        type: 'reward',
        crateId: c.id,
        expectedRevision: a!.game.loot.inventory!.revision,
      }),
    ]);
    expect(again[0]).toMatchObject({ ok: false, error: 'no_reward' });

    // host rời: thùng + 2 phần còn lại vẫn đó, host mới không đặt thùng thứ 2
    const host = m.hostNode()!;
    m.leave(host.id);
    const rest = nodes.filter((n) => n.id !== host.id);
    m.until(() => rest.every((n) => n.game.loot.ready && n.game.hostId !== host.id));
    m.step(40);
    const after = m.server().loot.replica().rewards ?? [];
    expect(after).toHaveLength(1);
    const left = after[0]!.shares.filter((s) => s.slots.some(Boolean)).map((s) => s.owner);
    expect(left.sort()).toEqual(
      c.shares
        .map((s) => s.owner)
        .filter((o) => o !== a!.game.loot.owner && o !== b!.game.loot.owner)
        .sort(),
    );
  });
});
