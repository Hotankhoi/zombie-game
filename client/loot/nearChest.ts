import type { ChestLocation } from '@shared/mapgen/chests';
import { LOOT_INTERACTION } from '@shared/data/lootInteraction';
import type { Vec2 } from '@shared/types';

/**
 * Rương gần nhất trong tầm với (≤ LOOT_INTERACTION.reach, giống host) mà mình nhìn thấy (`canSee`: tường/cửa
 * đóng che thì không). Không có → null. Host vẫn kiểm tra lại tầm với + đường nhìn theo vị trí của nó.
 */
export function nearestChest(
  chests: Iterable<ChestLocation>,
  me: Vec2,
  canSee: (c: ChestLocation) => boolean,
  reach: number = LOOT_INTERACTION.reach,
): ChestLocation | null {
  let best: ChestLocation | null = null;
  let bestD = Infinity;
  for (const c of chests) {
    const d = Math.hypot(c.x - me.x, c.y - me.y);
    if (d > reach || d >= bestD || !canSee(c)) continue;
    best = c;
    bestD = d;
  }
  return best;
}

/**
 * Panel rương còn được mở không: mình còn đứng (`me` khác null), trong tầm với và còn nhìn thấy rương (cùng luật với
 * `nearestChest`). false → đóng panel (host cũng sẽ từ chối).
 */
export function canKeepChestOpen(
  chest: ChestLocation,
  me: Vec2 | null,
  canSee: (c: ChestLocation) => boolean,
  reach: number = LOOT_INTERACTION.reach,
): boolean {
  return me !== null && Math.hypot(chest.x - me.x, chest.y - me.y) <= reach && canSee(chest);
}

/**
 * Gọi `view(id)` cho rương mình chưa biết khi tới gần: mỗi rương tối đa 1 lần / `retryMs` (host có thể từ chối
 * vì vị trí của mình ở host trễ hơn dự đoán → thử lại sau). Rương đã biết (replica / kết quả trước) thì khỏi hỏi.
 */
export class ChestViewer {
  private askedAt = new Map<string, number>();

  constructor(
    private view: (id: string) => void,
    private known: (id: string) => boolean,
    private retryMs = 1000,
  ) {}

  /** Gọi mỗi frame với rương gần nhất (hoặc null). */
  update(chest: ChestLocation | null, now: number): void {
    if (!chest || this.known(chest.id)) return;
    const at = this.askedAt.get(chest.id);
    if (at !== undefined && now - at < this.retryMs) return;
    this.askedAt.set(chest.id, now);
    this.view(chest.id);
  }

  /** Đổi host: replica mới → hỏi lại từ đầu. */
  reset(): void {
    this.askedAt.clear();
  }
}
