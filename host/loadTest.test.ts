import { describe, expect, it } from 'vitest';
import { runLoadTest } from '../tools/loadTest';

/**
 * Bản chạy nhanh của công cụ đo tải (tools/loadTest.ts) để CI bắt lỗi: 4 bot × 15 giây, trễ 150ms + mất 5%.
 * Bảng đo đầy đủ (đợt tràn 500 zombie, 60–120 giây): `npm run loadtest`.
 */
describe('đo tải (bản nhanh)', () => {
  it('4 bot, trễ 150ms + mất 5%: chơi được, băng thông trong ngân sách, dự đoán không lệch lớn', () => {
    const r = runLoadTest({
      name: 'ci',
      players: 4,
      seconds: 15,
      latencyMs: 150,
      loss: 0.05,
      zombieCount: 60,
      loot: [60, 120],
    });
    expect(r.players).toBe(4);
    expect(r.zombiesMax).toBeGreaterThanOrEqual(60);
    expect(r.downKBps).toBeLessThan(25);
    expect(r.upKBps).toBeLessThan(2);
    // mất 3 gói input liên tiếp mới lệch: rất hiếm, và nhỏ
    expect(r.predictionErrMax).toBeLessThan(1);
    expect(r.snapshotsLostPct).toBeGreaterThan(0);
    // bot mở rương thật qua mạng (trễ 150ms): có thao tác thành công, đồ vào túi, loot ≤ 3 KB/s mỗi người
    expect(r.lootVisits).toBeGreaterThan(0);
    expect(r.lootOk).toBeGreaterThan(4);
    expect(r.lootItems).toBeGreaterThan(4);
    expect(r.lootPeakMaxKBps).toBeLessThan(3);
  });
});
