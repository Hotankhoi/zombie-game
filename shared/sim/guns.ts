import { GUNS, RARITY_DAMAGE, type GunId } from '@shared/data/guns';
import type { Rarity } from '@shared/data/items';
import { BAT, FISTS, KNIFE, type MeleeWeapon } from '@shared/data/melee';
import type { BlockedFn } from './collision';
import type { PlayerState } from './player';
import { countdown } from './timer';
import { radiusOf, startChase, type ZombieState } from './zombie';

/**
 * Vũ khí đang cầm (GĐ 3b): cận chiến (tay không, dao, gậy) và súng (súng lục, súng trường). Thứ tự cố định — mã trên
 * dây = chỉ số, chỉ thêm vào cuối.
 */
export const WEAPON_IDS = ['fists', 'knife', 'bat', 'pistol', 'rifle'] as const;
export type WeaponId = (typeof WEAPON_IDS)[number];
const RARITY_ORDER: readonly Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

export function isGun(w: WeaponId): w is GunId {
  return w === 'pistol' || w === 'rifle';
}

export function isWeaponId(id: string): id is WeaponId {
  return (WEAPON_IDS as readonly string[]).includes(id);
}

/** Vũ khí cận chiến của món đang cầm (súng → không có), sát thương nhân theo độ hiếm. */
export function meleeOf(w: WeaponId, rarity: Rarity): MeleeWeapon {
  const base = w === 'knife' ? KNIFE : w === 'bat' ? BAT : FISTS;
  return rarity === 'common' ? base : { ...base, damage: base.damage * RARITY_DAMAGE[rarity] };
}

/** 1 byte: chỉ số vũ khí (3 bit thấp) + độ hiếm (bit 3–5). */
export function weaponCode(w: WeaponId, rarity: Rarity): number {
  return Math.max(0, WEAPON_IDS.indexOf(w)) | (Math.max(0, RARITY_ORDER.indexOf(rarity)) << 3);
}
export function decodeWeapon(code: number): { weapon: WeaponId; rarity: Rarity } {
  return { weapon: WEAPON_IDS[code & 7] ?? 'knife', rarity: RARITY_ORDER[(code >> 3) & 7] ?? 'common' };
}

/** Mã súng trong `reloadGun` (0 = không nạp). */
export const GUN_CODE: Record<GunId, number> = { pistol: 1, rifle: 2 };
const GUN_OF_CODE: Record<number, GunId> = { 1: 'pistol', 2: 'rifle' };

export function magOf(p: PlayerState, gun: GunId): number {
  return gun === 'pistol' ? p.magPistol : p.magRifle;
}
function addMag(p: PlayerState, gun: GunId, n: number): void {
  const cap = GUNS[gun].magazine;
  if (gun === 'pistol') p.magPistol = Math.min(cap, p.magPistol + n);
  else p.magRifle = Math.min(cap, p.magRifle + n);
}

/** Đang nạp đạn cho súng này. */
export function reloading(p: PlayerState, gun: GunId): boolean {
  return p.reloadLeft > 0 && p.reloadGun === GUN_CODE[gun];
}

/** Bắt đầu nạp `amount` viên (đạn đã trừ khỏi túi); hết `reloadSec` thì vào băng. */
export function startReload(p: PlayerState, gun: GunId, amount: number): void {
  p.reloadGun = GUN_CODE[gun];
  p.reloadLeft = GUNS[gun].reloadSec;
  p.reloadAmount = amount;
}

/** Mỗi tick (theo input, như stamina): hồi độ giật, đếm giờ nạp đạn. */
export function stepGun(p: PlayerState, dt: number): void {
  if (p.recoil > 0) {
    const gun = isGun(p.weapon) ? GUNS[p.weapon] : GUNS.pistol;
    p.recoil = Math.max(0, p.recoil - gun.recoilRecoverDegPerSec * dt);
  }
  if (p.reloadLeft > 0) {
    p.reloadLeft = countdown(p.reloadLeft, dt);
    if (p.reloadLeft === 0) {
      const gun = GUN_OF_CODE[p.reloadGun];
      if (gun) addMag(p, gun, p.reloadAmount);
      p.reloadGun = 0;
      p.reloadAmount = 0;
    }
  }
}

