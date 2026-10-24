import type { Session } from '@net/session';

interface LobbyOptions {
  room: string;
  maxPlayers: number;
  getName(): string;
  setName(name: string): void;
  newRoom(): void;
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );

/** Bảng phòng chờ (HTML): mã phòng, nút copy link mời, đổi tên, danh sách người chơi + ping. */
export function mountLobbyPanel(root: HTMLElement, opts: LobbyOptions) {
  const el = document.createElement('div');
  el.className = 'panel';
  el.innerHTML = `
    <h1>ZOMBIE <span>CO-OP</span></h1>
    <div class="sub">Giai đoạn 0 · phòng chờ thử kết nối</div>
    <div class="row"><label>Mã phòng</label><div class="code"></div><button data-act="copy">Copy link mời</button></div>
    <div class="row"><label>Tên bạn</label><input type="text" maxlength="24" /><button data-act="save">Lưu</button></div>
    <div class="row"><button data-act="new">Tạo phòng mới</button></div>
    <ul class="peers"></ul>
    <div class="status"></div>`;
  root.appendChild(el);

  const preview = new URLSearchParams(window.location.search);
  if (preview.get('loot') === '1') {
    void import('./loot/preview').then(({ mountLootPreview }) => mountLootPreview(root));
  } else if (preview.get('inventory') === '1') {
    void import('./inventory/preview').then(({ mountInventoryPreview }) => mountInventoryPreview(root));
  }

  const code = el.querySelector<HTMLDivElement>('.code')!;
  const input = el.querySelector<HTMLInputElement>('input')!;
  const list = el.querySelector<HTMLUListElement>('.peers')!;
  const status = el.querySelector<HTMLDivElement>('.status')!;
  const copyBtn = el.querySelector<HTMLButtonElement>('[data-act="copy"]')!;
  code.textContent = opts.room;
  input.value = opts.getName();

  const save = () => {
    const v = input.value.trim().slice(0, 24);
    if (v) opts.setName(v);
  };
  el.querySelector('[data-act="save"]')!.addEventListener('click', save);
  input.addEventListener('keydown', (e) => e.key === 'Enter' && save());
  el.querySelector('[data-act="new"]')!.addEventListener('click', () => opts.newRoom());
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      copyBtn.textContent = 'Đã copy!';
    } catch {
      copyBtn.textContent = 'Copy thủ công từ thanh địa chỉ';
    }
    setTimeout(() => (copyBtn.textContent = 'Copy link mời'), 1800);
  });

  return {
    update(session: Session, netError: string | null) {
      const peers = [...session.peers.values()];
      list.innerHTML = peers
        .map((p) => {
          const ping = p.versionMismatch
            ? '<span class="bad">khác phiên bản</span>'
            : p.rttMs === null
              ? 'đang đo…'
              : `${Math.round(p.rttMs)} ms · ${p.pongs} pong`;
          return `<li><span class="dot" style="background:${hex(p.color)}"></span><span class="name">${esc(p.name)}</span><span class="ping">${ping}</span></li>`;
        })
        .join('');
      const n = peers.length + 1;
      status.innerHTML = netError
        ? `<span class="bad">Lỗi mạng: ${esc(netError)}</span>`
        : peers.length === 0
          ? 'Đang chờ người khác vào phòng… Gửi link mời cho bạn bè.'
          : `${n}/${opts.maxPlayers} người trong phòng${n > opts.maxPlayers ? ' — quá số người cho phép!' : ''}`;
    },
  };
}
