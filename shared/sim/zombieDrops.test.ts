import { describe, expect, it } from 'vitest';
import { RARITIES } from '@shared/data/items';
import { ZOMBIE_DROPS } from '@shared/data/zombieDrops';
import { rollZombieDrop } from './zombieDrops';

const N = 20_000;
function rate(kind: 'normal' | 'boss', turned: boolean, night: boolean): number {
  let hit = 0;
  for (let id = 1; id <= N; id++)
    if (rollZombieDrop({ id, kind, turnedFrom: turned ? 'p' : null }, 5000 + id * 7, night).length) hit++;
  return hit / N;
}

describe('zombie rơi đồ (bảng shared/data/zombieDrops.ts)', () => {
  it('tất định: cùng zombie + cùng tick chết → cùng đồ; khác tick → quay lại', () => {
    const z = { id: 77, kind: 'boss' as const, turnedFrom: null };
    expect(rollZombieDrop(z, 1234, false)).toEqual(rollZombieDrop(z, 1234, false));
    const many = new Set(Array.from({ length: 50 }, (_, t) => JSON.stringify(rollZombieDrop(z, t, false))));
    expect(many.size).toBeGreaterThan(10);
  });

  it('tỉ lệ khớp bảng (±1 điểm %), đêm cao hơn ngày', () => {
    const t = ZOMBIE_DROPS;
    expect(Math.abs(rate('normal', false, false) - t.normal.chance.day)).toBeLessThan(0.01);
    expect(Math.abs(rate('normal', false, true) - t.normal.chance.night)).toBeLessThan(0.01);
    expect(Math.abs(rate('normal', true, false) - t.turned.chance.day)).toBeLessThan(0.01);
    expect(Math.abs(rate('normal', true, true) - t.turned.chance.night)).toBeLessThan(0.01);
    expect(rate('normal', false, true)).toBeGreaterThan(rate('normal', false, false));
  });

  it('xác đồng đội rơi 2 món; Boss luôn rơi 1 món hiếm trở lên + 1 đống đạn', () => {
    for (let id = 1; id <= 300; id++) {
      const turned = rollZombieDrop({ id, kind: 'runner', turnedFrom: 'p1' }, id, true);
      expect([0, 2]).toContain(turned.length);
      const boss = rollZombieDrop({ id, kind: 'boss' }, id * 3, false);
      expect(boss).toHaveLength(2);
      expect(RARITIES[boss[0]!.rarity].rank).toBeGreaterThanOrEqual(RARITIES.rare.rank);
      expect(boss[1]!.itemId).toMatch(/_ammo$/);
    }
  });
});
