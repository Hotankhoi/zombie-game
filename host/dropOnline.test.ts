import { describe, it, expect } from 'vitest';
import { TestMatch } from './testMatch';
import { addItems } from '@shared/inventory/inventory';
import type { LootOutcome } from '@net/clientLoot';
async function settle(m: TestMatch, ps: Promise<LootOutcome>[]) {
  const out: LootOutcome[] = [];
  ps.forEach(
    (p, i) =>
      void p.then((r) => {
        out[i] = r;
      }),
  );
  for (let i = 0; i < 600 && out.filter(Boolean).length < ps.length; i++) {
    m.step();
    await Promise.resolve();
  }
  expect(out.filter(Boolean)).toHaveLength(ps.length);
  return out;
}
function setup() {
  const m = new TestMatch('DROPQA', { latencyMs: 150, jitterMs: 0, loss: 0.05 });
  const nodes = [0, 1, 2, 3].map((i) => m.join('p' + i, String(i + 1).repeat(22)));
  m.until(() => nodes.every((n) => n.game.loot.ready));
  for (const n of nodes) m.place(n.id, 16.5, 16.5);
  return { m, nodes };
}
describe('drop/pickup through four real clients with latency', () => {
  it('unloads a held rifle on drop and cannot recover a ghost weapon from an older world state', async () => {
    const { m, nodes } = setup();
    const a = nodes[1]!;
    const owner = m.server().loot.ownerOf(a.id)!;
    m.server().loot.hostUpdate(owner, (s) =>
      addItems(s, { itemId: 'rifle', rarity: 'epic', quantity: 1 }, s.revision),
    );
    m.step(20);
    expect((await settle(m, [a.game.loot.equip('rifle', 'epic')]))[0]!.ok).toBe(true);
    const p = m.server().world.players.get(a.id)!;
    p.magRifle = 12;
    const bag = a.game.loot.inventory!;
    const slot = bag.slots.findIndex((s) => s?.itemId === 'rifle');
    expect(
      (
        await settle(m, [
          a.game.loot.request({ type: 'drop', slot, quantity: 1, expectedRevision: bag.revision }),
        ])
      )[0]!.ok,
    ).toBe(true);
    expect(p.magRifle).toBe(0);
    expect(p.weapon).toBe('fists');
    expect(a.game.loot.inventory!.slots.find((s) => s?.itemId === 'rifle_ammo')?.quantity).toBe(12);
    // Simulate the stale equipment fields an older world backup can contain.
    p.weapon = 'rifle';
    p.weaponRarity = 'epic';
    p.magRifle = 12;
    m.step();
    expect(p.weapon).toBe('fists');
    expect(p.magRifle).toBe(0);
    expect(a.game.loot.inventory!.slots.find((s) => s?.itemId === 'rifle_ammo')?.quantity).toBe(12);
  });
  it('drop knife, race pickup, reject stale replay; host migration preserves remaining ground item', async () => {
    const { m, nodes } = setup(),
      a = nodes[0]!,
      b = nodes[1]!;
    const command = {
      type: 'drop' as const,
      slot: 0,
      quantity: 1,
      expectedRevision: a.game.loot.inventory!.revision,
    };
    expect((await settle(m, [a.game.loot.request(command)]))[0]!.ok).toBe(true);
    m.step(15);
    const d = m.server().loot.replica().drops![0]!;
    expect(a.game.loot.inventory!.slots.every((s) => s === null)).toBe(true);
    expect(m.server().world.players.get(a.id)!.weapon).toBe('fists');
    expect((await settle(m, [a.game.loot.request(command)]))[0]!.ok).toBe(false);
    for (const n of nodes) expect(n.game.loot.replica?.drops).toHaveLength(1);
    const picked = await settle(
      m,
      [a, b].map((n) =>
        n.game.loot.request({
          type: 'pickup',
          dropId: d.id,
          expectedRevision: n.game.loot.inventory!.revision,
        }),
      ),
    );
    expect(picked.filter((r) => r.ok)).toHaveLength(1);
    m.step(10);
    expect(m.server().loot.replica().drops ?? []).toHaveLength(0);
    const total = m
      .server()
      .loot.replica()
      .inventories.flatMap((i) => i.state.slots)
      .filter(Boolean)
      .reduce((n, s) => n + s!.quantity, 0);
    expect(total).toBe(4);
    const c = nodes[2]!;
    expect(
      (
        await settle(m, [
          c.game.loot.request({
            type: 'drop',
            slot: 0,
            quantity: 1,
            expectedRevision: c.game.loot.inventory!.revision,
          }),
        ])
      )[0]!.ok,
    ).toBe(true);
    const before = m.server().loot.replica().drops;
    const host = m.hostNode()!;
    m.leave(host.id);
    const survivors = nodes.filter((n) => n.id !== host.id);
    m.until(() => survivors.every((n) => n.game.loot.ready && n.game.hostId !== host.id));
    m.step(30);
    expect(m.server().loot.replica().drops).toEqual(before);
  });
  it('Drop 1/all and a full bag never destroy or duplicate stacks', async () => {
    const { m, nodes } = setup(),
      a = nodes[0]!;
    const owner = m.server().loot.ownerOf(a.id)!;
    // Host-only grant; next replica is authoritative and the tested actions still traverse transport.
    m.server().loot.authority.update(owner, (s) =>
      addItems(s, { itemId: 'pistol_ammo', rarity: 'common', quantity: 20 }, s.revision),
    );
    // Existing dirty tracking is intentionally not bypassed: use refresh after full resend.
    m.step(50);
    await settle(m, [a.game.loot.refresh()]);
    const bag = m.server().loot.authority.inventory(owner)!;
    const actor = { id: owner, x: 16.5, y: 16.5, canInteract: true };
    const one = m.server().loot.authority.drop(actor, 1, 1, bag.revision, { x: 17, y: 16.5 });
    expect(one.ok).toBe(true);
    if (!one.ok) return;
    expect(one.inventory.slots[1]?.quantity).toBe(19);
    const all = m.server().loot.authority.drop(actor, 1, 19, one.inventory.revision, { x: 17, y: 16.5 });
    expect(all.ok).toBe(true);
    const drops = m.server().loot.authority.groundItems();
    expect(drops.map((d) => d.stack.quantity)).toEqual([1, 19]);
    m.server().loot.authority.update(owner, (s) => ({
      ...addItems(s, { itemId: 'knife', rarity: 'epic', quantity: 11 }, s.revision),
    }));
    const full = m.server().loot.authority.inventory(owner)!;
    const denied = m.server().loot.authority.pickup(actor, drops[0]!.id, full.revision, () => true);
    expect(denied).toMatchObject({ ok: false, error: 'inventory_full' });
    expect(m.server().loot.authority.groundItems()).toEqual(drops);
  });
});
