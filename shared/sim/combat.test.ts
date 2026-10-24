import { describe, expect, it } from 'vitest';
import { KNIFE } from '@shared/data/melee';
import { ZOMBIE_NORMAL } from '@shared/data/zombies';
import { Rng } from '@shared/util/rng';
import type { BlockedFn } from './collision';
import { meleeAttack } from './combat';
import { GridMap } from './grid';
import { createPlayer } from './player';
import { createZombie, type ZombieState } from './zombie';

const rng = new Rng(1);
const open: BlockedFn = () => false;

function zombieAt(id: number, x: number, y: number, facing: number): ZombieState {
  const z = createZombie(id, x, y, rng);
  z.facing = facing;
  return z;
}

/** Người ở (5, 5) nhìn sang phải. */
const player = () => createPlayer('p', { x: 5, y: 5 });

describe('meleeAttack – dao', () => {
  it('trúng zombie trong quạt và tầm, zombie quay sang đuổi', () => {
    const p = player();
    const z = zombieAt(1, 6, 5, Math.PI); // đối mặt với người
    const res = meleeAttack(p, KNIFE, [z], open);
    expect(res?.hit?.zombie).toBe(z);
    expect(z.hp).toBe(ZOMBIE_NORMAL.maxHp - KNIFE.damage);
    expect(z.mode).toBe('chase');
    expect(z.target).toBe('p');
    expect(res?.hit?.assassination).toBe(false);
  });

  it('trượt khi zombie ngoài tầm hoặc ngoài quạt', () => {
    const far = zombieAt(1, 5 + KNIFE.range + ZOMBIE_NORMAL.radius + 0.1, 5, Math.PI);
    expect(meleeAttack(player(), KNIFE, [far], open)?.hit).toBeNull();
    const side = zombieAt(2, 5, 6, -Math.PI / 2); // lệch 90° > arcDeg/2
    expect(meleeAttack(player(), KNIFE, [side], open)?.hit).toBeNull();
    expect(far.hp).toBe(ZOMBIE_NORMAL.maxHp);
    expect(side.hp).toBe(ZOMBIE_NORMAL.maxHp);
  });

  it('có hồi chiêu và tốn stamina', () => {
    const p = player();
    const z = zombieAt(1, 6, 5, Math.PI);
    expect(meleeAttack(p, KNIFE, [z], open)).not.toBeNull();
    expect(p.stamina).toBe(100 - KNIFE.staminaCost);
    expect(meleeAttack(p, KNIFE, [z], open)).toBeNull(); // còn hồi chiêu
    p.attackCd = 0;
    p.stamina = KNIFE.staminaCost - 1;
    expect(meleeAttack(p, KNIFE, [z], open)).toBeNull(); // thiếu stamina
  });

  it('chỉ trúng 1 con: con gần nhất', () => {
    const near = zombieAt(1, 5.8, 5, Math.PI);
    const nearer = zombieAt(2, 5.7, 5.1, Math.PI);
    meleeAttack(player(), KNIFE, [near, nearer], open);
    expect(nearer.hp).toBeLessThan(ZOMBIE_NORMAL.maxHp);
    expect(near.hp).toBe(ZOMBIE_NORMAL.maxHp);
  });

  it('không trúng xuyên tường', () => {
    const m = new GridMap(20, 20, { x: 1, y: 1 });
    m.setWall(6, 5);
    const blocked: BlockedFn = (tx, ty) => m.isWall(tx, ty);
    const longKnife = { ...KNIFE, range: 3 };
    const p = createPlayer('p', { x: 5.5, y: 5.5 });
    const z = zombieAt(1, 7.5, 5.5, Math.PI);
    expect(meleeAttack(p, longKnife, [z], blocked)?.hit).toBeNull();
    p.attackCd = 0;
    expect(meleeAttack(p, longKnife, [z], open)?.hit?.zombie).toBe(z);
  });

  it('ám sát từ sau lưng zombie đang lang thang: hạ ngay, không ồn', () => {
    const z = zombieAt(1, 6, 5, 0); // quay lưng về phía người
    const res = meleeAttack(player(), KNIFE, [z], open);
    expect(z.hp).toBe(0);
    expect(res?.hit).toMatchObject({ killed: true, assassination: true, silent: true });
  });

  it('không ám sát được khi đứng trước mặt hoặc khi zombie đang đuổi', () => {
    const front = zombieAt(1, 6, 5, Math.PI);
    meleeAttack(player(), KNIFE, [front], open);
    expect(front.hp).toBeGreaterThan(0);

    const chasing = zombieAt(2, 6, 5, 0);
    chasing.mode = 'chase';
    chasing.target = 'other';
    const res = meleeAttack(player(), KNIFE, [chasing], open);
    expect(chasing.hp).toBeGreaterThan(0);
    expect(res?.hit?.assassination).toBe(false);
  });

  it('3 nhát dao thì chết', () => {
    const p = player();
    const z = zombieAt(1, 6, 5, Math.PI);
    for (let i = 0; i < 3; i++) {
      p.attackCd = 0;
      meleeAttack(p, KNIFE, [z], open);
    }
    expect(z.hp).toBe(0);
  });
});
