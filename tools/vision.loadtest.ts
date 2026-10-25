/**
 * Đo chi phí CPU của tầm nhìn bị tường che (GĐ 4 bổ sung): đa giác bắn tia cho lớp tối + kiểm tra 200 zombie
 * có bị tường che không, trên map thật. Chạy cùng `npm run loadtest` (hoặc `npx vitest run --config
 * tools/vitest.config.ts tools/vision.loadtest.ts`).
 */
import { it } from 'vitest';
import { worldSeedForRoom } from '@shared/mapgen/world';
import { hasLineOfSight } from '@shared/sim/collision';
import { MapgenSource } from '@shared/sim/mapgenSource';
import { Rng } from '@shared/util/rng';
import { visionPolygon, visionShapes } from '@shared/sim/vision';

const map = new MapgenSource(worldSeedForRoom('BENCH1'));
// như ClientSync.blocked: 1 lần tra tileKind (cửa coi như đóng hết)
const blocked = (tx: number, ty: number) => map.tileKind(tx, ty) !== 0;
const eye = map.spawn;
const r = new Rng('z');
const zombies = Array.from({ length: 200 }, () => ({
  x: eye.x + r.int(-30, 30) + 0.5,
  y: eye.y + r.int(-30, 30) + 0.5,
}));
const mates = [1, 2, 3].map((i) => ({ x: eye.x + i, y: eye.y, facing: i, alive: true, flashlight: true }));

function frame(darkness: number) {
  let pts = 0;
  for (const v of visionShapes({ ...eye, facing: 0.7, flashlight: true }, darkness, mates)) {
    pts += visionPolygon(v, v.facing, v.halfAngle, v.range, blocked).length;
  }
  let seen = 0;
  // như WorldScene.zombieSeer: chỉ bắn tia tới zombie trên màn hình (~±20 × ±13 ô ở zoom 3)
  for (const z of zombies) {
    if (Math.abs(z.x - eye.x) > 20 || Math.abs(z.y - eye.y) > 13) continue;
    if (hasLineOfSight(eye, z, blocked)) seen++;
  }
  return pts + seen;
}

it('đo chi phí tầm nhìn bị tường che', () => {
  for (const [name, dark] of [
    ['Ban ngày', 0],
    ['Nửa đêm, 4 đèn pin', 1],
  ] as const) {
    for (let i = 0; i < 200; i++) frame(dark); // khởi động JIT + cache chunk
    const n = 2000;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) frame(dark);
    console.log(
      `${name}: ${((performance.now() - t0) / n).toFixed(3)} ms/frame (đa giác + zombie trên màn hình trong 200)`,
    );
  }
});
