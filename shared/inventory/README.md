# Vật phẩm và túi đồ — phần đầu của giai đoạn 3

## Phạm vi

Logic thuần trong thư mục này; bảng vật phẩm, độ hiếm, stack tối đa và sức chứa balo ở `shared/data/items.ts`. Chưa thực hiện hiệu ứng dùng đồ, trang bị vũ khí/giáp, cân bằng chiến đấu, sinh loot hoặc trao đồ giữa người chơi.

`InventoryState` chứa revision tăng dần, loại balo và mảng ô. Mỗi stack có itemId, rarity, quantity. Vũ khí chiếm một ô mỗi món. Chỉ các stack cùng itemId **và** rarity được gộp. Khi bổ sung độ bền/phụ kiện, cần mở rộng điều kiện tương thích stack; không gộp các vật phẩm có trạng thái khác nhau.

## API cho A ghép mạng

- `createInventory(backpack?)`: túi mới, mặc định 12 ô; balo khác có 16 hoặc 24 ô.
- `isInventoryState(unknown)`: kiểm tra snapshot từ JSON, gồm ID, độ hiếm, số lượng, sức chứa, revision và ô rỗng hợp lệ.
- `applyInventoryCommand(state, command)`: xử lý intent `move` hoặc `sort`. Move có from, to, quantity; ô trống = chuyển/tách, cùng loại = gộp, khác loại = đổi chỗ toàn bộ. Sort gộp và xếp ổn định theo độ hiếm giảm dần rồi ID.
- `addItems(state, stack, expectedRevision)`: **chỉ authority/host gọi** sau khi duyệt loot/phần thưởng; ưu tiên gộp vào stack đang có rồi dùng ô trống. Toàn bộ grant phải vừa túi, nếu không từ chối cả lệnh.
- `changeBackpack(state, backpack, expectedRevision)`: **chỉ authority/host gọi** sau khi kiểm tra sở hữu/trang bị balo. Thu nhỏ túi sẽ dồn các ô đang dùng; từ chối nếu không đủ chỗ. Không tự bỏ đồ.

Tất cả thao tác trả `{ ok, state }`, khi lỗi có thêm `error`. Input không bị sửa; lỗi trả lại đúng snapshot ban đầu. `expectedRevision` phải khớp để từ chối lệnh cũ hoặc phát lại. **Revision không thay thế kiểm tra quyền sở hữu**: host phải kiểm tra người gửi, inventory đích, tính hợp lệ của intent và quyền nhận vật phẩm trước khi gọi. Client không được gửi lệnh tự cấp đồ hoặc tự nâng balo. Không dùng snapshot do client cung cấp làm nguồn chân lý.

Các helper nhận state đã xác thực; chưa có schema/version giao thức mạng, chưa lưu dữ liệu. A bổ sung routing, kiểm tra quyền và lưu/truyền snapshot ở GĐ 2/3. Một revision chỉ áp dụng trong một vòng đời inventory; khi đổi nhân vật/thế giới hãy tạo panel mới.

```ts
const result = applyInventoryCommand(hostInventory, {
  type: 'move',
  expectedRevision: hostInventory.revision,
  from: 0,
  to: 3,
  quantity: 2,
});
if (result.ok) hostInventory = result.state;
// Gửi snapshot/kết quả về client, kể cả revision mới khi từ chối lệnh cũ.
```

## UI và xem thử

`mountInventoryPanel(root, { initial, onCommand })` tại `client/ui/inventory/inventoryPanel.ts` tạo UI độc lập. `onCommand` trả kết quả hoặc Promise kết quả từ authority. Trong lúc chờ, UI khóa thao tác để tránh gửi lặp, không tự sửa đồ. `panel.update(snapshot)` nhận push từ host, bỏ qua revision cũ; `panel.destroy()` hủy giao diện và bỏ qua response đến muộn. DOM chỉ được cập nhật khi state/thao tác đổi, không có vòng render mỗi frame. Không có listener bàn phím toàn cục.

Mở `?inventory=1` cùng link game để xem túi mẫu. Điểm ghép nằm trong `client/ui/lobbyPanel.ts` (vùng B), chỉ nạp fixture khi có tham số này; không sửa `main.ts`, scene của A, package.json hay shared/types. Fixture giữ dữ liệu trong bộ nhớ và mô phỏng callback chậm 150ms; **đây không phải kiểm thử mạng WebRTC hay túi đồ online hoàn chỉnh**. UI và reducer sẵn sàng để A ghép authority sau.

Chọn ô nguồn, nhập số lượng hoặc bấm **Một nửa**, rồi chọn ô đích. Chọn toàn bộ mới đổi chỗ được với vật phẩm khác. Nhấn Esc/bỏ chọn để hủy chọn. Nút **Sắp xếp & gộp** giữ nguyên tổng đồ. UI có nhãn cho trình đọc màn hình, Tab/Enter, màu kèm tên độ hiếm, hỗ trợ chạm và màn hình nhỏ.

## Kiểm tra

`npm run check`, `npm run build`. Test gồm stack đầy, túi gần đầy, chuyển/tách/gộp/đổi chỗ, rarity khác nhau, số lượng và chỉ số không hợp lệ, từ chối revision cũ, thu nhỏ balo không mất đồ, snapshot bất biến và 1000 thao tác hỗn hợp bảo toàn tổng số lượng từng item/rarity. Bảng dữ liệu là giá trị khởi đầu cho túi đồ, chưa khẳng định cân bằng gameplay.
