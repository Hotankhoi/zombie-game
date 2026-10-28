import { describe, expect, it } from 'vitest';
import { GUNS, RARITY_DAMAGE } from '@shared/data/guns';
import { SIM_TICK_MS } from '@shared/types';
import { arenaMap } from './grid';
import { fireGun, magOf, spreadUnit } from './guns';
import { Btn, radToAim, type PlayerInput } from './input';
import { createPlayer } from './player';
import { Predictor } from './prediction';
import { testZombie, twoRoomMap } from './testMaps';
import { SimWorld } from './world';

const DT = SIM_TICK_MS / 1000;
const open = () => false;
const idle: PlayerInput = { seq: 0, moveX: 0, moveY: 0, aim: 0, buttons: 0 };

function armed(gun: 'pistol' | 'rifle' = 'pistol') {
  const w = new SimWorld({ seed: 'guns', map: arenaMap(), zombieCount: 0 });
  const p = w.addPlayer('a');
  // sân trống của arenaMap (hàng y = 14, x 18..35 không có tường)
  p.x = 20.5;
  p.y = 14.5;
  w.equip('a', gun, 'common');
  if (gun === 'pistol') p.magPistol = GUNS.pistol.magazine;
  else p.magRifle = GUNS.rifle.magazine;
  return { w, p };
}

