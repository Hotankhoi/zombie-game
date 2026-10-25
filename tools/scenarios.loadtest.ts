import { it } from 'vitest';
import { runLoadTest, type LoadReport } from './loadTest';

/**
 * Bảng đo tải đầy đủ (GĐ 7): `npm run loadtest`. Mất vài phút. In bảng ra màn hình.
 * Mục tiêu (AGENTS.md mục 2): 4 người + 500 zombie trong đợt tràn, ≤ 25 KB/s mỗi người.
 */
it('đo tải 4 người', { timeout: 30 * 60_000 }, () => {
  const reports: LoadReport[] = [
    runLoadTest({ name: 'Bình thường, mạng tốt', zombieCount: 200, seconds: 60 }),
    runLoadTest({ name: 'Trễ 150ms + mất 5%', zombieCount: 200, seconds: 60, latencyMs: 150, loss: 0.05 }),
    runLoadTest({
      name: 'Đợt tràn tối đa (500 + 4 Boss), bất tử',
      zombieCount: 200,
      seconds: 90,
      latencyMs: 150,
      loss: 0.05,
      startDay: 150,
      startTime: 0.799,
      immortal: true,
    }),
    runLoadTest({
      name: 'Đợt tràn 1 (150 + Boss), bot tự chơi',
      zombieCount: 200,
      seconds: 120,
      latencyMs: 150,
      loss: 0.05,
      startDay: 15,
      startTime: 0.799,
    }),
  ];
  console.table(
    reports.map((r) => ({
      'Kịch bản': r.name,
      'Zombie TB/max': `${r.zombiesAvg}/${r.zombiesMax}`,
      'Host ms/tick TB·p95·max': `${r.hostTickAvgMs} · ${r.hostTickP95Ms} · ${r.hostTickMaxMs}`,
      'Khách ms/tick': r.clientTickAvgMs,
      'Nhận KB/s TB·đỉnh5s·đỉnh5s 1 người': `${r.downKBps} · ${r.downPeakKBps} · ${r.downPeakMaxKBps}`,
      'Gửi KB/s': r.upKBps,
      'Lệch dự đoán max (ô) · sửa/phút': `${r.predictionErrMax} · ${r.correctionsPerMin}`,
      'Mất snapshot %': r.snapshotsLostPct,
      'Giết/chết/cứu': `${r.kills}/${r.deaths}/${r.revives}`,
      'Đợt tràn': r.horde,
    })),
  );
});
