import { describe, expect, it } from 'vitest';
import { ClientSync } from '@net/clientSync';
import { FAR_ZOMBIE_TILES, GameMsg, decodeGame, encodeGame, type SnapshotMsg } from '@net/gameCodec';
import { decodeRoomFull } from '@net/roomFull';
import {
  BACKUP_PARTS,
  BackupParts,
  WORLD_BACKUP_MSG,
  decodeBackupPart,
  encodeBackup,
  mergeBackup,
} from '@net/worldBackup';
import { arenaMap } from '@shared/sim/grid';
import { testZombie } from '@shared/sim/testMaps';
import { Btn, type PlayerInput } from '@shared/sim/input';
import { SIM_TICK_MS, type PeerId } from '@shared/types';
import { Rng } from '@shared/util/rng';
import {
  BACKUP_EVERY,
  HostServer,
  INTEREST_RADIUS,
  ZOMBIE_BUDGET,
  ZOMBIE_NEAR_ALWAYS,
  ZOMBIE_OFFSCREEN_ROOM,
  snapshotArea,
  type Outgoing,
} from './hostServer';

interface Wire {
  at: number;
  data: Uint8Array;
}

/**
 * Trận giả: 1 host + vài client, mạng trễ `lag` tick mỗi chiều, mất `loss` gói unreliable
 * (input luôn đi unreliable; snapshot cũng vậy; roster/sự kiện reliable).
 */
function match(ids: PeerId[], lag: Record<PeerId, number>, loss = 0, zombieCount = 20) {
  let time = 0;
  const host = new HostServer({ seed: 'm', map: arenaMap(), zombieCount });
  const clients = new Map(ids.map((id) => [id, new ClientSync(id, arenaMap(), () => time)]));
  const toHost: (Wire & { from: PeerId })[] = [];
  const toClient = new Map<PeerId, Wire[]>(ids.map((id) => [id, []]));
  const rng = new Rng('loss');
  let tick = 0;
  let maxErr = 0;
  const seqs = new Map(ids.map((id) => [id, 0]));
  /** Giữ gói input lại tới tick này (giả lập máy khách khựng / mạng giật rồi tới dồn). */
  let holdUntil = -1;

  function step(inputFor: (id: PeerId, t: number) => Omit<PlayerInput, 'seq'>) {
    for (const [id, c] of clients) {
      const seq = (seqs.get(id) ?? 0) + 1;
      seqs.set(id, seq);
      const { packet } = c.tick({ ...inputFor(id, tick), seq });
      const at = Math.max(tick, holdUntil) + (lag[id] ?? 0);
      if (!(loss > 0 && rng.chance(loss))) toHost.push({ from: id, at, data: packet });
    }
    for (let i = toHost.length - 1; i >= 0; i--) {
      const m = toHost[i]!;
      if (m.at <= tick) {
        host.receive(m.from, m.data);
        toHost.splice(i, 1);
      }
    }
    for (const o of host.tick() as Outgoing[]) {
      if (o.channel === 'unreliable' && loss > 0 && rng.chance(loss)) continue;
      toClient.get(o.to)!.push({ at: tick + (lag[o.to] ?? 0), data: o.data });
    }
    for (const [id, q] of toClient) {
      const c = clients.get(id)!;
      while (q.length > 0 && q[0]!.at <= tick) {
        c.receive(q.shift()!.data);
        if (c.predictor.state) maxErr = Math.max(maxErr, c.predictor.lastError);
      }
    }
    tick++;
    time += SIM_TICK_MS;
  }
  const holdInputs = (ticks: number) => {
    holdUntil = tick + ticks;
  };
  return { host, clients, step, holdInputs, maxErr: () => maxErr };
}

/** Đổi phím mỗi ~0.5s, tất định theo id. */
function wander(seed: string) {
  const r = new Rng(seed);
  let cur: Omit<PlayerInput, 'seq'> = { moveX: 0, moveY: 0, aim: 0, buttons: 0 };
  return (_id: PeerId, t: number) => {
    if (t % 10 === 0) {
      cur = {
        moveX: r.int(-1, 1),
        moveY: r.int(-1, 1),
        aim: r.int(0, 255),
        buttons: (r.chance(0.3) ? Btn.Sprint : 0) | (r.chance(0.5) ? Btn.Attack : 0),
      };
    }
    return cur;
  };
}

