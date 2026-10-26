import type { PlayerInput } from '@shared/sim/input';
import { ZOMBIE_KINDS, type ZombieKind } from '@shared/sim/tuning/zombieKinds';

/**
 * Gói tin trong trận (GĐ 2a), nhị phân + lượng tử hóa (AGENTS.md mục 2.8). Byte đầu = loại gói,
 * đánh số từ 16 để không trùng gói phòng chờ ở codec.ts (Hello/Ping/Pong).
 * Người chơi trong gói được gọi bằng slot (0..255) thay vì PeerId dài — bảng slot gửi qua Roster.
 */
export const enum GameMsg {
  Input = 16,
  Snapshot = 17,
  Events = 18,
  Roster = 19,
  HostClaim = 20,
  /**
   * Ô map đã đổi (khổng lồ húc vỡ tường → ô trống). Gửi reliable: cả danh sách khi vào trận/đổi host, rồi
   * từng ô mới vỡ. Map gốc sinh từ seed nên KHÔNG gửi lại map (AGENTS.md mục 2.6).
   */
  MapDelta = 21,
}

/** Loại thay đổi ô trong MapDelta. */
export const TileChange = { WallBroken: 1 } as const;

/** Tọa độ zombie gửi dạng int16 theo 1/64 ô, so với gốc của gói → phạm vi ±512 ô quanh người nhận. */
export const POS_SCALE = 64;
/**
 * Zombie xa người nhận hơn FAR_ZOMBIE_TILES ô (ngoài màn hình: zoom 3 thấy ~±20 ô ngang) gửi gọn hơn ở khối mở rộng
 * cuối gói: 5 byte/con thay vì 8 — vị trí i8 theo 1/FAR_POS_SCALE ô (±31.75 ô), hướng 16 nấc. Chỉ để chừa băng thông
 * cho loot (đợt tràn tối đa); zombie trên màn hình vẫn chính xác 1/64 ô. Zombie-từ-đồng-đội luôn gửi đủ (cần màu).
 */
export const FAR_ZOMBIE_TILES = 20;
export const FAR_POS_SCALE = 4;

export interface WirePlayer {
  slot: number;
  x: number;
  y: number;
  /** Góc ngắm 0..255 — hướng nhìn người chơi luôn suy ra từ đây nên gửi 1 byte vẫn chính xác. */
  aim: number;
  hp: number;
  stamina: number;
  staminaIdle: number;
  attackCd: number;
  respawnIn: number;
  exhausted: boolean;
  sprinting: boolean;
  prevButtons: number;
  /** Gục/cứu/kéo (GĐ 2c) — gửi trong khối mở rộng cuối snapshot; gói thiếu khối thì = 0/false. */
  downedFor: number;
  reviveProgress: number;
  dragging: boolean;
  /** Đèn pin (GĐ 4) — cờ trong khối mở rộng. */
  flashlight: boolean;
  /** Vũ khí đang cầm (GĐ 3b, `weaponCode`) — khối mở rộng "trang bị"; gói thiếu khối thì = dao thường (1). */
  weapon: number;
}

export interface WireZombie {
  /** 16 bit thấp của id zombie. */
  id: number;
  x: number;
  y: number;
  facing: number;
  chasing: boolean;
  /** Loại zombie (GĐ 4) — nằm ở bit 1–3 của byte cờ; bản cũ chỉ đọc bit 0 (chasing). */
  kind: ZombieKind;
  /** Zombie từ xác đồng đội (GĐ 6): slot của người đó, hoặc null — bit 4–6 của byte cờ (slot + 1). */
  turnedSlot: number | null;
}

/** Vũng độc/axit (GĐ 4) gửi trong khối mở rộng. */
export interface WirePool {
  kind: 'poison' | 'acid';
  x: number;
  y: number;
  radius: number;
  /** Axit còn đang bay tới (chưa gây sát thương). */
  arming: boolean;
  /** Còn bao lâu (giây, làm tròn 0.1). */
  ttl: number;
}

/** Trạng thái đợt tràn (GĐ 5) gửi trong khối mở rộng; null = chưa có đợt nào. */
export interface WireHorde {
  number: number;
  active: boolean;
  /** Kết quả khi xong: true sống sót, false thất bại; null = đang diễn ra. */
  survived: boolean | null;
  /** Còn bao nhiêu zombie đợt tràn (chưa sinh + đang sống). */
  remaining: number;
  bossAlive: boolean;
  /** Bảng thành tích đội theo slot. */
  rows: { slot: number; kills: number; downs: number }[];
}

