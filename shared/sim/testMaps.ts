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