/** Lệch tản tất định trong [-1, 1] theo người bắn + số thứ tự phát (máy khách tính ra đúng hướng tia như host). */
export function spreadUnit(id: string, shots: number): number {
  let h = 2166136261;
  const s = `${id}#${shots}`;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

const RAY_STEP = 0.05;
/** Khoảng cách (ô) từ (x, y) theo hướng `angle` tới ô chặn đầu tiên, tối đa `range`. */
export function rayToWall(x: number, y: number, angle: number, range: number, blocked: BlockedFn): number {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let lastTx = Math.floor(x);
  let lastTy = Math.floor(y);
  for (let t = RAY_STEP; t <= range; t += RAY_STEP) {
    const tx = Math.floor(x + dx * t);
    const ty = Math.floor(y + dy * t);
    if (tx === lastTx && ty === lastTy) continue;
    lastTx = tx;
    lastTy = ty;
    if (blocked(tx, ty)) return Math.max(0, t - RAY_STEP);
  }
  return range;
}

export interface ShotHit {
  zombie: ZombieState;
  killed: boolean;
}
export interface Shot {
  x: number;
  y: number;
  angle: number;
  /** Tia dài bao nhiêu ô (tới tường, tới con cuối bị trúng, hoặc hết tầm). */
  dist: number;
  hits: ShotHit[];
}

/**
 * Bắn 1 phát nếu được (hồi chiêu xong, không đang nạp súng này, còn đạn; súng bán tự động cần vừa bấm). Trúng do mô
 * phỏng quyết (tất định): tia theo hướng ngắm + tản, dừng ở tường/cửa đóng, trúng zombie đầu tiên (+ `pierce`).
 * `at(z)` = vị trí zombie dùng để trúng (host lùi về lúc người bắn nhìn thấy — bù trễ); dự đoán phía máy khách truyền
 * danh sách zombie rỗng (chỉ đoán đạn/hồi chiêu/giật). Trả về null nếu không bắn.
 */
export function fireGun(
  p: PlayerState,
  gunId: GunId,
  rarity: Rarity,
  zombies: readonly ZombieState[],
  blocked: BlockedFn,
  pressed: boolean,
  at: (z: ZombieState) => { x: number; y: number } = (z) => z,
): Shot | null {
  const gun = GUNS[gunId];
  if (p.attackCd > 0 || (!gun.automatic && !pressed) || reloading(p, gunId) || magOf(p, gunId) <= 0)
    return null;
  addMag(p, gunId, -1);
  p.attackCd = 1 / gun.fireRate;
  const spread = ((gun.spreadDeg + p.recoil) * Math.PI) / 180;
  const angle = p.facing + spreadUnit(p.id, p.shots) * spread;
  p.shots = (p.shots + 1) & 63;
  p.recoil = Math.min(gun.recoilMaxDeg, p.recoil + gun.recoilDeg);
  const wall = rayToWall(p.x, p.y, angle, gun.range, blocked);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const cands: { z: ZombieState; t: number }[] = [];
  for (const z of zombies) {
    if (z.hp <= 0) continue;
    const pos = at(z);
    const rx = pos.x - p.x;
    const ry = pos.y - p.y;
    const along = rx * cos + ry * sin;
    if (along < 0) continue;
    const off = Math.abs(rx * sin - ry * cos);
    const r = radiusOf(z);
    if (off > r) continue;
    const t = along - Math.sqrt(r * r - off * off);
    if (t <= wall) cands.push({ z, t: Math.max(0, t) });
  }
  cands.sort((a, b) => a.t - b.t || a.z.id - b.z.id);
  const hits: ShotHit[] = [];
  const damage = gun.damage * RARITY_DAMAGE[rarity];
  let dist = wall;
  for (const { z, t } of cands.slice(0, 1 + gun.pierce)) {
    z.hp = Math.max(0, z.hp - damage);
    startChase(z, p.id);
    hits.push({ zombie: z, killed: z.hp === 0 });
    dist = t;
  }
  if (hits.length > 0 && hits.length <= gun.pierce) dist = wall; // xuyên hết mà còn đà → bay tiếp tới tường
  return { x: p.x, y: p.y, angle, dist, hits };
}
