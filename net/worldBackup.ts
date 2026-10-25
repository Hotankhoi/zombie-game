import type { PlayerState } from '@shared/sim/player';
import { ZOMBIE_KINDS } from '@shared/sim/tuning/zombieKinds';
import type { Corpse, HordeState, Noise, Pool, WorldState } from '@shared/sim/world';
import type { ZombieState } from '@shared/sim/zombie';
import { SIM_TICK_MS, type PeerId } from '@shared/types';
import { Reader, Writer } from './gameCodec';

/**
 * Sao lưu toàn bộ thế giới (AGENTS.md mục 2.1: host gửi snapshot thế giới cho mọi peer ~10s một lần
 * để chuyển host không mất trạng thái). Loại gói riêng (125), cố ý không nằm trong danh sách gói chung
 * của gameCodec (chỗ B thêm gói loot). Chưa gồm rương/túi đồ — B thêm khi ghép loot online.
 */
export const WORLD_BACKUP_MSG = 125;
/**
 * Phiên bản bố cục gói (byte thứ 2). Đổi bố cục thì TĂNG số này: máy bản khác nhận được sẽ bỏ qua bản lưu
 * (chuyển host chỉ dựa vào snapshot) thay vì đọc lệch byte ra trạng thái hỏng.
 */
export const WORLD_BACKUP_VERSION = 3;

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
const angleToByte = (a: number) => Math.round((((a % TAU) + TAU) % TAU) * (256 / TAU)) & 255;
const byteToAngle = (b: number) => (b / 256) * TAU;

function zombieTimers(z: ZombieState): number[] {
  return TIMER_NAMES.map((k) => z[k]);
}
const enc = new TextEncoder();
const dec = new TextDecoder();

export function encodeBackup(s: WorldState): Uint8Array {
  const w = new Writer();
  w.u8(WORLD_BACKUP_MSG);
  w.u8(WORLD_BACKUP_VERSION);
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
  }
  // zombie gọn (~25 byte/con thay vì 61): hướng 1 byte, đồng hồ đếm ngược 1/100 giây và chỉ ghi cái khác 0,
  // đích đi tới bỏ qua nếu trùng vị trí — đợt tràn 650 con vẫn giữ được ≤ 25 KB/s khi mỗi người nhận 10s/lần
  w.u16(s.zombies.length);
  for (const z of s.zombies) {
    w.u32(z.id);
    w.u8(Math.max(0, ZOMBIE_KINDS.indexOf(z.kind)));
    w.f32(z.x);
    w.f32(z.y);
    w.u8(angleToByte(z.facing));
    w.f32(z.hp);
    const sameGoal = z.goalX === z.x && z.goalY === z.y;
    w.u8(
      Math.max(0, MODES.indexOf(z.mode)) |
        (z.wanderMoving ? 4 : 0) |
        (z.hidden ? 8 : 0) |
        (z.horde ? 16 : 0) |
        (sameGoal ? 32 : 0),
    );
    w.u8(z.target === null ? 255 : (slot.get(z.target) ?? 255));
    const timers = zombieTimers(z);
    let mask = 0;
    timers.forEach((t, i) => {
      if (t > 0) mask |= 1 << i;
    });
    w.u8(mask);
    for (const t of timers) if (t > 0) w.u16(Math.min(0xffff, Math.ceil(t * 100)));
    if (!sameGoal) {
      w.f32(z.goalX);
      w.f32(z.goalY);
    }
    const turned = enc.encode(z.turnedFrom ?? '').subarray(0, 255);
    w.u8(turned.length);
    w.bytes(turned);
  }
  w.u16(s.openDoors.length);
  for (const d of s.openDoors) {
    w.i32(d.x);
    w.i32(d.y);
  }
  w.u8(s.flowTargets.length);
  for (const t of s.flowTargets) {
    w.f64(t.x);
    w.f64(t.y);
  }
  const pools = s.pools ?? [];
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
  const broken = s.brokenDoors ?? [];
  w.u16(broken.length);
  for (const d of broken) {
    w.i32(d.x);
    w.i32(d.y);
  }
  const noises = s.noises ?? [];
  w.u16(noises.length);
  for (const n of noises) {
    w.f32(n.x);
    w.f32(n.y);
    w.f32(n.radius);
  }
  // đợt tràn: ít khi có, gửi dạng JSON cho gọn code
  const horde = enc.encode(s.horde ? JSON.stringify(s.horde) : '');
  w.u32(horde.length);
  w.bytes(horde);
  const corpses = s.corpses ?? [];
  w.u8(Math.min(255, corpses.length));
  for (const c of corpses.slice(0, 255)) {
    const id = enc.encode(c.player).subarray(0, 255);
    w.u8(id.length);
    w.bytes(id);
    w.f64(c.x);
    w.f64(c.y);
    w.f32(c.turnIn);
  }
  return w.done();
}

/** Giải mã. Gói hỏng → null (dữ liệu từ mạng, không ném lỗi). */
export function decodeBackup(buf: Uint8Array): WorldState | null {
  if (buf[0] !== WORLD_BACKUP_MSG || buf[1] !== WORLD_BACKUP_VERSION) return null;
  try {
    const r = new Reader(buf);
    r.u8();
    r.u8();
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
      });
    }
    const zombies: ZombieState[] = [];
    for (let i = 0, n = r.u16(); i < n; i++) {
      const id = r.u32();
      const kind = ZOMBIE_KINDS[r.u8()] ?? 'normal';
      const x = r.f32();
      const y = r.f32();
      const facing = byteToAngle(r.u8());
      const hp = r.f32();
      const flags = r.u8();
      const mode = MODES[flags & 3] ?? 'wander';
      const t = r.u8();
      const mask = r.u8();
      const [wanderIn, biteCd, investigateFor, burstFor, spitCd, slamCd, roarCd] = TIMER_NAMES.map((_, i) =>
        mask & (1 << i) ? r.u16() / 100 : 0,
      ) as [number, number, number, number, number, number, number];
      const sameGoal = (flags & 32) !== 0;
      const goalX = sameGoal ? x : r.f32();
      const goalY = sameGoal ? y : r.f32();
      const turnedFrom = dec.decode(r.bytes(r.u8())) || null;
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
        wanderMoving: (flags & 4) !== 0,
        biteCd,
        goalX,
        goalY,
        investigateFor,
        hidden: (flags & 8) !== 0,
        burstFor,
        spitCd,
        horde: (flags & 16) !== 0,
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
    const corpses: Corpse[] = [];
    for (let i = 0, n = r.u8(); i < n; i++) {
      const player = dec.decode(r.bytes(r.u8()));
      corpses.push({ player, x: r.f64(), y: r.f64(), turnIn: r.f32() });
    }
    return {
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
    };
  } catch {
    return null;
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
    noises: (backup.noises ?? []).map((n) => ({ ...n })),
    horde: backup.horde ? structuredClone(backup.horde) : null,
    corpses,
  };
}

function aliveTargets(players: PlayerState[]) {
  return players.filter((p) => p.respawnIn <= 0).map((p) => ({ x: p.x, y: p.y }));
}
