import { isLootSave } from '@shared/loot/authority';
import { MAP_VERSION, worldSeedForRoom } from '@shared/mapgen/world';
import type { PlayerState } from '@shared/sim/player';
import type { WorldState } from '@shared/sim/world';
import { PROTOCOL_VERSION, type PeerId } from '@shared/types';
import type { LootReplicaWire } from '@shared/types/loot';

/**
 * File save (GĐ 5, A) — định dạng ở `docs/save-format.md`. Thuần (không IndexedDB/DOM): host dựng phần `world`/`loot`,
 * máy host ghép thành file; khi tải: kiểm tra rồi tách lại thành WorldState + replica loot cho HostServer.
 */
export const SAVE_FORMAT = 'zombie-coop-save';
export const SAVE_VERSION = 1;
export const WORLD_SAVE_VERSION = 1;
export const MAP_CHANGES_VERSION = 1;

export type MapChange =
  | { x: number; y: number; kind: 'wallBroken' | 'doorBroken' | 'doorOpen' }
  | { x: number; y: number; kind: 'wallDamaged'; hp: number };

export interface SaveFile {
  format: typeof SAVE_FORMAT;
  saveVersion: number;
  protocolVersion: number;
  mapVersion: number;
  room: string;
  seed: string;
  savedAt: string;
  tick: number;
  /** Theo ownerId — tên chỉ để hiện. */
  players: Record<string, { name?: string }>;
  /** WorldState: người chơi/zombie/xác/bảng thành tích khóa theo ownerId; cửa + tường nằm ở `map`. */
  world: { version: number; state: WorldState };
  loot: { version: number; state: LootReplicaWire };
  map: { version: number; changes: MapChange[] };
}

/** Bản dựng lại từ file: WorldState (người chơi khóa theo ownerId) + replica loot. */
export interface SavedWorld {
  world: WorldState;
  loot: LootReplicaWire;
}

/**
 * Đổi mọi tham chiếu người chơi trong WorldState theo `map` (PeerId → ownerId khi lưu, ownerId → PeerId khi người vào
 * lại). `null` = không có người tương ứng: người chơi/xác bị bỏ, zombie thôi đuổi, bảng thành tích bỏ dòng đó.
 */
export function rekeyWorld(state: WorldState, map: (id: string) => string | null): WorldState {
  const s = structuredClone(state);
  s.players = s.players.flatMap((p) => {
    const id = map(p.id);
    return id ? [{ ...p, id }] : [];
  });
  for (const z of s.zombies) {
    if (z.target !== null) z.target = map(z.target);
    if (z.turnedFrom) z.turnedFrom = map(z.turnedFrom);
  }
  if (s.corpses)
    s.corpses = s.corpses.flatMap((c) => {
      const player = map(c.player);
      return player ? [{ ...c, player }] : [];
    });
  if (s.horde) {
    const re = (r: Record<PeerId, number>) => {
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(r)) {
        const id = map(k);
        if (id) out[id] = (out[id] ?? 0) + v;
      }
      return out;
    };
    s.horde.kills = re(s.horde.kills);
    s.horde.downs = re(s.horde.downs);
  }
  return s;
}

const byTile = (a: MapChange, b: MapChange) =>
  a.y - b.y || a.x - b.x || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0);

/** Tách cửa/tường đã đổi ra danh sách `map.changes` (sắp xếp tất định). */
export function mapChangesOf(state: WorldState): MapChange[] {
  const out: MapChange[] = [
    ...state.openDoors.map((d) => ({ x: d.x, y: d.y, kind: 'doorOpen' as const })),
    ...(state.brokenDoors ?? []).map((d) => ({ x: d.x, y: d.y, kind: 'doorBroken' as const })),
    ...(state.brokenWalls ?? []).map((d) => ({ x: d.x, y: d.y, kind: 'wallBroken' as const })),
    ...(state.wallDamage ?? []).map((d) => ({ x: d.x, y: d.y, kind: 'wallDamaged' as const, hp: d.hp })),
  ];
  return out.sort(byTile);
}

/**
 * Ghép file save. `world` đã khóa theo ownerId (`rekeyWorld`), `loot` là replica đã được mọi người xác nhận.
 */
export function buildSave(
  world: WorldState,
  loot: LootReplicaWire,
  meta: { room: string; savedAt: string; names?: Record<string, string> },
): SaveFile {
  const state = structuredClone(world);
  const changes = mapChangesOf(state);
  state.openDoors = [];
  delete state.brokenDoors;
  delete state.brokenWalls;
  delete state.wallDamage;
  const players: SaveFile['players'] = {};
  for (const p of [...state.players].sort((a, b) => (a.id < b.id ? -1 : 1)))
    players[p.id] = meta.names?.[p.id] ? { name: meta.names[p.id] } : {};
  for (const inv of loot.inventories)
    players[inv.id] ??= meta.names?.[inv.id] ? { name: meta.names[inv.id] } : {};
  return {
    format: SAVE_FORMAT,
    saveVersion: SAVE_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    mapVersion: MAP_VERSION,
    room: meta.room,
    seed: worldSeedForRoom(meta.room),
    savedAt: meta.savedAt,
    tick: state.tick,
    players,
    world: { version: WORLD_SAVE_VERSION, state },
    loot: { version: loot.version, state: structuredClone(loot) },
    map: { version: MAP_CHANGES_VERSION, changes },
  };
}

