import { describe, expect, it } from 'vitest';
import { newRoomCode, normalizeRoomCode } from './roomCode';

describe('mã phòng', () => {
  it('tạo mã 6 ký tự hợp lệ', () => {
    for (let i = 0; i < 100; i++) {
      const c = newRoomCode();
      expect(c).toHaveLength(6);
      expect(normalizeRoomCode(c)).toBe(c);
    }
  });
  it('chuẩn hóa chữ thường, khoảng trắng, gạch ngang', () => {
    expect(normalizeRoomCode(' zk7q-2m ')).toBe('ZK7Q2M');
  });
  it('mã tự tạo không có ký tự dễ nhầm', () => {
    for (let i = 0; i < 200; i++) expect(newRoomCode()).not.toMatch(/[01OIL]/);
  });
  it('chấp nhận mã có số 0/1 từ link, từ chối độ dài sai', () => {
    expect(normalizeRoomCode('TEST10')).toBe('TEST10');
    expect(normalizeRoomCode('AB')).toBeNull();
    expect(normalizeRoomCode('')).toBeNull();
    expect(normalizeRoomCode(null)).toBeNull();
  });
});
