import type { ClientLoot } from '@net/clientLoot';
import { chestLocations, type ChestLocation } from '@shared/mapgen/chests';
import { CHUNK_SIZE, generateChunk } from '@shared/mapgen/world';
import { Rng } from '@shared/util/rng';

/**
 * Bot loot (đo tải GĐ 7 + nối loot 2A): thỉnh thoảng (mỗi ~15–30 s) tới rương gần nhất, mở, lấy hết; túi đầy thì sắp
 * xếp rồi bỏ rương đó. Chỉ dùng API ClientLoot như máy thật, không chờ Promise (vòng đo tải chạy đồng bộ): đọc
 * `busy`/`chest()`/`inventory` mỗi tick.
 * Bot không tự đi vào nhà được → `teleport` đưa nhân vật (phía host) tới cạnh rương — chỉ để đo băng thông loot.
 */
export class LootBot {
  private rng: Rng;
  private nextAt: number;
  private target: ChestLocation | null = null;
  private tries = 0;
  /** Rương đã lấy xong (không quay lại). */
  private done = new Set<string>();
  stats = { visits: 0, actions: 0 };

  constructor(
    private loot: ClientLoot,
    private seed: string,
    id: string,
    private teleport: (x: number, y: number) => void,
    private everyTicks: [number, number] = [300, 600],
  ) {
    this.rng = new Rng(`loot-${id}`);
    this.nextAt = this.rng.int(40, everyTicks[1]);
  }

  tick(tick: number, at: { x: number; y: number } | null): void {
    if (!this.loot.ready || this.loot.busy || !at) return;
    if (!this.target) {
      if (tick < this.nextAt) return;
      this.target = this.nearest(at);
      this.tries = 0;
      if (!this.target) return;
      this.stats.visits++;
      this.teleport(this.target.x, this.target.y);
      return; // đợi host chạy tick có vị trí mới
    }
    const c = this.loot.chest(this.target.id);
    const empty = c?.slots.every((s) => s === null) ?? false;
    if (empty || this.tries >= 3) {
      if (this.tries >= 3 && this.loot.inventory) void this.loot.sort();
      this.done.add(this.target.id);
      this.target = null;
      this.nextAt = tick + this.rng.int(this.everyTicks[0], this.everyTicks[1]);
      return;
    }
    this.tries++;
    this.stats.actions++;
    if (!c || !c.opened) void this.loot.open(this.target.id);
    else void this.loot.takeAll(this.target.id);
  }

  private nearest(at: { x: number; y: number }): ChestLocation | null {
    const cx = Math.floor(at.x / CHUNK_SIZE);
    const cy = Math.floor(at.y / CHUNK_SIZE);
    let best: ChestLocation | null = null;
    let bd = Infinity;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        for (const c of chestLocations(generateChunk(this.seed, cx + dx, cy + dy))) {
          if (this.done.has(c.id)) continue;
          const d = Math.hypot(c.x - at.x, c.y - at.y);
          if (d < bd) {
            bd = d;
            best = c;
          }
        }
    return best;
  }
}
