import { LOOT_REGIONS, type LootRegion } from '@shared/data/loot';
import {
  addItems,
  applyInventoryCommand,
  createInventory,
  type InventoryState,
} from '@shared/inventory/inventory';
import { applyLootCommand, generateChest, type ChestState } from '@shared/loot/chest';
import { mountInventoryPanel } from '../inventory/inventoryPanel';
import { mountLootPanel } from './lootPanel';

function starterInventory(): InventoryState {
  const state = createInventory();
  return addItems(state, { itemId: 'knife', rarity: 'common', quantity: 1 }, state.revision).state;
}

/** Preview fixture only. Production owns these states on the host and persists each chest once. */
export function mountLootPreview(parent: HTMLElement) {
  const url = new URL(window.location.href);
  const seed = (url.searchParams.get('room') ?? '').trim().slice(0, 128) || 'loot-preview';
  const chests = new Map<string, ChestState>();
  let region: LootRegion = 'residential';
  let inventory = starterInventory();
  let disposed = false;
  const chestFor = (area: LootRegion) => {
    const id = `preview:${area}:0`;
    let chest = chests.get(id);
    if (!chest) {
      chest = generateChest(seed, id, area);
      chests.set(id, chest);
    }
    return chest;
  };
  const root = document.createElement('div');
  root.className = 'loot-preview';
  root.tabIndex = -1;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Bản thử rương và vật phẩm');
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const siblings = Array.from(parent.children)
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
    .map((el) => ({ el, inert: el.inert }));
  siblings.forEach(({ el }) => {
    el.inert = true;
  });
  const bar = document.createElement('div');
  bar.className = 'loot-preview-bar';
  const caption = document.createElement('span');
  caption.textContent = 'BẢN THỬ · RƯƠNG & VẬT PHẨM';
  const back = document.createElement('a');
  back.textContent = '← Về phòng chờ';
  url.searchParams.delete('loot');
  url.searchParams.delete('inventory');
  back.href = url.toString();
  bar.append(caption, back);
  const intro = document.createElement('header');
  intro.className = 'loot-preview-intro';
  const copy = document.createElement('div');
  const heading = document.createElement('h1');
  heading.textContent = 'Mang về một cơ hội sống.';
  const description = document.createElement('p');
  description.textContent =
    'Mỗi khu vực có nguồn tiếp tế riêng. Mở rương, chọn thứ cần thiết và thu gọn vào hành trang.';
  copy.append(heading, description);
  const regionLabel = document.createElement('label');
  regionLabel.className = 'loot-region';
  regionLabel.textContent = 'Khám phá khu vực';
  const regionSelect = document.createElement('select');
  regionSelect.setAttribute('aria-label', 'Khám phá khu vực');
  Object.entries(LOOT_REGIONS).forEach(([id, area]) => {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = area.name;
    regionSelect.append(option);
  });
  regionLabel.append(regionSelect);
  intro.append(copy, regionLabel);
  const layout = document.createElement('div');
  layout.className = 'loot-layout';
  const lootMount = document.createElement('div');
  const inventoryMount = document.createElement('div');
  inventoryMount.className = 'loot-inventory';
  layout.append(lootMount, inventoryMount);
  root.append(bar, intro, layout);
  parent.append(root);
  const pause = () => new Promise((resolve) => setTimeout(resolve, 150));
  const bag = mountInventoryPanel(inventoryMount, {
    initial: inventory,
    async onCommand(command) {
      await pause();
      const result = applyInventoryCommand(inventory, command);
      if (!disposed) {
        inventory = result.state;
        loot.update({ chest: chestFor(region), inventory });
      }
      return result;
    },
  });
  const loot = mountLootPanel(lootMount, {
    initial: { chest: chestFor(region), inventory },
    async onCommand(command) {
      await pause();
      const result = applyLootCommand(chests.get(command.chestId)!, inventory, command);
      if (!disposed) {
        chests.set(result.chest.id, result.chest);
        inventory = result.inventory;
        bag.update(inventory);
        // A response for a previous area still updates its stored chest and the shared bag.
        loot.update({ chest: chestFor(region), inventory });
      }
      return result;
    },
  });
  regionSelect.addEventListener('change', () => {
    region = regionSelect.value as LootRegion;
    loot.update({ chest: chestFor(region), inventory });
  });
  const tools = document.createElement('details');
  tools.className = 'loot-preview-tools';
  const summary = document.createElement('summary');
  summary.textContent = 'Thông tin bản thử & công cụ kiểm tra';
  const note = document.createElement('p');
  note.textContent =
    'Đây là dữ liệu dùng thử trên máy này, phản hồi trễ 150 ms. Chưa ghép loot online hoặc lưu khi tải lại trang. Đổi khu vực rồi quay lại sẽ giữ đồ đã lấy trong phiên thử này.';
  const fill = document.createElement('button');
  fill.type = 'button';
  fill.dataset.lootFixture = 'full';
  fill.textContent = 'Thử với túi đầy';
  const restore = document.createElement('button');
  restore.type = 'button';
  restore.dataset.lootFixture = 'restore';
  restore.textContent = 'Khôi phục túi ban đầu';
  const feedback = document.createElement('p');
  feedback.className = 'loot-preview-feedback';
  feedback.setAttribute('role', 'status');
  tools.append(summary, note, fill, restore, feedback);
  root.append(tools);
  const replaceInventory = (state: InventoryState) => {
    inventory = { ...state, revision: inventory.revision + 1 };
    bag.update(inventory);
    loot.update({ chest: chestFor(region), inventory });
  };
  fill.addEventListener('click', () => {
    replaceInventory({
      ...createInventory(),
      slots: Array.from({ length: 12 }, () => ({
        itemId: 'knife' as const,
        rarity: 'common' as const,
        quantity: 1,
      })),
    });
    feedback.textContent =
      'Túi mẫu đã kín ô. Thử lấy đồ để kiểm tra thông báo; rương vẫn giữ nguyên khi túi không đủ chỗ.';
  });
  restore.addEventListener('click', () => {
    replaceInventory(starterInventory());
    feedback.textContent = 'Đã thay túi dùng thử bằng túi ban đầu. Giữ nguyên mọi rương đã mở và đồ đã lấy.';
  });
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      root.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), summary',
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
  root.focus();
  return () => {
    disposed = true;
    loot.destroy();
    bag.destroy();
    root.remove();
    siblings.forEach(({ el, inert }) => {
      el.inert = inert;
    });
    previousFocus?.focus();
  };
}
