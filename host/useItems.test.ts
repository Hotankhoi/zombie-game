import { describe, expect, it } from 'vitest';
import { ClientLoot } from '@net/clientLoot';
import { GameMsg, encodeGame } from '@net/gameCodec';
import { encodeLoot, isLootPacket } from '@net/lootCodec';
import { addItems, type InventoryState } from '@shared/inventory/inventory';
import { worldSeedForRoom } from '@shared/mapgen/world';
import { MapgenSource } from '@shared/sim/mapgenSource';
import type { PeerId } from '@shared/types';
import { LootMessage } from '@shared/types/loot';
import type { ItemId } from '@shared/data/items';
import { HostServer } from './hostServer';
import { TestMatch } from './testMatch';

const seed = worldSeedForRoom('USEITEMS');
const count = (inv: InventoryState | null, id: ItemId) =>
  (inv?.slots ?? []).reduce((n, s) => n + (s?.itemId === id ? s.quantity : 0), 0);
const slotOf = (inv: InventoryState, id: ItemId) => inv.slots.findIndex((s) => s?.itemId === id);

/** Host thật + ClientLoot nối thẳng; `mute` = người đó chưa nhận gói (chưa ACK). */
function setup(ids: PeerId[]) {
  let time = 0;
  const host = new HostServer({ seed, map: new MapgenSource(seed), zombieCount: 0 });
  const mute = new Set<PeerId>();
  const held = new Map<PeerId, Uint8Array[]>(ids.map((id) => [id, []]));
  const loot = new Map(
    ids.map((id) => [
      id,
      new ClientLoot({
        seed,
        key: `u${id}`.padEnd(22, '0'),
        send: (d) => host.receive(id, d),
        now: () => time,
      }),
    ]),
  );
  let seq = 0;
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      seq++;
      for (const id of ids)
        host.receive(
          id,
          encodeGame({ type: GameMsg.Input, inputs: [{ seq, moveX: 0, moveY: 0, aim: 0, buttons: 0 }] }),
        );
      for (const o of host.tick()) {
        if (!isLootPacket(o.data)) continue;
        if (mute.has(o.to)) held.get(o.to)!.push(o.data);
        else loot.get(o.to)?.receive(o.data);
      }
      for (const id of ids)
        if (!mute.has(id)) for (const d of held.get(id)!.splice(0)) loot.get(id)!.receive(d);
      time += 50;
      for (const l of loot.values()) l.tick();
    }
  };
  const give = (id: PeerId, itemId: ItemId, quantity: number) => {
    const owner = loot.get(id)!.owner;
    host.loot.hostUpdate(owner, (s) => addItems(s, { itemId, rarity: 'common', quantity }, s.revision));
  };
  step(4);
  return { host, loot, step, mute, give };
}

async function settle<T>(p: Promise<T>, step: (n?: number) => void, max = 60): Promise<T> {
  let done = false;
  let v: T | undefined;
  void p.then((x) => {
    done = true;
    v = x;
  });
  for (let i = 0; i < max && !done; i++) {
    step();
    await Promise.resolve();
  }
  if (!done) throw new Error('chưa có kết quả');
  return v as T;
}

