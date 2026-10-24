import type { Vec2 } from '@shared/types';

/**
 * Nguồn bản đồ mà mô phỏng cần biết — chỉ "ô này là tường?" và "ô này là cửa?".
 * Sim không phụ thuộc trực tiếp vào /shared/mapgen (vùng của B): map thật của B
 * cắm vào qua một adapter, map thử bên dưới dùng cho test và chơi thử.
 * Trạng thái mở/đóng cửa KHÔNG nằm ở đây — SimWorld giữ riêng (map gốc chỉ đọc).
 */
export interface MapSource {
  /** Tường/vật cản cố định (không tính cửa). Ngoài rìa bản đồ cũng trả về true. */
  isWall(tx: number, ty: number): boolean;
  /** Ô cửa (mặc định đóng). */
  isDoor(tx: number, ty: number): boolean;
  /** Điểm xuất phát của người chơi (tọa độ ô, số thực). */
  spawn: Vec2;
}

const WALL = 1;
const DOOR = 2;

/** Bản đồ lưới hữu hạn, dựng bằng code. */
export class GridMap implements MapSource {
  private cells: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly spawn: Vec2,
  ) {
    this.cells = new Uint8Array(width * height);
  }

  private inside(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.width && ty < this.height;
  }

  isWall(tx: number, ty: number): boolean {
    return !this.inside(tx, ty) || this.cells[ty * this.width + tx] === WALL;
  }

  isDoor(tx: number, ty: number): boolean {
    return this.inside(tx, ty) && this.cells[ty * this.width + tx] === DOOR;
  }

  setWall(tx: number, ty: number): this {
    if (this.inside(tx, ty)) this.cells[ty * this.width + tx] = WALL;
    return this;
  }

  setDoor(tx: number, ty: number): this {
    if (this.inside(tx, ty)) this.cells[ty * this.width + tx] = DOOR;
    return this;
  }

  /** Phòng hình chữ nhật có tường bao (gồm cả tường) và một cửa. */
  room(x: number, y: number, w: number, h: number, door: Vec2): this {
    for (let tx = x; tx < x + w; tx++) {
      this.setWall(tx, y).setWall(tx, y + h - 1);
    }
    for (let ty = y; ty < y + h; ty++) {
      this.setWall(x, ty).setWall(x + w - 1, ty);
    }
    return this.setDoor(door.x, door.y);
  }
}

/**
 * Bản đồ thử 48×36 ô: sân trống ở giữa, 5 phòng có cửa, vài cột chắn.
 * Dùng cho test (game thật dùng map của B qua MapgenSource).
 */
export function arenaMap(): GridMap {
  const m = new GridMap(48, 36, { x: 24.5, y: 17.5 });
  m.room(0, 0, 48, 36, { x: -1, y: -1 }); // tường bao, không cửa
  m.room(4, 4, 10, 8, { x: 8, y: 11 });
  m.room(19, 3, 12, 8, { x: 24, y: 10 });
  m.room(36, 4, 8, 11, { x: 36, y: 9 });
  m.room(4, 23, 12, 9, { x: 9, y: 23 });
  m.room(30, 22, 10, 10, { x: 30, y: 26 });
  // cột chắn ở sân để thử trượt dọc tường và nấp
  for (const [x, y] of [
    [17, 16],
    [17, 17],
    [31, 16],
    [32, 16],
    [22, 26],
    [23, 26],
    [24, 26],
  ] as const) {
    m.setWall(x, y);
  }
  return m;
}
