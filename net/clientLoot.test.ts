import { HostServer } from '@host/hostServer';
import { chestLocations } from '@shared/mapgen/chests';
import { generateChunk, worldSeedForRoom } from '@shared/mapgen/world';
import { MapgenSource } from '@shared/sim/mapgenSource';
import type { PeerId } from '@shared/types';
import { describe, expect, it } from 'vitest';
import { ClientLoot, type LootChange } from './clientLoot';
import { GameMsg, encodeGame } from './gameCodec';
import { encodeLoot, isLootPacket } from './lootCodec';
import { LootMessage } from '@shared/types/loot';

const seed = worldSeedForRoom('CLIENTLOOT');
const chest = chestLocations(generateChunk(seed, 0, 0))[0]!;
const items = (slots: readonly ({ quantity: number } | null)[] | undefined) =>
  (slots ?? []).reduce((n, s) => n + (s?.quantity ?? 0), 0);

/** Host thật + ClientLoot nối thẳng (mạng không trễ), `mute` = người đó không nhận gói (máy chậm). */
function setup(ids: PeerId[]) {
  let time = 0;
  const host = new HostServer({ seed, map: new MapgenSource(seed), zombieCount: 0 });
  const mute = new Set<PeerId>();
  const held = new Map<PeerId, Uint8Array[]>(ids.map((id) => [id, []]));
  const loot = new Map(
    ids.map((id) => [
      id,
      new ClientLoot({ seed, owner: id, send: (d) => host.receive(id, d), now: () => time, timeoutMs: 1000 }),
    ]),
  );
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
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
  for (const id of ids)
    host.receive(
      id,
      encodeGame({ type: GameMsg.Input, inputs: [{ seq: 1, moveX: 0, moveY: 0, aim: 0, buttons: 0 }] }),
    );
  for (const id of ids) {
    const p = host.world.players.get(id)!;
    p.x = chest.x;
    p.y = chest.y;
  }
  return { host, loot, step, mute };
}

