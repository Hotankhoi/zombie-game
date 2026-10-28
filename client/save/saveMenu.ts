import { dayClock } from '@shared/sim/dayNight';
import { parseSave, type SaveFile } from '@shared/save/save';
import { latestSave, markResume, putSave } from './store';

interface SaveMenuOptions {
  room: string;
  /** Mình đang là host → yêu cầu lưu ngay; trả về file vừa lưu (hoặc null nếu quá 3 s). */
  saveNow(): Promise<SaveFile | null>;
  isHost(): boolean;
}

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
};
const label = (f: SaveFile) => `${f.room} · Ngày ${dayClock(f.tick).day} · lưu ${when(f.savedAt)}`;

/** Mở phòng của bản lưu và nạp nó (máy mình lên host nếu phòng chưa có ai chơi). */
function openSaved(room: string): void {
  markResume(room);
  const u = new URL(window.location.href);
  u.searchParams.set('room', room);
  window.location.href = u.toString();
}

function download(file: SaveFile): void {
  const blob = new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `zombie-${file.room}-ngay${dayClock(file.tick).day}.zsave.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * Hàng nút lưu game trong bảng phòng chờ (GĐ 5, `docs/save-format.md` mục 6): "Tiếp tục thế giới đã lưu",
 * "Xuất file save", "Nhập file save" + dòng trạng thái.
 */
export function mountSaveMenu(opts: SaveMenuOptions) {
  const el = document.createElement('div');
  el.className = 'save-menu';
  el.innerHTML = `
    <div class="row"><button data-act="resume" disabled>Tiếp tục thế giới đã lưu</button></div>
    <div class="row"><button data-act="export">Xuất file save</button><button data-act="import">Nhập file save</button>
    <input type="file" accept=".json,.zsave.json,application/json" hidden /></div>
    <div class="save-status"></div>`;
  const resume = el.querySelector<HTMLButtonElement>('[data-act="resume"]')!;
  const status = el.querySelector<HTMLDivElement>('.save-status')!;
  const input = el.querySelector<HTMLInputElement>('input')!;
  let latest: SaveFile | null = null;
  const say = (t: string, bad = false) => {
    status.textContent = t;
    status.classList.toggle('bad', bad);
  };
  const refresh = async () => {
    latest = await latestSave();
    resume.disabled = !latest;
    resume.textContent = latest ? `Tiếp tục thế giới đã lưu (${label(latest)})` : 'Chưa có thế giới đã lưu';
  };
  void refresh();

  resume.addEventListener('click', () => latest && openSaved(latest.room));
  el.querySelector('[data-act="export"]')!.addEventListener('click', async () => {
    const file = opts.isHost() ? await opts.saveNow() : await latestSave(opts.room);
    if (!file) return say('Chưa có bản lưu của phòng này (chỉ máy host lưu).', true);
    download(file);
    say(`Đã xuất ${label(file)}.`);
  });
  el.querySelector('[data-act="import"]')!.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    const check = parseSave(await f.text());
    if (!check.ok) return say(`Không nhập được: ${check.error}`, true);
    if (!(await putSave(check.save))) return say('Trình duyệt không cho lưu (IndexedDB bị tắt?).', true);
    say(`Đã nhập ${label(check.save)} — đang mở phòng…`);
    openSaved(check.save.room);
  });

  return {
    el,
    /** Host vừa tự lưu. */
    saved(file: SaveFile) {
      latest = file;
      resume.disabled = false;
      resume.textContent = `Tiếp tục thế giới đã lưu (${label(file)})`;
    },
    say,
  };
}
