import type { GroundItemWire } from '@shared/types/loot';
import { isGroundItems } from '@shared/loot/ground';
import { GROUND } from '@shared/data/ground';
import { BACKPACKS, ITEMS, RARITIES } from '@shared/data/items';
import { LOOT_REGIONS } from '@shared/data/loot';
import { LOOT_INTERACTION } from '@shared/data/lootInteraction';
import { isInventoryState } from '@shared/inventory/inventory';
import { isLootSave } from '@shared/loot/authority';
import { CHEST_SLOTS, LOOT_VERSION, isChestState } from '@shared/loot/chest';
import { findChest } from '@shared/mapgen/chests';
import { MAP_VERSION, MAX_CHUNK } from '@shared/mapgen/world';
import {
  LootMessage,
  type ChestWire,
  type InventoryWire,
  type LootAck,
  type LootAction,
  type LootPacket,
  type LootReplica,
  type LootReplicaWire,
  type LootReply,
  type LootRequest,
  type LootStackWire,
} from '@shared/types/loot';
import { Reader, Writer } from './gameCodec';

/**
 * Codec gói loot 110–113 (hợp đồng `shared/types/loot.ts`, kênh reliable). Nhị phân gọn:
 * - vật phẩm / độ hiếm / balo / khu = SỐ THỨ TỰ trong danh mục `shared/data` → giải mã lấy tên từ danh mục, không bao giờ
 *   đọc chuỗi tên từ gói (số lạ → bỏ cả gói); số lượng 1..maxStack của món đó; số ô = sức chứa balo / 6 ô rương;
 * - ID rương ghi gọn (chunk + ô nhà, ~5 byte thay vì ~20) và dựng lại đúng dạng chuẩn `v1:cx,cy:bx,by:chest:0`;
 * - Replica có 2 dạng: đầy đủ (`LootReplicaWire`) và PHẦN ĐỔI (`LootPatch`: chỉ túi/rương vừa đổi so với revision
 *   `baseRevision`) — bên nhận ghép bằng `applyLootPatch` thành bản đầy đủ rồi mới kiểm tra (`isValidReplica`) và ACK.
 * Giải mã không bao giờ ném lỗi: gói hỏng/lạ/thừa byte → null. Mã hóa dữ liệu sai (lỗi lập trình) → ném RangeError.
 */

/**
 * Thứ tự danh mục trên dây. ĐỔI/THÊM món giữa chừng làm lệch số → phải tăng PROTOCOL_VERSION (test ghim thứ tự này).
 * Món mới thêm vào CUỐI `ITEMS`.
 */
export const ITEM_CODES = Object.keys(ITEMS) as (keyof typeof ITEMS)[];
export const RARITY_CODES = Object.keys(RARITIES) as LootStackWire['rarity'][];
export const BACKPACK_CODES = Object.keys(BACKPACKS) as InventoryWire['backpack'][];
export const REGION_CODES = Object.keys(LOOT_REGIONS) as ChestWire['region'][];

/** Mã lỗi gửi trong Reply (số thứ tự). Chuỗi không có trong danh sách → 'internal_error'. Thêm mã mới vào CUỐI. */
export const LOOT_ERRORS = [
  'internal_error',
  // túi đồ (shared/inventory)
  'invalid_state',
  'invalid_command',
  'stale_revision',
  'invalid_item',
  'invalid_quantity',
  'invalid_slot',
  'empty_slot',
  'same_slot',
  'stack_full',
  'partial_swap',
  'inventory_full',
  'invalid_backpack',
  // rương (shared/loot/chest)
  'invalid_chest',
  'wrong_chest',
  'chest_closed',
  'empty_chest',
  // authority (shared/loot/authority)
  'unknown_player',
  'player_not_up',
  'unknown_chest',
  'out_of_reach',
  'blocked',
  'state_limit',
  // host (host/hostLoot.ts)
  'not_in_match',
  'rate_limited',
  'recovering',
  'inventory_limit',
  'key_in_use',
  'invalid_key',
  // dùng đồ (GĐ 3b, shared/sim/items.ts) — chỉ thêm vào cuối
  'not_usable',
  'not_still',
  'no_target',
  'not_needed',
  // vũ khí (GĐ 3b, PR vũ khí)
  'not_equippable',
  'not_owned',
  'no_gun',
  'mag_full',
  'no_ammo',
  'reloading',
] as const;
export type LootErrorCode = (typeof LOOT_ERRORS)[number];

