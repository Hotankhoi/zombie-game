import { describe, expect, it } from 'vitest';
import { SNAPSHOT_EVERY } from '@host/hostServer';
import { AutoTransport } from '@net/auto';
import { LoopbackHub } from '@net/loopback';
import { RelayTransport } from '@net/relay';
import { SIM_TICK_MS } from '@shared/types';
import { runRelayLoadTest } from './relayLoadTest';

/**
 * Chạy qua relay THẬT (chỉ khi có biến RELAY_URL, không thì bỏ qua):
 *   cd relay && npx wrangler dev        (máy mình, cổng 8787)
 *   RELAY_URL=ws://127.0.0.1:8787 npm run loadtest -- --silent=false
 * Hoặc RELAY_URL=wss://zombie-relay.<tên>.workers.dev để đo relay đã deploy (tốn hạn mức thật).
 */
const url = process.env.RELAY_URL ?? '';

describe.skipIf(!url)('relay thật', () => {
  it('4 máy Node nói chuyện qua relay: cả phòng, gửi riêng, rời phòng', async () => {
    const room = `T${Math.floor(Math.random() * 1e6)}`;
    const ids = ['n1', 'n2', 'n3', 'n4'];
    const nets = ids.map((id) => new RelayTransport(url, room, id));
    const got = new Map(ids.map((id) => [id, [] as string[]]));
    nets.forEach((n, i) => n.onMessage((d, f) => got.get(ids[i]!)!.push(`${f}:${d[0]}`)));
    await until(() => nets.every((n) => n.peers().length === 3));
    nets[0]!.send(Uint8Array.of(1));
    nets[1]!.send(Uint8Array.of(2), { to: 'n4' });
    nets[3]!.send(Uint8Array.of(3), { to: ['n1', 'n2'] });
    await until(() => got.get('n4')!.length === 2 && got.get('n1')!.length === 1);
    await new Promise((r) => setTimeout(r, 200));
    expect(got.get('n1')).toEqual(['n4:3']);
    expect(got.get('n2')).toEqual(['n1:1', 'n4:3']);
    expect(got.get('n3')).toEqual(['n1:1']);
    expect(got.get('n4')!.sort()).toEqual(['n1:1', 'n2:2']);
    await nets[2]!.leave();
    await until(() => nets[0]!.peers().length === 2);
    expect(nets[0]!.peers().sort()).toEqual(['n2', 'n4']);
    // cùng id vào lại (mạng chập chờn, mở tab lại): thay kết nối cũ
    const again = new RelayTransport(url, room, 'n3');
    await until(() => nets[0]!.peers().includes('n3') && again.peers().length === 3);
    await Promise.all([...nets, again].map((n) => n.leave()));
  });

  it(
    'tự chuyển đường: không nối thẳng được → sau ~8s đi relay; ?relay=ws vào ngay',
    { timeout: 30_000 },
    async () => {
      const room = `A${Math.floor(Math.random() * 1e6)}`;
      // WebRTC "không nối được": mỗi máy một LoopbackHub riêng (không thấy ai)
      const make = (id: string, direct: boolean) =>
        new AutoTransport(direct ? new LoopbackHub().join(id) : null, new RelayTransport(url, room, id));
      const a = make('a1', true);
      const b = make('b1', true);
      const t0 = Date.now();
      await until(() => a.peers().length === 1 && b.peers().length === 1, 15_000);
      const waited = Date.now() - t0;
      expect(waited).toBeGreaterThan(7000);
      expect(a.routeOf('b1')).toBe('relay');
      const ws = make('w1', false); // ?relay=ws
      await until(() => ws.peers().length === 2);
      // game thật gửi chào (Hello) ngay → máy kia nhận gói relay từ w1 thì chọn relay luôn, không chờ 8s
      ws.send(Uint8Array.of(1));
      await until(() => a.peers().length === 2 && b.peers().length === 2, 2000);
      const got: string[] = [];
      ws.onMessage((d, f) => got.push(`${f}:${d[0]}`));
      a.send(Uint8Array.of(7));
      b.send(Uint8Array.of(8), { to: 'w1', channel: 'unreliable' });
      await until(() => got.length === 2);
      expect(got.sort()).toEqual(['a1:7', 'b1:8']);
      console.log(`chuyển sang relay sau ${waited} ms`);
      await Promise.all([a, b, ws].map((t) => t.leave()));
    },
  );

  it('đo tải 4 người qua relay (thời gian thật)', { timeout: 120_000 }, async () => {
    const r = await runRelayLoadTest({ url, players: 4, seconds: Number(process.env.RELAY_SECONDS ?? 30) });
    console.table([
      {
        'Khung gửi lên/s (cả phòng · host · mỗi khách)': `${r.framesPerSec} · ${r.hostFramesPerSec} · ${r.clientFramesPerSec}`,
        'Gói/khung': r.packetsPerFrame,
        'Snapshot nhận/s mỗi khách': r.snapshotsPerSec,
        'Nhận KB/s mỗi khách': r.downKBps,
        'Ping tới host (ms)': r.pingMs,
        'Giờ chơi/ngày (free)': r.hoursPerDay,
      },
    ]);
    // host gửi snapshot mỗi SNAPSHOT_EVERY tick (10/s): nhận đủ ≥ 80%
    expect(r.snapshotsPerSec).toBeGreaterThan((0.8 * 1000) / SIM_TICK_MS / SNAPSHOT_EVERY);
    expect(r.hoursPerDay).toBeGreaterThanOrEqual(6);
  });
});

async function until(ok: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('hết giờ chờ');
    await new Promise((r) => setTimeout(r, 20));
  }
}
