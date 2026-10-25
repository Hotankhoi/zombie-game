import { describe, expect, it } from 'vitest';
import { createInventory } from '@shared/inventory/inventory';
import type { ChestState } from '@shared/loot/chest';
import { LOOT_ERRORS } from '@net/lootCodec';
import { LOOT_ERROR_TEXT, lootErrorText } from './lootMessages';
import { toInventoryResult, toLootResult } from './outcome';

const chest = (id: string, revision: number): ChestState => ({
  version: 1,
  id,
  region: 'residential',
  revision,
  opened: true,
  slots: [null, null, null, null, null, null],
});

describe('toLootResult', () => {
  const shown = { chest: chest('a', 1), inventory: createInventory() };

  it('thành công: lấy rương + túi mới từ kết quả', () => {
    const inv = { ...createInventory(), revision: 5 };
    const r = toLootResult({ ok: true, inventory: inv, chest: chest('a', 2) }, shown);
    expect(r).toEqual({ ok: true, inventory: inv, chest: chest('a', 2) });
  });

  it('lỗi chưa có trạng thái (not_ready) → giữ trạng thái panel đang hiện, kèm mã lỗi', () => {
    const r = toLootResult({ ok: false, error: 'not_ready', inventory: null, chest: null }, shown);
    expect(r).toEqual({ ok: false, error: 'not_ready', ...shown });
  });

  it('rương trong kết quả khác rương panel → giữ rương panel', () => {
    const r = toLootResult({ ok: false, error: 'busy', inventory: null, chest: chest('b', 9) }, shown);
    expect(r.chest.id).toBe('a');
  });

  it('túi: lỗi không có trạng thái → giữ túi đang hiện', () => {
    const inv = createInventory();
    expect(toInventoryResult({ ok: false, error: 'timeout', inventory: null, chest: null }, inv)).toEqual({
      ok: false,
      error: 'timeout',
      state: inv,
    });
  });
});

describe('lootErrorText', () => {
  it('mọi mã lỗi của host + máy khách đều có câu tiếng Việt', () => {
    for (const code of [...LOOT_ERRORS, 'not_ready', 'busy', 'host_changed', 'timeout'])
      expect(LOOT_ERROR_TEXT[code as keyof typeof LOOT_ERROR_TEXT], code).toMatch(/\S/);
    expect(lootErrorText('out_of_reach')).toContain('xa');
    expect(lootErrorText('mã lạ')).toBe('Thao tác chưa được xác nhận.');
  });
});
