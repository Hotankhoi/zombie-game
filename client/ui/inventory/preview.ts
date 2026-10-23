import { BACKPACKS, ITEMS, RARITIES, type BackpackId, type ItemId, type Rarity } from '@shared/data/items';
import {
  addItems,
  applyInventoryCommand,
  changeBackpack,
  createInventory,
  type InventoryState,
  type ItemStack,
} from '@shared/inventory/inventory';
import { INVENTORY_MESSAGES, mountInventoryPanel } from './inventoryPanel';

function sampleInventory(): InventoryState {
  let state = createInventory();
  const sample: ItemStack[] = [
    { itemId: 'knife', rarity: 'common', quantity: 1 },
    { itemId: 'pistol', rarity: 'rare', quantity: 1 },
    { itemId: 'bandage', rarity: 'common', quantity: 8 },
    { itemId: 'pistol_ammo', rarity: 'common', quantity: 42 },
    { itemId: 'water', rarity: 'common', quantity: 3 },
    { itemId: 'canned_food', rarity: 'common', quantity: 4 },
    { itemId: 'scrap', rarity: 'common', quantity: 18 },
    { itemId: 'medkit', rarity: 'uncommon', quantity: 2 },
    { itemId: 'rifle', rarity: 'epic', quantity: 1 },
  ];
  for (const item of sample) {
    const result = addItems(state, item, state.revision);
    if (!result.ok) throw new Error(result.error);
    state = result.state;
  }
  return state;
}

/** Development preview with a local authority fixture, never the player's real inventory. */
export function mountInventoryPreview(parent: HTMLElement) {
  let state = sampleInventory();
  const root = document.createElement('div');
  root.className = 'inventory-preview';
  root.tabIndex = -1;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Bản thử hành trang');
  const siblings = Array.from(parent.children)
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
    .map((el) => ({ el, inert: el.inert }));
  siblings.forEach(({ el }) => {
    el.inert = true;
  });
  const bar = document.createElement('div');
  bar.className = 'inv-preview-bar';
  const caption = document.createElement('span');
  caption.textContent = 'BẢN THỬ HÀNH TRANG';
  const back = document.createElement('a');
  back.textContent = '← Về phòng chờ';
  const url = new URL(window.location.href);
  url.searchParams.delete('inventory');
  back.href = url.toString();
  bar.append(caption, back);
  root.append(bar);
  parent.append(root);
  const panel = mountInventoryPanel(root, {
    initial: state,
    async onCommand(command) {
      // Exercise pending UI without optimistic mutations; real integration supplies the host callback.
      await new Promise((resolve) => setTimeout(resolve, 150));
      const result = applyInventoryCommand(state, command);
      state = result.state;
      return result;
    },
  });
  const tools = document.createElement('div');
  tools.className = 'inv-preview-tools';
  function select<T extends string>(labelText: string, entries: [T, string][]) {
    const label = document.createElement('label');
    label.textContent = labelText;
    const input = document.createElement('select');
    input.setAttribute('aria-label', labelText);
    entries.forEach(([id, name]) => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = name;
      input.append(option);
    });
    label.append(input);
    tools.append(label);
    return input;
  }
  const item = select(
    'Vật phẩm nhặt thử',
    Object.entries(ITEMS).map(([id, d]) => [id, d.name]),
  );
  item.value = 'bandage';
  const rarity = select(
    'Độ hiếm',
    Object.entries(RARITIES).map(([id, d]) => [id, d.name]),
  );
  const quantityLabel = document.createElement('label');
  quantityLabel.textContent = 'Số lượng';
  const quantity = document.createElement('input');
  quantity.type = 'number';
  quantity.min = '1';
  quantity.step = '1';
  quantity.value = '5';
  quantity.setAttribute('aria-label', 'Số lượng nhặt thử');
  quantityLabel.append(quantity);
  tools.append(quantityLabel);
  const grant = document.createElement('button');
  grant.type = 'button';
  grant.textContent = 'Nhặt vào túi';
  tools.append(grant);
  const backpack = select(
    'Balo',
    Object.entries(BACKPACKS).map(([id, d]) => [id, `${d.name} · ${d.capacity} ô`]),
  );
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Khôi phục túi mẫu';
  tools.append(reset);
  const feedback = document.createElement('p');
  feedback.className = 'inv-preview-note';
  feedback.setAttribute('role', 'status');
  const note = document.createElement('p');
  note.className = 'inv-preview-note';
  note.textContent =
    'Dữ liệu dùng thử, không lưu và không ảnh hưởng phiên chơi. Chức năng sử dụng, trang bị và trao đồ sẽ được bổ sung ở các bước tiếp theo.';
  root.append(tools, feedback, note);
  root.focus();
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      root.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled)',
      ),
    ).filter((el) => el.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  });
  grant.addEventListener('click', () => {
    const result = addItems(
      state,
      { itemId: item.value as ItemId, rarity: rarity.value as Rarity, quantity: quantity.valueAsNumber },
      state.revision,
    );
    state = result.state;
    panel.update(state);
    feedback.textContent = result.ok
      ? `Đã nhặt ${quantity.value} ${ITEMS[item.value as ItemId].name}.`
      : INVENTORY_MESSAGES[result.error];
  });
  backpack.addEventListener('change', () => {
    const result = changeBackpack(state, backpack.value as BackpackId, state.revision);
    state = result.state;
    panel.update(state);
    backpack.value = state.backpack;
    feedback.textContent = result.ok
      ? 'Đã đổi balo và giữ nguyên toàn bộ vật phẩm.'
      : INVENTORY_MESSAGES[result.error];
  });
  reset.addEventListener('click', () => {
    state = { ...sampleInventory(), revision: state.revision + 1 };
    panel.update(state);
    backpack.value = state.backpack;
    feedback.textContent = 'Đã khôi phục hành trang mẫu.';
  });
  return () => {
    panel.destroy();
    root.remove();
    siblings.forEach(({ el, inert }) => {
      el.inert = inert;
    });
  };
}
