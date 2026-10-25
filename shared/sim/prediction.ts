import { KNIFE } from '@shared/data/melee';
import { SIM_TICK_MS } from '@shared/types';
import type { BlockedFn } from './collision';
import { meleeAttack } from './combat';
import { Btn, hasBtn, type PlayerInput } from './input';
import { isUp, stepPlayer, type PlayerState } from './player';

const DT = SIM_TICK_MS / 1000;
/** Giữ tối đa bấy nhiêu input chưa được host xác nhận (3 giây). */
const MAX_PENDING = 60;
/** Lệch quá xa (vd: hồi sinh, bị kéo về) thì nhảy luôn, không làm mượt. */
const SNAP_DIST = 2;
/** Thời gian (ms) để độ lệch hiển thị giảm còn ~37%. */
const SMOOTH_MS = 100;

/**
 * Client prediction cho nhân vật của chính mình (AGENTS.md mục 2.3).
 * Mỗi tick chạy ngay input của mình bằng code mô phỏng dùng chung; khi host gửi trạng thái
 * kèm số input đã xử lý (ack) thì đặt lại theo host rồi chạy lại các input chưa được xác nhận.
 * Sai lệch không bị giật: dồn vào `offset` (cộng vào chỗ vẽ) và giảm dần.
 */
export class Predictor {
  state: PlayerState | null = null;
  /** Độ lệch hiển thị (ô): vẽ tại state + offset. */
  offsetX = 0;
  offsetY = 0;
  /** Vị trí trước tick vừa chạy — để vẽ nội suy giữa 2 tick. Reconcile dời cả cái này theo. */
  prevX = 0;
  prevY = 0;
  /** Độ lớn sai lệch ở lần reconcile gần nhất (ô) — hiện ở bảng F3. */
  lastError = 0;
  private pending: PlayerInput[] = [];

  constructor(private blocked: BlockedFn) {}

  /** Chạy 1 tick với input mới của mình. Trả về true nếu tick này chém (để vẽ vết chém ngay). */
  step(input: PlayerInput): boolean {
    this.pending.push(input);
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    if (!this.state) return false;
    this.prevX = this.state.x;
    this.prevY = this.state.y;
    return this.simulate(this.state, input);
  }

  /** Nhận trạng thái của mình từ host, đã xử lý tới input số ackSeq. */
  reconcile(server: PlayerState, ackSeq: number): void {
    while (this.pending.length > 0 && (this.pending[0] as PlayerInput).seq <= ackSeq) this.pending.shift();
    const before = this.state;
    const next: PlayerState = { ...server };
    for (const input of this.pending) this.simulate(next, input);
    this.state = next;
    if (!before) {
      this.prevX = next.x;
      this.prevY = next.y;
      return;
    }
    const dx = next.x - before.x;
    const dy = next.y - before.y;
    this.lastError = Math.hypot(dx, dy);
    if (Math.hypot(this.offsetX - dx, this.offsetY - dy) > SNAP_DIST) {
      this.offsetX = this.offsetY = 0;
      this.prevX = next.x;
      this.prevY = next.y;
    } else {
      // dời cả khung nội suy, bù bằng offset → chỗ vẽ không nhảy, rồi trôi dần về chỗ đúng
      this.offsetX -= dx;
      this.offsetY -= dy;
      this.prevX += dx;
      this.prevY += dy;
    }
  }

  /** Giảm dần độ lệch hiển thị — gọi mỗi frame. */
  decay(dtMs: number): void {
    const k = Math.exp(-dtMs / SMOOTH_MS);
    this.offsetX *= k;
    this.offsetY *= k;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  private simulate(p: PlayerState, input: PlayerInput): boolean {
    stepPlayer(p, input, DT, this.blocked);
    let swung = false;
    // chém: chỉ đoán hồi chiêu + stamina; trúng zombie nào là do host quyết (GĐ 2b chuyển sang client)
    if (isUp(p) && hasBtn(input, Btn.Attack)) swung = meleeAttack(p, KNIFE, [], this.blocked) !== null;
    p.prevButtons = input.buttons;
    return swung;
  }
}
