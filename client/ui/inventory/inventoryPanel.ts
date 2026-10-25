import {
  BACKPACKS,
  CATEGORY_NAMES,
  ITEMS,
  RARITIES,
  type ItemCategory,
  type ItemId,
} from '@shared/data/items';
import {
  isInventoryState,
  type InventoryCommand,
  type InventoryError,
  type InventoryResult,
  type InventoryState,
} from '@shared/inventory/inventory';
import './inventory.css';

export const INVENTORY_MESSAGES: Record<InventoryError, string> = {
  invalid_state: 'Dữ liệu túi đồ không hợp lệ. Hãy tải lại dữ liệu trước khi tiếp tục.',
  invalid_command: 'Thao tác không hợp lệ.',
  stale_revision: 'Túi đồ vừa thay đổi. Hãy chọn lại vật phẩm để tiếp tục.',
  invalid_item: 'Vật phẩm không hợp lệ.',
  invalid_quantity: 'Nhập số nguyên từ 1 đến số lượng đang có.',
  invalid_slot: 'Ô đồ không hợp lệ.',
  empty_slot: 'Ô này đang trống.',
  same_slot: 'Hãy chọn một ô khác.',
  stack_full: 'Ô đích không đủ chỗ. Giảm số lượng hoặc chọn một ô trống.',
  partial_swap: 'Muốn đổi chỗ hai vật phẩm, hãy chọn toàn bộ số lượng.',
  inventory_full: 'Túi không đủ chỗ. Hãy gộp bớt đồ hoặc dùng balo lớn hơn.',
  invalid_backpack: 'Balo không hợp lệ.',
};
const ICONS: Record<ItemCategory, string> = {
  weapon: '<path d="m8 25 5-5m-3-3 7 7m-4-7L25 5l2 2-10 14M6 27l3-3"/>',
  ammo: '<path d="M8 27V12l3-6 3 6v15Zm10 0V12l3-6 3 6v15ZM8 22h6m4 0h6"/>',
  medical: '<path d="M6 10h20v17H6zM11 10V6h10v4m-5 4v9m-4-4h8"/>',
  food: '<path d="M11 4h10v5l3 5v13H8V14l3-5Zm0 5h10M8 17h16m-12 4h8"/>',
  material: '<path d="m6 11 10-6 10 6v14L16 29 6 25Zm0 0 10 6 10-6M16 17v12M11 8l10 6"/>',
};
const ITEM_ICONS: Partial<Record<ItemId, string>> = {
  pistol: '<path d="M5 10h23v6H17l-3 11H8l2-11H5Zm14 6v4h-5M24 10V7"/>',
  rifle: '<path d="M3 13h24v5H14l-3 7H7l2-7H3Zm24 2h4M17 18v5h5l-1-5M5 13V9m16 4V9"/>',
  bat: '<path d="m7 26 6-8 7-12c2-3 6-1 5 2l-9 12-6 8M6 25l5 4"/>',
  canned_food:
    '<ellipse cx="16" cy="8" rx="9" ry="4"/><path d="M7 8v17c0 5 18 5 18 0V8M7 15h18M7 22h18m-12-3h8"/>',
  antibiotics: '<path d="m10 9 8-4c6-3 12 6 6 10l-10 8c-6 4-12-5-7-10Zm2-2 10 10"/>',
};
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function icon(category: ItemCategory, itemId?: ItemId) {
  const el = element('span', 'inv-icon');
  el.innerHTML = `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(itemId && ITEM_ICONS[itemId]) || ICONS[category]}</svg>`;
  return el;
}

/** Online authority may also fail with network/host codes (net/clientLoot); text comes from `describeError`. */
export type InventoryPanelResult = InventoryResult | { ok: false; state: InventoryState; error: string };
export interface InventoryPanelOptions {
  initial: InventoryState;
  /** Send intent to authority; render only the returned or pushed authoritative snapshot. */
  onCommand(command: InventoryCommand): InventoryPanelResult | Promise<InventoryPanelResult>;
  /** Text for error codes outside INVENTORY_MESSAGES (online: host/network codes). */
  describeError?(code: string): string;
}

