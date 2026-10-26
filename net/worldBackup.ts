import type { PlayerState } from '@shared/sim/player';
import { ZOMBIE_KINDS } from '@shared/sim/tuning/zombieKinds';
import type { Corpse, HordeState, Noise, Pool, WorldState } from '@shared/sim/world';
import type { ZombieState } from '@shared/sim/zombie';
import { SIM_TICK_MS, type PeerId } from '@shared/types';
import { Reader, Writer } from './gameCodec';

/**
 * Sao lưu toàn bộ thế giới (AGENTS.md mục 2.1: host gửi snapshot thế giới cho mọi peer ~10s một lần
 * để chuyển host không mất trạng thái). Loại gói riêng (125), cố ý không nằm trong danh sách gói chung
 * của gameCodec. Phiên bản 6: cuối mẩu 0 có khối loot (túi + rương = gói 112 đầy đủ của host, `HostLoot.backupBlock`).
 */
export const WORLD_BACKUP_MSG = 125;
/**
 * Phiên bản bố cục gói (byte thứ 2). Đổi bố cục thì TĂNG số này: máy bản khác nhận được sẽ bỏ qua bản lưu
 * (chuyển host chỉ dựa vào snapshot) thay vì đọc lệch byte ra trạng thái hỏng.
 */
export const WORLD_BACKUP_VERSION = 8;
/** Khối loot (gói 112 đầy đủ, net/lootCodec.ts) ở cuối mẩu 0 lớn nhất bấy nhiêu byte (≈ 4096 rương). */
export const MAX_BACKUP_LOOT = 256 * 1024;
/**
 * Bản sao lưu được chia thành bấy nhiêu mẩu, host gửi 1 mẩu/giây cho mọi người (thay vì cả thế giới ~23 KB dồn 1 lần
 * mỗi 10s → đỉnh băng thông). Mẩu k = zombie có id % N === k + danh sách người chơi; phần chung (cửa, vũng, tường, đợt
 * tràn…) chỉ nằm ở mẩu 0. Máy nhận ghép lại bằng BackupParts — mỗi zombie vẫn cũ tối đa 10s như khi gửi cả gói.
 */
export const BACKUP_PARTS = 10;

const MODES = ['wander', 'investigate', 'chase'] as const;
/** Các đồng hồ đếm ngược của zombie, theo thứ tự bit trong mặt nạ. */
const TIMER_NAMES = [
  'wanderIn',
  'biteCd',
  'investigateFor',
  'burstFor',
  'spitCd',
  'slamCd',
  'roarCd',
] as const;
const TAU = Math.PI * 2;
/** Vị trí zombie trong bản lưu: i16 theo 1/ZPOS ô so với gốc của gói (±1024 ô). */
const ZPOS = 32;

