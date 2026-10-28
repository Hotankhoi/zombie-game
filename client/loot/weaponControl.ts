import type { ClientLoot } from '@net/clientLoot';
import { GUNS } from '@shared/data/guns';
import { ITEMS, RARITIES, type ItemId, type Rarity } from '@shared/data/items';
import type { InventoryState } from '@shared/inventory/inventory';
import { isGun, magOf, reloading, type WeaponId } from '@shared/sim/guns';
import { isUp, type PlayerState } from '@shared/sim/player';
import { ARMOR_SLOTS, SLOT_ITEM, armorAt, durabilityAt } from '@shared/sim/armor';
import type { ArmorSlot } from '@shared/data/armor';
import { lootErrorText } from './lootMessages';
import { countOf } from './quickUse';

/** Thứ tự xoay vòng khi đổi vũ khí (X / lăn chuột): dao → gậy → súng lục → súng trường. */
export const WEAPON_ORDER: readonly WeaponId[] = ['knife', 'bat', 'pistol', 'rifle'];

/** Vũ khí có trong túi (mỗi loại lấy món độ hiếm cao nhất), theo WEAPON_ORDER. */
export function ownedWeapons(inv: InventoryState | null): { itemId: WeaponId; rarity: Rarity }[] {
  const best = new Map<WeaponId, Rarity>();
  for (const s of inv?.slots ?? []) {
    if (!s || !(WEAPON_ORDER as readonly string[]).includes(s.itemId)) continue;
    const id = s.itemId as WeaponId;
    const cur = best.get(id);
    if (!cur || RARITIES[s.rarity].rank > RARITIES[cur].rank) best.set(id, s.rarity);
  }
  return WEAPON_ORDER.filter((w) => best.has(w)).map((w) => ({ itemId: w, rarity: best.get(w)! }));
}

/** Vũ khí kế tiếp (dir = 1 tới, −1 lùi) sau vũ khí đang cầm; null = không có gì khác để đổi. */
export function nextWeapon(
  inv: InventoryState | null,
  current: WeaponId,
  currentRarity: Rarity,
  dir: 1 | -1 = 1,
): { itemId: WeaponId; rarity: Rarity } | null {
  const list = ownedWeapons(inv);
  if (list.length === 0) return null;
  const at = list.findIndex((w) => w.itemId === current);
  if (at < 0) return list[0]!;
  const next = list[(at + dir + list.length) % list.length]!;
  return next.itemId === current && next.rarity === currentRarity ? null : next;
}

/** Chữ HUD cho giáp đang mặc: "Mũ Hiếm 85% · Áo — · Quần Thường 40%". */
export function armorLabel(me: PlayerState): string {
  const names: Record<ArmorSlot, string> = { head: 'Mũ', body: 'Áo', legs: 'Quần' };
  return ARMOR_SLOTS.map((s) => {
    const r = armorAt(me, s);
    return r ? `${names[s]} ${RARITIES[r].name} ${Math.ceil(durabilityAt(me, s))}%` : `${names[s]} —`;
  }).join(' · ');
}

/** Giáp vừa vỡ (so trạng thái trước/sau): tên các món. */
export function brokenArmor(before: PlayerState | null, after: PlayerState): string[] {
  if (!before) return [];
  return ARMOR_SLOTS.filter(
    (s) => armorAt(before, s) && !armorAt(after, s) && durabilityAt(after, s) <= 0,
  ).map((s) => ITEMS[SLOT_ITEM[s]].name);
}

/** Chữ HUD cho vũ khí đang cầm: "Súng lục (Tốt) 8/12 · túi 24". */
export function weaponLabel(me: PlayerState, inv: InventoryState | null): string {
  const w = me.weapon;
  const name = w === 'fists' ? 'Tay không' : ITEMS[w as ItemId].name;
  const rarity = me.weaponRarity === 'common' ? '' : ` (${RARITIES[me.weaponRarity].name})`;
  if (!isGun(w)) return `${name}${rarity}`;
  const gun = GUNS[w];
  const state = reloading(me, w) ? ' · đang nạp…' : magOf(me, w) === 0 ? ' · HẾT ĐẠN (Q nạp)' : '';
  return `${name}${rarity} ${magOf(me, w)}/${gun.magazine} · túi ${countOf(inv, gun.ammo)}${state}`;
}

/**
 * Đổi vũ khí / nạp đạn phía máy khách (GĐ 3b) → intent `equip` / `reload` cho host. Bấm bắn khi hết đạn → tự nạp
 * (nếu túi còn đạn).
 */
export class WeaponControl {
  private lastAutoReload = -Infinity;
  private pending = false;

  constructor(
    private loot: ClientLoot,
    private toast: (text: string, error?: boolean) => void,
  ) {}

  /** X / lăn chuột. */
  cycle(me: PlayerState | null, dir: 1 | -1 = 1): void {
    if (!me || this.pending) return;
    const next = nextWeapon(this.loot.inventory, me.weapon, me.weaponRarity, dir);
    if (!next) {
      this.toast('Không có vũ khí khác trong túi.', true);
      return;
    }
    void this.equip(next.itemId, next.rarity);
  }

  /** Nút "Cầm" ở panel túi. */
  async equip(itemId: string, rarity: Rarity): Promise<void> {
    this.pending = true;
    const out = await this.loot.equip(itemId, rarity);
    this.pending = false;
    const verb = ITEMS[itemId as ItemId].category === 'armor' ? 'Mặc' : 'Cầm';
    if (!out.ok) this.toast(lootErrorText(out.error), true);
    else this.toast(`${verb} ${ITEMS[itemId as ItemId].name.toLowerCase()}`);
  }

  /** Q. */
  reload(me: PlayerState | null, quiet = false): void {
    if (!me || !isUp(me)) return;
    if (!isGun(me.weapon)) {
      if (!quiet) this.toast(lootErrorText('no_gun'), true);
      return;
    }
    if (reloading(me, me.weapon)) return;
    if (countOf(this.loot.inventory, GUNS[me.weapon].ammo) === 0) {
      if (!quiet) this.toast(lootErrorText('no_ammo'), true);
      return;
    }
    void this.loot.reload().then((out) => {
      if (!out.ok && !quiet) this.toast(lootErrorText(out.error), true);
    });
  }

  /** Gọi mỗi tick khi đang giữ chuột bắn: súng hết đạn → tự nạp (tối đa 1 lần/giây). */
  onFire(me: PlayerState | null, now: number): void {
    if (!me || !isGun(me.weapon) || magOf(me, me.weapon) > 0 || reloading(me, me.weapon)) return;
    if (now - this.lastAutoReload < 1000 || this.loot.busy) return;
    this.lastAutoReload = now;
    this.reload(me, true);
  }
}