/** One panel per inventory identity. No global keyboard listeners, optimistic grants or render loop. */
export function mountInventoryPanel(parent: HTMLElement, options: InventoryPanelOptions) {
  if (!isInventoryState(options.initial)) throw new Error('Invalid initial inventory');
  let state = options.initial;
  let selected: number | null = null;
  let busy = false;
  let disposed = false;
  const root = element('section', 'inventory');
  root.setAttribute('aria-label', 'Túi đồ');
  const header = element('header', 'inv-header');
  const heading = element('div', '');
  heading.append(element('p', 'inv-eyebrow', 'HÀNH TRANG'), element('h1', '', 'Sẵn sàng lên đường'));
  const bag = element('div', 'inv-bag');
  header.append(heading, bag);
  const toolbar = element('div', 'inv-toolbar');
  const capacity = element('span', 'inv-capacity');
  const sort = element('button', 'inv-sort', 'Sắp xếp & gộp');
  sort.type = 'button';
  toolbar.append(capacity, sort);
  const body = element('div', 'inv-body');
  const grid = element('div', 'inv-grid');
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', 'Các ô hành trang');
  const detail = element('aside', 'inv-detail');
  const artwork = element('div', 'inv-artwork');
  const rarity = element('p', 'inv-rarity');
  const title = element('h2', 'inv-item-name');
  const description = element('p', 'inv-description');
  const stackInfo = element('p', 'inv-stack-info');
  const controls = element('div', 'inv-controls');
  const label = element('label', 'inv-quantity-label', 'Số lượng chuyển');
  const quantity = element('input', 'inv-quantity');
  quantity.type = 'number';
  quantity.min = '1';
  quantity.step = '1';
  quantity.value = '1';
  quantity.inputMode = 'numeric';
  label.append(quantity);
  const quick = element('div', 'inv-quick');
  const half = element('button', '', 'Một nửa');
  half.type = 'button';
  const all = element('button', '', 'Tất cả');
  all.type = 'button';
  const cancel = element('button', 'inv-cancel', 'Bỏ chọn');
  cancel.type = 'button';
  quick.append(half, all);
  controls.append(
    label,
    quick,
    element('p', 'inv-hint', 'Chọn ô đích để chuyển. Chọn toàn bộ để đổi chỗ với vật phẩm khác.'),
    cancel,
  );
  detail.append(artwork, rarity, title, description, stackInfo, controls);
  body.append(grid, detail);
  const status = element('p', 'inv-status', 'Chọn một vật phẩm để xem và di chuyển.');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const footer = element('p', 'inv-footer', 'Chạm hoặc dùng Tab + Enter để chọn ô. Esc để bỏ chọn.');
  root.append(header, toolbar, body, status, footer);
  parent.append(root);

  function announce(message: string, error = false) {
    status.textContent = message;
    status.classList.toggle('inv-error', error);
  }
  function render() {
    if (disposed) return;
    const focus =
      document.activeElement instanceof HTMLElement && grid.contains(document.activeElement)
        ? document.activeElement.dataset.slot
        : undefined;
    bag.textContent = BACKPACKS[state.backpack].name;
    const used = state.slots.filter(Boolean).length;
    capacity.textContent = `${used} / ${state.slots.length} ô đang dùng${used === state.slots.length ? ' · Túi đầy' : ''}`;
    grid.replaceChildren();
    state.slots.forEach((stack, index) => {
      const slot = element('button', `inv-slot${stack ? '' : ' inv-empty'}`);
      slot.type = 'button';
      slot.dataset.slot = String(index);
      slot.disabled = busy;
      slot.setAttribute('aria-pressed', String(selected === index));
      slot.append(element('span', 'inv-slot-number', String(index + 1).padStart(2, '0')));
      if (stack) {
        const item = ITEMS[stack.itemId];
        slot.style.setProperty('--rarity', RARITIES[stack.rarity].color);
        slot.append(
          icon(item.category, stack.itemId),
          element('span', 'inv-slot-name', item.name),
          element('span', 'inv-count', `×${stack.quantity}`),
        );
        slot.setAttribute(
          'aria-label',
          `Ô ${index + 1}: ${item.name}, ${RARITIES[stack.rarity].name}, ${stack.quantity}`,
        );
      } else {
        slot.append(element('span', 'inv-empty-mark', '+'));
        slot.setAttribute('aria-label', `Ô ${index + 1}: trống`);
      }
      grid.append(slot);
    });
    if (focus !== undefined) grid.querySelector<HTMLButtonElement>(`[data-slot="${focus}"]`)?.focus();
    const stack = selected === null ? null : state.slots[selected];
    controls.hidden = !stack;
    if (stack) {
      const item = ITEMS[stack.itemId];
      detail.style.setProperty('--rarity', RARITIES[stack.rarity].color);
      artwork.replaceChildren(icon(item.category, stack.itemId));
      rarity.textContent = `${RARITIES[stack.rarity].name} · ${CATEGORY_NAMES[item.category]}`;
      title.textContent = item.name;
      description.textContent = item.description;
      stackInfo.textContent = `${stack.quantity} đang có · Tối đa ${item.maxStack} mỗi ô`;
      quantity.max = String(stack.quantity);
      half.disabled = busy || stack.quantity < 2;
    } else {
      detail.style.removeProperty('--rarity');
      artwork.replaceChildren(icon('material'));
      rarity.textContent = 'MỌI THỨ ĐỀU CÓ CHỖ';
      title.textContent = 'Sắp gọn, đi xa';
      description.textContent = 'Chọn một vật phẩm để xem chi tiết, chia số lượng hoặc chuyển sang ô khác.';
      stackInfo.textContent = `${state.slots.length - used} ô trống cho chuyến đi tiếp theo`;
    }
    sort.disabled = busy;
    all.disabled = cancel.disabled = quantity.disabled = busy;
    root.setAttribute('aria-busy', String(busy));
  }
  function update(next: InventoryState) {
    if (disposed) return;
    if (!isInventoryState(next)) {
      announce(INVENTORY_MESSAGES.invalid_state, true);
      return;
    }
    if (next.revision <= state.revision) return;
    state = next;
    selected = null;
    render();
  }
  async function dispatch(command: InventoryCommand) {
    if (busy || disposed) return;
    const restoreSlot =
      document.activeElement instanceof HTMLElement && grid.contains(document.activeElement)
        ? document.activeElement.dataset.slot
        : undefined;
    busy = true;
    render();
    announce('Đang xử lý…');
    try {
      const result = await options.onCommand(command);
      if (disposed) return;
      if (!isInventoryState(result.state)) {
        announce(INVENTORY_MESSAGES.invalid_state, true);
        return;
      }
      const superseded = result.state.revision < state.revision;
      update(result.state);
      if (superseded) announce('Đã nhận dữ liệu túi đồ mới hơn. Hãy chọn lại vật phẩm.');
      else
        announce(
          result.ok
            ? command.type === 'sort'
              ? 'Đã sắp xếp và gộp các vật phẩm cùng loại.'
              : 'Đã chuyển vật phẩm.'
            : (options.describeError?.(result.error) ??
                INVENTORY_MESSAGES[result.error as InventoryError] ??
                'Thao tác chưa được xác nhận.'),
          !result.ok,
        );
    } catch {
      if (!disposed) announce('Chưa nhận được xác nhận. Hãy kiểm tra kết nối và thử lại.', true);
    } finally {
      if (!disposed) {
        busy = false;
        render();
        if (restoreSlot !== undefined && document.activeElement === document.body) {
          grid.querySelector<HTMLButtonElement>(`[data-slot="${restoreSlot}"]`)?.focus();
        }
      }
    }
  }
  grid.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-slot]');
    if (!button || busy) return;
    const index = Number(button.dataset.slot);
    if (selected === index) {
      selected = null;
      render();
      announce('Đã bỏ chọn vật phẩm.');
      return;
    }
    if (selected === null) {
      const stack = state.slots[index];
      if (!stack) {
        announce('Ô trống. Hãy chọn một vật phẩm trước.');
        return;
      }
      selected = index;
      quantity.value = String(stack.quantity);
      render();
      announce('Chọn số lượng, sau đó chọn ô đích.');
    } else {
      void dispatch({
        type: 'move',
        from: selected,
        to: index,
        quantity: quantity.valueAsNumber,
        expectedRevision: state.revision,
      });
    }
  });
  sort.addEventListener('click', () => void dispatch({ type: 'sort', expectedRevision: state.revision }));
  half.addEventListener('click', () => {
    const stack = selected === null ? null : state.slots[selected];
    if (stack) {
      quantity.value = String(Math.max(1, Math.floor(stack.quantity / 2)));
      announce('Đã chọn một nửa. Chọn ô đích để tách.');
    }
  });
  all.addEventListener('click', () => {
    const stack = selected === null ? null : state.slots[selected];
    if (stack) quantity.value = String(stack.quantity);
  });
  const deselect = () => {
    if (!busy) {
      selected = null;
      render();
      announce('Đã bỏ chọn vật phẩm.');
    }
  };
  cancel.addEventListener('click', deselect);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      deselect();
    }
  });
  render();
  return {
    update,
    destroy() {
      disposed = true;
      root.remove();
    },
  };
}
