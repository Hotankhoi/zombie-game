import { describe, expect, it } from 'vitest';
import { addItems } from '@shared/inventory/inventory';
import { LootAuthority, isLootSave } from './authority';
import { isRewardCrates, rewardCrateId, rollRewardShare } from './reward';

const crate = (owners: string[]) => ({
  id: rewardCrateId(1),
  x: 5,
  y: 5,
  horde: 1,
  shares: owners.map((owner) => ({ owner, slots: rollRewardShare('seed', 1, owner) })),
});
const at = (id: string) => ({ id, x: 5.5, y: 5, canInteract: true });

describe('thùng thưởng đợt tràn (A, giao thức 12)', () => {
  it('phần thưởng tất định theo seed + đợt + người; món chính Huyền thoại', () => {
    expect(rollRewardShare('seed', 1, 'pA')).toEqual(rollRewardShare('seed', 1, 'pA'));
    const kinds = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const s = rollRewardShare('seed', i + 1, 'p' + i);
      expect(s[0]!.rarity).toBe('legendary');
      expect(s[1]!.itemId).toBe(s[0]!.itemId === 'rifle' ? 'rifle_ammo' : 'pistol_ammo');
      kinds.add(s[0]!.itemId);
    }
    expect(kinds.size).toBe(5);
  });

  it('mỗi người lấy đúng phần mình, không lấy được phần người khác, lấy lần 2 → no_reward; hết phần → thùng mất', () => {
    const a = new LootAuthority('seed');
    a.join('pA');
    a.join('pB');
    expect(a.addReward(crate(['pA', 'pB']))).toBe(true);
    expect(a.addReward(crate(['pA']))).toBe(false); // trùng id
    a.join('pC');
    const sees = () => true;
    expect(a.takeReward(at('pC'), 'r1', a.inventory('pC')!.revision, sees)).toMatchObject({
      ok: false,
      error: 'no_reward',
    });
    expect(a.takeReward({ ...at('pA'), x: 9 }, 'r1', a.inventory('pA')!.revision, sees)).toMatchObject({
      error: 'out_of_reach',
    });
    expect(a.takeReward(at('pA'), 'r1', a.inventory('pA')!.revision, () => false)).toMatchObject({
      error: 'blocked',
    });
    const r = a.takeReward(at('pA'), 'r1', a.inventory('pA')!.revision, sees);
    expect(r.ok).toBe(true);
    expect(a.inventory('pA')!.slots.filter(Boolean)).toHaveLength(1 + 4);
    expect(a.takeReward(at('pA'), 'r1', a.inventory('pA')!.revision, sees)).toMatchObject({
      error: 'no_reward',
    });
    expect(a.rewardCrates()).toHaveLength(1);
    expect(a.takeReward(at('pB'), 'r1', a.inventory('pB')!.revision, sees).ok).toBe(true);
    expect(a.rewardCrates()).toHaveLength(0);
    expect(isLootSave(a.snapshot(), 'seed')).toBe(true);
  });

  it('túi gần đầy: món vừa thì vào túi, phần dư ở lại thùng cho lần sau', () => {
    const a = new LootAuthority('seed');
    a.join('pA');
    // túi 12 ô: dao + 9 ô băng gạc đầy → còn 2 ô
    for (let i = 0; i < 9; i++)
      a.update('pA', (s) => addItems(s, { itemId: 'bandage', rarity: 'epic', quantity: 10 }, s.revision));
    a.addReward(crate(['pA']));
    expect(a.takeReward(at('pA'), 'r1', a.inventory('pA')!.revision, () => true).ok).toBe(true);
    const left = a.rewardCrates()[0]!.shares[0]!.slots.filter(Boolean);
    expect(left).toHaveLength(2);
    expect(a.inventory('pA')!.slots.every(Boolean)).toBe(true);
    expect(a.takeReward(at('pA'), 'r1', a.inventory('pA')!.revision, () => true)).toMatchObject({
      error: 'inventory_full',
    });
  });

  it('kiểm tra dữ liệu thùng', () => {
    expect(isRewardCrates([crate(['pA'])])).toBe(true);
    expect(isRewardCrates([{ ...crate(['pA']), id: 'r2' }])).toBe(false);
    expect(isRewardCrates([crate(['pA', 'pA'])])).toBe(false);
    expect(isRewardCrates([crate([])])).toBe(false);
  });
});