describe('ClientLoot – lớp dữ liệu loot phía máy khách', () => {
  it('chưa có replica → not_ready; vào trận → ready, túi có dao, báo sự kiện', async () => {
    const { loot, step } = setup(['a']);
    const a = loot.get('a')!;
    const events: LootChange[] = [];
    a.changed.on((e) => events.push(e));
    expect(await a.open(chest.id)).toMatchObject({ ok: false, error: 'not_ready' });
    step();
    expect(a.ready).toBe(true);
    expect(a.inventory!.slots[0]).toMatchObject({ itemId: 'knife' });
    expect(events.map((e) => e.kind)).toContain('ready');
    expect(a.chest(chest.id)).toBeNull(); // rương chưa ai đụng: chưa biết
  });

  it('mở → lấy 1 → lấy hết: tự điền revision; người kia thấy rương qua replica; tổng đồ bảo toàn', async () => {
    const { loot, step } = setup(['a', 'b']);
    step();
    const a = loot.get('a')!;
    const b = loot.get('b')!;
    const pOpen = a.open(chest.id);
    step(2);
    const opened = await pOpen;
    expect(opened.ok).toBe(true);
    const total = items(opened.chest!.slots) + items(a.inventory!.slots) + items(b.inventory!.slots);
    const slot = opened.chest!.slots.findIndex((s) => s !== null);
    const pTake = a.take(chest.id, slot, 1);
    step(2);
    expect((await pTake).ok).toBe(true);
    const pAll = a.takeAll(chest.id);
    step(2);
    const all = await pAll;
    expect(all.ok).toBe(true);
    expect(items(all.chest!.slots)).toBe(0);
    expect(items(b.chest(chest.id)!.slots)).toBe(0);
    expect(items(a.inventory!.slots) + items(b.inventory!.slots)).toBe(total);
    // dữ liệu trả ra là bản sao: sửa không ảnh hưởng trạng thái giữ trong ClientLoot
    (all.inventory!.slots as unknown[])[0] = null;
    expect(a.inventory!.slots[0]).not.toBeNull();
  });

  it('mỗi lúc 1 thao tác sửa đồ (busy); ID rương lạ bị chặn tại máy; xem/sắp xếp/chuyển ô', async () => {
    const { loot, step } = setup(['a']);
    step();
    const a = loot.get('a')!;
    expect(await a.view('v1:00,0:0,0:chest:0')).toMatchObject({ ok: false, error: 'unknown_chest' });
    const first = a.open(chest.id);
    expect(a.busy).toBe(true);
    expect(await a.sort()).toMatchObject({ ok: false, error: 'busy' });
    const v = a.view(chest.id); // xem không bị khóa
    step(2);
    expect((await first).ok).toBe(true);
    expect((await v).ok).toBe(true);
    const mv = a.move(0, 5, 1);
    step(2);
    expect((await mv).inventory!.slots[5]).toMatchObject({ itemId: 'knife' });
    const s = a.sort();
    step(2);
    expect((await s).inventory!.slots[0]).toMatchObject({ itemId: 'knife' });
  });

  it('lệnh của panel UI (command) dùng nguyên revision trong lệnh: revision cũ → stale_revision, không mất đồ', async () => {
    const { loot, step } = setup(['a']);
    step();
    const a = loot.get('a')!;
    const p = a.command({
      type: 'open',
      chestId: chest.id,
      expectedChestRevision: 5,
      expectedInventoryRevision: 1,
    });
    step(2);
    const r = await p;
    expect(r).toMatchObject({ ok: false, error: 'stale_revision' });
    expect(r.chest!.revision).toBe(0);
    expect(items(r.inventory!.slots)).toBe(1);
  });

  it('chưa xác nhận thì túi chưa đổi: người kia chưa ACK → túi mình giữ nguyên dù replica đã có đồ mới', async () => {
    const { loot, step, mute } = setup(['a', 'b']);
    step();
    const a = loot.get('a')!;
    const o = a.open(chest.id);
    step(2);
    await o;
    mute.add('b');
    const before = items(a.inventory!.slots);
    let done = false;
    const all = a.takeAll(chest.id).then((r) => ((done = true), r));
    step(3);
    await Promise.resolve();
    expect(done).toBe(false);
    expect(items(a.inventory!.slots)).toBe(before); // replica có rồi, nhưng chưa xác nhận
    expect(items(a.replica!.inventories.find((e) => e.id === 'a')!.state.slots)).toBeGreaterThan(before);
    mute.delete('b');
    step(2);
    expect((await all).ok).toBe(true);
    expect(items(a.inventory!.slots)).toBeGreaterThan(before);
  });

  it('đổi host khi đang chờ → host_changed; quá giờ → timeout; gói hỏng/term lạ bị bỏ', async () => {
    const { loot, step, mute } = setup(['a', 'b']);
    step();
    const a = loot.get('a')!;
    mute.add('b');
    const p = a.open(chest.id);
    a.resetHost();
    expect(await p).toMatchObject({ ok: false, error: 'host_changed' });
    expect(a.ready).toBe(false);
    // host cũ gửi gì cũng bỏ cho tới khi nhận replica đầy đủ (term của host mới)
    a.receive(encodeLoot({ type: LootMessage.Reply, term: 'x.y', requestId: 'c1', ok: true, revision: 1 }));
    a.receive(new Uint8Array([112, 1, 2, 3]));
    expect(a.stats.rejectedPackets).toBe(1);
    // có thay đổi mới: phần đổi tới a bị bỏ (chưa có term) → a không ACK → host gửi lại bản đầy đủ sau 2s
    void loot.get('b')!.open(chest.id);
    step(42);
    expect(a.ready).toBe(true);
    const q = a.view(chest.id);
    step(25); // b vẫn im → kết quả chờ mãi → hết giờ (1s)
    expect(await q).toMatchObject({ ok: false, error: 'timeout' });
  });
});
