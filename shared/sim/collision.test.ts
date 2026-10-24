import { describe, expect, it } from 'vitest';
import { angleDiff, hasLineOfSight, moveCircle, type BlockedFn } from './collision';
import { GridMap } from './grid';

const R = 0.3;

function wallColumn(x: number): BlockedFn {
  const m = new GridMap(20, 20, { x: 1.5, y: 1.5 });
  for (let y = 0; y < 20; y++) m.setWall(x, y);
  return (tx, ty) => m.isWall(tx, ty);
}

describe('moveCircle', () => {
  it('không đi xuyên tường', () => {
    const blocked = wallColumn(5);
    const pos = { x: 4, y: 3.5 };
    moveCircle(pos, 3, 0, R, blocked);
    expect(pos.x).toBeLessThanOrEqual(5 - R + 1e-9);
  });

  it('đi rất nhanh trong 1 bước cũng không xuyên tường', () => {
    const blocked = wallColumn(5);
    const pos = { x: 4, y: 3.5 };
    moveCircle(pos, 10, 0, R, blocked);
    expect(pos.x).toBeLessThan(5);
  });

  it('trượt dọc tường khi đi chéo vào tường', () => {
    const blocked = wallColumn(5);
    const pos = { x: 4.6, y: 3.5 };
    moveCircle(pos, 1, 1, R, blocked);
    expect(pos.x).toBeLessThanOrEqual(5 - R + 1e-9);
    expect(pos.y).toBeCloseTo(4.5, 5);
  });

  it('không lách qua khe giữa 2 góc tường chéo nhau', () => {
    const m = new GridMap(20, 20, { x: 1.5, y: 1.5 });
    m.setWall(5, 4).setWall(4, 5);
    const blocked: BlockedFn = (tx, ty) => m.isWall(tx, ty);
    const pos = { x: 4.5, y: 4.5 };
    for (let i = 0; i < 20; i++) moveCircle(pos, 0.1, 0.1, R, blocked);
    expect(pos.x > 5 && pos.y > 5).toBe(false);
  });
});

describe('hasLineOfSight', () => {
  it('bị tường che thì không thấy, không che thì thấy', () => {
    const blocked = wallColumn(5);
    expect(hasLineOfSight({ x: 2.5, y: 2.5 }, { x: 8.5, y: 2.5 }, blocked)).toBe(false);
    expect(hasLineOfSight({ x: 2.5, y: 2.5 }, { x: 4.5, y: 8.5 }, blocked)).toBe(true);
  });
});

describe('angleDiff', () => {
  it('nằm trong [0, π] và quấn vòng đúng', () => {
    expect(angleDiff(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(angleDiff(0.1, Math.PI * 2 - 0.1)).toBeCloseTo(0.2);
    expect(angleDiff(0, Math.PI)).toBeCloseTo(Math.PI);
  });
});
