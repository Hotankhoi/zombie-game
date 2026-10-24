import { describe, expect, it } from 'vitest';
import { ClientSync } from '@net/clientSync';
import { GameMsg, decodeGame, encodeGame, type SnapshotMsg } from '@net/gameCodec';
import { decodeRoomFull } from '@net/roomFull';
import { WORLD_BACKUP_MSG, decodeBackup, mergeBackup } from '@net/worldBackup';
import { arenaMap } from '@shared/sim/grid';
import { testZombie } from '@shared/sim/testMaps';
import { Btn, type PlayerInput } from '@shared/sim/input';
import { SIM_TICK_MS, type PeerId } from '@shared/types';
import { Rng } from '@shared/util/rng';
import { BACKUP_EVERY, HostServer, INTEREST_RADIUS, type Outgoing } from './hostServer';

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

  it('host gửi bản sao lưu toàn thế giới mỗi 10s (reliable), xoay vòng từng người', () => {
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
    expect(backups).toHaveLength(4);
    expect(backups.map((b) => b.to).sort()).toEqual(['a', 'a', 'b', 'b']);
    expect(backups[0]!.to).not.toBe(backups[1]!.to);
    expect(backups[0]!.channel).toBe('reliable');
    expect(decodeBackup(backups[1]!.data)!.zombies).toHaveLength(30);
  });

  it('chuyển host có bản sao lưu: giữ cả zombie ở xa người lên host (không chỉ quanh mình)', () => {
    const m = match(['old', 'b'], { old: 0, b: 1 }, 0, 40);
    const inputs = { old: wander('a'), b: wander('b') };
    let backup = null;
    const orig = m.host.tick.bind(m.host);
    m.host.tick = () => {
      const out = orig();
      for (const o of out) if (o.to === 'b' && o.data[0] === WORLD_BACKUP_MSG) backup = decodeBackup(o.data);
      return out;
    };
    // bản lưu gửi xoay vòng: sau 2 lượt chắc chắn b đã nhận
    for (let t = 0; t < BACKUP_EVERY * 2 + 40; t++) m.step((id, tick) => inputs[id as 'old' | 'b'](id, tick));
    expect(backup).not.toBeNull();
    const c = m.clients.get('b')!;
    const latest = c.latest!;
    const keep = new Set(['b']);
    const merged = mergeBackup(
      backup,
      c.toWorldState('m', keep),
      { x: latest.originX, y: latest.originY, radius: INTEREST_RADIUS },
      keep,
    )!;
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
      zombies: [{ id: 1, x, y: 5, facing: 0, chasing: false, kind: 'normal' }],
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
  it('300 zombie quanh người: mỗi snapshot ≤ 200, gần nhất luôn có; client vẫn thấy đủ 300', () => {
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
    expect(Math.max(...sizes)).toBe(200);
    expect(c.sample().zombies).toHaveLength(300);
  });
});
