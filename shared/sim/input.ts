/**
 * Input của một người chơi trong một tick. Dạng gọn, lượng tử hóa sẵn để GĐ 2 gửi qua mạng
 * (AGENTS.md mục 2.8–2.9): hướng đi -1/0/1, góc ngắm 1 byte, nút bấm là bit.
 */
export interface PlayerInput {
  /** Số thứ tự input (tăng dần) — GĐ 2 dùng để ack và resimulate. */
  seq: number;
  /** -1, 0 hoặc 1. */
  moveX: number;
  /** -1, 0 hoặc 1 (dương = đi xuống). */
  moveY: number;
  /** Góc ngắm 0..255 (0 = sang phải, tăng theo chiều kim đồng hồ trên màn hình). */
  aim: number;
  /** Các bit trong Btn. */
  buttons: number;
}

export const Btn = {
  Sprint: 1,
  Attack: 2,
  Interact: 4,
} as const;

export const IDLE_INPUT: PlayerInput = { seq: 0, moveX: 0, moveY: 0, aim: 0, buttons: 0 };

const TAU = Math.PI * 2;

export function aimToRad(aim: number): number {
  return ((aim & 255) / 256) * TAU;
}

export function radToAim(rad: number): number {
  return Math.round((((rad % TAU) + TAU) % TAU) * (256 / TAU)) & 255;
}

export function hasBtn(input: PlayerInput, b: number): boolean {
  return (input.buttons & b) !== 0;
}