describe('HostServer + ClientSync', () => {
  it('trễ đều (0 và 3 tick mỗi chiều): dự đoán khớp host, không phải sửa', () => {
    // không zombie: zombie cắn là thứ client không đoán được, không phải lỗi dự đoán
    const m = match(['host', 'far'], { host: 0, far: 3 }, 0, 0);
    const inputs = { host: wander('a'), far: wander('b') };
    for (let t = 0; t < 400; t++) m.step((id, tick) => inputs[id as 'host' | 'far'](id, tick));
    expect(m.maxErr()).toBeLessThan(1e-6);
    for (const [id, c] of m.clients) {
      const real = m.host.world.players.get(id)!;
      // dự đoán chạy trước host đúng số tick trễ → cùng vị trí sau khi host bắt kịp
      expect(Math.hypot(c.predictor.state!.x - real.x, c.predictor.state!.y - real.y)).toBeLessThan(
        0.5 + (id === 'far' ? 3 * 0.35 * 2 : 0),
      );
    }
  });

  it('mất 15% gói: input gửi dư 3 cái nên host gần như không thiếu input', () => {
    const m = match(['a', 'b'], { a: 2, b: 2 }, 0.15, 0);
    const inputs = { a: wander('a'), b: wander('b') };
    for (let t = 0; t < 400; t++) m.step((id, tick) => inputs[id as 'a' | 'b'](id, tick));
    // chỉ khi mất cả 3 gói liên tiếp (~0.3%) host mới thiếu hẳn 1 input → sửa nhỏ (1 tick đi)
    expect(m.maxErr()).toBeLessThan(0.5);
    for (const c of m.clients.values()) expect(c.received).toBeGreaterThan(150);
  });

  it('client khựng rồi gửi dồn (tab treo, mạng giật): host chạy bù, dự đoán vẫn khớp tuyệt đối', () => {
    const m = match(['a'], { a: 2 }, 0, 0);
    const walk = wander('stall');
    for (let t = 0; t < 400; t++) {
      // mỗi 50 tick thì 8 tick liền gói input bị giữ lại rồi tới cùng lúc
      m.step((id, tick) => walk(id, tick));
      if (t % 50 === 20) m.holdInputs(8);
    }
    expect(m.maxErr()).toBeLessThan(1e-9);
    // sau vài tick không giật, host chạy bù xong: chỉ còn vài input đang trên đường (trễ 2 tick mỗi chiều)
    for (let t = 400; t < 430; t++) m.step((id, tick) => walk(id, tick));
    expect(m.clients.get('a')!.predictor.pendingCount).toBeLessThanOrEqual(7);
  });

  it('client thấy zombie quanh mình (nội suy), chỉ trong vùng quan tâm', () => {
    const m = match(['a'], { a: 2 }, 0, 30);
    for (let t = 0; t < 60; t++) m.step(() => ({ moveX: 0, moveY: 0, aim: 0, buttons: 0 }));
    const c = m.clients.get('a')!;
    const { zombies } = c.sample();
    expect(zombies.length).toBeGreaterThan(0);
    const me = m.host.world.players.get('a')!;
    for (const z of zombies) {
      expect(Math.abs(z.x - me.x)).toBeLessThanOrEqual(INTEREST_RADIUS + 1);
      const real = m.host.world.zombies.find((r) => (r.id & 0xffff) === z.id);
      if (real) expect(Math.hypot(real.x - z.x, real.y - z.y)).toBeLessThan(2);
    }
  });

  it('sự kiện: chém trúng zombie → client nhận hit; vết chém của mình không gửi lại', () => {
    const m = match(['a'], { a: 1 }, 0, 0);
    const z = m.host.world;
    for (let t = 0; t < 4; t++) m.step(() => ({ moveX: 0, moveY: 0, aim: 0, buttons: 0 }));
    const me = z.players.get('a')!;
    z.zombies.push(
      testZombie(77, me.x + 0.8, me.y, { facing: Math.PI, mode: 'chase', target: 'a', biteCd: 1 }),
    );
    const c = m.clients.get('a')!;
    for (let t = 0; t < 6; t++) m.step(() => ({ moveX: 0, moveY: 0, aim: 0, buttons: Btn.Attack }));
    expect(c.events.some((e) => e.type === 'hit' && e.zombie === 77)).toBe(true);
    expect(c.events.some((e) => e.type === 'swing')).toBe(false);
  });

  it('chuyển host giữ máu zombie đã bị đánh (qua sự kiện hit) và xác đồng đội chưa thành zombie', () => {
    const m = match(['a', 'b'], { a: 1, b: 1 }, 0, 0);
    const z = m.host.world;
    const idle = () => ({ moveX: 0, moveY: 0, aim: 0, buttons: 0 });
    for (let t = 0; t < 4; t++) m.step(idle);
    const me = z.players.get('a')!;
    const zb = testZombie(77, me.x + 0.8, me.y, { facing: Math.PI, hp: 1000, biteCd: 99 });
    z.zombies.push(zb);
    for (let t = 0; t < 4; t++) m.step((id) => (id === 'a' ? { ...idle(), buttons: Btn.Attack } : idle()));
    expect(zb.hp).toBeLessThan(1000);
    // b chết hẳn: xác nằm lại chờ thành zombie
    const b = z.players.get('b')!;
    b.hp = 0;
    b.downedFor = 0.01;
    for (let t = 0; t < 6; t++) m.step(idle);
    expect(z.corpses.map((c) => c.player)).toEqual(['b']);
    const state = m.clients.get('a')!.toWorldState('m', new Set(['a', 'b']))!;
    expect(state.zombies.find((x) => x.id === 77)!.hp).toBe(Math.fround(zb.hp));
    expect(state.corpses!.map((c) => c.player)).toEqual(['b']);
    expect(state.corpses![0]!.turnIn).toBeGreaterThan(7);
  });

  it('người rời phòng → bị xóa khỏi thế giới, roster gửi lại', () => {
    const m = match(['a', 'b'], { a: 0, b: 0 });
    for (let t = 0; t < 5; t++) m.step(() => ({ moveX: 0, moveY: 0, aim: 0, buttons: 0 }));
    m.host.removePeer('b');
    const out = m.host.tick();
    expect(m.host.world.players.has('b')).toBe(false);
    const roster = out.map((o) => decodeGame(o.data)).find((g) => g?.type === GameMsg.Roster);
    expect(roster?.type === GameMsg.Roster && roster.slots.map((s) => s.id)).toEqual(['a']);
  });

  it('chuyển host: dựng thế giới từ snapshot của client, người chơi giữ nguyên chỗ', () => {
    const m = match(['old', 'b'], { old: 0, b: 1 }, 0, 25);
    const inputs = { old: wander('a'), b: wander('b') };
    for (let t = 0; t < 120; t++) m.step((id, tick) => inputs[id as 'old' | 'b'](id, tick));
    const c = m.clients.get('b')!;
    const state = c.toWorldState('m', new Set(['b']))!;
    expect(state.players.map((p) => p.id)).toEqual(['b']);
    const next = new HostServer({ seed: 'm', map: arenaMap(), zombieCount: 25, restore: state });
    const before = { ...next.world.players.get('b')! };
    expect(Math.hypot(before.x - c.predictor.state!.x, before.y - c.predictor.state!.y)).toBeLessThan(1);
    expect(next.world.zombies.length).toBeGreaterThan(0);
    for (let i = 0; i < 6; i++) {
      next.receive('b', c.tick({ seq: 1000 + i, moveX: 1, moveY: 0, aim: 0, buttons: 0 }).packet);
      next.tick();
    }
    expect(next.world.players.get('b')!.x).toBeGreaterThan(before.x);
    expect(next.world.zombies).toHaveLength(25);
  });

  it('mỗi người nhận đủ thế giới mỗi 10s, chia BACKUP_PARTS mẩu đều mỗi giây (reliable), mẩu nhỏ', () => {
    const host = new HostServer({ seed: 'm', map: arenaMap(), zombieCount: 30 });
    for (const id of ['a', 'b']) {
      host.receive(
        id,
        new ClientSync(id, arenaMap()).tick({ seq: 1, moveX: 0, moveY: 0, aim: 0, buttons: 0 }).packet,
      );
    }
    const backups: Outgoing[] = [];
    for (let t = 0; t < BACKUP_EVERY * 4; t++) {
      for (const o of host.tick()) if (o.data[0] === WORLD_BACKUP_MSG) backups.push(o);
    }
    // 4 lần 10s × BACKUP_PARTS mẩu × 2 người
    expect(backups).toHaveLength(4 * BACKUP_PARTS * 2);
    expect(backups.every((b) => b.channel === 'reliable')).toBe(true);
    for (const id of ['a', 'b']) {
      const mine = backups.filter((b) => b.to === id).slice(0, BACKUP_PARTS);
      const parts = mine.map((b) => decodeBackupPart(b.data)!);
      // 10 mẩu đầu = đủ 0..N-1, mỗi zombie đúng 1 lần
      expect(parts.map((p) => p.part).sort((x, y) => x - y)).toEqual([...Array(BACKUP_PARTS).keys()]);
      const ids = parts.flatMap((p) => p.state.zombies.map((z) => z.id));
      expect(new Set(ids).size).toBe(ids.length);
      const store = new BackupParts();
      for (const b of mine) store.receive(b.data);
      expect(store.assemble()!.zombies).toHaveLength(30);
    }
    // mẩu (trừ mẩu 0 có phần chung) nhỏ hơn hẳn cả gói
    const full = encodeBackup(host.world.state()).length;
    const biggest = Math.max(
      ...backups
        .map((b) => decodeBackupPart(b.data)!)
        .filter((p) => p.part > 0)
        .map((p) => encodeBackup(p.state).length),
    );
    expect(biggest).toBeLessThan(full / 2);
  });

  it('chuyển host có bản sao lưu: giữ cả zombie ở xa người lên host (không chỉ quanh mình)', () => {
    const m = match(['old', 'b'], { old: 0, b: 1 }, 0, 40);
    const inputs = { old: wander('a'), b: wander('b') };
    const store = new BackupParts();
    const orig = m.host.tick.bind(m.host);
    m.host.tick = () => {
      const out = orig();
      for (const o of out) if (o.to === 'b' && o.data[0] === WORLD_BACKUP_MSG) store.receive(o.data);
      return out;
    };
    // sau hơn 10s b đã có đủ mẩu
    for (let t = 0; t < BACKUP_EVERY + 40; t++) m.step((id, tick) => inputs[id as 'old' | 'b'](id, tick));
    expect(store.have).toBe(BACKUP_PARTS);
    const backup = store.assemble();
    expect(backup!.zombies).toHaveLength(m.host.world.zombies.length);
    const c = m.clients.get('b')!;
    const latest = c.latest!;
    const keep = new Set(['b']);
    const merged = mergeBackup(backup, c.toWorldState('m', keep), snapshotArea(latest), keep)!;
    expect(merged.zombies.length).toBeGreaterThanOrEqual(c.toWorldState('m', keep)!.zombies.length);
    const next = new HostServer({ seed: 'm', map: arenaMap(), zombieCount: 40, restore: merged });
    // bản dựng lại theo snapshot cuối (trễ 1 tick); dự đoán đi trước vài tick
    expect(Math.abs(next.world.players.get('b')!.x - c.predictor.state!.x)).toBeLessThan(1.5);
  });
});

