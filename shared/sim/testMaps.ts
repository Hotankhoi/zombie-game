import { Rng } from '@shared/util/rng';
import { createZombie, type ZombieState } from './zombie';
import { GridMap } from './grid';

/**
 * Map thử cho test: 2 phòng 16×9 ngăn bởi bức tường x = 8, cửa duy nhất ở (8, 4).
 * Người chơi xuất phát ở phòng trái.
 */
export function twoRoomMap(): GridMap {
  const m = new GridMap(16, 9, { x: 3.5, y: 4.5 });
  m.room(0, 0, 16, 9, { x: -1, y: -1 });
  for (let y = 0; y < 9; y++) m.setWall(8, y);
  m.setDoor(8, 4);
  return m;
}

export const DOOR = { x: 8, y: 4 } as const;

/** Zombie cho test: mặc định loại thường, không nấp; ghi đè trường tùy ý. */
export function testZombie(id: number, x: number, y: number, extra: Partial<ZombieState> = {}): ZombieState {
  return { ...createZombie(id, x, y, new Rng(id)), hidden: false, ...extra };
}