/** Gói lớn nhất chấp nhận (replica đầy đủ 4096 rương ~ 60 KB). */
export const MAX_LOOT_PACKET = 256 * 1024;
/** requestId / term: 1..MAX_TOKEN ký tự ASCII an toàn. */
export const MAX_TOKEN = 40;
const TOKEN = /^[A-Za-z0-9._:-]+$/;
const MAX_SEED = 256;
const MAX_INVENTORY_ID = 255;
const MAX_QUANTITY = Math.max(...Object.values(ITEMS).map((i) => i.maxStack));
const MAX_BACKPACK = Math.max(...Object.values(BACKPACKS).map((b) => b.capacity));
/** Thứ tự cố định (mã = chỉ số) — chỉ thêm vào cuối. use/reload/equip: GĐ 3b. */
const ACTIONS = [
  'inventory',
  'view',
  'open',
  'take',
  'takeAll',
  'move',
  'sort',
  'claim',
  'use',
  'reload',
  'equip',
  'unequip',
  'drop',
  'pickup',
] as const;
const FULL = 0;
const PATCH = 1;

/** Phần đổi của replica so với bản đầy đủ có `revision === baseRevision` (cùng term). */
export interface LootPatch {
  /**
   * Giao thức 11: CHỈ đồ trên đất vừa thêm/đổi (gộp thêm, số lượng) — thay theo id — và id đồ vừa mất (nhặt hết, hết
   * hạn, bị gộp vào đống khác). Trước đây mỗi phần đổi mang lại cả danh sách (128 đống ≈ 4 KB mỗi lần).
   */
  readonly dropsSet?: readonly GroundItemWire[];
  readonly dropsRemoved?: readonly string[];
  readonly baseRevision: number;
  readonly revision: number;
  /** Túi/rương thay thế nguyên khối (thêm mới nếu chưa có). Không bao giờ xóa. */
  readonly inventories: readonly { id: string; state: InventoryWire }[];
  readonly chests: readonly ChestWire[];
}
export interface LootReplicaPatch {
  readonly type: typeof LootMessage.Replica;
  readonly term: string;
  readonly patch: LootPatch;
}
export type LootWirePacket = LootPacket | LootReplicaPatch;

export function isLootPacket(data: Uint8Array): boolean {
  return data.length > 0 && data[0]! >= LootMessage.Request && data[0]! <= LootMessage.Ack;
}

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

// ---------- số nguyên ----------

function writeVarint(w: Writer, v: number): void {
  if (!Number.isSafeInteger(v) || v < 0) throw new RangeError(`varint: ${v}`);
  while (v >= 0x80) {
    w.u8((v % 128) | 0x80);
    v = Math.floor(v / 128);
  }
  w.u8(v);
}
function readVarint(r: Reader): number {
  let v = 0;
  for (let mul = 1, i = 0; i < 8; i++, mul *= 128) {
    const b = r.u8();
    v += (b & 0x7f) * mul;
    if (b < 0x80) {
      if (!Number.isSafeInteger(v)) throw new RangeError('varint lớn');
      return v;
    }
  }
  throw new RangeError('varint dài');
}
/** Revision hợp lệ: như kiểm tra của B (< MAX_SAFE_INTEGER). */
function readRevision(r: Reader): number {
  const v = readVarint(r);
  if (v >= Number.MAX_SAFE_INTEGER) throw new RangeError('revision');
  return v;
}
const zigzag = (n: number) => (n < 0 ? -n * 2 - 1 : n * 2);
const unzigzag = (n: number) => (n % 2 === 1 ? -(n + 1) / 2 : n / 2);