describe('ClientSync – ngoại suy khi thiếu snapshot', () => {
  it('snapshot sau chưa tới: zombie đi tiếp theo vận tốc tối đa 3 tick rồi dừng', () => {
    let now = 0;
    const c = new ClientSync('me', arenaMap(), () => now);
    c.receive(encodeGame({ type: GameMsg.Roster, slots: [{ slot: 0, id: 'me' }] }));
    const snap = (tick: number, x: number): SnapshotMsg => ({
      type: GameMsg.Snapshot,
      tick,
      ack: 0,
      originX: 0,
      originY: 0,
      players: [],
      zombies: [{ id: 1, x, y: 5, facing: 0, chasing: false, kind: 'normal', turnedSlot: null }],
      doors: [],
      pools: [],
      horde: null,
    });
    for (const [tick, x] of [
      [10, 5],
      [12, 6],
    ] as const) {
      now = tick * SIM_TICK_MS;
      c.receive(encodeGame(snap(tick, x)));
    }
    // tới thời điểm vẽ ứng với tick 13 (sau snapshot cuối 1 tick): x ≈ 6 + 0.5
    now = 13 * SIM_TICK_MS + c.interpDelayMs;
    expect(c.sample().zombies[0]!.x).toBeCloseTo(6.5, 1);
    // rất lâu sau: chỉ ngoại suy tối đa 3 tick (= +1.5 ô)
    now = 30 * SIM_TICK_MS + c.interpDelayMs;
    expect(c.sample().zombies[0]!.x).toBeCloseTo(7.5, 1);
    expect(c.extrapolated).toBeGreaterThan(0);
  });
});

