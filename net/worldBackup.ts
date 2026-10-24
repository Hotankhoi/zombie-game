import type { PlayerState } from '@shared/sim/player';
import type { WorldState } from '@shared/sim/world';
import type { ZombieState } from '@shared/sim/zombie';
import type { PeerId } from '@shared/types';
import { Reader, Writer } from './gameCodec';

/**
 * Sao lưu toàn bộ thế giới (AGENTS.md mục 2.1: host gửi snapshot thế giới cho mọi peer ~10s một lần
 * để chuyển host không mất trạng thái). Loại gói riêng (125), cố ý không nằm trong danh sách gói chung
 * của gameCodec (chỗ B thêm gói loot). Chưa gồm rương/túi đồ — B thêm khi ghép loot online.
 */
export const WORLD_BACKUP_MSG = 125;

const MODE = { wander: 0, chase: 1 } as const;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function encodeBackup(s: WorldState): Uint8Array {
  const w = new Writer();
  w.u8(WORLD_BACKUP_MSG);
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
    w.u8((p.exhausted ? 1 : 0) | (p.sprinting ? 2 : 0) | (p.dragging ? 4 : 0));
    w.u8(p.prevButtons);
    w.f32(p.downedFor);
    w.f32(p.reviveProgress);
  }
  w.u16(s.zombies.length);
  for (const z of s.zombies) {
    w.u32(z.id);
    w.f32(z.x);
    w.f32(z.y);
    w.f32(z.facing);
    w.f32(z.hp);
    w.u8(MODE[z.mode]);
    w.u8(z.target === null ? 255 : (slot.get(z.target) ?? 255));
    w.f32(z.wanderIn);
    w.u8(z.wanderMoving ? 1 : 0);
    w.f32(z.biteCd);
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
  return w.done();
}

/** Giải mã. Gói hỏng → null (dữ liệu từ mạng, không ném lỗi). */
export function decodeBackup(buf: Uint8Array): WorldState | null {
  if (buf[0] !== WORLD_BACKUP_MSG) return null;
  try {
    const r = new Reader(buf);
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
      });
    }
    const zombies: ZombieState[] = [];
    for (let i = 0, n = r.u16(); i < n; i++) {
      const id = r.u32();
      const x = r.f32();
      const y = r.f32();
      const facing = r.f32();
      const hp = r.f32();
      const mode = r.u8() === MODE.chase ? 'chase' : 'wander';
      const t = r.u8();
      const wanderIn = r.f32();
      const wanderMoving = r.u8() === 1;
      const biteCd = r.f32();
      const target = mode === 'chase' ? (players[t]?.id ?? null) : null;
      zombies.push({
        id,
        x,
        y,
        facing,
        hp,
        mode: target ? 'chase' : 'wander',
        target,
        wanderIn,
        wanderMoving,
        biteCd,
      });
    }
    const openDoors: { x: number; y: number }[] = [];
    for (let i = 0, n = r.u16(); i < n; i++) openDoors.push({ x: r.i32(), y: r.i32() });
    const flowTargets: { x: number; y: number }[] = [];
    for (let i = 0, n = r.u8(); i < n; i++) flowTargets.push({ x: r.f64(), y: r.f64() });
    return { tick, rngState, nextZombieId, players, zombies, openDoors, flowTargets, flowDirty };
  } catch {
    return null;
  }
}

/**
 * Ghép bản sao lưu (đủ cả thế giới nhưng cũ tới 10s) với trạng thái từ snapshot mới nhất (mới nhưng chỉ
 * quanh mình) khi mình lên làm host thay người vừa rời:
 * - người chơi: lấy bản mới; ai không còn trong phòng (`keep`) thì bỏ;
 * - zombie trong vùng quanh mình: theo snapshot (con không còn = đã chết; con mới = sinh sau bản lưu);
 *   ngoài vùng: theo bản lưu (giữ cả máu, trạng thái lang thang);
 * - cửa: trong vùng theo snapshot, ngoài vùng theo bản lưu.
 */
export function mergeBackup(
  backup: WorldState | null,
  fresh: WorldState | null,
  area: { x: number; y: number; radius: number } | null,
  keep: ReadonlySet<PeerId>,
): WorldState | null {
  if (!backup) return fresh;
  const players = (fresh?.players ?? backup.players).filter((p) => keep.has(p.id)).map((p) => ({ ...p }));
  if (!fresh || !area) {
    return { ...backup, players, flowTargets: aliveTargets(players), flowDirty: true };
  }
  const inArea = (x: number, y: number) =>
    Math.abs(x - area.x) <= area.radius && Math.abs(y - area.y) <= area.radius;

  // snapshot chỉ có 16 bit thấp của id zombie → ghép theo đó, giữ id đầy đủ của bản lưu
  const freshByLow = new Map(fresh.zombies.map((z) => [z.id & 0xffff, z]));
  let nextId = Math.max(backup.nextZombieId, fresh.nextZombieId);
  const zombies: ZombieState[] = [];
  for (const z of backup.zombies) {
    const f = freshByLow.get(z.id & 0xffff);
    if (f) {
      freshByLow.delete(z.id & 0xffff);
      zombies.push({ ...z, x: f.x, y: f.y, facing: f.facing, mode: f.mode, target: f.target });
    } else if (!inArea(z.x, z.y)) {
      zombies.push({ ...z });
    }
  }
  for (const f of freshByLow.values()) zombies.push({ ...f, id: nextId++ });

  const doors = backup.openDoors.filter((d) => !inArea(d.x + 0.5, d.y + 0.5));
  for (const d of fresh.openDoors) doors.push({ ...d });

  const alivePeers = new Set(players.map((p) => p.id));
  for (const z of zombies) {
    if (z.target !== null && !alivePeers.has(z.target)) {
      z.mode = 'wander';
      z.target = null;
    }
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
  };
}

function aliveTargets(players: PlayerState[]) {
  return players.filter((p) => p.respawnIn <= 0).map((p) => ({ x: p.x, y: p.y }));
}