/**
 * Chỉ số sinh tồn (GĐ 3b) của 1 người — khối mở rộng cuối snapshot. Host gửi của **người nhận** mỗi snapshot (dự đoán +
 * HUD) và của **1 đồng đội xoay vòng** (để lên host thay thì có chỉ số của cả đội, ≤ 0,3 s tuổi). u16 theo 1/VITAL_SCALE.
 */
/** Các trường số trong khối "chỉ số" (thứ tự trên dây; mỗi trường u16 theo 1/VITAL_SCALE, kẹp 0..109). */
export const VITAL_FIELDS = [
  'food',
  'water',
  'infection',
  'maxHp',
  /** máu còn hồi dần + tốc độ (băng gạc) */
  'healLeft',
  'healRate',
  /** đứng yên bao lâu (bộ sơ cứu) */
  'stillFor',
  /** súng (GĐ 3b): đạn trong băng, đang nạp (mã súng, còn bao lâu, bao nhiêu viên), độ giật, số phát mod 64 */
  'magPistol',
  'magRifle',
  'reloadGun',
  'reloadLeft',
  'reloadAmount',
  'recoil',
  'shots',
] as const;
export type VitalField = (typeof VITAL_FIELDS)[number];
export type WireVitals = { slot: number } & Record<VitalField, number>;
export const VITAL_SCALE = 600;

export interface SnapshotMsg {
  type: GameMsg.Snapshot;
  tick: number;
  /** seq của input cuối cùng host đã chạy cho người nhận. */
  ack: number;
  originX: number;
  originY: number;
  players: WirePlayer[];
  zombies: WireZombie[];
  /** Ô cửa đang mở quanh người nhận (tọa độ ô tuyệt đối). */
  doors: { x: number; y: number }[];
  /** Vũng độc/axit quanh người nhận (GĐ 4, khối mở rộng). */
  pools: WirePool[];
  /** Đợt tràn (GĐ 5, khối mở rộng). */
  horde: WireHorde | null;
  /** Chỉ số sinh tồn (GĐ 3b, khối mở rộng): người nhận + 1 đồng đội xoay vòng. Gói cũ không có → []. */
  vitals?: WireVitals[];
}

export type WireEvent =
  | { kind: 'swing'; slot: number; x: number; y: number; facing: number }
  | {
      kind: 'hit';
      slot: number;
      zombie: number;
      x: number;
      y: number;
      killed: boolean;
      assassination: boolean;
      silent: boolean;
      /** Máu zombie còn lại sau đòn. */
      hp: number;
    }
  | { kind: 'bite'; zombie: number; slot: number; x: number; y: number }
  | { kind: 'door'; x: number; y: number; open: boolean }
  | { kind: 'death'; slot: number }
  | { kind: 'respawn'; slot: number }
  /** GĐ 3b: 1 phát súng (tia đạn), `dist` ô. */
  | { kind: 'shot'; slot: number; x: number; y: number; angle: number; dist: number; hit: boolean };

export type GameMessage =
  | { type: GameMsg.Input; inputs: PlayerInput[] }
  | SnapshotMsg
  | { type: GameMsg.Events; tick: number; events: WireEvent[] }
  | { type: GameMsg.Roster; slots: { slot: number; id: string }[] }
  /** hostedMs: đã làm host bao lâu — hai host cùng lúc thì ai làm lâu hơn giữ quyền. */
  | { type: GameMsg.HostClaim; hostedMs: number }
  | { type: GameMsg.MapDelta; tiles: { x: number; y: number; change: number }[] };

const EV = { swing: 1, hit: 2, bite: 3, door: 4, death: 5, respawn: 6, shot: 7 } as const;
const TAU = Math.PI * 2;
const enc = new TextEncoder();
const dec = new TextDecoder();

const angleToByte = (a: number) => Math.round((((a % TAU) + TAU) % TAU) * (256 / TAU)) & 255;
const byteToAngle = (b: number) => (b / 256) * TAU;
const clampI16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v)));
const clampI8 = (v: number) => Math.max(-128, Math.min(127, Math.round(v)));
const vitalToU16 = (v: number) => Math.max(0, Math.min(0xffff, Math.round(v * VITAL_SCALE)));

/** Ghi tuần tự vào bộ đệm tự nới rộng. */
export class Writer {
  private buf = new Uint8Array(256);
  private view = new DataView(this.buf.buffer);
  len = 0;

