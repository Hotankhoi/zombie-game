import { describe, expect, it } from 'vitest';
import type { ChestLocation } from '@shared/mapgen/chests';
import { ChestViewer, nearestChest } from './nearChest';

const chest = (id: string, x: number, y: number): ChestLocation => ({ id, region: 'residential', x, y });

describe('nearestChest', () => {
  const chests = [chest('a', 10.5, 10.5), chest('b', 12.5, 10.5), chest('c', 30.5, 30.5)];

  it('chọn rương gần nhất trong tầm với', () => {
    expect(nearestChest(chests, { x: 11, y: 10.5 }, () => true)?.id).toBe('a');
    expect(nearestChest(chests, { x: 12.2, y: 10.5 }, () => true)?.id).toBe('b');
  });

  it('ngoài tầm với (> 2 ô) → không có', () => {
    expect(nearestChest(chests, { x: 20, y: 20 }, () => true)).toBeNull();
    expect(nearestChest(chests, { x: 10.5, y: 12.6 }, () => true)).toBeNull();
    expect(nearestChest(chests, { x: 10.5, y: 12.5 }, () => true)?.id).toBe('a');
  });

  it('rương sau tường (không thấy) bị bỏ qua, lấy rương thấy được dù xa hơn', () => {
    expect(nearestChest(chests, { x: 11, y: 10.5 }, (c) => c.id !== 'a')?.id).toBe('b');
    expect(nearestChest(chests, { x: 11, y: 10.5 }, () => false)).toBeNull();
  });
});

describe('ChestViewer', () => {
  it('hỏi rương chưa biết 1 lần, thử lại sau retryMs; rương đã biết thì không hỏi', () => {
    const asked: string[] = [];
    const known = new Set<string>();
    const v = new ChestViewer((id) => asked.push(id), (id) => known.has(id), 1000);
    const a = chest('a', 0, 0);
    v.update(a, 0);
    v.update(a, 16);
    v.update(a, 999);
    expect(asked).toEqual(['a']);
    v.update(a, 1000);
    expect(asked).toEqual(['a', 'a']);
    known.add('a');
    v.update(a, 5000);
    v.update(null, 6000);
    expect(asked).toEqual(['a', 'a']);
  });

  it('reset (đổi host) → hỏi lại ngay', () => {
    const asked: string[] = [];
    const v = new ChestViewer((id) => asked.push(id), () => false);
    v.update(chest('a', 0, 0), 0);
    v.reset();
    v.update(chest('a', 0, 0), 10);
    expect(asked).toEqual(['a', 'a']);
  });
});