// ---------- chuỗi ----------

function writeToken(w: Writer, s: string): void {
  if (!isToken(s)) throw new RangeError(`token: ${s}`);
  w.u8(s.length);
  w.bytes(enc.encode(s));
}
function readToken(r: Reader): string {
  const n = r.u8();
  const s = String.fromCharCode(...r.bytes(n));
  if (!isToken(s)) throw new RangeError('token');
  return s;
}
export function isToken(s: unknown): s is string {
  return typeof s === 'string' && s.length > 0 && s.length <= MAX_TOKEN && TOKEN.test(s);
}
function writeText(w: Writer, s: string, max: number, wide: boolean): void {
  const b = enc.encode(s);
  if (!s.trim() || b.length > max) throw new RangeError('chuỗi');
  if (wide) w.u16(b.length);
  else w.u8(b.length);
  w.bytes(b);
}
function readText(r: Reader, max: number, wide: boolean): string {
  const n = wide ? r.u16() : r.u8();
  if (n > max) throw new RangeError('chuỗi dài');
  const s = dec.decode(r.bytes(n)); // UTF-8 hỏng → ném
  if (!s.trim()) throw new RangeError('chuỗi rỗng');
  return s;
}

// ---------- danh mục ----------

function code<T>(list: readonly T[], v: T): number {
  const i = list.indexOf(v);
  if (i < 0) throw new RangeError(`không có trong danh mục: ${String(v)}`);
  return i;
}
function lookup<T>(list: readonly T[], i: number): T {
  if (i >= list.length) throw new RangeError('số danh mục lạ');
  return list[i] as T;
}

// ---------- ID rương ----------

const CHEST_ID = /^v(\d+):(-?\d+),(-?\d+):([01]),([01]):chest:0$/;

/** ID rương dạng chuẩn (như `chestLocations` sinh) → ghi gọn được. Dạng khác (vd "v1:00,0:…") → null. */
export function parseChestId(id: unknown): { cx: number; cy: number; bx: number; by: number } | null {
  if (typeof id !== 'string' || id.length > 128) return null;
  const m = CHEST_ID.exec(id);
  if (!m || Number(m[1]) !== MAP_VERSION) return null;
  const cx = Number(m[2]);
  const cy = Number(m[3]);
  if (String(cx) !== m[2] || String(cy) !== m[3] || Math.abs(cx) > MAX_CHUNK || Math.abs(cy) > MAX_CHUNK)
    return null;
  return { cx, cy, bx: Number(m[4]), by: Number(m[5]) };
}
function writeChestId(w: Writer, id: string): void {
  const p = parseChestId(id);
  if (!p) throw new RangeError(`ID rương: ${id}`);
  writeVarint(w, zigzag(p.cx));
  writeVarint(w, zigzag(p.cy));
  w.u8(p.bx | (p.by << 1));
}
function readChestId(r: Reader): string {
  const cx = unzigzag(readVarint(r));
  const cy = unzigzag(readVarint(r));
  const b = r.u8();
  if (Math.abs(cx) > MAX_CHUNK || Math.abs(cy) > MAX_CHUNK || b > 3) throw new RangeError('ID rương');
  return `v${MAP_VERSION}:${cx},${cy}:${b & 1},${b >> 1}:chest:0`;
}

// ---------- ô đồ ----------