describe('súng (GĐ 3b) — mô phỏng', () => {
  it('mỗi phát tốn 1 viên trong băng; hết đạn không bắn; súng lục phải bấm lại mỗi phát', () => {
    const p = createPlayer('a', { x: 5, y: 5 });
    p.weapon = 'pistol';
    p.magPistol = 2;
    expect(fireGun(p, 'pistol', 'common', [], open, true)).not.toBeNull();
    expect(p.magPistol).toBe(1);
    p.attackCd = 0;
    expect(fireGun(p, 'pistol', 'common', [], open, false)).toBeNull(); // giữ chuột: không bắn tiếp
    expect(fireGun(p, 'pistol', 'common', [], open, true)).not.toBeNull();
    p.attackCd = 0;
    expect(p.magPistol).toBe(0);
    expect(fireGun(p, 'pistol', 'common', [], open, true)).toBeNull();
    // súng trường: giữ chuột bắn liên tục theo tốc độ bắn
    const q = createPlayer('b', { x: 5, y: 5 });
    q.magRifle = 5;
    expect(fireGun(q, 'rifle', 'common', [], open, true)).not.toBeNull();
    expect(fireGun(q, 'rifle', 'common', [], open, false)).toBeNull(); // hồi chiêu
    q.attackCd = 0;
    expect(fireGun(q, 'rifle', 'common', [], open, false)).not.toBeNull();
  });

  it('tản tất định theo (người, số phát); độ giật tăng theo phát rồi hồi dần', () => {
    expect(spreadUnit('a', 3)).toBe(spreadUnit('a', 3));
    expect(spreadUnit('a', 3)).not.toBe(spreadUnit('a', 4));
    for (let i = 0; i < 64; i++) expect(Math.abs(spreadUnit('x', i))).toBeLessThanOrEqual(1);
    const { w, p } = armed('rifle');
    const fire: PlayerInput = { ...idle, buttons: Btn.Attack };
    for (let i = 0; i < 40; i++) w.step(new Map([['a', { ...fire, seq: i }]]));
    expect(p.recoil).toBeGreaterThan(GUNS.rifle.recoilDeg);
    expect(p.recoil).toBeLessThanOrEqual(GUNS.rifle.recoilMaxDeg);
    const r = p.recoil;
    for (let i = 0; i < 10; i++) w.step(new Map([['a', { ...idle, seq: 100 + i }]]));
    expect(p.recoil).toBeLessThan(r);
  });

  it('trúng zombie trên đường bắn (sát thương × độ hiếm); tường chặn; súng trường xuyên 1 con', () => {
    const p = createPlayer('a', { x: 10.5, y: 10.5 });
    p.magPistol = 5;
    const z1 = testZombie(1, 14.5, 10.5);
    const z2 = testZombie(2, 16.5, 10.5);
    const shot = fireGun(p, 'pistol', 'rare', [z2, z1], open, true)!;
    expect(shot.hits.map((h) => h.zombie.id)).toEqual([1]);
    expect(z1.hp).toBeCloseTo(100 - GUNS.pistol.damage * RARITY_DAMAGE.rare, 5);
    expect(z2.hp).toBe(100);
    expect(shot.dist).toBeLessThan(4.5);
    const q = createPlayer('b', { x: 10.5, y: 10.5 });
    q.magRifle = 5;
    const r = fireGun(q, 'rifle', 'common', [z1, z2], open, true)!;
    expect(r.hits.map((h) => h.zombie.id)).toEqual([1, 2]);
    // sau tường: không trúng
    const m = twoRoomMap();
    const s = createPlayer('c', { x: 6.5, y: 2.5 });
    s.magPistol = 1;
    const behind = testZombie(3, 10.5, 2.5);
    const blocked = (tx: number, ty: number) => m.isWall(tx, ty);
    const b = fireGun(s, 'pistol', 'common', [behind], blocked, true)!;
    expect(b.hits).toHaveLength(0);
    expect(b.dist).toBeLessThan(2);
    expect(behind.hp).toBe(100);
  });

  it('súng ồn: zombie trong bán kính tiếng ồn kéo tới; dao không ồn tới đó', () => {
    const { w } = armed('pistol');
    const far = testZombie(9, 20.5 - (GUNS.pistol.noise - 2), 14.5);
    far.facing = 0; // quay lưng về người bắn
    w.zombies.push(far);
    w.step(new Map([['a', { ...idle, aim: radToAim(Math.PI / 2), buttons: Btn.Attack }]]));
    w.step(new Map([['a', { ...idle, seq: 2 }]]));
    expect(far.mode).toBe('investigate');
  });

  it('bù trễ: host lùi vị trí zombie về tick người bắn đang nhìn (≤ 10 tick)', () => {
    const { w, p } = armed('pistol');
    // đứng quay lưng, không tự đi (chỉ test dịch tay)
    const still = { facing: 0, wanderMoving: false, wanderIn: 99 };
    const z = testZombie(5, 25.5, 14.5, still);
    w.zombies.push(z);
    for (let i = 0; i < 4; i++) w.step(new Map([['a', { ...idle, seq: i }]]));
    const seenAt = w.tick; // máy người bắn đang vẽ zombie ở đây
    // zombie chạy ngang qua 2 ô (host đã ở chỗ mới, máy khách vẫn thấy chỗ cũ)
    for (let i = 0; i < 4; i++) {
      z.y += 0.5;
      w.step(new Map([['a', { ...idle, seq: 10 + i }]]));
    }
    const shoot = { ...idle, seq: 20, aim: radToAim(0), buttons: Btn.Attack };
    const lagged = { ...shoot, view: seenAt };
    w.step(new Map([['a', lagged]]));
    expect(z.hp).toBeLessThan(100);
    // không bù trễ: bắn vào chỗ cũ thì trượt
    const { w: w2, p: p2 } = armed('pistol');
    const z2 = testZombie(5, 25.5, 16.5, still);
    w2.zombies.push(z2);
    w2.step(new Map([['a', shoot]]));
    expect(z2.hp).toBe(100);
    expect(magOf(p, 'pistol')).toBe(GUNS.pistol.magazine - 1);
    expect(magOf(p2, 'pistol')).toBe(GUNS.pistol.magazine - 1);
  });

  it('nạp đạn: thiếu bao nhiêu nạp bấy nhiêu, hết giờ mới vào băng; không bắn trong lúc nạp', () => {
    const { w, p } = armed('pistol');
    expect(w.reloadNeed('a')).toEqual({ error: 'mag_full' });
    p.magPistol = 3;
    expect(w.reloadNeed('a')).toEqual({ gun: 'pistol', need: GUNS.pistol.magazine - 3 });
    w.beginReload('a', 'pistol', 9);
    expect(w.reloadNeed('a')).toEqual({ error: 'reloading' });
    w.step(new Map([['a', { ...idle, buttons: Btn.Attack }]]));
    expect(p.magPistol).toBe(3);
    for (let i = 0; i < Math.round(GUNS.pistol.reloadSec / DT); i++)
      w.step(new Map([['a', { ...idle, seq: i }]]));
    expect(p.magPistol).toBe(12);
    w.equip('a', 'knife', 'common');
    expect(w.reloadNeed('a')).toEqual({ error: 'no_gun' });
  });

  it('dự đoán phía máy khách khớp host: đạn, hồi chiêu, giật, hướng tia', () => {
    const { w, p } = armed('rifle');
    const pr = new Predictor(w.blocked);
    pr.reconcile({ ...p }, 0);
    const angles: number[] = [];
    for (let i = 1; i <= 30; i++) {
      const input = { ...idle, seq: i, aim: (i * 7) & 255, buttons: i % 10 < 6 ? Btn.Attack : 0 };
      const fx = pr.step(input);
      if (fx?.kind === 'shot') angles.push(fx.angle);
      w.step(new Map([['a', input]]));
    }
    const shots = w.events; // sự kiện tick cuối
    void shots;
    expect(pr.state!.magRifle).toBe(p.magRifle);
    expect(pr.state!.recoil).toBeCloseTo(p.recoil, 6);
    expect(pr.state!.attackCd).toBeCloseTo(p.attackCd, 6);
    expect(pr.state!.shots).toBe(p.shots);
    expect(angles.length).toBe(GUNS.rifle.magazine - p.magRifle);
  });

  it('gậy bóng chày đau hơn dao, không ám sát; tất định hash có vũ khí', () => {
    const w = new SimWorld({ seed: 'bat', map: arenaMap(), zombieCount: 0 });
    const p = w.addPlayer('a');
    w.equip('a', 'bat', 'common');
    const z = testZombie(1, p.x + 1, p.y, { mode: 'wander', facing: 0 });
    w.zombies.push(z);
    w.step(new Map([['a', { ...idle, aim: radToAim(0), buttons: Btn.Attack }]]));
    expect(z.hp).toBe(100 - 55);
    const h = w.hash();
    w.players.get('a')!.weaponRarity = 'epic';
    expect(w.hash()).not.toBe(h);
  });
});