describe('HostServer – giới hạn 4 người', () => {
  it('người thứ 5 bị từ chối (không vào thế giới, được báo phòng đầy); có người rời thì vào được', () => {
    const host = new HostServer({ seed: 'm', map: arenaMap(), zombieCount: 0 });
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const syncs = new Map(ids.map((id) => [id, new ClientSync(id, arenaMap())]));
    const send = (id: string, seq: number) =>
      host.receive(id, syncs.get(id)!.tick({ seq, moveX: 0, moveY: 0, aim: 0, buttons: 0 }).packet);
    for (const id of ids) send(id, 1);
    const out = host.tick();
    expect(host.clientCount).toBe(4);
    expect(host.world.players.has('e')).toBe(false);
    const full = out.filter((o) => o.to === 'e' && decodeRoomFull(o.data) !== null);
    expect(full).toHaveLength(1);
    expect(decodeRoomFull(full[0]!.data)).toBe(4);
    // gửi tiếp ngay: không báo lặp mỗi gói
    send('e', 2);
    expect(host.tick().filter((o) => o.to === 'e')).toHaveLength(0);
    host.removePeer('a');
    send('e', 3);
    host.tick();
    expect(host.world.players.has('e')).toBe(true);
  });
});

describe('HostServer – GĐ 4', () => {
  it('zombie đang nấp không có trong snapshot; loại zombie và vũng axit đi kèm snapshot', () => {
    const host = new HostServer({ seed: 'm', map: arenaMap(), zombieCount: 0 });
    const c = new ClientSync('a', arenaMap());
    host.receive('a', c.tick({ seq: 1, moveX: 0, moveY: 0, aim: 0, buttons: 0 }).packet);
    host.tick();
    const me = host.world.players.get('a')!;
    host.world.zombies.push(
      testZombie(1, me.x + 5, me.y, { kind: 'hider', hidden: true }),
      testZombie(2, me.x - 5, me.y, { kind: 'giant' }),
    );
    host.world['spit'](me.x + 1, me.y);
    let snap: SnapshotMsg | null = null;
    for (let i = 0; i < 2; i++) {
      for (const o of host.tick()) {
        const g = decodeGame(o.data);
        if (g?.type === GameMsg.Snapshot) snap = g;
      }
    }
    expect(snap!.zombies.map((z) => [z.id, z.kind])).toEqual([[2, 'giant']]);
    expect(snap!.pools).toHaveLength(1);
    expect(snap!.pools[0]).toMatchObject({ kind: 'acid', arming: true });
  });
});

