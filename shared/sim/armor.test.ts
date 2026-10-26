import { describe, expect, it } from 'vitest';
import { ARMOR_RULES, RARITY_ARMOR } from '@shared/data/armor';
import { LOOT_REGIONS } from '@shared/data/loot';
import { SURVIVAL } from '@shared/data/survival';
import { ZOMBIE_NORMAL } from '@shared/data/zombies';
import { generateChest } from '@shared/loot/chest';
import { arenaMap } from './grid';
import type { PlayerInput } from './input';
import { createPlayer } from './player';
import { absorb, armorAt, armorReduction, durabilityAt, infectionFactor, wearArmor } from './armor';
import { testZombie } from './testMaps';
import { SimWorld } from './world';

const idle: PlayerInput = { seq: 0, moveX: 0, moveY: 0, aim: 0, buttons: 0 };

describe('giáp (GĐ 3b)', () => {
  it('mặc mũ/áo/quần: giảm sát thương cộng dồn theo độ hiếm (trần 70%)', () => {
    const p = createPlayer('a', { x: 0, y: 0 });
    expect(armorReduction(p)).toBe(0);
    wearArmor(p, 'vest', 'common');
    expect(armorReduction(p)).toBeCloseTo(0.15, 6);
    wearArmor(p, 'helmet', 'rare');
    wearArmor(p, 'pants', 'common');
    expect(armorReduction(p)).toBeCloseTo(0.15 + 0.08 * RARITY_ARMOR.rare + 0.07, 6);
    for (const item of ['helmet', 'vest', 'pants'] as const) wearArmor(p, item, 'legendary');
    // cả bộ huyền thoại: 30% × 2.1 = 63% (trần 70%)
    expect(armorReduction(p)).toBeCloseTo(0.3 * RARITY_ARMOR.legendary, 6);
    expect(armorReduction(p)).toBeLessThanOrEqual(ARMOR_RULES.maxReduction);
    expect(wearArmor(p, 'bandage', 'common')).toBe(false);
  });

  it('đỡ đòn thì mòn theo phần mình đỡ; axit mòn ×3; hết bền thì vỡ (tháo ra, báo món vỡ)', () => {
    const p = createPlayer('a', { x: 0, y: 0 });
    wearArmor(p, 'vest', 'common');
    const r = absorb(p, 40);
    expect(r.damage).toBeCloseTo(40 * 0.85, 6);
    expect(durabilityAt(p, 'body')).toBeCloseTo(100 - 40 * 0.15, 6);
    const q = createPlayer('b', { x: 0, y: 0 });
    wearArmor(q, 'vest', 'common');
    absorb(q, 40, true);
    expect(100 - durabilityAt(q, 'body')).toBeCloseTo(
      (100 - durabilityAt(p, 'body')) * ARMOR_RULES.acidWear,
      6,
    );
    let broke: unknown[] = [];
    for (let i = 0; i < 200 && broke.length === 0; i++) broke = absorb(q, 40, true).broken;
    expect(broke).toEqual([{ item: 'vest', rarity: 'common' }]);
    expect(armorAt(q, 'body')).toBeNull();
    expect(armorReduction(q)).toBe(0);
  });

  it('độ bền thuộc chỗ mặc: thay mũ khác không hồi bền; chỗ trống mặc vào thì đủ bền', () => {
    const p = createPlayer('a', { x: 0, y: 0 });
    wearArmor(p, 'helmet', 'common');
    absorb(p, 100);
    const d = durabilityAt(p, 'head');
    expect(d).toBeLessThan(100);
    wearArmor(p, 'helmet', 'epic');
    expect(armorAt(p, 'head')).toBe('epic');
    expect(durabilityAt(p, 'head')).toBe(d);
  });

  it('trong trận: zombie cắn đau ít hơn và nhiễm trùng ít hơn khi mặc giáp; vũng axit làm mòn giáp', () => {
    const bitten = (armored: boolean) => {
      const w = new SimWorld({ seed: 'armor', map: arenaMap(), zombieCount: 0 });
      const a = w.addPlayer('a');
      w.addPlayer('b');
      if (armored) for (const item of ['helmet', 'vest', 'pants'] as const) w.wearArmor('a', item, 'rare');
      w.zombies.push(testZombie(1, a.x + 0.5, a.y, { mode: 'chase', target: 'a' }));
      const inputs = new Map([
        ['a', idle],
        ['b', idle],
      ]);
      for (let i = 0; i < 200 && a.infection === 0; i++) w.step(inputs);
      return a;
    };
    const plain = bitten(false);
    const armored = bitten(true);
    expect(100 - plain.hp).toBeCloseTo(ZOMBIE_NORMAL.biteDamage, 3);
    expect(100 - armored.hp).toBeCloseTo(ZOMBIE_NORMAL.biteDamage * (1 - armorReduction(armored)), 3);
    expect(armored.infection).toBeCloseTo(SURVIVAL.infection.perBite * infectionFactor(armored), 1);
    expect(armored.infection).toBeLessThan(plain.infection);
    // vũng axit
    const w = new SimWorld({ seed: 'acid', map: arenaMap(), zombieCount: 0 });
    const a = w.addPlayer('a');
    w.wearArmor('a', 'vest', 'common');
    w.pools.push({ id: 1, kind: 'acid', x: a.x, y: a.y, radius: 1, ttl: 3, armIn: 0, dps: 14 });
    for (let i = 0; i < 20; i++) w.step(new Map([['a', idle]]));
    expect(durabilityAt(a, 'body')).toBeCloseTo(100 - 14 * 0.15 * ARMOR_RULES.acidWear, 1);
  });

  it('giáp vỡ trong trận → SimWorld báo armorBreaks (host trừ món khỏi túi)', () => {
    const w = new SimWorld({ seed: 'brk', map: arenaMap(), zombieCount: 0 });
    const a = w.addPlayer('a');
    w.wearArmor('a', 'helmet', 'common');
    a.durHead = 0.1;
    w.pools.push({ id: 1, kind: 'acid', x: a.x, y: a.y, radius: 1, ttl: 3, armIn: 0, dps: 14 });
    w.step(new Map([['a', idle]]));
    expect(w.armorBreaks).toEqual([{ player: 'a', item: 'helmet', rarity: 'common' }]);
    expect(armorAt(a, 'head')).toBeNull();
  });

  it('bảng loot: giáp có ở dân cư/siêu thị (ít), đồn cảnh sát và quân sự (nhiều), không có ở bệnh viện', () => {
    const weight = (r: keyof typeof LOOT_REGIONS) =>
      LOOT_REGIONS[r].entries
        .filter((e) => ['helmet', 'vest', 'pants'].includes(e.itemId))
        .reduce((n, e) => n + e.weight, 0) / LOOT_REGIONS[r].entries.reduce((n, e) => n + e.weight, 0);
    expect(weight('hospital')).toBe(0);
    expect(weight('residential')).toBeGreaterThan(0);
    expect(weight('police')).toBeGreaterThan(weight('residential') * 2);
    expect(weight('military')).toBeGreaterThan(weight('police'));
    // sinh rương tất định: quân sự ra giáp
    let found = 0;
    for (let i = 0; i < 60; i++)
      found += generateChest('world:armor', `b${i}:chest:0`, 'military').slots.filter(
        (s) => s?.itemId === 'vest' || s?.itemId === 'helmet' || s?.itemId === 'pants',
      ).length;
    expect(found).toBeGreaterThan(20);
  });
});
