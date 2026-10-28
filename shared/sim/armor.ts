import { ARMOR, ARMOR_RULES, RARITY_ARMOR, type ArmorSlot } from '@shared/data/armor';
import type { ItemId, Rarity } from '@shared/data/items';
import type { PlayerState } from './player';

/**
 * Giáp (GĐ 3b): mũ/áo/quần đang mặc giảm sát thương nhận vào và nhiễm trùng khi bị cắn. Món nào đỡ đòn thì mòn theo
 * lượng sát thương nó đỡ (axit mòn nhanh hơn); hết bền thì vỡ (SimWorld báo `armorBreaks` để host trừ món khỏi túi).
 * Mã trên dây: 0 = không mặc, 1..5 = độ hiếm (thường..huyền thoại) — chỗ mặc cố định món (đầu = mũ…).
 */
export const ARMOR_SLOTS: readonly ArmorSlot[] = ['head', 'body', 'legs'];
export const SLOT_ITEM: Record<ArmorSlot, ItemId> = { head: 'helmet', body: 'vest', legs: 'pants' };
const RARITY_ORDER: readonly Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

type CodeKey = 'armorHead' | 'armorBody' | 'armorLegs';
type DurKey = 'durHead' | 'durBody' | 'durLegs';
const CODE: Record<ArmorSlot, CodeKey> = { head: 'armorHead', body: 'armorBody', legs: 'armorLegs' };
const DUR: Record<ArmorSlot, DurKey> = { head: 'durHead', body: 'durBody', legs: 'durLegs' };

/** Độ hiếm của món đang mặc ở chỗ này; null = không mặc. */
export function armorAt(p: PlayerState, slot: ArmorSlot): Rarity | null {
  const c = p[CODE[slot]];
  return c > 0 ? (RARITY_ORDER[c - 1] ?? null) : null;
}
export function durabilityAt(p: PlayerState, slot: ArmorSlot): number {
  return p[DUR[slot]];
}

export function isArmor(itemId: string): boolean {
  return ARMOR[itemId as ItemId] !== undefined;
}

/**
 * Mặc món giáp (host đã kiểm tra có trong túi). Độ bền thuộc CHỖ mặc: chỗ đang trống (hoặc vừa vỡ) thì món mới đủ bền;
 * thay món khác vào chỗ đang mặc thì giữ độ bền đang có (không "hồi bền" bằng cách thay qua lại).
 */
export function wearArmor(p: PlayerState, itemId: ItemId, rarity: Rarity): boolean {
  const def = ARMOR[itemId];
  if (!def) return false;
  const slot = def.slot;
  if (p[DUR[slot]] <= 0) p[DUR[slot]] = ARMOR_RULES.durability;
  p[CODE[slot]] = RARITY_ORDER.indexOf(rarity) + 1;
  return true;
}

function pieceReduction(slot: ArmorSlot, rarity: Rarity): number {
  return (ARMOR[SLOT_ITEM[slot]]?.reduction ?? 0) * RARITY_ARMOR[rarity];
}

/** Tổng mức giảm sát thương của bộ đang mặc (0..maxReduction). */
export function armorReduction(p: PlayerState): number {
  let r = 0;
  for (const s of ARMOR_SLOTS) {
    const rarity = armorAt(p, s);
    if (rarity && p[DUR[s]] > 0) r += pieceReduction(s, rarity);
  }
  return Math.min(ARMOR_RULES.maxReduction, r);
}

/**
 * Nhận `damage` qua giáp: trả về sát thương còn lại; các món đỡ đòn mòn theo phần mình đỡ (axit × acidWear). Món hết
 * bền → tháo ra, trả về trong `broken` (SimWorld chuyển cho host trừ khỏi túi).
 */
export function absorb(
  p: PlayerState,
  damage: number,
  acid = false,
): { damage: number; broken: { item: ItemId; rarity: Rarity }[] } {
  const broken: { item: ItemId; rarity: Rarity }[] = [];
  const total = armorReduction(p);
  if (total <= 0 || damage <= 0) return { damage, broken };
  const blocked = damage * total;
  let raw = 0;
  for (const s of ARMOR_SLOTS) {
    const rarity = armorAt(p, s);
    if (rarity && p[DUR[s]] > 0) raw += pieceReduction(s, rarity);
  }
  for (const s of ARMOR_SLOTS) {
    const rarity = armorAt(p, s);
    if (!rarity || p[DUR[s]] <= 0) continue;
    const share = pieceReduction(s, rarity) / raw;
    p[DUR[s]] = Math.max(0, p[DUR[s]] - blocked * share * (acid ? ARMOR_RULES.acidWear : 1));
    if (p[DUR[s]] === 0) {
      broken.push({ item: SLOT_ITEM[s], rarity });
      p[CODE[s]] = 0;
    }
  }
  return { damage: damage - blocked, broken };
}

/** Hệ số nhiễm trùng khi bị cắn (1 = không giáp). */
export function infectionFactor(p: PlayerState): number {
  return 1 - ARMOR_RULES.infectionFactor * armorReduction(p);
}
