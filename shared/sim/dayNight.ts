import { SIM_TICK_MS } from '@shared/types';
import { DAY } from './tuning/night';

export interface DayClock {
  /** Ngày thứ mấy (bắt đầu từ 1). */
  day: number;
  /** Thời điểm trong ngày 0..1 (0 = nửa đêm, 0.5 = trưa). */
  time: number;
  /** Độ tối 0 (ban ngày) .. 1 (đêm hẳn), chuyển mượt lúc chạng vạng/rạng sáng. */
  darkness: number;
  night: boolean;
}

/**
 * Đồng hồ ngày/đêm (GĐ 4) — chỉ suy ra từ số tick, nên host và mọi client tính giống hệt nhau,
 * không cần gửi gì thêm qua mạng (snapshot đã có tick). B dùng `night` cho tỉ lệ loot hiếm ban đêm.
 */
export function dayClock(tick: number): DayClock {
  const days = (tick * SIM_TICK_MS) / 1000 / DAY.lengthSec + DAY.startAt;
  const day = Math.floor(days) + 1;
  const time = days - Math.floor(days);
  return { day, time, darkness: darknessAt(time), night: darknessAt(time) >= 0.5 };
}

export function darknessAt(time: number): number {
  if (time >= DAY.nightStart || time < DAY.dawnStart) return 1;
  if (time >= DAY.dawnEnd && time < DAY.duskStart) return 0;
  if (time >= DAY.duskStart) return smooth((time - DAY.duskStart) / (DAY.nightStart - DAY.duskStart));
  return 1 - smooth((time - DAY.dawnStart) / (DAY.dawnEnd - DAY.dawnStart));
}

function smooth(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/** Tick đầu tiên của ngày `day` (ngày bắt đầu lúc nửa đêm). */
export function tickOfDay(day: number): number {
  return Math.ceil(((day - 1 - DAY.startAt) * DAY.lengthSec * 1000) / SIM_TICK_MS - 1e-9);
}
