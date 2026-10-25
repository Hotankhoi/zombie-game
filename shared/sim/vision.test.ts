import { describe, expect, it } from 'vitest';
import { GridMap } from './grid';
import { castRay, seesPoint, visionPolygon, visionShapes } from './vision';

/** Phòng 20×20, bức tường dọc ở cột x = 10 (hàng 0..14), chừa lối đi ở dưới. */
function walled() {
  const m = new GridMap(20, 20, { x: 5.5, y: 5.5 });
  for (let y = 0; y < 15; y++) m.setWall(10, y);
  return m;
}
const blockedOf = (m: GridMap) => (tx: number, ty: number) => m.isWall(tx, ty);

describe('vision (tường che tầm nhìn)', () => {
  it('tia dừng ở mặt tường (ăn sâu một chút để thấy mặt tường), không có tường thì đi hết tầm', () => {
    const b = blockedOf(walled());
    const o = { x: 5.5, y: 5.5 };
    expect(castRay(o, 0, 16, b)).toBeCloseTo(4.5 + 0.35, 5); // sang phải: mặt tường ở x = 10
    expect(castRay(o, Math.PI, 3, b)).toBe(3); // sang trái: trống trong tầm 3
  });

  it('đa giác nón nhìn không vượt qua tường; vòng tròn kín quanh mình', () => {
    const b = blockedOf(walled());
    const cone = visionPolygon({ x: 5.5, y: 5.5 }, 0, Math.PI / 4, 16, b);
    expect(cone[0]).toEqual({ x: 5.5, y: 5.5 });
    for (const p of cone) expect(p.x).toBeLessThanOrEqual(10.35 + 1e-9);
    const ring = visionPolygon({ x: 5.5, y: 5.5 }, 0, Math.PI, 3, b);
    expect(ring.length).toBeGreaterThanOrEqual(12);
    for (const p of ring) expect(Math.hypot(p.x - 5.5, p.y - 5.5)).toBeCloseTo(3, 5);
  });

  it('zombie sau tường: không thấy; cùng phía / ngoài nón / ngoài tầm: đúng', () => {
    const b = blockedOf(walled());
    const o = { x: 5.5, y: 5.5 };
    expect(seesPoint(o, 0, Math.PI / 4, 16, { x: 12.5, y: 5.5 }, b)).toBe(false); // sau tường
    expect(seesPoint(o, 0, Math.PI / 4, 16, { x: 8.5, y: 5.5 }, b)).toBe(true);
    expect(seesPoint(o, 0, Math.PI / 4, 16, { x: 5.5, y: 9.5 }, b)).toBe(false); // ngoài nón (90°)
    expect(seesPoint(o, 0, Math.PI, 3, { x: 5.5, y: 7.5 }, b)).toBe(true); // vòng quanh mình
    expect(seesPoint(o, 0, Math.PI / 4, 2, { x: 8.5, y: 5.5 }, b)).toBe(false); // ngoài tầm
  });

  it('vùng nhìn: ban ngày nón + vòng; ban đêm bật đèn thêm đèn của mình và đồng đội', () => {
    const view = { x: 0, y: 0, facing: 0, flashlight: false };
    const mate = { x: 3, y: 3, facing: 1, alive: true, flashlight: true };
    expect(visionShapes(view, 0, [mate])).toHaveLength(2);
    expect(visionShapes({ ...view, flashlight: true }, 1, [mate])).toHaveLength(4);
    const night = visionShapes(view, 1, [])[0]!;
    const day = visionShapes(view, 0, [])[0]!;
    expect(night.range).toBeLessThan(day.range);
  });
});
