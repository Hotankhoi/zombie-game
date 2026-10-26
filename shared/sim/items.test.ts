import { describe, expect, it } from 'vitest';
import { CONSUMABLES, RARITY_POTENCY } from '@shared/data/consumables';
import { SIM_TICK_MS } from '@shared/types';
import { arenaMap } from './grid';
import type { PlayerInput } from './input';
import { isDowned, isUp } from './player';
import { twoRoomMap } from './testMaps';
import { SimWorld } from './world';

const idle: PlayerInput = { seq: 0, moveX: 0, moveY: 0, aim: 0, buttons: 0 };
const DT = SIM_TICK_MS / 1000;
const bandage = CONSUMABLES.bandage!.healOverTime!;

function world(map = arenaMap()) {
  const w = new SimWorld({ seed: 'items', map, zombieCount: 0 });
  const a = w.addPlayer('a');
  const b = w.addPlayer('b');
  b.x = a.x + 1;
  b.y = a.y;
  const step = (
    sec: number,
    inputs = new Map([
      ['a', idle],
      ['b', idle],
    ]),
  ) => {
    for (let i = 0; i < Math.round(sec / DT); i++) w.step(inputs);
  };
  return { w, a, b, step };
}

describe('dùng đồ (GĐ 3b) — mô phỏng', () => {
  it('băng gạc tự băng: hồi 20 máu trong 8 s (dần dần); băng cho đồng đội nhanh hơn (3 s)', () => {
    const { w, a, b, step } = world();
    a.hp = 50;
    b.hp = 50;
    expect(w.checkItemUse('a', 'bandage', null)).toBeNull();
    w.applyItemUse('a', 'bandage', 'common', null);
    step(1);
    expect(a.hp).toBeCloseTo(50 + bandage.hp / bandage.selfSec, 1);
    step(8);
    expect(a.hp).toBeCloseTo(70, 3);
    expect(a.healLeft).toBe(0);
    w.applyItemUse('a', 'bandage', 'common', 'b');
    step(1);
    expect(b.hp).toBeCloseTo(50 + bandage.hp / bandage.allySec, 1);
    step(3);
    expect(b.hp).toBeCloseTo(70, 3);
  });

  it('băng cho đồng đội đang gục: đứng dậy ngay (không cần giữ R 4 s)', () => {
    const { w, b, step } = world();
    b.hp = 0;
    b.downedFor = 20;
    expect(isDowned(b)).toBe(true);
    expect(w.checkItemUse('a', 'bandage', 'b')).toBeNull();
    w.applyItemUse('a', 'bandage', 'common', 'b');
    expect(isUp(b)).toBe(true);
    expect(b.hp).toBe(CONSUMABLES.bandage!.reviveHp);
    step(4);
    expect(b.hp).toBeCloseTo(CONSUMABLES.bandage!.reviveHp! + bandage.hp, 2);
  });

  it('đồng đội quá xa / bị tường che / chết → no_target; khỏe → not_needed', () => {
    const { w, b } = world();
    b.hp = 40;
    b.x += 3;
    expect(w.checkItemUse('a', 'bandage', 'b')).toBe('no_target');
    const r = new SimWorld({ seed: 'x', map: twoRoomMap(), zombieCount: 0 });
    const p = r.addPlayer('p');
    const q = r.addPlayer('q');
    p.x = 7.7;
    p.y = 2.5;
    q.x = 9.1; // bên kia bức tường x = 8 (cách 1.4 ô)
    q.y = 2.5;
    q.hp = 10;
    expect(r.checkItemUse('p', 'bandage', 'q')).toBe('no_target');
    b.x -= 3;
    b.hp = b.maxHp;
    expect(w.checkItemUse('a', 'bandage', 'b')).toBe('not_needed');
    expect(w.checkItemUse('a', 'medkit', 'b')).toBe('no_target'); // sơ cứu chỉ cho mình
  });

  it('bộ sơ cứu: phải đứng yên ~3 s rồi mới dùng được; hồi 60 ngay', () => {
    const { w, a, step } = world();
    a.hp = 20;
    expect(w.checkItemUse('a', 'medkit', null)).toBe('not_still');
    step(1);
    expect(w.checkItemUse('a', 'medkit', null)).toBe('not_still');
    step(2);
    expect(w.checkItemUse('a', 'medkit', null)).toBeNull();
    w.applyItemUse('a', 'medkit', 'common', null);
    expect(a.hp).toBeCloseTo(80, 1);
    // đi 1 bước → đếm lại từ đầu
    step(0.1, new Map([['a', { ...idle, moveX: 1 }]]));
    expect(a.stillFor).toBe(0);
    expect(w.checkItemUse('a', 'medkit', null)).toBe('not_still');
  });

  it('kháng sinh giảm nhiễm trùng; nước/đồ hộp hồi; độ hiếm mạnh hơn; đầy thì not_needed', () => {
    const { w, a } = world();
    expect(w.checkItemUse('a', 'antibiotics', null)).toBe('not_needed');
    a.infection = 80;
    w.applyItemUse('a', 'antibiotics', 'common', null);
    expect(a.infection).toBeCloseTo(20, 5);
    expect(w.checkItemUse('a', 'water', null)).toBe('not_needed');
    a.water = 10;
    a.food = 10;
    w.applyItemUse('a', 'water', 'common', null);
    w.applyItemUse('a', 'canned_food', 'epic', null);
    expect(a.water).toBeCloseTo(55, 5);
    expect(a.food).toBeCloseTo(10 + 40 * RARITY_POTENCY.epic, 5);
    expect(w.checkItemUse('a', 'knife', null)).toBe('not_usable');
  });

  it('đang gục không tự dùng được; chết hẳn thì hiệu ứng không có tác dụng', () => {
    const { w, a } = world();
    a.hp = 0;
    a.downedFor = 10;
    expect(w.checkItemUse('a', 'bandage', null)).toBe('player_not_up');
    a.downedFor = 0;
    a.respawnIn = 2;
    w.applyItemUse('a', 'medkit', 'common', null);
    expect(a.hp).toBe(0);
  });
});