describe('HostServer – ngân sách zombie mỗi snapshot (GĐ 5)', () => {
  it('300 zombie quanh người: mỗi snapshot ≤ ngân sách, gần nhất luôn có; client vẫn thấy đủ 300', () => {
    let time = 0;
    const host = new HostServer({ seed: 'm', map: arenaMap(), zombieCount: 0 });
    const c = new ClientSync('a', arenaMap(), () => time);
    host.receive('a', c.tick({ seq: 1, moveX: 0, moveY: 0, aim: 0, buttons: 0 }).packet);
    for (const o of host.tick()) c.receive(o.data); // roster: client biết slot của mình
    const me = host.world.players.get('a')!;
    for (let i = 0; i < 300; i++) {
      host.world.zombies.push(
        testZombie(i + 1, me.x + 2 + (i % 20), me.y - 8 + Math.floor(i / 20), {
          wanderMoving: false,
          wanderIn: 99,
        }),
      );
    }
    const sizes: number[] = [];
    for (let t = 0; t < 30; t++) {
      for (const o of host.tick()) {
        const g = decodeGame(o.data);
        if (g?.type === GameMsg.Snapshot) {
          sizes.push(g.zombies.length);
          // con gần nhất (cách 2 ô) luôn có mặt
          expect(g.zombies.some((z) => z.id === 1 + 8 * 20)).toBe(true);
        }
        c.receive(o.data);
      }
      time += SIM_TICK_MS;
    }
    expect(Math.max(...sizes)).toBe(ZOMBIE_BUDGET);
    expect(c.sample().zombies).toHaveLength(300);
  });

  it('chỗ xoay vòng ưu tiên zombie trên màn hình; zombie ngoài màn hình tối đa ZOMBIE_OFFSCREEN_ROOM con/snapshot', () => {
    const host = new HostServer({ seed: 'm', map: arenaMap(), zombieCount: 0 });
    host.receive(
      'a',
      encodeGame({ type: GameMsg.Input, inputs: [{ seq: 1, moveX: 0, moveY: 0, aim: 0, buttons: 0 }] }),
    );
    host.tick();
    const me = host.world.players.get('a')!;
    const still = { wanderMoving: false, wanderIn: 99 };
    let id = 1;
    // 130 con sát người, 100 con trên màn hình (cách 10 ô), 100 con ngoài màn hình (cách 25 ô)
    for (let i = 0; i < ZOMBIE_NEAR_ALWAYS; i++)
      host.world.zombies.push(
        testZombie(id++, me.x + 1 + (i % 10) * 0.3, me.y + 1 + Math.floor(i / 10) * 0.3, still),
      );
    for (let i = 0; i < 100; i++)
      host.world.zombies.push(testZombie(id++, me.x + 10, me.y - 5 + i * 0.1, still));
    for (let i = 0; i < 100; i++)
      host.world.zombies.push(testZombie(id++, me.x + FAR_ZOMBIE_TILES + 5, me.y - 5 + i * 0.1, still));
    let snaps = 0;
    for (let t = 0; t < 10; t++) {
      for (const o of host.tick()) {
        const g = decodeGame(o.data);
        if (g?.type !== GameMsg.Snapshot) continue;
        snaps++;
        const far = g.zombies.filter((z) => Math.abs(z.x - g.originX) > FAR_ZOMBIE_TILES).length;
        expect(g.zombies).toHaveLength(ZOMBIE_BUDGET);
        expect(far).toBe(ZOMBIE_OFFSCREEN_ROOM);
      }
    }
    expect(snaps).toBeGreaterThan(0);
  });
});