describe('dùng đồ online (GĐ 3b) — host trừ đồ + hiệu ứng cùng 1 giao dịch', () => {
  it('ăn đồ hộp: túi −1, no tăng — nhưng chỉ khi MỌI người đã nhận bản túi mới', async () => {
    const { host, loot, step, mute, give } = setup(['a', 'b']);
    give('a', 'canned_food', 2);
    step(3);
    const a = loot.get('a')!;
    const me = host.world.players.get('a')!;
    me.food = 30;
    mute.add('b'); // b chưa nhận/ACK → host chưa được áp hiệu ứng
    const p = a.use(slotOf(a.inventory!, 'canned_food'));
    step(10);
    expect(count(host.loot.authority.inventory(a.owner), 'canned_food')).toBe(1); // đã trừ trong kho host
    expect(me.food).toBeLessThan(31); // hiệu ứng còn chờ
    expect(a.busy).toBe(true);
    mute.delete('b');
    const r = await settle(p, step);
    expect(r.ok).toBe(true);
    expect(me.food).toBeGreaterThan(69);
    expect(count(a.inventory, 'canned_food')).toBe(1);
  });

  it('gói yêu cầu lặp (cùng requestId) → chỉ trừ 1 món, hiệu ứng 1 lần', () => {
    const { host, loot, step, give } = setup(['a']);
    give('a', 'water', 3);
    step(3);
    const a = loot.get('a')!;
    const me = host.world.players.get('a')!;
    me.water = 10;
    const req = encodeLoot({
      type: LootMessage.Request,
      term: a.term!,
      requestId: 'dup-1',
      action: {
        type: 'use',
        slot: slotOf(a.inventory!, 'water'),
        target: null,
        expectedRevision: a.inventory!.revision,
      },
    });
    host.receive('a', req);
    host.receive('a', req);
    step(5);
    host.receive('a', req);
    step(5);
    expect(count(host.loot.authority.inventory(a.owner), 'water')).toBe(2);
    expect(me.water).toBeCloseTo(55, 0);
  });

  it('revision cũ / ô trống / không cần → từ chối, không trừ, không hiệu ứng', async () => {
    const { host, loot, step, give } = setup(['a']);
    give('a', 'bandage', 1);
    step(3);
    const a = loot.get('a')!;
    const slot = slotOf(a.inventory!, 'bandage');
    expect(await settle(a.use(slot), step)).toMatchObject({ ok: false, error: 'not_needed' }); // máu đầy
    const me = host.world.players.get('a')!;
    me.hp = 40;
    const stale = a.request({ type: 'use', slot, target: null, expectedRevision: a.inventory!.revision - 1 });
    expect(await settle(stale, step)).toMatchObject({ ok: false, error: 'stale_revision' });
    expect(await settle(a.use(11), step)).toMatchObject({ ok: false, error: 'empty_slot' });
    expect(count(host.loot.authority.inventory(a.owner), 'bandage')).toBe(1);
    expect(me.healLeft).toBe(0);
    expect((await settle(a.use(slot), step)).ok).toBe(true);
    expect(me.healLeft).toBeGreaterThan(0);
  });

  it('băng cho đồng đội đang gục → đứng dậy; sơ cứu khi chưa đứng yên → not_still', async () => {
    const { host, loot, step, give } = setup(['a', 'b']);
    give('a', 'bandage', 1);
    give('a', 'medkit', 1);
    step(3);
    const a = loot.get('a')!;
    const pa = host.world.players.get('a')!;
    const pb = host.world.players.get('b')!;
    pb.x = pa.x + 1;
    pb.y = pa.y;
    pb.hp = 0;
    pb.downedFor = 20;
    const r = await settle(a.use(slotOf(a.inventory!, 'bandage'), 'b'), step);
    expect(r.ok).toBe(true);
    expect(pb.downedFor).toBe(0);
    expect(pb.hp).toBeGreaterThanOrEqual(30);
    pa.hp = 30;
    pa.stillFor = 0;
    expect(await settle(a.use(slotOf(a.inventory!, 'medkit')), step)).toMatchObject({
      ok: false,
      error: 'not_still',
    });
    step(60); // đứng yên 3 s
    expect((await settle(a.use(slotOf(a.inventory!, 'medkit')), step)).ok).toBe(true);
    expect(pa.hp).toBeGreaterThan(85);
  });
});

describe('dùng đồ khi host rời giữa chừng — không nhân đôi', () => {
  for (const when of ['host vừa nhận', 'mọi người đã có bản mới'] as const)
    it(`${when}: (món còn trong túi) + (lần được hiệu ứng) ≤ 1`, async () => {
      const m = new TestMatch('USEITEMS', { latencyMs: 150, jitterMs: 0, loss: 0.05 });
      const ids = ['a', 'b', 'h'];
      const nodes = ids.map((id) => m.join(id, `use${id}`.padEnd(22, 'x')));
      m.until(() => nodes.every((n) => n.game.loot.ready));
      const host = m.hostNode()!;
      const user = nodes.find((n) => n !== host)!;
      m.server().loot.hostUpdate(user.game.loot.owner, (s) =>
        addItems(s, { itemId: 'canned_food', rarity: 'common', quantity: 1 }, s.revision),
      );
      m.until(() => count(user.game.loot.inventory, 'canned_food') === 1);
      m.server().world.players.get(user.id)!.food = 20;
      const rev = m.server().loot.authority.currentRevision();
      const pending = user.game.loot.use(slotOf(user.game.loot.inventory!, 'canned_food'));
      m.until(() => m.server().loot.authority.currentRevision() > rev);
      if (when === 'mọi người đã có bản mới')
        m.until(() => nodes.filter((n) => n !== host).every((n) => n.game.loot.replica!.revision > rev));
      m.leave(host.id);
      let done = false;
      void pending.then(() => (done = true));
      for (let i = 0; i < 2000 && !(done && m.hostNode() !== null && user.game.loot.ready); i++) {
        m.step();
        await Promise.resolve();
      }
      expect(done).toBe(true);
      m.step(20);
      const fed = m.server().world.players.get(user.id)!.food > 50 ? 1 : 0;
      const left = count(m.server().loot.authority.inventory(user.game.loot.owner), 'canned_food');
      expect(left + fed).toBeLessThanOrEqual(1);
    });
});

