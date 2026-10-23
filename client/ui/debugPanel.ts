import type { ConditionedTransport } from '@net/conditions';

/**
 * Bảng debug mạng (AGENTS.md mục 2.12). Bấm F3 để ẩn/hiện.
 * Thêm trễ / giật / mất gói vào gói gửi đi để thử game khi mạng xấu.
 */
export function mountDebugPanel(root: HTMLElement, net: ConditionedTransport) {
  const el = document.createElement('div');
  el.className = 'panel debug';
  el.innerHTML = `
    <h2>Giả lập mạng (F3)</h2>
    ${slider('latency', 'Trễ', 0, 300, 'ms')}
    ${slider('jitter', 'Giật', 0, 100, 'ms')}
    ${slider('loss', 'Mất gói', 0, 20, '%')}`;
  root.appendChild(el);

  const bind = (id: string, apply: (v: number) => void) => {
    const input = el.querySelector<HTMLInputElement>(`#dbg-${id}`)!;
    const out = el.querySelector<HTMLSpanElement>(`#dbg-${id}-v`)!;
    const unit = out.dataset.unit ?? '';
    const on = () => {
      const v = Number(input.value);
      out.textContent = `${v}${unit}`;
      apply(v);
    };
    input.addEventListener('input', on);
    on();
  };
  bind('latency', (v) => (net.conditions.latencyMs = v));
  bind('jitter', (v) => (net.conditions.jitterMs = v));
  bind('loss', (v) => (net.conditions.loss = v / 100));

  window.addEventListener('keydown', (e) => {
    if (e.key === 'F3') {
      e.preventDefault();
      el.classList.toggle('hidden');
    }
  });
}

function slider(id: string, label: string, min: number, max: number, unit: string) {
  return `<div class="row"><label>${label}</label><input type="range" id="dbg-${id}" min="${min}" max="${max}" value="0" /><span class="val" id="dbg-${id}-v" data-unit="${unit}"></span></div>`;
}
