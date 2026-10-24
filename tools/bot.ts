import type { ClientSync } from '@net/clientSync';
import { dayClock } from '@shared/sim/dayNight';
import { Btn, radToAim, type PlayerInput } from '@shared/sim/input';
import { isAlive, isDowned } from '@shared/sim/player';
import { PARTY } from '@shared/sim/tuning/party';
import { Rng } from '@shared/util/rng';

export type BotInput = Omit<PlayerInput, 'seq'>;

const IDLE: BotInput = { moveX: 0, moveY: 0, aim: 0, buttons: 0 };

/**
 * Bot giả lập người chơi (GĐ 7: đo tải 4 người). Chỉ đọc đúng những gì một máy khách thật thấy
 * (ClientSync: nhân vật dự đoán, zombie/đồng đội nội suy) — nên bot đo được cả độ trễ/mất gói.
 * Hành vi: cứu đồng đội gục (R) → đánh zombie gần → lại gần đồng đội → lang thang; máu thấp thì chạy;
 * ban đêm bật đèn pin.
 */
export class Bot {
  private rng: Rng;
  private wanderDir = { x: 1, y: 0 };
  private wanderUntil = 0;
  private lightWanted = false;
  /** Đếm cho báo cáo. */
  stats = { revives: 0, attacks: 0 };

  constructor(
    readonly sync: ClientSync,
    seed: string,
  ) {
    this.rng = new Rng(seed);
  }

  decide(tick: number): BotInput {
    const me = this.sync.predictor.state;
    if (!me || !isAlive(me)) return IDLE;
    const { zombies, others } = this.sync.sample();
    const night = dayClock(this.sync.serverTick()).darkness > 0.5;
    // đèn pin là nút bật/tắt theo cạnh nhấn → chỉ nhấn khi trạng thái khác mong muốn
    this.lightWanted = night;
    const toggleLight = me.flashlight !== this.lightWanted && tick % 4 === 0 ? Btn.Flashlight : 0;

    const nearestZ = closest(zombies, me);
    if (isDowned(me)) {
      // gục: bò về phía đồng đội gần nhất còn đứng được
      const mate = closest(
        others.filter((o) => o.alive && o.downedFor <= 0),
        me,
      );
      return mate ? { ...move(me, mate.p, 1), buttons: toggleLight } : { ...IDLE, buttons: toggleLight };
    }

    const downed = closest(
      others.filter((o) => o.alive && o.downedFor > 0),
      me,
    );
    if (downed && downed.d <= PARTY.reviveRange * 0.8) {
      if (downed.p.reviveProgress === 0) this.stats.revives++;
      return { moveX: 0, moveY: 0, aim: aimAt(me, downed.p), buttons: Btn.Revive | toggleLight };
    }

    if (nearestZ && me.hp < 30 && nearestZ.d < 6) {
      // máu thấp: chạy ngược hướng zombie gần nhất
      return { ...move(nearestZ.p, me, 1), aim: aimAt(me, nearestZ.p), buttons: Btn.Sprint | toggleLight };
    }
    if (nearestZ && nearestZ.d < 1.4) {
      this.stats.attacks++;
      return { moveX: 0, moveY: 0, aim: aimAt(me, nearestZ.p), buttons: Btn.Attack | toggleLight };
    }
    if (nearestZ && nearestZ.d < 7) {
      return { ...move(me, nearestZ.p, 1), aim: aimAt(me, nearestZ.p), buttons: Btn.Attack | toggleLight };
    }
    if (downed && downed.d < 20) return { ...move(me, downed.p, 1), buttons: Btn.Sprint | toggleLight };

    // lang thang theo nhóm: đổi hướng mỗi ~2s, đi xa đồng đội quá thì quay lại
    const mate = closest(
      others.filter((o) => o.alive),
      me,
    );
    if (mate && mate.d > 12) return { ...move(me, mate.p, 1), buttons: toggleLight };
    if (tick >= this.wanderUntil) {
      this.wanderUntil = tick + 30 + this.rng.int(0, 30);
      this.wanderDir = { x: this.rng.int(-1, 1), y: this.rng.int(-1, 1) };
    }
    return {
      moveX: this.wanderDir.x,
      moveY: this.wanderDir.y,
      aim: radToAim(Math.atan2(this.wanderDir.y, this.wanderDir.x)),
      buttons: toggleLight,
    };
  }
}

function closest<T extends { x: number; y: number }>(
  list: readonly T[],
  from: { x: number; y: number },
): { p: T; d: number } | null {
  let best: { p: T; d: number } | null = null;
  for (const p of list) {
    const d = Math.hypot(p.x - from.x, p.y - from.y);
    if (!best || d < best.d) best = { p, d };
  }
  return best;
}

function aimAt(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return radToAim(Math.atan2(to.y - from.y, to.x - from.x));
}

/** Hướng đi -1/0/1 từ a về phía b (dir = 1) — bỏ trục lệch quá nhỏ cho đỡ rung. */
function move(a: { x: number; y: number }, b: { x: number; y: number }, dir: number): BotInput {
  const dx = (b.x - a.x) * dir;
  const dy = (b.y - a.y) * dir;
  return {
    moveX: Math.abs(dx) > 0.3 ? Math.sign(dx) : 0,
    moveY: Math.abs(dy) > 0.3 ? Math.sign(dy) : 0,
    aim: radToAim(Math.atan2(dy, dx)),
    buttons: 0,
  };
}
