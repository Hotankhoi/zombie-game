import { parseSave, type SaveFile } from '@shared/save/save';

/**
 * Lưu thế giới trong IndexedDB của máy host (GĐ 5, `docs/save-format.md` mục 6): database `zombie-coop`, store `saves`,
 * khóa `room#0..2` — giữ 3 bản gần nhất mỗi phòng (ghi đè bản cũ nhất). Không có IndexedDB (chế độ riêng tư…) → mọi
 * hàm trả null/false, game vẫn chạy.
 */
const DB = 'zombie-coop';
const STORE = 'saves';
export const KEEP_SAVES = 3;

interface Row {
  key: string;
  room: string;
  savedAt: string;
  tick: number;
  json: string;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function all(d: IDBDatabase): Promise<Row[]> {
  return new Promise((resolve) => {
    const req = d.transaction(STORE).objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as Row[]);
    req.onerror = () => resolve([]);
  });
}

/** Ghi 1 bản lưu (chỗ trống, hoặc đè bản cũ nhất của phòng đó). */
export async function putSave(file: SaveFile): Promise<boolean> {
  const d = await db();
  if (!d) return false;
  const rows = (await all(d)).filter((r) => r.room === file.room);
  let slot = [...Array(KEEP_SAVES).keys()].find((i) => !rows.some((r) => r.key === `${file.room}#${i}`));
  if (slot === undefined) {
    const oldest = [...rows].sort((a, b) => (a.savedAt < b.savedAt ? -1 : 1))[0]!;
    slot = Number(oldest.key.split('#')[1]);
  }
  const row: Row = {
    key: `${file.room}#${slot}`,
    room: file.room,
    savedAt: file.savedAt,
    tick: file.tick,
    json: JSON.stringify(file),
  };
  return new Promise((resolve) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(row);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

/** Bản lưu mới nhất còn đọc được (của phòng `room`, hoặc mọi phòng). Bản hỏng thì lấy bản trước đó. */
export async function latestSave(room?: string): Promise<SaveFile | null> {
  const d = await db();
  if (!d) return null;
  const rows = (await all(d))
    .filter((r) => !room || r.room === room)
    .sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  for (const r of rows) {
    const check = parseSave(r.json);
    if (check.ok) return check.save;
  }
  return null;
}

/** "Tiếp tục thế giới đã lưu": đánh dấu cho lần mở phòng `room` tới (cùng tab) là nạp bản lưu. */
const RESUME_KEY = 'zombie-coop.resume';
export function markResume(room: string): void {
  try {
    sessionStorage.setItem(RESUME_KEY, room);
  } catch {
    /* không có sessionStorage: bỏ qua */
  }
}
/** Lần mở này có phải "tiếp tục" phòng `room` không (đọc xong thì xóa). */
export function takeResume(room: string): boolean {
  try {
    const v = sessionStorage.getItem(RESUME_KEY);
    sessionStorage.removeItem(RESUME_KEY);
    return v === room;
  } catch {
    return false;
  }
}