describe('tường vỡ qua mạng (danh sách ô đã đổi)', () => {
  it('host gửi ô vừa vỡ cho mọi người; người vào sau nhận cả danh sách; máy khách coi ô đó là trống', () => {
    const m = match(['a', 'b'], { a: 1, b: 1 }, 0, 0);
    const idle = () => ({ moveX: 0, moveY: 0, aim: 0, buttons: 0 });
    for (let t = 0; t < 4; t++) m.step(idle);
    const w = m.host.world;
    // arenaMap: tường bao quanh; chọn ô tường ở mép phải cùng hàng với a
    const a = w.players.get('a')!;
    let wx = Math.floor(a.x);
    while (!w.isWall(wx, Math.floor(a.y))) wx++;
    const wy = Math.floor(a.y);
    const s = w.state();
    s.brokenWalls = [{ x: wx, y: wy }];
    // giả lập tick vừa vỡ tường: dựng host mới từ trạng thái có tường vỡ, cùng người chơi
    const host2 = new HostServer({ seed: 'm', map: arenaMap(), zombieCount: 0, restore: s });
    const late = new ClientSync('c', arenaMap());
    host2.receive('c', late.tick({ seq: 1, moveX: 0, moveY: 0, aim: 0, buttons: 0 }).packet);
    const out = host2.tick();
    const deltas = out.filter((o) => o.to === 'c' && decodeGame(o.data)?.type === GameMsg.MapDelta);
    expect(deltas).toHaveLength(1);
    expect(late.blocked(wx, wy)).toBe(true);
    for (const o of out) if (o.to === 'c') late.receive(o.data);
    expect(late.blocked(wx, wy)).toBe(false);
  });

  it('khổng lồ húc vỡ tường trong trận → mọi máy khách nhận MapDelta (reliable)', () => {
    const m = match(['a', 'b'], { a: 1, b: 2 }, 0, 0);
    const idle = () => ({ moveX: 0, moveY: 0, aim: 0, buttons: 0 });
    for (let t = 0; t < 4; t++) m.step(idle);
    const w = m.host.world;
    // arenaMap: phòng (19,3)–(30,10), tường dưới ở hàng y = 10; a đứng ngoài, khổng lồ trong phòng
    const a = w.players.get('a')!;
    a.x = 27.5;
    a.y = 13.5;
    w.zombies.push(
      testZombie(5, 27.5, 7.5, {
        kind: 'giant',
        mode: 'chase',
        target: 'a',
        facing: Math.PI / 2,
        biteCd: 99,
      }),
    );
    const [wx, wy] = [27, 10];
    expect(w.isWall(wx, wy)).toBe(true);
    for (let t = 0; t < 8 * 20 && w.isWall(wx, wy); t++) m.step(idle);
    expect(w.isWall(wx, wy)).toBe(false);
    for (let t = 0; t < 5; t++) m.step(idle);
    for (const id of ['a', 'b']) expect(m.clients.get(id)!.blocked(wx, wy)).toBe(false);
  });
});