function writeSlots(w: Writer, slots: readonly (LootStackWire | null)[]): void {
  const mask = new Uint8Array(Math.ceil(slots.length / 8));
  slots.forEach((s, i) => {
    if (s) mask[i >> 3]! |= 1 << (i & 7);
  });
  w.bytes(mask);
  for (const s of slots) {
    if (!s) continue;
    const item = code(ITEM_CODES, s.itemId as keyof typeof ITEMS);
    if (!Number.isSafeInteger(s.quantity) || s.quantity < 1 || s.quantity > ITEMS[ITEM_CODES[item]!].maxStack)
      throw new RangeError('số lượng');
    w.u8(item);
    w.u8(code(RARITY_CODES, s.rarity));
    writeVarint(w, s.quantity);
  }
}
function readSlots(r: Reader, count: number): (LootStackWire | null)[] {
  const mask = r.bytes(Math.ceil(count / 8));
  // bit thừa ngoài số ô → hỏng
  if (count % 8 !== 0 && mask[mask.length - 1]! >> (count % 8) !== 0) throw new RangeError('mặt nạ ô');
  const slots: (LootStackWire | null)[] = [];
  for (let i = 0; i < count; i++) {
    if (!(mask[i >> 3]! & (1 << (i & 7)))) {
      slots.push(null);
      continue;
    }
    const itemId = lookup(ITEM_CODES, r.u8());
    const rarity = lookup(RARITY_CODES, r.u8());
    const quantity = readVarint(r);
    if (quantity < 1 || quantity > ITEMS[itemId].maxStack) throw new RangeError('số lượng');
    slots.push({ itemId, rarity, quantity });
  }
  return slots;
}

function writeInventory(w: Writer, s: InventoryWire): void {
  const b = code(BACKPACK_CODES, s.backpack);
  if (s.slots.length !== BACKPACKS[s.backpack].capacity) throw new RangeError('số ô túi');
  w.u8(b);
  writeVarint(w, s.revision);
  writeSlots(w, s.slots);
}
function readInventory(r: Reader): InventoryWire {
  const backpack = lookup(BACKPACK_CODES, r.u8());
  const revision = readRevision(r);
  return { revision, backpack, slots: readSlots(r, BACKPACKS[backpack].capacity) };
}

function writeChest(w: Writer, c: ChestWire): void {
  if (c.version !== LOOT_VERSION || c.slots.length !== CHEST_SLOTS) throw new RangeError('rương');
  writeChestId(w, c.id);
  w.u8(code(REGION_CODES, c.region));
  writeVarint(w, c.revision);
  w.u8(c.opened ? 1 : 0);
  writeSlots(w, c.slots);
}
function readChest(r: Reader): ChestWire {
  const id = readChestId(r);
  const region = lookup(REGION_CODES, r.u8());
  const revision = readRevision(r);
  const flags = r.u8();
  if (flags > 1) throw new RangeError('cờ rương');
  return {
    version: LOOT_VERSION,
    id,
    region,
    revision,
    opened: flags === 1,
    slots: readSlots(r, CHEST_SLOTS),
  };
}

function writeInventoryId(w: Writer, id: string): void {
  if (id.length > MAX_INVENTORY_ID) throw new RangeError('ID túi');
  writeText(w, id, MAX_INVENTORY_ID, false);
}
function readInventoryId(r: Reader): string {
  const id = readText(r, MAX_INVENTORY_ID, false);
  if (id.length > MAX_INVENTORY_ID) throw new RangeError('ID túi');
  return id;
}

/** Túi + rương (dùng chung cho bản đầy đủ và phần đổi): giới hạn số lượng, không trùng ID. */
function writeEntries(
  w: Writer,
  inventories: readonly { id: string; state: InventoryWire }[],
  chests: readonly ChestWire[],
): void {
  if (inventories.length > LOOT_INTERACTION.maxInventories || chests.length > LOOT_INTERACTION.maxChests)
    throw new RangeError('quá nhiều túi/rương');
  w.u8(inventories.length);
  for (const e of inventories) {
    writeInventoryId(w, e.id);
    writeInventory(w, e.state);
  }
  writeVarint(w, chests.length);
  for (const c of chests) writeChest(w, c);
}

// ---------- đồ trên đất (giao thức 11: ~10–15 byte/đống) ----------

