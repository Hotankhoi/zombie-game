import { GROUND } from '../data/ground';
import { ITEMS, RARITIES } from '../data/items';
import type { GroundItemWire, LootStackWire } from '../types/loot';
export function isGroundItems(value: unknown): value is readonly GroundItemWire[] {
  if (!Array.isArray(value) || value.length > GROUND.max) return false;
  const ids = new Set<string>();
  return value.every((d) => {
    if (
      !d ||
      typeof d.id !== 'string' ||
      !/^d[1-9][0-9]{0,15}$/.test(d.id) ||
      ids.has(d.id) ||
      !Number.isFinite(d.x) ||
      !Number.isFinite(d.y) ||
      Math.abs(d.x) > 1e8 ||
      Math.abs(d.y) > 1e8 ||
      !Number.isSafeInteger(d.t) ||
      d.t < 0
    )
      return false;
    ids.add(d.id);
    const s = d.stack;
    return (
      !!s &&
      Object.hasOwn(ITEMS, s.itemId) &&
      Object.hasOwn(RARITIES, s.rarity) &&
      Number.isSafeInteger(s.quantity) &&
      s.quantity > 0 &&
      s.quantity <= ITEMS[s.itemId as keyof typeof ITEMS].maxStack
    );
  });
}

// ---- Tự dọn + gộp (A, giao thức 11). Thuần, tất định theo thứ tự danh sách (luôn tăng dần theo số id). ----

/** Làm tròn vị trí về lưới 1/GROUND.grid ô — mọi máy giữ đúng cùng số sau khi qua mạng. */
export const snapGround = (v: number): number => Math.round(v * GROUND.grid) / GROUND.grid;

const maxOf = (s: LootStackWire) => ITEMS[s.itemId as keyof typeof ITEMS].maxStack;
const sameKind = (a: LootStackWire, b: LootStackWire) => a.itemId === b.itemId && a.rarity === b.rarity;
const near = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y) <= GROUND.mergeRadius + 1e-9;

/**
 * Đặt `stack` xuống đất ở `at`: dồn vào các đống cùng loại + độ hiếm trong GROUND.mergeRadius (tới maxStack, `t` = tick),
 * phần còn lại thành đống mới id `newId`. null = cần đống mới mà đã đủ GROUND.max đống (không đổi gì).
 */
export function placeGround(
  drops: readonly GroundItemWire[],
  stack: LootStackWire,
  at: { x: number; y: number },
  tick: number,
  newId: string,
): GroundItemWire[] | null {
  const p = { x: snapGround(at.x), y: snapGround(at.y) };
  const out = drops.map((d) => ({ ...d }));
  let left = stack.quantity;
  for (let i = 0; i < out.length && left > 0; i++) {
    const d = out[i]!;
    if (!sameKind(d.stack, stack) || !near(d, p)) continue;
    const add = Math.min(left, maxOf(d.stack) - d.stack.quantity);
    if (add <= 0) continue;
    out[i] = { ...d, t: Math.max(d.t, tick), stack: { ...d.stack, quantity: d.stack.quantity + add } };
    left -= add;
  }
  if (left === 0) return out;
  if (out.length >= GROUND.max) return null;
  out.push({ id: newId, x: p.x, y: p.y, t: tick, stack: { ...stack, quantity: left } });
  return out;
}

/**
 * Dọn định kỳ: bỏ đống đã nằm ≥ GROUND.expireTicks, rồi gộp các đống cùng loại + độ hiếm còn nằm gần nhau (đống id nhỏ
 * hơn nhận, `t` lấy mới hơn). Trả về null nếu không có gì đổi.
 */
export function sweepGround(
  drops: readonly GroundItemWire[],
  tick: number,
  expireTicks: number = GROUND.expireTicks,
): GroundItemWire[] | null {
  let changed = false;
  const out = drops.filter((d) => tick - d.t < expireTicks).map((d) => ({ ...d }));
  if (out.length !== drops.length) changed = true;
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i]!,
        b = out[j]!;
      if (!sameKind(a.stack, b.stack) || !near(a, b)) continue;
      const add = Math.min(b.stack.quantity, maxOf(a.stack) - a.stack.quantity);
      if (add <= 0) continue;
      changed = true;
      out[i] = { ...a, t: Math.max(a.t, b.t), stack: { ...a.stack, quantity: a.stack.quantity + add } };
      if (add === b.stack.quantity) out.splice(j--, 1);
      else out[j] = { ...b, stack: { ...b.stack, quantity: b.stack.quantity - add } };
    }
  }
  return changed ? out : null;
}