describe('sự kiện cắn gộp theo người', () => {
  it('cả bầy cắn cùng tick: mỗi người nhận 1 sự kiện cắn/tick, máu vẫn trừ đủ mọi vết cắn', () => {
    const host = new HostServer({ seed: 'm', map: arenaMap(), zombieCount: 0 });
    host.receive(
      'a',
      encodeGame({ type: GameMsg.Input, inputs: [{ seq: 1, moveX: 0, moveY: 0, aim: 0, buttons: 0 }] }),
    );
    host.tick();
    const me = host.world.players.get('a')!;
    me.hp = 100;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      host.world.zombies.push(
        testZombie(i + 1, me.x + Math.cos(a) * 0.6, me.y + Math.sin(a) * 0.6, {
          mode: 'chase',
          target: 'a',
          biteCd: 0,
        }),
      );
    }
    let maxPerTick = 0;
    let simMaxPerTick = 0;
    for (let t = 0; t < 40 && me.hp > 0; t++) {
      const out = host.tick();
      simMaxPerTick = Math.max(simMaxPerTick, host.world.events.filter((e) => e.type === 'bite').length);
      for (const o of out) {
        const g = decodeGame(o.data);
        if (g?.type === GameMsg.Events) {
          maxPerTick = Math.max(maxPerTick, g.events.filter((e) => e.kind === 'bite').length);
        }
      }
    }
    expect(simMaxPerTick).toBeGreaterThan(1); // mô phỏng vẫn có nhiều vết cắn trong cùng 1 tick
    expect(maxPerTick).toBe(1);
  });
});