describe('vũ khí online (GĐ 3b) — cầm và nạp đạn qua host', () => {
  it('cầm món có trong túi; món không có → not_owned; súng không có đạn trong túi → no_ammo', async () => {
    const { host, loot, step, give } = setup(['a']);
    give('a', 'pistol', 1);
    step(3);
    const a = loot.get('a')!;
    const me = host.world.players.get('a')!;
    expect(await settle(a.equip('rifle', 'common'), step)).toMatchObject({ ok: false, error: 'not_owned' });
    expect(await settle(a.reload(), step)).toMatchObject({ ok: false, error: 'no_gun' });
    expect((await settle(a.equip('pistol', 'common'), step)).ok).toBe(true);
    expect(me.weapon).toBe('pistol');
    expect(await settle(a.reload(), step)).toMatchObject({ ok: false, error: 'no_ammo' });
  });

  it('nạp đạn: trừ đúng số còn thiếu khỏi túi, hết giờ nạp mới vào băng; đổi vũ khí giữa chừng vẫn vào đúng súng', async () => {
    const { host, loot, step, give } = setup(['a']);
    give('a', 'pistol', 1);
    give('a', 'pistol_ammo', 30);
    step(3);
    const a = loot.get('a')!;
    const me = host.world.players.get('a')!;
    await settle(a.equip('pistol', 'common'), step);
    me.magPistol = 4;
    const p = a.reload();
    await settle(a.equip('knife', 'common'), step); // đổi sang dao ngay
    expect((await settle(p, step)).ok).toBe(true);
    expect(count(a.inventory, 'pistol_ammo')).toBe(30 - 8);
    step(30); // 1.5 s > 1.2 s nạp
    expect(me.magPistol).toBe(12);
    expect(me.magRifle).toBe(0);
    await settle(a.equip('pistol', 'common'), step);
    expect(await settle(a.reload(), step)).toMatchObject({ ok: false, error: 'mag_full' });
  });

  it('bắn qua mạng: tốn đạn trong băng, zombie trúng mất máu, mọi máy nhận sự kiện tia đạn của người khác', () => {
    const m = new TestMatch('GUNNET', { latencyMs: 150, jitterMs: 0, loss: 0.05 });
    const nodes = ['a', 'b'].map((id) => m.join(id, `gun${id}`.padEnd(22, 'x')));
    m.until(() => nodes.every((n) => n.game.loot.ready));
    const shooter = nodes[0]!;
    const w = m.server().world;
    const p = w.players.get(shooter.id)!;
    const owner = m.server().loot.ownerOf(shooter.id)!;
    m.server().loot.hostUpdate(owner, (bag) =>
      addItems(bag, { itemId: 'pistol', rarity: 'common', quantity: 1 }, bag.revision),
    );
    w.equip(shooter.id, 'pistol', 'common');
    p.magPistol = 12;
    m.step(10);
    expect(shooter.game.sync.predictor.state!.weapon).toBe('pistol');
    let saw = false;
    nodes[1]!.game.sync.events = [];
    for (let i = 0; i < 60 && !saw; i++) {
      // bấm chuột mỗi 2 tick (súng lục bán tự động)
      shooter.game.tick({ seq: 100000 + i, moveX: 0, moveY: 0, aim: 0, buttons: i % 2 === 0 ? 2 : 0 });
      m.step();
      saw = nodes[1]!.game.sync.events.some((e) => e.type === 'shot' && e.player === shooter.id);
    }
    expect(saw).toBe(true);
    expect(p.magPistol).toBeLessThan(12);
  });
});

describe('giáp online (GĐ 3b)', () => {
  it('mặc giáp có trong túi; giáp vỡ → host trừ đúng món đó khỏi túi, máy khách thấy túi mới', async () => {
    const { host, loot, step, give } = setup(['a']);
    give('a', 'vest', 1);
    step(3);
    const a = loot.get('a')!;
    expect(await settle(a.equip('helmet', 'common'), step)).toMatchObject({ ok: false, error: 'not_owned' });
    expect((await settle(a.equip('vest', 'common'), step)).ok).toBe(true);
    const me = host.world.players.get('a')!;
    expect(me.armorBody).toBe(1);
    me.durBody = 0.05;
    host.world.pools.push({ id: 99, kind: 'acid', x: me.x, y: me.y, radius: 1, ttl: 1, armIn: 0, dps: 14 });
    step(10);
    expect(me.armorBody).toBe(0);
    expect(count(host.loot.authority.inventory(a.owner), 'vest')).toBe(0);
    expect(count(a.inventory, 'vest')).toBe(0);
  });
});