const dropNumber = (id: string): number => {
  const n = Number(id.slice(1));
  if (!/^d[1-9][0-9]{0,15}$/.test(id) || !Number.isSafeInteger(n)) throw new RangeError(`id đồ: ${id}`);
  return n;
};
const zig = (v: number) => (v < 0 ? -2 * v - 1 : 2 * v);
const unzig = (v: number) => (v % 2 === 1 ? -(v + 1) / 2 : v / 2);
function writeDropId(w: Writer, id: string): void {
  writeVarint(w, dropNumber(id));
}
function readDropId(r: Reader): string {
  const n = readVarint(r);
  if (n < 1) throw new RangeError('id đồ');
  return 'd' + n;
}
/** Vị trí theo lưới 1/GROUND.grid ô (host đã làm tròn khi tạo → không mất gì). */
function writeDrop(w: Writer, d: GroundItemWire): void {
  writeDropId(w, d.id);
  writeVarint(w, zig(Math.round(d.x * GROUND.grid)));
  writeVarint(w, zig(Math.round(d.y * GROUND.grid)));
  writeVarint(w, d.t);
  writeSlots(w, [d.stack]);
}
function readDrop(r: Reader): GroundItemWire {
  const id = readDropId(r),
    x = unzig(readVarint(r)) / GROUND.grid,
    y = unzig(readVarint(r)) / GROUND.grid,
    t = readVarint(r),
    stack = readSlots(r, 1)[0];
  if (!stack) throw new RangeError('empty drop');
  return { id, x, y, t, stack };
}
function writeDrops(w: Writer, drops: readonly GroundItemWire[]): void {
  if (!isGroundItems(drops)) throw new RangeError('ground items');
  w.u8(drops.length);
  for (const d of drops) writeDrop(w, d);
}
function readDrops(r: Reader): GroundItemWire[] {
  const count = r.u8();
  if (count > GROUND.max) throw new RangeError('ground count');
  const drops: GroundItemWire[] = [];
  for (let i = 0; i < count; i++) drops.push(readDrop(r));
  if (!isGroundItems(drops)) throw new RangeError('ground');
  return drops;
}
function writeDropIds(w: Writer, ids: readonly string[]): void {
  if (ids.length > GROUND.max) throw new RangeError('ground ids');
  w.u8(ids.length);
  for (const id of ids) writeDropId(w, id);
}
function readDropIds(r: Reader): string[] {
  const count = r.u8();
  if (count > GROUND.max) throw new RangeError('ground ids');
  const ids: string[] = [];
  for (let i = 0; i < count; i++) ids.push(readDropId(r));
  if (new Set(ids).size !== ids.length) throw new RangeError('trùng id đồ');
  return ids;
}
function readEntries(r: Reader) {
  const n = r.u8();
  if (n > LOOT_INTERACTION.maxInventories) throw new RangeError('quá nhiều túi');
  const inventories: { id: string; state: InventoryWire }[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < n; i++) {
    const id = readInventoryId(r);
    if (ids.has(id)) throw new RangeError('trùng ID túi');
    ids.add(id);
    inventories.push({ id, state: readInventory(r) });
  }
  const m = readVarint(r);
  if (m > LOOT_INTERACTION.maxChests) throw new RangeError('quá nhiều rương');
  const chests: ChestWire[] = [];
  const chestIds = new Set<string>();
  for (let i = 0; i < m; i++) {
    const c = readChest(r);
    if (chestIds.has(c.id)) throw new RangeError('trùng ID rương');
    chestIds.add(c.id);
    chests.push(c);
  }
  return { inventories, chests };
}

// ---------- hành động ----------

