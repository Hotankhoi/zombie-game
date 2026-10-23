import { describe, expect, it } from 'vitest';
import { Rng, hashString } from './rng';

describe('Rng', () => {
  it('cùng seed cho cùng dãy số', () => {
    const a = new Rng('the-world');
    const b = new Rng('the-world');
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
  });

  it('khác seed cho dãy khác', () => {
    expect(new Rng(1).next()).not.toBe(new Rng(2).next());
  });

  it('int nằm trong khoảng và phủ đủ giá trị', () => {
    const r = new Rng(42);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = r.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7]);
  });

  it('fork tất định và độc lập với nhau', () => {
    const w1 = new Rng('seed');
    const w2 = new Rng('seed');
    expect(w1.fork('chunk:0,0').next()).toBe(w2.fork('chunk:0,0').next());
    expect(new Rng('seed').fork('a').next()).not.toBe(new Rng('seed').fork('b').next());
  });

  it('hashString ổn định (không đổi giữa các phiên bản)', () => {
    expect(hashString('zombie')).toBe(hashString('zombie'));
    expect(hashString('')).toBe(0x811c9dc5);
  });
});
