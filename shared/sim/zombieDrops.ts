import type { ItemId, Rarity } from '@shared/data/items';
import { BOSS_AMMO, ZOMBIE_DROPS, type DropEntry, type DropTable } from '@shared/data/zombieDrops';
import { Rng, hashString } from '@shared/util/rng';
import type { ZombieKind } from './tuning/zombieKinds';

export interface DropStack {
  itemId: ItemId;
  rarity: Rarity;
  quantity: number;
}

/** Zombie vừa chết rơi đồ (SimWorld.zombieDrops) — host đặt xuống đất. */
export interface ZombieDrop {
  x: number;
  y: number;
  items: DropStack[];
}

export function dropTableOf(z: { kind: ZombieKind; turnedFrom?: string | null }): DropTable {
  if (z.kind === 'boss') return ZOMBIE_DROPS.boss;
  return z.turnedFrom ? ZOMBIE_DROPS.turned : ZOMBIE_DROPS.normal;
}

function weighted<T>(rng: Rng, list: readonly T[], weight: (t: T) => number): T {
  const total = list.reduce((n, t) => n + weight(t), 0);
  let roll = rng.next() * total;
  for (const t of list) {
    roll -= weight(t);
    if (roll < 0) return t;
  }
  return list[list.length - 1]!;
}

function stackOf(rng: Rng, e: DropEntry, rarity: Rarity): DropStack {
  return { itemId: e.item, rarity, quantity: rng.int(e.qty[0], e.qty[1]) };
}

/**
 * Đồ rơi khi zombie `id` chết ở `tick` (tất định: Rng của mô phỏng gieo từ id + tick → không xáo dãy RNG chính, đổi
 * host không cần thêm trạng thái). Ban đêm dùng tỉ lệ đêm. Boss luôn rơi 1 món hiếm+ và 1 đống đạn.
 */
export function rollZombieDrop(
  z: { id: number; kind: ZombieKind; turnedFrom?: string | null },
  tick: number,
  night: boolean,
  /** CHỈ bản dev (`?roido=`): nhân tỉ lệ rơi để thử nhanh. */
  chanceScale = 1,
): DropStack[] {
  const rng = new Rng(hashString(`zombie-drop:${z.id}:${tick}`));
  const table = dropTableOf(z);
  if (!rng.chance((night ? table.chance.night : table.chance.day) * chanceScale)) return [];
  const rarities = Object.entries(table.rarity) as [Rarity, number][];
  const out: DropStack[] = [];
  for (let i = 0; i < table.rolls; i++) {
    const e = weighted(rng, table.items, (x) => x.weight);
    out.push(stackOf(rng, e, weighted(rng, rarities, (r) => r[1])[0]));
  }
  if (z.kind === 'boss')
    out.push(
      stackOf(
        rng,
        weighted(rng, BOSS_AMMO, (x) => x.weight),
        'common',
      ),
    );
  return out;
}
