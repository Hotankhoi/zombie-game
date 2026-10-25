import { ITEMS, RARITIES, type ItemCategory } from '@shared/data/items';
import { LOOT_REGIONS } from '@shared/data/loot';
import { isInventoryState, type InventoryState } from '@shared/inventory/inventory';
import {
  isChestState,
  type ChestState,
  type LootCommand,
  type LootError,
  type LootResult,
} from '@shared/loot/chest';
import { INVENTORY_MESSAGES } from '../inventory/inventoryPanel';
import './loot.css';

export interface LootSnapshot {
  chest: ChestState;
  inventory: InventoryState;
}
/** Online authority may also fail with network/host codes (net/clientLoot); text comes from `describeError`. */
export type LootPanelResult =
  LootResult | { ok: false; chest: ChestState; inventory: InventoryState; error: string };
export interface LootPanelOptions {
  initial: LootSnapshot;
  /** Send intent to the authority. Both snapshots must come from one transaction. */
  onCommand(command: LootCommand): LootPanelResult | Promise<LootPanelResult>;
  /** Text for error codes outside LOOT_MESSAGES (online: host/network codes). */
  describeError?(code: string): string;
}
export const LOOT_MESSAGES: Record<LootError, string> = {
  ...INVENTORY_MESSAGES,
  invalid_chest: 'Dữ liệu rương không hợp lệ. Hãy tải lại trước khi tiếp tục.',
  wrong_chest: 'Rương đang xem đã thay đổi. Hãy chọn lại vật phẩm.',
  chest_closed: 'Mở rương trước khi lấy đồ.',
  empty_chest: 'Bạn đã lấy hết đồ trong rương này.',
  stale_revision: 'Rương hoặc túi vừa thay đổi. Hãy chọn lại vật phẩm.',
  inventory_full: 'Túi không đủ chỗ. Đồ vẫn còn trong rương; hãy lấy ít hơn hoặc sắp gọn túi.',
};

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
const ICONS: Record<ItemCategory | 'chest', string> = {
  weapon: '<path d="m8 25 5-5m-3-3 7 7m-4-7L25 5l2 2-10 14M6 27l3-3"/>',
  ammo: '<path d="M8 27V12l3-6 3 6v15Zm10 0V12l3-6 3 6v15ZM8 22h6m4 0h6"/>',
  medical: '<path d="M6 10h20v17H6zM11 10V6h10v4m-5 4v9m-4-4h8"/>',
  food: '<path d="M11 4h10v5l3 5v13H8V14l3-5Zm0 5h10M8 17h16m-12 4h8"/>',
  material: '<path d="m6 11 10-6 10 6v14L16 29 6 25Zm0 0 10 6 10-6M16 17v12M11 8l10 6"/>',
  chest: '<path d="M4 14h24v13H4zM4 14V9l4-4h16l4 4v5M9 5v22m14-22v22M4 18h9m6 0h9m-15-3h6v7h-6z"/>',
};
function icon(kind: keyof typeof ICONS) {
  const el = element('span', 'loot-icon');
  el.innerHTML = `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[kind]}</svg>`;
  return el;
}
function valid(snapshot: LootSnapshot): boolean {
  return !!snapshot && isChestState(snapshot.chest) && isInventoryState(snapshot.inventory);
}