/** Lỗi khi đọc file (tiếng Việt, hiện thẳng cho người chơi). */
export type SaveCheck = { ok: true; save: SaveFile } | { ok: false; error: string };

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const int = (v: unknown): v is number => Number.isSafeInteger(v);

function validWorld(s: WorldState): boolean {
  if (!s || typeof s !== 'object') return false;
  if (!int(s.tick) || s.tick < 0 || !int(s.rngState) || !int(s.nextZombieId)) return false;
  if (
    !Array.isArray(s.players) ||
    s.players.length > 16 ||
    !Array.isArray(s.zombies) ||
    s.zombies.length > 5000
  )
    return false;
  if (!s.players.every((p: PlayerState) => typeof p?.id === 'string' && fin(p.x) && fin(p.y) && fin(p.hp)))
    return false;
  if (!s.zombies.every((z) => int(z?.id) && fin(z.x) && fin(z.y) && fin(z.hp) && typeof z.kind === 'string'))
    return false;
  return Array.isArray(s.flowTargets) && Array.isArray(s.openDoors);
}

function validChanges(list: unknown): list is MapChange[] {
  return (
    Array.isArray(list) &&
    list.length <= 100_000 &&
    list.every(
      (c: MapChange) =>
        !!c &&
        int(c.x) &&
        int(c.y) &&
        (c.kind === 'wallBroken' ||
          c.kind === 'doorBroken' ||
          c.kind === 'doorOpen' ||
          (c.kind === 'wallDamaged' && fin(c.hp))),
    )
  );
}

/** Đọc + kiểm tra file (chuỗi JSON hoặc đối tượng đã parse). Không tải nửa vời: sai một chỗ là từ chối cả file. */
export function parseSave(input: string | unknown): SaveCheck {
  let v: unknown = input;
  if (typeof input === 'string') {
    try {
      v = JSON.parse(input);
    } catch {
      return { ok: false, error: 'File không phải JSON hợp lệ.' };
    }
  }
  const f = v as SaveFile;
  if (!f || typeof f !== 'object' || f.format !== SAVE_FORMAT)
    return { ok: false, error: 'Không phải file save của Zombie Co-op.' };
  if (f.saveVersion !== SAVE_VERSION)
    return {
      ok: false,
      error: `File save phiên bản ${String(f.saveVersion)} — bản game này đọc được ${SAVE_VERSION}.`,
    };
  if (f.mapVersion !== MAP_VERSION)
    return { ok: false, error: 'File save làm từ bản đồ phiên bản khác — không tải được.' };
  if (typeof f.room !== 'string' || !/^[A-Z0-9]{4,12}$/.test(f.room))
    return { ok: false, error: 'Mã phòng trong file không hợp lệ.' };
  if (f.seed !== worldSeedForRoom(f.room)) return { ok: false, error: 'Seed thế giới không khớp mã phòng.' };
  if (f.world?.version !== WORLD_SAVE_VERSION || !validWorld(f.world.state))
    return { ok: false, error: 'Phần thế giới trong file bị hỏng hoặc khác phiên bản.' };
  if (f.loot?.version !== 1 || !isLootSave(f.loot.state, f.seed))
    return { ok: false, error: 'Phần túi đồ/rương trong file bị hỏng hoặc khác phiên bản.' };
  if (f.map?.version !== MAP_CHANGES_VERSION || !validChanges(f.map.changes))
    return { ok: false, error: 'Phần bản đồ đã đổi trong file bị hỏng.' };
  if (typeof f.savedAt !== 'string' || !int(f.tick)) return { ok: false, error: 'Thiếu giờ lưu.' };
  return { ok: true, save: f };
}

/** Tách file đã kiểm tra thành WorldState (người chơi khóa theo ownerId) + replica loot. */
export function restoreSave(save: SaveFile): SavedWorld {
  const state = structuredClone(save.world.state);
  const pick = (k: MapChange['kind']) => save.map.changes.filter((c) => c.kind === k);
  state.openDoors = pick('doorOpen').map(({ x, y }) => ({ x, y }));
  state.brokenDoors = pick('doorBroken').map(({ x, y }) => ({ x, y }));
  state.brokenWalls = pick('wallBroken').map(({ x, y }) => ({ x, y }));
  state.wallDamage = save.map.changes.flatMap((c) =>
    c.kind === 'wallDamaged' ? [{ x: c.x, y: c.y, hp: c.hp }] : [],
  );
  return { world: state, loot: structuredClone(save.loot.state) };
}