function writeQuantity(w: Writer, q: number): void {
  if (!Number.isSafeInteger(q) || q < 1 || q > MAX_QUANTITY) throw new RangeError('số lượng');
  writeVarint(w, q);
}
function writeAction(w: Writer, a: LootAction): void {
  w.u8(code(ACTIONS, a.type));
  switch (a.type) {
    case 'unequip':
    case 'inventory':
      return;
    case 'view':
      writeChestId(w, a.chestId);
      return;
    case 'open':
    case 'take':
    case 'takeAll':
      writeChestId(w, a.chestId);
      writeVarint(w, a.expectedChestRevision);
      writeVarint(w, a.expectedInventoryRevision);
      if (a.type === 'take') {
        if (!Number.isSafeInteger(a.slot) || a.slot < 0 || a.slot >= CHEST_SLOTS)
          throw new RangeError('ô rương');
        w.u8(a.slot);
        writeQuantity(w, a.quantity);
      }
      return;
    case 'move':
      writeVarint(w, a.expectedRevision);
      for (const s of [a.from, a.to])
        if (!Number.isSafeInteger(s) || s < 0 || s >= MAX_BACKPACK) throw new RangeError('ô túi');
      w.u8(a.from);
      w.u8(a.to);
      writeQuantity(w, a.quantity);
      return;
    case 'drop':
      writeVarint(w, a.expectedRevision);
      writeVarint(w, a.slot);
      writeQuantity(w, a.quantity);
      return;
    case 'pickup':
      writeVarint(w, a.expectedRevision);
      writeToken(w, a.dropId);
      return;
    case 'sort':
      writeVarint(w, a.expectedRevision);
      return;
    case 'claim':
      writeToken(w, a.key);
      w.u8(a.resume ? 1 : 0);
      return;
    case 'use':
      writeVarint(w, a.expectedRevision);
      if (!Number.isSafeInteger(a.slot) || a.slot < 0 || a.slot >= MAX_BACKPACK)
        throw new RangeError('ô túi');
      w.u8(a.slot);
      w.u8(a.target === null ? 0 : 1);
      if (a.target !== null) writeToken(w, a.target);
      return;
    case 'reload':
      writeVarint(w, a.expectedRevision);
      return;
    case 'equip':
      w.u8(code(ITEM_CODES, a.itemId as keyof typeof ITEMS));
      w.u8(code(RARITY_CODES, a.rarity));
      return;
  }
}
function readQuantity(r: Reader): number {
  const q = readVarint(r);
  if (q < 1 || q > MAX_QUANTITY) throw new RangeError('số lượng');
  return q;
}
function readAction(r: Reader): LootAction {
  const type = lookup(ACTIONS, r.u8());
  switch (type) {
    case 'unequip':
    case 'inventory':
      return { type };
    case 'view':
      return { type, chestId: readChestId(r) };
    case 'open':
    case 'takeAll':
      return {
        type,
        chestId: readChestId(r),
        expectedChestRevision: readRevision(r),
        expectedInventoryRevision: readRevision(r),
      };
    case 'take': {
      const chestId = readChestId(r);
      const expectedChestRevision = readRevision(r);
      const expectedInventoryRevision = readRevision(r);
      const slot = r.u8();
      if (slot >= CHEST_SLOTS) throw new RangeError('ô rương');
      return {
        type,
        chestId,
        expectedChestRevision,
        expectedInventoryRevision,
        slot,
        quantity: readQuantity(r),
      };
    }
    case 'move': {
      const expectedRevision = readRevision(r);
      const from = r.u8();
      const to = r.u8();
      if (from >= MAX_BACKPACK || to >= MAX_BACKPACK) throw new RangeError('ô túi');
      return { type, expectedRevision, from, to, quantity: readQuantity(r) };
    }
    case 'sort':
      return { type, expectedRevision: readRevision(r) };
    case 'claim': {
      const key = readToken(r);
      const flag = r.u8();
      if (flag > 1) throw new RangeError('cờ claim');
      return { type, key, resume: flag === 1 };
    }
    case 'use': {
      const expectedRevision = readRevision(r);
      const slot = r.u8();
      if (slot >= MAX_BACKPACK) throw new RangeError('ô túi');
      const flag = r.u8();
      if (flag > 1) throw new RangeError('cờ mục tiêu');
      return { type, expectedRevision, slot, target: flag === 1 ? readToken(r) : null };
    }
    case 'drop':
      return { type, expectedRevision: readRevision(r), slot: readVarint(r), quantity: readQuantity(r) };
    case 'pickup':
      return { type, expectedRevision: readRevision(r), dropId: readToken(r) };
    case 'reload':
      return { type, expectedRevision: readRevision(r) };
    case 'equip':
      return { type, itemId: lookup(ITEM_CODES, r.u8()), rarity: lookup(RARITY_CODES, r.u8()) };
  }
}

