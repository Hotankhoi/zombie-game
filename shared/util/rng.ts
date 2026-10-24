/**
 * Bộ sinh số ngẫu nhiên tất định (mulberry32).
 * Cùng seed → cùng dãy số trên mọi máy. Dùng cho sinh map, loot, zombie (KHÔNG dùng Math.random trong /shared).
 */
export class Rng {
  private state: number;

  constructor(seed: number | string) {
    this.state = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
  }

  /** Trạng thái hiện tại (chỉ đọc) — để băm/so khớp mô phỏng giữa các máy. */
  get stateValue(): number {
    return this.state;
  }

  /** Số thực trong [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Số nguyên trong [min, max] (gồm cả 2 đầu). */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Chọn một phần tử ngẫu nhiên. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: mảng rỗng');
    return items[this.int(0, items.length - 1)] as T;
  }

  /** true với xác suất p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Tạo Rng con độc lập (vd: mỗi chunk map một Rng riêng từ seed thế giới + tọa độ chunk). */
  fork(label: string | number): Rng {
    return new Rng(hashString(`${this.state}:${label}`));
  }
}

/** Băm chuỗi thành số 32-bit (FNV-1a). Tất định trên mọi máy. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