/** Số nguyên không âm, 7 bit mỗi byte (bit cao = còn byte sau). */
function writeVarint(w: Writer, v: number): void {
  while (v >= 0x80) {
    w.u8((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  w.u8(v);
}
function readVarint(r: Reader): number {
  let v = 0;
  for (let shift = 1; ; shift *= 128) {
    const b = r.u8();
    v += (b & 0x7f) * shift;
    if (b < 0x80) return v;
    if (shift > 2 ** 28) throw new RangeError('varint dài');
  }
}
const angleToByte = (a: number) => Math.round((((a % TAU) + TAU) % TAU) * (256 / TAU)) & 255;
const byteToAngle = (b: number) => (b / 256) * TAU;

function zombieTimers(z: ZombieState): number[] {
  return TIMER_NAMES.map((k) => z[k]);
}
const enc = new TextEncoder();
const dec = new TextDecoder();

/** Phần chung rỗng — mẩu khác mẩu 0 ghi cái này. */
const NO_GLOBALS: Pick<
  WorldState,
  | 'openDoors'
  | 'flowTargets'
  | 'pools'
  | 'brokenDoors'
  | 'noises'
  | 'horde'
  | 'brokenWalls'
  | 'wallDamage'
  | 'corpses'
> = {
  openDoors: [],
  flowTargets: [],
  pools: [],
  brokenDoors: [],
  noises: [],
  horde: null,
  brokenWalls: [],
  wallDamage: [],
  corpses: [],
};

/** Cả thế giới trong 1 gói (1 mẩu duy nhất). */
export function encodeBackup(s: WorldState): Uint8Array {
  return encodeBackupPart(s, 0, 1);
}

/** Mẩu `part` trong `parts` mẩu (xem BACKUP_PARTS). */
export function encodeBackupPart(
  s: WorldState,
  part: number,
  parts: number,
  loot: Uint8Array | null = null,
): Uint8Array {
  const main = part === 0;
  const w = new Writer();
  w.u8(WORLD_BACKUP_MSG);
  w.u8(WORLD_BACKUP_VERSION);
  w.u8(part);
  w.u8(parts);
  w.u32(s.tick);
  w.u32(s.rngState);
  w.u32(s.nextZombieId);
  w.u8(s.flowDirty ? 1 : 0);
  const slot = new Map(s.players.map((p, i) => [p.id, i]));
  w.u8(s.players.length);
  for (const p of s.players) {
    const id = enc.encode(p.id).subarray(0, 255);
    w.u8(id.length);
    w.bytes(id);
    w.f64(p.x);
    w.f64(p.y);
    w.f32(p.facing);
    w.f32(p.hp);
    w.f32(p.stamina);
    w.f32(p.staminaIdle);
    w.f32(p.attackCd);
    w.f32(p.respawnIn);
    w.u8((p.exhausted ? 1 : 0) | (p.sprinting ? 2 : 0) | (p.dragging ? 4 : 0) | (p.flashlight ? 8 : 0));
    w.u8(p.prevButtons);
    w.f32(p.downedFor);
    w.f32(p.reviveProgress);
    w.f32(p.shield);
    // bản 7 (GĐ 3b): chỉ số sinh tồn
    w.f32(p.food);
    w.f32(p.water);
    w.f32(p.infection);
    w.f32(p.maxHp);
    // bản 8: hồi máu dần + đứng yên (dùng đồ)
    w.f32(p.healLeft);
    w.f32(p.healRate);
    w.f32(p.stillFor);
  }
  // zombie gọn (~18 byte/con, bản 4 là ~32): id ghi chênh lệch (varint), vị trí/đích i16 theo 1/ZPOS ô so với gốc của
  // gói (xa quá ±1024 ô thì f32), máu u16 theo 0.1, hướng 1 byte, đồng hồ 1/100 giây chỉ ghi cái khác 0, đích bỏ qua
  // nếu trùng vị trí, mục tiêu/xác đồng đội chỉ ghi khi có. Chỉ dùng khi chuyển host nên sai số 1/64 ô không đáng kể.
  const zombies = (parts > 1 ? s.zombies.filter((z) => z.id % parts === part) : [...s.zombies]).sort(
    (a, b) => a.id - b.id,
  );
  const ox = Math.floor(s.players[0]?.x ?? 0);
  const oy = Math.floor(s.players[0]?.y ?? 0);
  w.i32(ox);
  w.i32(oy);
  w.u16(zombies.length);
  let prevId = 0;
  for (const z of zombies) {
    writeVarint(w, z.id - prevId);
    prevId = z.id;
    const sameGoal = z.goalX === z.x && z.goalY === z.y;
    const q = [z.x - ox, z.y - oy, ...(sameGoal ? [] : [z.goalX - ox, z.goalY - oy])].map((v) =>
      Math.round(v * ZPOS),
    );
    const near = q.every((v) => v >= -32768 && v <= 32767);
    const targetSlot = z.target === null ? undefined : slot.get(z.target);
    const hpQ = Math.round(z.hp * 10);
    const hpShort = hpQ >= 0 && hpQ <= 0xffff;
    const turned = enc.encode(z.turnedFrom ?? '').subarray(0, 255);
    w.u8(
      (Math.max(0, ZOMBIE_KINDS.indexOf(z.kind)) & 7) |
        (Math.max(0, MODES.indexOf(z.mode)) << 3) |
        (z.wanderMoving ? 32 : 0) |
        (z.hidden ? 64 : 0) |
        (z.horde ? 128 : 0),
    );
    w.u8(
      (sameGoal ? 1 : 0) |
        (targetSlot !== undefined ? 2 : 0) |
        (near ? 0 : 4) |
        (turned.length > 0 ? 8 : 0) |
        (hpShort ? 0 : 16),
    );
    const pos = (exact: number, i: number) => (near ? w.i16(q[i]!) : w.f32(exact));
    pos(z.x, 0);
    pos(z.y, 1);
    w.u8(angleToByte(z.facing));
    if (hpShort) w.u16(hpQ);
    else w.f32(z.hp);
    if (targetSlot !== undefined) w.u8(targetSlot);
    const timers = zombieTimers(z);
    let mask = 0;
    timers.forEach((t, i) => {
      if (t > 0) mask |= 1 << i;
    });
    w.u8(mask);
    for (const t of timers) if (t > 0) w.u16(Math.min(0xffff, Math.ceil(t * 100)));
    if (!sameGoal) {
      pos(z.goalX, 2);
      pos(z.goalY, 3);
    }
    if (turned.length > 0) {
      w.u8(turned.length);
      w.bytes(turned);
    }
  }
  // phần chung của thế giới: chỉ ở mẩu 0 (mẩu khác ghi danh sách rỗng)
  const g = main ? s : NO_GLOBALS;
  w.u16(g.openDoors.length);
  for (const d of g.openDoors) {
    w.i32(d.x);
    w.i32(d.y);
  }
  w.u8(g.flowTargets.length);
  for (const t of g.flowTargets) {
    w.f64(t.x);
    w.f64(t.y);
  }
  const pools = g.pools ?? [];
  w.u32(s.nextPoolId ?? 1);
  w.u16(pools.length);
  for (const p of pools) {
    w.u32(p.id);
    w.u8(p.kind === 'acid' ? 1 : 0);
    w.f32(p.x);
    w.f32(p.y);
    w.f32(p.radius);
    w.f32(p.ttl);
    w.f32(p.armIn);
    w.f32(p.dps);
  }
  const broken = g.brokenDoors ?? [];
  w.u16(broken.length);
  for (const d of broken) {
    w.i32(d.x);
    w.i32(d.y);
  }
  const noises = g.noises ?? [];
  w.u16(noises.length);
  for (const n of noises) {
    w.f32(n.x);
    w.f32(n.y);
    w.f32(n.radius);
  }
  // đợt tràn: ít khi có, gửi dạng JSON cho gọn code
  const horde = enc.encode(g.horde ? JSON.stringify(g.horde) : '');
  w.u32(horde.length);
  w.bytes(horde);
  const walls = g.brokenWalls ?? [];
  w.u32(walls.length);
  for (const t of walls) {
    w.i32(t.x);
    w.i32(t.y);
  }
  const damaged = g.wallDamage ?? [];
  w.u16(Math.min(0xffff, damaged.length));
  for (const t of damaged.slice(0, 0xffff)) {
    w.i32(t.x);
    w.i32(t.y);
    w.f32(t.hp);
  }
  const corpses = g.corpses ?? [];
  w.u8(Math.min(255, corpses.length));
  for (const c of corpses.slice(0, 255)) {
    const id = enc.encode(c.player).subarray(0, 255);
    w.u8(id.length);
    w.bytes(id);
    w.f64(c.x);
    w.f64(c.y);
    w.f32(c.turnIn);
  }
  // khối loot: chỉ mẩu 0 (u32 độ dài, 0 = không có)
  const block = main && loot && loot.length <= MAX_BACKUP_LOOT ? loot : null;
  w.u32(block?.length ?? 0);
  if (block) w.bytes(block);
  return w.done();
}

/** Giải mã 1 gói thành trạng thái (với mẩu ≠ 0: chỉ có người chơi + zombie của mẩu đó). Gói hỏng → null. */
export function decodeBackup(buf: Uint8Array): WorldState | null {
  return decodeBackupPart(buf)?.state ?? null;
}

/** Giải mã kèm số mẩu. Gói hỏng/khác phiên bản → null (dữ liệu từ mạng, không ném lỗi). */
export function decodeBackupPart(
  buf: Uint8Array,
): { part: number; parts: number; state: WorldState; loot: Uint8Array | null } | null {
  if (buf[0] !== WORLD_BACKUP_MSG || buf[1] !== WORLD_BACKUP_VERSION) return null;
  try {
    const r = new Reader(buf);
    r.u8();
    r.u8();
    const part = r.u8();
    const parts = r.u8();
    if (parts < 1 || part >= parts) return null;
    const tick = r.u32();
    const rngState = r.u32();
    const nextZombieId = r.u32();
    const flowDirty = r.u8() === 1;
    const players: PlayerState[] = [];
    for (let i = 0, n = r.u8(); i < n; i++) {
      const id = dec.decode(r.bytes(r.u8()));
      const x = r.f64();
      const y = r.f64();
      const facing = r.f32();
      const hp = r.f32();
      const stamina = r.f32();
      const staminaIdle = r.f32();
      const attackCd = r.f32();
      const respawnIn = r.f32();
      const flags = r.u8();
      const prevButtons = r.u8();
      const downedFor = r.f32();
      const reviveProgress = r.f32();
      const shield = r.f32();
      const food = r.f32();
      const water = r.f32();
      const infection = r.f32();
      const maxHp = r.f32();
      const healLeft = r.f32();
      const healRate = r.f32();
      const stillFor = r.f32();
      players.push({
        id,
        x,
        y,
        facing,
        hp,
        stamina,
        exhausted: (flags & 1) !== 0,
        staminaIdle,
        sprinting: (flags & 2) !== 0,
        attackCd,
        prevButtons,
        respawnIn,
        downedFor,
        reviveProgress,
        dragging: (flags & 4) !== 0,
        flashlight: (flags & 8) !== 0,
        shield,
        food,
        water,
        infection,
        maxHp,
        healLeft,
        healRate,
        stillFor,
      });
    }
    const zombies: ZombieState[] = [];
    const ox = r.i32();
    const oy = r.i32();
    let prevId = 0;
    for (let i = 0, n = r.u16(); i < n; i++) {
      const id = prevId + readVarint(r);
      prevId = id;
      const flags = r.u8();
      const more = r.u8();
      const kind = ZOMBIE_KINDS[flags & 7] ?? 'normal';
      const mode = MODES[(flags >> 3) & 3] ?? 'wander';
      const far = (more & 4) !== 0;
      const posX = () => (far ? r.f32() : ox + r.i16() / ZPOS);
      const posY = () => (far ? r.f32() : oy + r.i16() / ZPOS);
      const x = posX();
      const y = posY();
      const facing = byteToAngle(r.u8());
      const hp = more & 16 ? r.f32() : r.u16() / 10;
      const t = more & 2 ? r.u8() : 255;
      const mask = r.u8();
      const [wanderIn, biteCd, investigateFor, burstFor, spitCd, slamCd, roarCd] = TIMER_NAMES.map((_, i) =>
        mask & (1 << i) ? r.u16() / 100 : 0,
      ) as [number, number, number, number, number, number, number];
      const sameGoal = (more & 1) !== 0;
      const goalX = sameGoal ? x : posX();
      const goalY = sameGoal ? y : posY();
      const turnedFrom = more & 8 ? dec.decode(r.bytes(r.u8())) || null : null;
      const target = mode === 'chase' ? (players[t]?.id ?? null) : null;
      zombies.push({
        id,
        kind,
        x,
        y,
        facing,
        hp,
        mode: mode === 'chase' && !target ? 'wander' : mode,
        target,
        wanderIn,
        wanderMoving: (flags & 32) !== 0,
        biteCd,
        goalX,
        goalY,
        investigateFor,
        hidden: (flags & 64) !== 0,
        burstFor,
        spitCd,
        horde: (flags & 128) !== 0,
        slamCd,
        roarCd,
        turnedFrom,
      });
    }
    const openDoors: { x: number; y: number }[] = [];
    for (let i = 0, n = r.u16(); i < n; i++) openDoors.push({ x: r.i32(), y: r.i32() });
    const flowTargets: { x: number; y: number }[] = [];
    for (let i = 0, n = r.u8(); i < n; i++) flowTargets.push({ x: r.f64(), y: r.f64() });
    const nextPoolId = r.u32();
    const pools: Pool[] = [];
    for (let i = 0, n = r.u16(); i < n; i++) {
      const id = r.u32();
      const kind = r.u8() === 1 ? 'acid' : 'poison';
      pools.push({
        id,
        kind,
        x: r.f32(),
        y: r.f32(),
        radius: r.f32(),
        ttl: r.f32(),
        armIn: r.f32(),
        dps: r.f32(),
      });
    }
    const brokenDoors: { x: number; y: number }[] = [];
    for (let i = 0, n = r.u16(); i < n; i++) brokenDoors.push({ x: r.i32(), y: r.i32() });
    const noises: Noise[] = [];
    for (let i = 0, n = r.u16(); i < n; i++) noises.push({ x: r.f32(), y: r.f32(), radius: r.f32() });
    const hordeText = dec.decode(r.bytes(r.u32()));
    const horde = hordeText ? (JSON.parse(hordeText) as HordeState) : null;
    const brokenWalls: { x: number; y: number }[] = [];
    for (let i = 0, n = r.u32(); i < n; i++) brokenWalls.push({ x: r.i32(), y: r.i32() });
    const wallDamage: { x: number; y: number; hp: number }[] = [];
    for (let i = 0, n = r.u16(); i < n; i++) wallDamage.push({ x: r.i32(), y: r.i32(), hp: r.f32() });
    const corpses: Corpse[] = [];
    for (let i = 0, n = r.u8(); i < n; i++) {
      const player = dec.decode(r.bytes(r.u8()));
      corpses.push({ player, x: r.f64(), y: r.f64(), turnIn: r.f32() });
    }
    const lootLen = r.u32();
    if (lootLen > MAX_BACKUP_LOOT || (lootLen > 0 && part !== 0)) return null;
    const loot = lootLen > 0 ? r.bytes(lootLen).slice() : null;
    // gói phải hết đúng chỗ (gói cụt hay dư rác đều là hỏng)
    if (r.more()) return null;
    return {
      part,
      parts,
      loot,
      state: {
        tick,
        rngState,
        nextZombieId,
        players,
        zombies,
        openDoors,
        flowTargets,
        flowDirty,
        pools,
        nextPoolId,
        brokenDoors,
        noises,
        horde,
        corpses,
        brokenWalls,
        wallDamage,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Máy nhận ghép các mẩu sao lưu (xem BACKUP_PARTS). Mỗi mẩu mới thay mẩu cùng số; host đổi số mẩu thì làm lại từ đầu.
 * assemble(): phần chung + người chơi + tick theo mẩu 0, zombie gộp từ mọi mẩu đang có. Chưa có mẩu 0 → null.
 * Thiếu mẩu khác (mới vào < 10s) → thiếu zombie của mẩu đó, giống như trước đây chưa nhận được bản lưu.
 */
export class BackupParts {
  private parts: (WorldState | null)[] = [];
  private loot: Uint8Array | null = null;

  /** Khối loot của mẩu 0 vừa nhận (gói 112 đầy đủ) — lấy 1 lần rồi xóa. */
  takeLoot(): Uint8Array | null {
    const l = this.loot;
    this.loot = null;
    return l;
  }

  /** Nhận 1 gói 125. Trả về false nếu gói hỏng/khác phiên bản. */
  receive(buf: Uint8Array): boolean {
    const d = decodeBackupPart(buf);
    if (!d) return false;
    if (d.loot) this.loot = d.loot;
    if (this.parts.length !== d.parts) this.parts = new Array<WorldState | null>(d.parts).fill(null);
    this.parts[d.part] = d.state;
    return true;
  }

  /** Số mẩu đang có / tổng số mẩu (bảng F3). */
  get have(): number {
    return this.parts.filter((p) => p !== null).length;
  }
  get total(): number {
    return this.parts.length;
  }

  clear(): void {
    this.parts = [];
    this.loot = null;
  }

  assemble(): WorldState | null {
    const base = this.parts[0];
    if (!base) return null;
    const seen = new Set<number>();
    const zombies: ZombieState[] = [];
    let nextZombieId = base.nextZombieId;
    for (const p of this.parts) {
      if (!p) continue;
      nextZombieId = Math.max(nextZombieId, p.nextZombieId);
      for (const z of p.zombies) {
        if (seen.has(z.id)) continue;
        seen.add(z.id);
        zombies.push(z);
      }
    }
    zombies.sort((a, b) => a.id - b.id);
    return { ...base, zombies, nextZombieId };
  }
}

/**
 * Ghép bản sao lưu (đủ cả thế giới nhưng cũ tới 10s) với trạng thái từ snapshot mới nhất (mới nhưng chỉ
 * quanh mình) khi mình lên làm host thay người vừa rời:
 * - snapshot cũ hơn bản lưu (mất gói unreliable): bỏ snapshot, chỉ dùng bản lưu — không lùi thời gian;
 * - người chơi: lấy bản mới; ai không còn trong phòng (`keep`) thì bỏ;
 * - zombie trong vùng snapshot gửi đủ (`zombieRadius`): theo snapshot (con không còn = đã chết; con mới =
 *   sinh sau bản lưu), máu = min(bản lưu, máu biết qua sự kiện hit); ngoài vùng đó hoặc đang nấp (snapshot
 *   không gửi zombie nấp): theo bản lưu (giữ cả máu, trạng thái lang thang);
 * - cửa: trong vùng theo snapshot, ngoài vùng theo bản lưu; cửa bị phá, vũng độc, đợt tràn: theo bản lưu
 *   (lùi thời gian theo số tick đã trôi); xác chờ thành zombie: gộp, ưu tiên bản mới.
 */
export function mergeBackup(
  backup: WorldState | null,
  fresh: WorldState | null,
  area: { x: number; y: number; radius: number; zombieRadius?: number } | null,
  keep: ReadonlySet<PeerId>,
): WorldState | null {
  if (!backup) return fresh;
  if (fresh && fresh.tick < backup.tick) fresh = null;
  const players = (fresh?.players ?? backup.players).filter((p) => keep.has(p.id)).map((p) => ({ ...p }));
  if (!fresh || !area) {
    return { ...backup, players, flowTargets: aliveTargets(players), flowDirty: true };
  }
  const near = (x: number, y: number, r: number) => Math.abs(x - area.x) <= r && Math.abs(y - area.y) <= r;
  const zr = Math.min(area.radius, area.zombieRadius ?? area.radius);

  // snapshot chỉ có 16 bit thấp của id zombie → ghép theo đó, giữ id đầy đủ của bản lưu
  const freshByLow = new Map(fresh.zombies.map((z) => [z.id & 0xffff, z]));
  let nextId = Math.max(backup.nextZombieId, fresh.nextZombieId);
  const zombies: ZombieState[] = [];
  for (const z of backup.zombies) {
    const f = freshByLow.get(z.id & 0xffff);
    if (f) {
      freshByLow.delete(z.id & 0xffff);
      const hp = Math.min(z.hp, f.hp);
      zombies.push({ ...z, x: f.x, y: f.y, facing: f.facing, mode: f.mode, target: f.target, hp });
    } else if (z.hidden || !near(z.x, z.y, zr)) {
      zombies.push({ ...z });
    }
  }
  for (const f of freshByLow.values()) zombies.push({ ...f, id: nextId++ });

  const doors = backup.openDoors.filter((d) => !near(d.x + 0.5, d.y + 0.5, area.radius));
  for (const d of fresh.openDoors) doors.push({ ...d });

  const alivePeers = new Set(players.map((p) => p.id));
  for (const z of zombies) {
    if (z.target !== null && !alivePeers.has(z.target)) {
      z.mode = 'wander';
      z.target = null;
    }
  }

  const elapsed = (fresh.tick - backup.tick) * (SIM_TICK_MS / 1000);
  const corpses: Corpse[] = (fresh.corpses ?? []).map((c) => ({ ...c }));
  for (const c of backup.corpses ?? []) {
    if (corpses.some((k) => k.player === c.player)) continue;
    if (c.turnIn - elapsed > 0) corpses.push({ ...c, turnIn: c.turnIn - elapsed });
  }
  return {
    tick: fresh.tick,
    rngState: backup.rngState,
    nextZombieId: nextId,
    players,
    zombies,
    openDoors: doors,
    flowTargets: aliveTargets(players),
    flowDirty: true,
    pools: (backup.pools ?? [])
      .map((p) => ({ ...p, ttl: p.ttl - elapsed, armIn: Math.max(0, p.armIn - elapsed) }))
      .filter((p) => p.ttl > 0),
    nextPoolId: backup.nextPoolId ?? 1,
    brokenDoors: (backup.brokenDoors ?? []).map((d) => ({ ...d })),
    // tường vỡ thì vỡ mãi: gộp cả hai (máy mình biết qua MapDelta có thể mới hơn bản lưu)
    brokenWalls: unionTiles(backup.brokenWalls ?? [], fresh.brokenWalls ?? []),
    wallDamage: (backup.wallDamage ?? []).map((d) => ({ ...d })),
    noises: (backup.noises ?? []).map((n) => ({ ...n })),
    horde: backup.horde ? structuredClone(backup.horde) : null,
    corpses,
  };
}

function unionTiles(a: readonly { x: number; y: number }[], b: readonly { x: number; y: number }[]) {
  const seen = new Set<string>();
  const out: { x: number; y: number }[] = [];
  for (const t of [...a, ...b]) {
    const k = `${t.x},${t.y}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ x: t.x, y: t.y });
  }
  return out;
}

function aliveTargets(players: PlayerState[]) {
  return players.filter((p) => p.respawnIn <= 0).map((p) => ({ x: p.x, y: p.y }));
}
