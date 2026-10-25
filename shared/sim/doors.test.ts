import { describe, expect, it } from 'vitest';
import { Rng } from '@shared/util/rng';
import { circleOverlapsTile, nearestDoor } from './doors';
import { Btn, type PlayerInput } from './input';
import { DOOR, twoRoomMap } from './testMaps';
import { SimWorld } from './world';
import { createZombie } from './zombie';

const press: PlayerInput = { seq: 0, moveX: 0, moveY: 0, aim: 0, buttons: Btn.Interact };
const none: PlayerInput = { ...press, buttons: 0 };

function worldNearDoor() {
  const w = new SimWorld({ seed: 1, map: twoRoomMap(), zombieCount: 0 });
  const p = w.addPlayer('p');
  p.x = 7.4;
  p.y = 4.5;
  const step = (i: PlayerInput) => w.step(new Map([['p', i]]));
  return { w, p, step };
}

describe('cửa', () => {
  it('người đang gục không mở hoặc đóng cửa bằng E', () => {
    const { w, p, step } = worldNearDoor();
    w.addPlayer('rescuer');
    p.downedFor = 20;
    step(press);
    expect(w.doors.isOpen(DOOR.x, DOOR.y)).toBe(false);
    w.doors.set(DOOR.x, DOOR.y, true);
    step(none);
    step(press);
    expect(w.doors.isOpen(DOOR.x, DOOR.y)).toBe(true);
  });
  it('mặc định đóng (chặn đường), E mở, E lần nữa đóng', () => {
    const { w, step } = worldNearDoor();
    expect(w.blocked(DOOR.x, DOOR.y)).toBe(true);
    step(press);
    expect(w.doors.isOpen(DOOR.x, DOOR.y)).toBe(true);
    expect(w.blocked(DOOR.x, DOOR.y)).toBe(false);
    expect(w.events).toContainEqual({ type: 'door', x: DOOR.x, y: DOOR.y, open: true });
    step(none);
    step(press);
    expect(w.doors.isOpen(DOOR.x, DOOR.y)).toBe(false);
  });

  it('giữ E nhiều tick chỉ tính 1 lần bấm', () => {
    const { w, step } = worldNearDoor();
    for (let i = 0; i < 5; i++) step(press);
    expect(w.doors.isOpen(DOOR.x, DOOR.y)).toBe(true);
  });

  it('ngoài tầm với thì không mở được', () => {
    const { w, p, step } = worldNearDoor();
    p.x = 3.5;
    step(press);
    expect(w.doors.isOpen(DOOR.x, DOOR.y)).toBe(false);
  });

  it('không đóng được khi có người đứng trong khung cửa', () => {
    const { w, p, step } = worldNearDoor();
    step(press);
    p.x = 8.5; // đứng giữa ô cửa
    step(none);
    step(press);
    expect(w.doors.isOpen(DOOR.x, DOOR.y)).toBe(true);
  });

  it('không đóng được khi có zombie đứng trong khung cửa', () => {
    const { w, step } = worldNearDoor();
    step(press);
    w.zombies.push(createZombie(99, 8.5, 4.5, new Rng(1)));
    step(none);
    step(press);
    expect(w.doors.isOpen(DOOR.x, DOOR.y)).toBe(true);
  });

  it('nearestDoor + circleOverlapsTile', () => {
    const m = twoRoomMap();
    expect(nearestDoor(m, { x: 7.5, y: 4.5 }, 1.6)).toEqual(DOOR);
    expect(nearestDoor(m, { x: 4.5, y: 4.5 }, 1.6)).toBeNull();
    expect(circleOverlapsTile(7.75, 4.5, 0.3, 8, 4)).toBe(true);
    expect(circleOverlapsTile(7.6, 4.5, 0.3, 8, 4)).toBe(false);
  });
});