/** Read-only view of an authoritative chest/inventory pair. No per-frame work or optimistic loot. */
export function mountLootPanel(parent: HTMLElement, options: LootPanelOptions) {
  if (!valid(options.initial)) throw new Error('Invalid initial loot snapshot');
  let state = options.initial;
  let selected: number | null = null;
  let busy = false;
  let disposed = false;
  let identity = 0;
  const root = element('section', 'loot-panel');
  root.tabIndex = -1;
  root.setAttribute('aria-label', 'Rương tiếp tế');
  const header = element('header', 'loot-header');
  const heading = element('div', '');
  const title = element('h2', 'loot-title');
  heading.append(element('p', 'loot-eyebrow', 'THU GOM TIẾP TẾ'), title);
  const badge = element('span', 'loot-badge');
  header.append(heading, badge);
  const description = element('p', 'loot-description');
  const gate = element('div', 'loot-gate');
  const open = element('button', 'loot-primary', 'Mở rương');
  open.type = 'button';
  open.dataset.lootAction = 'open';
  gate.append(
    icon('chest'),
    element('h3', '', 'Một điểm dừng, thêm cơ hội'),
    element('p', '', 'Mở rương để xem những vật tư còn lại.'),
    open,
  );
  const contents = element('div', 'loot-contents');
  const grid = element('div', 'loot-grid');
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', 'Vật phẩm trong rương');
  const empty = element('div', 'loot-empty-state');
  empty.append(
    icon('chest'),
    element('h3', '', 'Đã thu gom hết'),
    element('p', '', 'Tìm thêm một rương khác cho chuyến đi tiếp theo.'),
  );
  const detail = element('div', 'loot-detail');
  const rarity = element('p', 'loot-rarity');
  const itemName = element('h3', 'loot-item-name');
  const itemDescription = element('p', 'loot-item-description');
  const controls = element('div', 'loot-controls');
  const quantityLabel = element('label', 'loot-quantity-label', 'Số lượng lấy');
  const quantity = element('input', 'loot-quantity');
  quantity.type = 'number';
  quantity.min = '1';
  quantity.step = '1';
  quantity.inputMode = 'numeric';
  quantity.value = '1';
  quantityLabel.append(quantity);
  const take = element('button', 'loot-primary', 'Lấy vào túi');
  take.type = 'button';
  take.dataset.lootAction = 'take';
  const takeStack = element('button', 'loot-secondary', 'Chọn cả chồng');
  takeStack.type = 'button';
  controls.append(quantityLabel, takeStack, take);
  detail.append(rarity, itemName, itemDescription, controls);
  const takeAll = element('button', 'loot-take-all', 'Lấy tất cả vào túi');
  takeAll.type = 'button';
  takeAll.dataset.lootAction = 'takeAll';
  contents.append(grid, empty, detail, takeAll);
  const capacity = element('p', 'loot-capacity');
  const status = element(
    'p',
    'loot-status',
    options.initial.chest.opened ? 'Chọn vật phẩm để lấy vào túi.' : 'Mở rương để bắt đầu thu gom.',
  );
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  root.append(header, description, gate, contents, capacity, status);
  parent.append(root);

  function announce(message: string, error = false) {
    status.textContent = message;
    status.classList.toggle('loot-error', error);
  }
  const knownError = (code: string) => Object.hasOwn(LOOT_MESSAGES, code) || !!options.describeError;
  const errorText = (code: string) =>
    options.describeError?.(code) ?? LOOT_MESSAGES[code as LootError] ?? 'Thao tác chưa được xác nhận.';
  function render() {
    if (disposed) return;
    const focused =
      document.activeElement instanceof HTMLElement && grid.contains(document.activeElement)
        ? document.activeElement.dataset.lootSlot
        : undefined;
    title.textContent = LOOT_REGIONS[state.chest.region].name;
    description.textContent = LOOT_REGIONS[state.chest.region].description;
    const count = state.chest.slots.filter(Boolean).length;
    badge.textContent = state.chest.opened ? `${count} / ${state.chest.slots.length} ô còn đồ` : 'Chưa mở';
    gate.hidden = state.chest.opened;
    contents.hidden = !state.chest.opened;
    empty.hidden = count > 0;
    grid.hidden = count === 0;
    detail.hidden = count === 0;
    takeAll.hidden = count === 0;
    grid.replaceChildren();
    // Closed chests must not reveal names, quantities or rarity in DOM/accessibility labels.
    if (state.chest.opened)
      state.chest.slots.forEach((stack, index) => {
        const slot = element('button', `loot-slot${stack ? '' : ' loot-slot-empty'}`);
        slot.type = 'button';
        slot.dataset.lootSlot = String(index);
        slot.disabled = busy || !stack;
        slot.setAttribute('aria-pressed', String(index === selected));
        if (stack) {
          const item = ITEMS[stack.itemId];
          const quality = RARITIES[stack.rarity];
          slot.style.setProperty('--loot-rarity', quality.color);
          slot.append(
            icon(item.category),
            element('span', 'loot-slot-name', item.name),
            element('span', 'loot-slot-rarity', quality.name),
            element('span', 'loot-count', `×${stack.quantity}`),
          );
          slot.setAttribute('aria-label', `Ô ${index + 1}: ${item.name}, ${quality.name}, ${stack.quantity}`);
        } else {
          slot.append(element('span', 'loot-empty-mark', '—'), element('span', 'loot-slot-name', 'Trống'));
          slot.setAttribute('aria-label', `Ô ${index + 1}: trống`);
        }
        grid.append(slot);
      });
    if (focused !== undefined)
      grid.querySelector<HTMLButtonElement>(`[data-loot-slot="${focused}"]`)?.focus();
    const stack = state.chest.opened && selected !== null ? state.chest.slots[selected] : null;
    controls.hidden = !stack;
    if (stack) {
      detail.style.setProperty('--loot-rarity', RARITIES[stack.rarity].color);
      rarity.textContent = `${RARITIES[stack.rarity].name} · ${stack.quantity} trong rương`;
      itemName.textContent = ITEMS[stack.itemId].name;
      itemDescription.textContent = ITEMS[stack.itemId].description;
      quantity.max = String(stack.quantity);
    } else {
      detail.style.removeProperty('--loot-rarity');
      rarity.textContent = 'DÀNH CHỖ CHO ĐIỀU CẦN THIẾT';
      itemName.textContent = 'Chọn đồ để mang theo';
      itemDescription.textContent = 'Chọn một ô để lấy riêng, hoặc lấy toàn bộ nếu túi đủ chỗ.';
    }
    open.disabled = takeAll.disabled = take.disabled = takeStack.disabled = quantity.disabled = busy;
    const used = state.inventory.slots.filter(Boolean).length;
    capacity.textContent = `Hành trang · ${used} / ${state.inventory.slots.length} ô${used === state.inventory.slots.length ? ' · Đã kín ô, vẫn có thể gộp đồ cùng loại' : ` · ${state.inventory.slots.length - used} ô trống`}`;
    root.setAttribute('aria-busy', String(busy));
  }
  function update(next: LootSnapshot) {
    if (disposed) return;
    if (!valid(next)) {
      announce(LOOT_MESSAGES.invalid_chest, true);
      return;
    }
    if (next.inventory.revision < state.inventory.revision) return;
    if (next.chest.id === state.chest.id) {
      if (next.chest.revision < state.chest.revision) return;
      if (
        next.chest.revision === state.chest.revision &&
        next.inventory.revision === state.inventory.revision
      )
        return;
    } else {
      identity++;
      busy = false;
      announce(next.chest.opened ? 'Chọn vật phẩm để lấy vào túi.' : 'Mở rương để bắt đầu thu gom.');
    }
    state = next;
    selected = null;
    render();
  }
  async function dispatch(command: LootCommand) {
    if (busy || disposed) return;
    const requestIdentity = identity;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    busy = true;
    render();
    announce('Đang xử lý…');
    try {
      const result = await options.onCommand(command);
      if (disposed || requestIdentity !== identity) return;
      if (
        !valid(result) ||
        result.chest.id !== state.chest.id ||
        (result.ok !== true &&
          (result.ok !== false || typeof result.error !== 'string' || !knownError(result.error)))
      ) {
        announce('Phản hồi không hợp lệ. Hãy tải lại dữ liệu trước khi tiếp tục.', true);
        return;
      }
      const superseded =
        result.chest.revision < state.chest.revision || result.inventory.revision < state.inventory.revision;
      update(result);
      announce(
        superseded
          ? 'Đã nhận dữ liệu mới hơn. Hãy chọn lại vật phẩm.'
          : result.ok
            ? command.type === 'open'
              ? 'Rương đã mở. Chọn đồ bạn cần mang theo.'
              : command.type === 'takeAll'
                ? 'Đã chuyển toàn bộ đồ trong rương vào túi.'
                : 'Đã lấy vật phẩm vào túi.'
            : errorText(result.error),
        !superseded && !result.ok,
      );
    } catch {
      if (!disposed && requestIdentity === identity)
        announce('Chưa nhận được xác nhận. Hãy kiểm tra kết nối và thử lại.', true);
    } finally {
      if (!disposed && requestIdentity === identity) {
        busy = false;
        render();
        // Keep keyboard users in the chest when the just-used control disappears.
        if (
          previousFocus &&
          (document.activeElement === document.body || document.activeElement === previousFocus)
        ) {
          if (
            previousFocus.isConnected &&
            previousFocus.getClientRects().length &&
            !(previousFocus as HTMLButtonElement).disabled
          )
            previousFocus.focus();
          else (root.querySelector<HTMLButtonElement>('.loot-slot:not(:disabled)') ?? root).focus();
        }
      }
    }
  }
  const revisions = () => ({
    chestId: state.chest.id,
    expectedChestRevision: state.chest.revision,
    expectedInventoryRevision: state.inventory.revision,
  });
  open.addEventListener('click', () => void dispatch({ type: 'open', ...revisions() }));
  takeAll.addEventListener('click', () => void dispatch({ type: 'takeAll', ...revisions() }));
  take.addEventListener('click', () => {
    if (selected !== null)
      void dispatch({ type: 'take', ...revisions(), slot: selected, quantity: quantity.valueAsNumber });
  });
  takeStack.addEventListener('click', () => {
    const stack = selected !== null ? state.chest.slots[selected] : null;
    if (stack) quantity.value = String(stack.quantity);
  });
  grid.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-loot-slot]');
    if (!button || busy) return;
    const index = Number(button.dataset.lootSlot);
    const stack = state.chest.slots[index];
    if (!stack) return;
    selected = index;
    quantity.value = String(stack.quantity);
    render();
    announce('Chọn số lượng rồi lấy vào túi. Esc để bỏ chọn.');
  });
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    if (busy) return;
    const previousSlot = selected;
    selected = null;
    render();
    announce('Đã bỏ chọn vật phẩm.');
    if (previousSlot !== null) {
      (
        grid.querySelector<HTMLButtonElement>(`[data-loot-slot="${previousSlot}"]:not(:disabled)`) ?? root
      ).focus();
    }
  });
  render();
  return {
    update,
    destroy() {
      disposed = true;
      identity++;
      root.remove();
    },
  };
}
