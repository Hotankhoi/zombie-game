import { describe, expect, it } from 'vitest';
import { arenaMap } from '@shared/sim/grid';
import { testZombie } from '@shared/sim/testMaps';
import { HostServer } from './hostServer';

/** Chạy host, giết 1 Boss + 40 zombie (hàng y = 20.5) đứng dậy từ xác đồng đội ở tick `tick`; trả về đồ trên đất. */
function killAndCollect(tick: number) {
  const host = new HostServer({ seed: 'drops', map: arenaMap(), zombieCount: 0 });
  host.world.tick = tick;
  host.world.zombies.push(testZombie(1, 24.5, 17.5, { kind: 'boss', hp: 0 }));
  for (let i = 0; i < 40; i++)
    host.world.zombies.push(testZombie(100 + i, 2.5 + i, 20.5, { hp: 0, turnedFrom: 'p1' }));
  host.tick();
  host.tick();
  return host.loot.replica().drops ?? [];
}

describe('host đặt đồ zombie rơi xuống đất', () => {
  it('Boss rơi đồ hiếm + đạn ngay chỗ chết; tất định (chạy 2 lần cùng kết quả)', () => {
    const a = killAndCollect(4000);
    const boss = a.filter((d) => Math.hypot(d.x - 24.5, d.y - 17.5) < 0.5);
    expect(boss.length).toBe(2);
    expect(boss.some((d) => ['rare', 'epic', 'legendary'].includes(d.stack.rarity))).toBe(true);
    // xác đồng đội: ~60% rơi 2 món
    expect(a.length).toBeGreaterThan(2 + 20);
    expect(killAndCollect(4000)).toEqual(a);
    expect(killAndCollect(4001)).not.toEqual(a);
  });
});
