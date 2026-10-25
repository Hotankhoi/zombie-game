import { describe, expect, it } from 'vitest';
import { chestLocations, findChest } from '../mapgen/chests';
import { generateChunk, Tile, WorldMap } from '../mapgen/world';
import { LootAuthority, isLootSave } from './authority';

const seed = 'authority-test';
const location = chestLocations(generateChunk(seed, 0, 0))[0]!;
const actor = { id: 'one', x: location.x, y: location.y, canInteract: true };
const open = {
  type: 'open' as const,
  chestId: location.id,
  expectedChestRevision: 0,
  expectedInventoryRevision: 1,
};
function fixture() {
  const host = new LootAuthority(seed);
  host.join('one');
  host.join('two');
  return host;
}

describe('world loot authority', () => {
  it('places reproducible chests on floor tiles, including negative chunks', () => {
    const world = new WorldMap(seed);
    for (let cy = -3; cy <= 3; cy++)
      for (let cx = -3; cx <= 3; cx++) {
        const points = chestLocations(generateChunk(seed, cx, cy));
        expect(points).toHaveLength(4);
        for (const p of points) {
          expect(world.tileAt(Math.floor(p.x), Math.floor(p.y))).toBe(Tile.Floor);
          expect(findChest(seed, p.id)).toEqual(p);
        }
      }
    for (const id of ['', '__proto__', 'v1:999999999,0:0,0:chest:0', 'v1:00,0:0,0:chest:0'])
      expect(findChest(seed, id)).toBeNull();
  });
  it('rejects unadmitted, downed, remote and obstructed players without changing state', () => {
    const host = fixture(),
      before = host.snapshot();
    for (const [player, visible, error] of [
      [{ ...actor, id: 'intruder' }, true, 'unknown_player'],
      [{ ...actor, canInteract: false }, true, 'player_not_up'],
      [{ ...actor, x: actor.x + 10 }, true, 'out_of_reach'],
      [{ ...actor, x: NaN }, true, 'out_of_reach'],
      [actor, false, 'blocked'],
    ] as const)
      expect(host.loot(player, open, () => visible)).toEqual({ ok: false, error });
    expect(host.snapshot()).toEqual(before);
  });
  it('serializes two players taking one chest, preserves empty state after restore', () => {
    const host = fixture();
    const opened = host.loot(actor, open, () => true);
    expect(opened.ok).toBe(true);
    if (!opened.ok || !opened.chest) throw Error('open');
    const command = { ...open, type: 'takeAll' as const, expectedChestRevision: opened.chest.revision };
    expect(host.loot(actor, command, () => true).ok).toBe(true);
    expect(host.loot({ ...actor, id: 'two' }, command, () => true)).toEqual({
      ok: false,
      error: 'stale_revision',
    });
    const saved = host.snapshot();
    expect(saved.chests[0]!.slots.every((s) => s === null)).toBe(true);
    expect(saved.inventories.find((p) => p.id === 'two')!.state.slots.filter(Boolean)).toHaveLength(1);
    const restored = new LootAuthority(seed, JSON.parse(JSON.stringify(saved)));
    expect(restored.snapshot()).toEqual(saved);
    expect(restored.join('one')).toBe(true);
    expect(restored.snapshot()).toEqual(saved);
    expect(restored.loot(actor, command, () => true).ok).toBe(false);
  });
  it('keeps storage isolated from UI results, exported snapshots and restore input', () => {
    const host = fixture();
    const saved = host.snapshot();
    const restored = new LootAuthority(seed, saved);
    (saved.inventories[0]!.state.slots as unknown[])[0] = null;
    expect(restored.inventory('one')!.slots[0]).not.toBeNull();
    const bag = restored.inventory('one')!;
    (bag.slots as unknown[])[0] = null;
    expect(restored.inventory('one')!.slots[0]).not.toBeNull();
  });
  it('rejects corrupted, duplicate and wrong-world saves', () => {
    const host = fixture();
    host.loot(actor, open, () => true);
    const save = host.snapshot();
    for (const bad of [
      null,
      {},
      { ...save, seed: 'other' },
      { ...save, revision: NaN },
      { ...save, inventories: [save.inventories[0], save.inventories[0]] },
      { ...save, chests: [save.chests[0], save.chests[0]] },
      { ...save, inventories: new Array(2) },
    ]) {
      expect(isLootSave(bad, seed)).toBe(false);
      if (bad) expect(() => new LootAuthority(seed, bad as typeof save)).toThrow();
    }
  });
  it('uses only the authenticated actor inventory for move/sort and limits admission', () => {
    const host = fixture();
    expect(host.move(actor, { type: 'move', expectedRevision: 1, from: 0, to: 2, quantity: 1 }).ok).toBe(
      true,
    );
    expect(host.inventory('one')!.slots[0]).toBeNull();
    expect(host.inventory('two')!.slots[0]).not.toBeNull();
    expect(host.move({ ...actor, canInteract: false }, { type: 'sort', expectedRevision: 2 }).ok).toBe(false);
    expect(host.join('three')).toBe(true);
    expect(host.join('four')).toBe(true);
    expect(host.join('five')).toBe(false);
  });
  it('view/chest: same checks as loot, never stores or advances revision (A, loot online)', () => {
    const host = fixture();
    const rev = host.currentRevision();
    expect(host.view({ ...actor, x: actor.x + 10 }, location.id, () => true)).toEqual({
      ok: false,
      error: 'out_of_reach',
    });
    expect(host.view(actor, location.id, () => false)).toEqual({ ok: false, error: 'blocked' });
    expect(host.view({ ...actor, canInteract: false }, location.id, () => true).ok).toBe(false);
    const seen = host.view(actor, location.id, () => true);
    expect(seen.ok && seen.chest?.opened).toBe(false);
    expect(host.chest('nope')).toBeNull();
    expect(host.chest(location.id)!.revision).toBe(0);
    expect(host.snapshot().chests).toHaveLength(0);
    expect(host.currentRevision()).toBe(rev);
  });
});
