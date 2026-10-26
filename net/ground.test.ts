import { describe, it, expect } from 'vitest';
import { LootAuthority } from '@shared/loot/authority';
import { addItems } from '@shared/inventory/inventory';
import { decodeLoot, encodeLoot, applyLootPatch } from '@net/lootCodec';
import { LootMessage } from '@shared/types/loot';
import { isGroundItems } from '@shared/loot/ground';
describe('ground item atomic state', () => {
  it('round trips drops, clears removed ground through delta and rejects malformed wire', () => {
    const a = new LootAuthority('ground');
    a.join('a');
    const p = { id: 'a', x: 0, y: 0, canInteract: true };
    const bag = a.inventory('a')!;
    a.drop(p, 0, 1, bag.revision, { x: 0.8, y: 0 });
    const state = a.snapshot();
    const packet = encodeLoot({ type: LootMessage.Replica, term: '1.qa', state });
    expect(decodeLoot(packet)).toMatchObject({ state });
    expect(decodeLoot(packet.slice(0, -1))).toBeNull();
    const merged = applyLootPatch(state, {
      baseRevision: state.revision,
      revision: state.revision + 1,
      inventories: [],
      chests: [],
      drops: [],
    });
    expect(merged?.drops ?? []).toEqual([]);
    expect(isGroundItems([{ ...state.drops![0], x: NaN }])).toBe(false);
    expect(isGroundItems([state.drops![0], state.drops![0]])).toBe(false);
  });
  it('refunds loaded rounds in the same gun-drop transaction and blocks invalid/downed/out-of-range pickup', () => {
    const a = new LootAuthority('ground');
    a.join('a');
    a.update('a', (s) => addItems(s, { itemId: 'rifle', rarity: 'epic', quantity: 1 }, s.revision));
    const p = { id: 'a', x: 0, y: 0, canInteract: true };
    const b = a.inventory('a')!;
    expect(a.drop({ ...p, canInteract: false }, 1, 1, b.revision, { x: 1, y: 0 })).toMatchObject({
      ok: false,
    });
    expect(a.drop(p, 1, -1, b.revision, { x: 1, y: 0 })).toMatchObject({ ok: false });
    const r = a.drop(
      p,
      1,
      1,
      b.revision,
      { x: 1, y: 0 },
      { itemId: 'rifle_ammo', rarity: 'common', quantity: 30 },
    );
    expect(r.ok).toBe(true);
    expect(a.inventory('a')!.slots.find((s) => s?.itemId === 'rifle_ammo')?.quantity).toBe(30);
    const drop = a.groundItems()[0]!;
    const rev = a.inventory('a')!.revision;
    expect(a.pickup({ ...p, x: 20 }, drop.id, rev, () => true)).toMatchObject({
      ok: false,
      error: 'out_of_reach',
    });
    expect(a.pickup(p, drop.id, rev, () => false)).toMatchObject({ ok: false, error: 'blocked' });
    expect(a.groundItems()).toHaveLength(1);
  });
});
