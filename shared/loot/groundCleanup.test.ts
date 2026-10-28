import { describe, expect, it } from 'vitest';
import { GROUND } from '@shared/data/ground';
import type { GroundItemWire } from '@shared/types/loot';
import { LootAuthority } from './authority';
import { placeGround, snapGround, sweepGround } from './ground';

const ammo = (quantity: number) => ({ itemId: 'pistol_ammo', rarity: 'common', quantity }) as const;
const item = (id: number, x: number, t: number, quantity = 1, rarity = 'common'): GroundItemWire => ({
  id: 'd' + id,
  x,
  y: 0,
  t,
  stack: { itemId: 'bandage', rarity: rarity as 'common', quantity },
});

describe('đồ trên đất tự dọn + gộp (A, giao thức 11)', () => {
  it('hết hạn đúng GROUND.expireTicks (5 phút) kể từ lúc rơi', () => {
    expect(GROUND.expireTicks).toBe(6000);
    const drops = [item(1, 0, 100), item(2, 5, 200)];
    expect(sweepGround(drops, 100 + 5999)).toBeNull();
    expect(sweepGround(drops, 100 + 6000)!.map((d) => d.id)).toEqual(['d2']);
    expect(sweepGround(drops, 200 + 6000)).toEqual([]);
  });

  it('gộp cùng loại + độ hiếm trong 0.5 ô; xa hơn hoặc khác độ hiếm thì không', () => {
    const base = [item(1, 0, 10)];
    const near = placeGround(
      base,
      { itemId: 'bandage', rarity: 'common', quantity: 2 },
      { x: 0.5, y: 0 },
      50,
      'd9',
    );
    expect(near).toEqual([{ ...item(1, 0, 50, 3) }]);
    const far = placeGround(
      base,
      { itemId: 'bandage', rarity: 'common', quantity: 2 },
      { x: 0.53125, y: 0 },
      50,
      'd9',
    );
    expect(far!.map((d) => d.id)).toEqual(['d1', 'd9']);
    const rare = placeGround(
      base,
      { itemId: 'bandage', rarity: 'rare', quantity: 1 },
      { x: 0, y: 0 },
      50,
      'd9',
    );
    expect(rare!.map((d) => d.stack.rarity)).toEqual(['common', 'rare']);
  });

  it('gộp không vượt maxStack — phần dư thành đống mới; quét định kỳ gộp đống còn sót', () => {
    // đạn súng lục maxStack 60
    const start: GroundItemWire[] = [{ id: 'd1', x: 0, y: 0, t: 0, stack: ammo(50) }];
    const out = placeGround(start, ammo(30), { x: 0.25, y: 0 }, 7, 'd2')!;
    expect(out.map((d) => [d.id, d.stack.quantity])).toEqual([
      ['d1', 60],
      ['d2', 20],
    ]);
    const loose = [item(1, 0, 3, 2), item(2, 10, 4), item(3, 0.4, 9, 5)];
    const swept = sweepGround(loose, 10)!;
    expect(swept.map((d) => [d.id, d.stack.quantity, d.t])).toEqual([
      ['d1', 7, 9],
      ['d2', 1, 4],
    ]);
    expect(sweepGround(swept, 10)).toBeNull();
  });

  it('vị trí làm tròn 1/32 ô; đủ GROUND.max đống thì từ chối đống mới nhưng vẫn gộp được', () => {
    expect(snapGround(1.01)).toBe(1);
    const full = Array.from({ length: GROUND.max }, (_, i) => item(i + 1, i * 2, 0));
    expect(
      placeGround(full, { itemId: 'water', rarity: 'common', quantity: 1 }, { x: 0, y: 0 }, 1, 'd999'),
    ).toBeNull();
    expect(
      placeGround(full, { itemId: 'bandage', rarity: 'common', quantity: 1 }, { x: 0, y: 0 }, 1, 'd999'),
    ).toHaveLength(GROUND.max);
  });

  it('authority: thả + tự dọn tất định, mỗi lần đổi 1 revision', () => {
    const run = () => {
      const a = new LootAuthority('ground-clean');
      a.join('a');
      const p = { id: 'a', x: 0, y: 0, canInteract: true };
      a.drop(p, 0, 1, a.inventory('a')!.revision, { x: 0.8, y: 0.013 }, undefined, 40);
      expect(a.spawnGround(ammo(5), { x: 3, y: 3 }, 100)).toBe(true);
      expect(a.spawnGround(ammo(5), { x: 3.2, y: 3 }, 200)).toBe(true);
      const rev = a.currentRevision();
      expect(a.sweepGround(40 + 5999)).toBe(false);
      expect(a.sweepGround(40 + 6000)).toBe(true);
      expect(a.currentRevision()).toBe(rev + 1);
      return a.snapshot();
    };
    const s = run();
    expect(s.drops).toEqual([{ id: 'd3', x: 3, y: 3, t: 200, stack: ammo(10) }]);
    expect(run()).toEqual(s);
  });
});