  private need(n: number) {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  u8(v: number) {
    this.need(1);
    this.view.setUint8(this.len, v);
    this.len += 1;
  }
  i8(v: number) {
    this.need(1);
    this.view.setInt8(this.len, v);
    this.len += 1;
  }
  u16(v: number) {
    this.need(2);
    this.view.setUint16(this.len, v);
    this.len += 2;
  }
  i16(v: number) {
    this.need(2);
    this.view.setInt16(this.len, v);
    this.len += 2;
  }
  u32(v: number) {
    this.need(4);
    this.view.setUint32(this.len, v >>> 0);
    this.len += 4;
  }
  i32(v: number) {
    this.need(4);
    this.view.setInt32(this.len, v);
    this.len += 4;
  }
  f32(v: number) {
    this.need(4);
    this.view.setFloat32(this.len, v);
    this.len += 4;
  }
  f64(v: number) {
    this.need(8);
    this.view.setFloat64(this.len, v);
    this.len += 8;
  }
  bytes(b: Uint8Array) {
    this.need(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
  }
  done(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

/** Đọc tuần tự; đọc quá cuối gói thì ném lỗi (decode bắt lại và trả null). */
export class Reader {
  private view: DataView;
  pos = 0;
  constructor(private buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  private at(n: number) {
    const p = this.pos;
    if (p + n > this.buf.length) throw new RangeError('gói ngắn');
    this.pos += n;
    return p;
  }
  u8 = () => this.view.getUint8(this.at(1));
  i8 = () => this.view.getInt8(this.at(1));
  u16 = () => this.view.getUint16(this.at(2));
  i16 = () => this.view.getInt16(this.at(2));
  u32 = () => this.view.getUint32(this.at(4));
  i32 = () => this.view.getInt32(this.at(4));
  f32 = () => this.view.getFloat32(this.at(4));
  f64 = () => this.view.getFloat64(this.at(8));
  /** Còn dữ liệu chưa đọc (để đọc khối mở rộng nối cuối gói nếu có). */
  more = () => this.pos < this.buf.length;
  bytes = (n: number) => {
    const p = this.at(n);
    return this.buf.subarray(p, p + n);
  };
}

export function encodeGame(msg: GameMessage): Uint8Array {
  const w = new Writer();
  w.u8(msg.type);
  switch (msg.type) {
    case GameMsg.Input:
      w.u8(msg.inputs.length);
      for (const i of msg.inputs) {
        w.u32(i.seq);
        w.i8(i.moveX);
        w.i8(i.moveY);
        w.u8(i.aim);
        w.u8(i.buttons);
      }
      // GĐ 3b (nối cuối): tick đang xem của từng input, u32 (0xffffffff = không có) — bù trễ khi bắn
      for (const i of msg.inputs) w.u32(i.view === undefined ? 0xffffffff : Math.max(0, Math.floor(i.view)));
      break;
    case GameMsg.Snapshot: {
      w.u32(msg.tick);
      w.u32(msg.ack);
      w.i32(msg.originX);
      w.i32(msg.originY);
      w.u8(msg.players.length);
      for (const p of msg.players) {
        w.u8(p.slot);
        w.f64(p.x);
        w.f64(p.y);
        w.u8(p.aim);
        w.f32(p.hp);
        w.f32(p.stamina);
        w.f32(p.staminaIdle);
        w.f32(p.attackCd);
        w.f32(p.respawnIn);
        w.u8((p.exhausted ? 1 : 0) | (p.sprinting ? 2 : 0));
        w.u8(p.prevButtons);
      }
      const far: WireZombie[] = [];
      const near: WireZombie[] = [];
      for (const z of msg.zombies) {
        const d = Math.max(Math.abs(z.x - msg.originX), Math.abs(z.y - msg.originY));
        (d > FAR_ZOMBIE_TILES && z.turnedSlot === null ? far : near).push(z);
      }
      w.u16(near.length);
      for (const z of near) {
        w.u16(z.id & 0xffff);
        w.i16(clampI16((z.x - msg.originX) * POS_SCALE));
        w.i16(clampI16((z.y - msg.originY) * POS_SCALE));
        w.u8(angleToByte(z.facing));
        const turned = z.turnedSlot === null ? 0 : Math.min(7, z.turnedSlot + 1);
        w.u8((z.chasing ? 1 : 0) | (Math.max(0, ZOMBIE_KINDS.indexOf(z.kind)) << 1) | (turned << 4));
      }
      w.u8(msg.doors.length);
      for (const d of msg.doors) {
        w.i16(clampI16(d.x - msg.originX));
        w.i16(clampI16(d.y - msg.originY));
      }
      // khối mở rộng GĐ 2c (nối cuối gói: bản cũ đọc tới cửa là dừng, không đọc nhầm)
      w.u8(msg.players.length);
      for (const p of msg.players) {
        w.u8(p.slot);
        w.f32(p.downedFor);
        w.f32(p.reviveProgress);
        w.u8((p.dragging ? 1 : 0) | (p.flashlight ? 2 : 0));
      }
      // khối mở rộng GĐ 4: vũng độc/axit
      w.u8(Math.min(255, msg.pools.length));
      for (const pool of msg.pools.slice(0, 255)) {
        w.u8(pool.kind === 'acid' ? 1 : 0);
        w.i16(clampI16((pool.x - msg.originX) * POS_SCALE));
        w.i16(clampI16((pool.y - msg.originY) * POS_SCALE));
        w.u8(Math.min(255, Math.round(pool.radius * 16)));
        w.u8(pool.arming ? 1 : 0);
        w.u8(Math.min(255, Math.round(pool.ttl * 10)));
      }
      // khối mở rộng GĐ 5: đợt tràn
      w.u8(msg.horde ? 1 : 0);
      if (msg.horde) {
        const h = msg.horde;
        w.u8(h.number & 0xff);
        w.u8(
          (h.active ? 1 : 0) |
            (h.survived === true ? 2 : 0) |
            (h.survived === false ? 4 : 0) |
            (h.bossAlive ? 8 : 0),
        );
        w.u16(Math.min(0xffff, h.remaining));
        w.u8(h.rows.length);
        for (const row of h.rows) {
          w.u8(row.slot);
          w.u16(Math.min(0xffff, row.kills));
          w.u8(Math.min(255, row.downs));
        }
      }
      // khối mở rộng: zombie xa (gọn)
      w.u16(far.length);
      for (const z of far) {
        w.u16(z.id & 0xffff);
        w.i8(clampI8((z.x - msg.originX) * FAR_POS_SCALE));
        w.i8(clampI8((z.y - msg.originY) * FAR_POS_SCALE));
        w.u8(
          (Math.round((((z.facing % TAU) + TAU) % TAU) * (16 / TAU)) & 15) |
            (z.chasing ? 16 : 0) |
            ((Math.max(0, ZOMBIE_KINDS.indexOf(z.kind)) & 7) << 5),
        );
      }
      // khối mở rộng GĐ 3b: chỉ số sinh tồn
      const vitals = msg.vitals ?? [];
      w.u8(vitals.length);
      for (const v of vitals) {
        w.u8(v.slot);
        for (const f of VITAL_FIELDS) w.u16(vitalToU16(v[f]));
      }
      // khối mở rộng GĐ 3b: trang bị (vũ khí đang cầm) của mọi người
      w.u8(msg.players.length);
      for (const p of msg.players) {
        w.u8(p.slot);
        w.u8(p.weapon & 0xff);
      }
      break;
    }
    case GameMsg.Events:
      w.u32(msg.tick);
      w.u16(msg.events.length);
      for (const e of msg.events) writeEvent(w, e);
      break;
    case GameMsg.Roster:
      w.u8(msg.slots.length);
      for (const s of msg.slots) {
        const id = enc.encode(s.id).subarray(0, 255);
        w.u8(s.slot);
        w.u8(id.length);
        w.bytes(id);
      }
      break;
    case GameMsg.HostClaim:
      w.u32(Math.max(0, Math.min(0xffffffff, Math.floor(msg.hostedMs))));
      break;
    case GameMsg.MapDelta:
      w.u32(msg.tiles.length);
      for (const t of msg.tiles) {
        w.i32(t.x);
        w.i32(t.y);
        w.u8(t.change);
      }
      break;
  }
  return w.done();
}

function writeEvent(w: Writer, e: WireEvent) {
  w.u8(EV[e.kind]);
  switch (e.kind) {
    case 'swing':
      w.u8(e.slot);
      w.f32(e.x);
      w.f32(e.y);
      w.u8(angleToByte(e.facing));
      break;
    case 'hit':
      w.u8(e.slot);
      w.u16(e.zombie & 0xffff);
      w.f32(e.x);
      w.f32(e.y);
      w.u8((e.killed ? 1 : 0) | (e.assassination ? 2 : 0) | (e.silent ? 4 : 0));
      w.f32(e.hp);
      break;
    case 'bite':
      w.u16(e.zombie & 0xffff);
      w.u8(e.slot);
      w.f32(e.x);
      w.f32(e.y);
      break;
    case 'door':
      w.i32(e.x);
      w.i32(e.y);
      w.u8(e.open ? 1 : 0);
      break;
    case 'death':
    case 'respawn':
      w.u8(e.slot);
      break;
    case 'shot':
      w.u8(e.slot);
      w.f32(e.x);
      w.f32(e.y);
      w.u16(Math.round((((e.angle % TAU) + TAU) % TAU) * (65536 / TAU)) & 0xffff);
      w.u8(Math.max(0, Math.min(255, Math.round(e.dist * 10))));
      w.u8(e.hit ? 1 : 0);
      break;
  }
}

/** Giải mã. Gói hỏng/lạ/không phải gói trong trận → null (không bao giờ ném lỗi vì dữ liệu từ mạng). */
export function decodeGame(buf: Uint8Array): GameMessage | null {
  if (buf.length < 1) return null;
  try {
    const r = new Reader(buf);
    const type = r.u8();
    switch (type) {
      case GameMsg.Input: {
        const n = r.u8();
        const inputs: PlayerInput[] = [];
        for (let i = 0; i < n; i++) {
          inputs.push({ seq: r.u32(), moveX: r.i8(), moveY: r.i8(), aim: r.u8(), buttons: r.u8() });
        }
        if (r.more())
          for (const i of inputs) {
            const v = r.u32();
            if (v !== 0xffffffff) i.view = v;
          }
        return { type, inputs };
      }
      case GameMsg.Snapshot: {
        const tick = r.u32();
        const ack = r.u32();
        const originX = r.i32();
        const originY = r.i32();
        const players: WirePlayer[] = [];
        for (let i = 0, n = r.u8(); i < n; i++) {
          const slot = r.u8();
          const x = r.f64();
          const y = r.f64();
          const aim = r.u8();
          const hp = r.f32();
          const stamina = r.f32();
          const staminaIdle = r.f32();
          const attackCd = r.f32();
          const respawnIn = r.f32();
          const flags = r.u8();
          const prevButtons = r.u8();
          players.push({
            slot,
            x,
            y,
            aim,
            hp,
            stamina,
            staminaIdle,
            attackCd,
            respawnIn,
            exhausted: (flags & 1) !== 0,
            sprinting: (flags & 2) !== 0,
            prevButtons,
            downedFor: 0,
            reviveProgress: 0,
            dragging: false,
            flashlight: false,
            weapon: 1,
          });
        }
        const zombies: WireZombie[] = [];
        for (let i = 0, n = r.u16(); i < n; i++) {
          const id = r.u16();
          const x = originX + r.i16() / POS_SCALE;
          const y = originY + r.i16() / POS_SCALE;
          const facing = byteToAngle(r.u8());
          const flags = r.u8();
          zombies.push({
            id,
            x,
            y,
            facing,
            chasing: (flags & 1) !== 0,
            kind: ZOMBIE_KINDS[(flags >> 1) & 7] ?? 'normal',
            turnedSlot: (flags >> 4) & 7 ? ((flags >> 4) & 7) - 1 : null,
          });
        }
        const doors: { x: number; y: number }[] = [];
        for (let i = 0, n = r.u8(); i < n; i++) doors.push({ x: originX + r.i16(), y: originY + r.i16() });
        if (r.more()) {
          const bySlot = new Map(players.map((p) => [p.slot, p]));
          for (let i = 0, n = r.u8(); i < n; i++) {
            const p = bySlot.get(r.u8());
            const downedFor = r.f32();
            const reviveProgress = r.f32();
            const flags = r.u8();
            if (p)
              Object.assign(p, {
                downedFor,
                reviveProgress,
                dragging: (flags & 1) !== 0,
                flashlight: (flags & 2) !== 0,
              });
          }
        }
        const pools: WirePool[] = [];
        if (r.more()) {
          for (let i = 0, n = r.u8(); i < n; i++) {
            const kind = r.u8() === 1 ? 'acid' : 'poison';
            const x = originX + r.i16() / POS_SCALE;
            const y = originY + r.i16() / POS_SCALE;
            const radius = r.u8() / 16;
            const arming = r.u8() === 1;
            pools.push({ kind, x, y, radius, arming, ttl: r.u8() / 10 });
          }
        }
        let horde: WireHorde | null = null;
        if (r.more() && r.u8() === 1) {
          const number = r.u8();
          const flags = r.u8();
          const remaining = r.u16();
          const rows: WireHorde['rows'] = [];
          for (let i = 0, n = r.u8(); i < n; i++) rows.push({ slot: r.u8(), kills: r.u16(), downs: r.u8() });
          horde = {
            number,
            active: (flags & 1) !== 0,
            survived: (flags & 2) !== 0 ? true : (flags & 4) !== 0 ? false : null,
            remaining,
            bossAlive: (flags & 8) !== 0,
            rows,
          };
        }
        if (r.more()) {
          for (let i = 0, n = r.u16(); i < n; i++) {
            const id = r.u16();
            const x = originX + r.i8() / FAR_POS_SCALE;
            const y = originY + r.i8() / FAR_POS_SCALE;
            const b = r.u8();
            zombies.push({
              id,
              x,
              y,
              facing: ((b & 15) / 16) * TAU,
              chasing: (b & 16) !== 0,
              kind: ZOMBIE_KINDS[(b >> 5) & 7] ?? 'normal',
              turnedSlot: null,
            });
          }
        }
        const vitals: WireVitals[] = [];
        if (r.more()) {
          for (let i = 0, n = r.u8(); i < n; i++) {
            const v = { slot: r.u8() } as WireVitals;
            for (const f of VITAL_FIELDS) v[f] = r.u16() / VITAL_SCALE;
            vitals.push(v);
          }
        }
        if (r.more()) {
          const bySlot = new Map(players.map((p) => [p.slot, p]));
          for (let i = 0, n = r.u8(); i < n; i++) {
            const p = bySlot.get(r.u8());
            const weapon = r.u8();
            if (p) p.weapon = weapon;
          }
        }
        return { type, tick, ack, originX, originY, players, zombies, doors, pools, horde, vitals };
      }
      case GameMsg.Events: {
        const tick = r.u32();
        const events: WireEvent[] = [];
        for (let i = 0, n = r.u16(); i < n; i++) {
          const e = readEvent(r);
          if (!e) return null;
          events.push(e);
        }
        return { type, tick, events };
      }
      case GameMsg.Roster: {
        const slots: { slot: number; id: string }[] = [];
        for (let i = 0, n = r.u8(); i < n; i++) {
          const slot = r.u8();
          slots.push({ slot, id: dec.decode(r.bytes(r.u8())) });
        }
        return { type, slots };
      }
      case GameMsg.HostClaim:
        return { type, hostedMs: r.u32() };
      case GameMsg.MapDelta: {
        const tiles: { x: number; y: number; change: number }[] = [];
        for (let i = 0, n = r.u32(); i < n; i++) tiles.push({ x: r.i32(), y: r.i32(), change: r.u8() });
        return { type, tiles };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function readEvent(r: Reader): WireEvent | null {
  switch (r.u8()) {
    case EV.swing:
      return { kind: 'swing', slot: r.u8(), x: r.f32(), y: r.f32(), facing: byteToAngle(r.u8()) };
    case EV.hit: {
      const slot = r.u8();
      const zombie = r.u16();
      const x = r.f32();
      const y = r.f32();
      const f = r.u8();
      return {
        kind: 'hit',
        slot,
        zombie,
        x,
        y,
        killed: (f & 1) !== 0,
        assassination: (f & 2) !== 0,
        silent: (f & 4) !== 0,
        hp: r.f32(),
      };
    }
    case EV.bite:
      return { kind: 'bite', zombie: r.u16(), slot: r.u8(), x: r.f32(), y: r.f32() };
    case EV.door:
      return { kind: 'door', x: r.i32(), y: r.i32(), open: r.u8() === 1 };
    case EV.death:
      return { kind: 'death', slot: r.u8() };
    case EV.respawn:
      return { kind: 'respawn', slot: r.u8() };
    case EV.shot: {
      const slot = r.u8();
      const x = r.f32();
      const y = r.f32();
      const angle = (r.u16() / 65536) * TAU;
      const dist = r.u8() / 10;
      return { kind: 'shot', slot, x, y, angle, dist, hit: r.u8() === 1 };
    }
    default:
      return null;
  }
}
