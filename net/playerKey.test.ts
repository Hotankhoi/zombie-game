import { describe, expect, it } from 'vitest';
import {
  PLAYER_KEY_STORAGE,
  isPlayerKey,
  loadPlayerKey,
  newPlayerKey,
  ownerIdOf,
  replacePlayerKey,
  type KeyStorage,
} from './playerKey';
import { sha256Hex } from './sha256';

class Mem implements KeyStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

describe('sha256', () => {
  it('khớp vector chuẩn FIPS 180-4', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
    expect(sha256Hex('a'.repeat(1000))).toBe(
      '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3',
    );
  });
});

describe('playerKey', () => {
  it('khóa 22 ký tự base64url; ownerId công khai cố định theo khóa, không chứa khóa', () => {
    const key = newPlayerKey();
    expect(isPlayerKey(key)).toBe(true);
    expect(isPlayerKey('short')).toBe(false);
    expect(isPlayerKey('a'.repeat(21) + '!')).toBe(false);
    expect(ownerIdOf(key)).toMatch(/^p[0-9a-f]{24}$/);
    expect(ownerIdOf(key)).toBe(ownerIdOf(key));
    expect(ownerIdOf(key)).not.toContain(key);
    expect(ownerIdOf(newPlayerKey())).not.toBe(ownerIdOf(key));
  });

  it('tải lại tab → cùng khóa (resume); tab mới cùng trình duyệt → khóa chung (không resume); đổi khóa chỉ cho tab đó', () => {
    const local = new Mem();
    const tab1 = new Mem();
    const first = loadPlayerKey(local, tab1);
    expect(first.resume).toBe(false);
    expect(local.getItem(PLAYER_KEY_STORAGE)).toBe(first.key);
    expect(loadPlayerKey(local, tab1)).toEqual({ key: first.key, resume: true });
    const tab2 = new Mem();
    expect(loadPlayerKey(local, tab2)).toEqual({ key: first.key, resume: false });
    const own = replacePlayerKey(tab2);
    expect(own).not.toBe(first.key);
    expect(loadPlayerKey(local, tab2)).toEqual({ key: own, resume: true });
    expect(local.getItem(PLAYER_KEY_STORAGE)).toBe(first.key);
  });

  it('storage hỏng/bị chặn → vẫn có khóa tạm, không ném lỗi', () => {
    const broken: KeyStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const k = loadPlayerKey(broken, null);
    expect(isPlayerKey(k.key)).toBe(true);
    const bad = new Mem();
    bad.setItem(PLAYER_KEY_STORAGE, 'not a key');
    expect(loadPlayerKey(bad, null).key).not.toBe('not a key');
  });
});