// ---------- gói ----------

export function encodeLoot(p: LootWirePacket): Uint8Array {
  const w = new Writer();
  w.u8(p.type);
  writeToken(w, p.term);
  switch (p.type) {
    case LootMessage.Request:
      writeToken(w, p.requestId);
      writeAction(w, p.action);
      break;
    case LootMessage.Reply: {
      if (p.ok === (p.error !== undefined)) throw new RangeError('reply: ok xor error');
      const flags = (p.ok ? 1 : 0) | (p.inventory ? 2 : 0) | (p.chest ? 4 : 0);
      writeToken(w, p.requestId);
      w.u8(flags);
      if (!p.ok) {
        const i = LOOT_ERRORS.indexOf(p.error as LootErrorCode);
        w.u8(i < 0 ? 0 : i);
      }
      writeVarint(w, p.revision);
      if (p.inventory) writeInventory(w, p.inventory);
      if (p.chest) writeChest(w, p.chest);
      break;
    }
    case LootMessage.Replica:
      if ('patch' in p) {
        const d = p.patch;
        if (d.revision <= d.baseRevision) throw new RangeError('patch revision');
        w.u8(PATCH);
        writeVarint(w, d.baseRevision);
        writeVarint(w, d.revision);
        writeEntries(w, d.inventories, d.chests);
        writeDrops(w, d.dropsSet ?? []);
        writeDropIds(w, d.dropsRemoved ?? []);
      } else {
        const s = p.state;
        if (s.version !== 1) throw new RangeError('replica version');
        w.u8(FULL);
        w.u8(s.version);
        writeText(w, s.seed, MAX_SEED, true);
        writeVarint(w, s.revision);
        writeEntries(w, s.inventories, s.chests);
        writeDrops(w, s.drops ?? []);
      }
      break;
    case LootMessage.Ack:
      writeVarint(w, p.revision);
      break;
  }
  return w.done();
}

/** Giải mã + kiểm tra cấu trúc. Kiểm tra theo seed/thế giới (vị trí rương có thật) làm ở `isValidReplica`. */
export function decodeLoot(buf: Uint8Array): LootWirePacket | null {
  if (!isLootPacket(buf) || buf.length > MAX_LOOT_PACKET) return null;
  try {
    const r = new Reader(buf);
    const type = r.u8() as LootPacket['type'];
    const term = readToken(r);
    let p: LootWirePacket;
    switch (type) {
      case LootMessage.Request:
        p = { type, term, requestId: readToken(r), action: readAction(r) } satisfies LootRequest;
        break;
      case LootMessage.Reply: {
        const requestId = readToken(r);
        const flags = r.u8();
        if (flags > 7) return null;
        const ok = (flags & 1) !== 0;
        const error = ok ? undefined : lookup(LOOT_ERRORS, r.u8());
        const revision = readRevision(r);
        const inventory = flags & 2 ? readInventory(r) : undefined;
        const chest = flags & 4 ? readChest(r) : undefined;
        const reply: LootReply = {
          type,
          term,
          requestId,
          ok,
          revision,
          ...(error !== undefined && { error }),
          ...(inventory && { inventory }),
          ...(chest && { chest }),
        };
        p = reply;
        break;
      }
      case LootMessage.Replica: {
        const form = r.u8();
        if (form === FULL) {
          if (r.u8() !== 1) return null;
          const seed = readText(r, MAX_SEED, true);
          const revision = readRevision(r);
          const entries = readEntries(r);
          const drops = readDrops(r);
          p = {
            type,
            term,
            state: { ...(drops.length ? { drops } : {}), version: 1, seed, revision, ...entries },
          } satisfies LootReplica;
        } else if (form === PATCH) {
          const baseRevision = readRevision(r);
          const revision = readRevision(r);
          if (revision <= baseRevision) return null;
          const entries = readEntries(r);
          const dropsSet = readDrops(r);
          const dropsRemoved = readDropIds(r);
          p = {
            type,
            term,
            patch: {
              baseRevision,
              revision,
              ...entries,
              ...(dropsSet.length ? { dropsSet } : {}),
              ...(dropsRemoved.length ? { dropsRemoved } : {}),
            },
          } satisfies LootReplicaPatch;
        } else return null;
        break;
      }
      case LootMessage.Ack:
        p = { type, term, revision: readRevision(r) } satisfies LootAck;
        break;
      default:
        return null;
    }
    // gói phải hết đúng chỗ
    return r.more() ? null : p;
  } catch {
    return null;
  }
}

