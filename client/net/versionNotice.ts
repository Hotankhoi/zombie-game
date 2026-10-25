import type { UpdateNotice } from '@net/session';

/**
 * Nhắc tải lại trang khi khác phiên bản (net/session.ts `updateNotice`):
 * - 'old': mình là bản cũ → bảng che giữa màn hình, không chơi chung được với người bản mới.
 * - 'newer': cùng giao thức, có người build mới hơn → dải nhỏ trên cùng, vẫn chơi bình thường.
 * Ẩn được dải nhỏ (✕); bảng 'old' thì không (chơi tiếp cũng không ghép được trận với họ).
 */
export function mountVersionNotice(parent: HTMLElement): { update(notice: UpdateNotice): void } {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;left:50%;transform:translateX(-50%);z-index:50;display:none;align-items:center;gap:10px;' +
    'font:14px system-ui,sans-serif;color:#fff;border-radius:8px;box-shadow:0 4px 16px #0008;';
  const text = document.createElement('span');
  const reload = document.createElement('button');
  reload.textContent = 'Tải lại';
  reload.style.cssText = 'font:inherit;padding:6px 14px;border:0;border-radius:6px;cursor:pointer;';
  reload.addEventListener('click', () => window.location.reload());
  const close = document.createElement('button');
  close.textContent = '✕';
  close.title = 'Ẩn';
  close.style.cssText = 'font:inherit;background:none;border:0;color:#fff;cursor:pointer;';
  let dismissed = false;
  close.addEventListener('click', () => {
    dismissed = true;
    el.style.display = 'none';
  });
  el.append(text, reload, close);
  parent.appendChild(el);

  let shown: UpdateNotice = null;
  return {
    update(notice) {
      if (notice === shown) return;
      shown = notice;
      if (notice === null || (notice === 'newer' && dismissed)) {
        el.style.display = 'none';
        return;
      }
      el.style.display = 'flex';
      if (notice === 'old') {
        text.textContent = 'Bạn đang dùng bản cũ, bấm để tải lại';
        el.style.top = '40%';
        el.style.padding = '18px 22px';
        el.style.background = '#8e2424';
        reload.style.background = '#fff';
        close.style.display = 'none';
      } else {
        text.textContent = 'Có bản mới, nên tải lại';
        el.style.top = '8px';
        el.style.padding = '6px 10px';
        el.style.background = '#2d5f8a';
        reload.style.background = '#e3f2fd';
        close.style.display = '';
      }
    },
  };
}