// ---------- replica: ghép phần đổi + kiểm tra theo thế giới ----------

/**
 * Ghép phần đổi vào bản đầy đủ. `base.revision` phải đúng `patch.baseRevision` (không thì null → chờ bản đầy đủ).
 * Không sửa `base`. Kết quả vẫn phải qua `isValidReplica` (chỉ rương/túi trong phần đổi là mới, xem `isValidPatch`).
 */
export function applyLootPatch(base: LootReplicaWire, patch: LootPatch): LootReplicaWire | null {
  if (base.revision !== patch.baseRevision) return null;
  const inventories = base.inventories.map((e) => ({ ...e }));
  for (const e of patch.inventories) {
    const i = inventories.findIndex((x) => x.id === e.id);
    if (i >= 0) inventories[i] = e;
    else inventories.push(e);
  }
  const chests = new Map(base.chests.map((c) => [c.id, c]));
  for (const c of patch.chests) chests.set(c.id, c);
  if (inventories.length > LOOT_INTERACTION.maxInventories || chests.size > LOOT_INTERACTION.maxChests)
    return null;
  const { drops: old, ...rest } = base;
  const removed = new Set(patch.dropsRemoved ?? []);
  const drops = (old ?? []).filter((d) => !removed.has(d.id));
  for (const d of patch.dropsSet ?? []) {
    const i = drops.findIndex((x) => x.id === d.id);
    if (i >= 0) drops[i] = d;
    else drops.push(d);
  }
  // host luôn giữ danh sách tăng dần theo số id (đống mới = revision mới) → mọi máy cùng thứ tự
  drops.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  if (drops.length > GROUND.max) return null;
  return {
    ...rest,
    ...(drops.length ? { drops } : {}),
    revision: patch.revision,
    inventories,
    chests: [...chests.values()],
  };
}

/** Bản đầy đủ hợp lệ cho thế giới `seed`: đúng seed, mọi túi/rương hợp lệ, rương có thật trong map, đúng khu. */
export function isValidReplica(state: LootReplicaWire, seed: string): boolean {
  return isLootSave(state, seed);
}

/** Chỉ kiểm tra phần mới của một phần đổi (phần cũ đã kiểm khi nhận) — rẻ hơn kiểm cả bản. */
export function isValidPatch(patch: LootPatch, seed: string): boolean {
  if (!isGroundItems(patch.dropsSet ?? [])) return false;
  if (!(patch.dropsRemoved ?? []).every((id) => /^d[1-9][0-9]{0,15}$/.test(id))) return false;
  if (!patch.inventories.every((e) => isInventoryState(e.state))) return false;
  return patch.chests.every((c) => {
    if (!isChestState(c)) return false;
    const at = findChest(seed, c.id);
    return at !== null && at.region === c.region;
  });
}
