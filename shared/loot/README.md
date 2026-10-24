# Loot và rương — giai đoạn 3

Phần này nối rương với túi đồ của PR #5. Bảng cân bằng nằm ở `shared/data/loot.ts`; logic thuần không phụ thuộc trình duyệt, Phaser hay transport. Chưa ghép rương vào thế giới, WebRTC hoặc file save. Host thật sẽ dùng cùng reducer sau khi A hoàn thiện hợp đồng mạng.

## Sinh loot

`generateChest(worldSeed, chestId, region)` tạo rương 6 ô, chứa 3–6 stack. Năm vùng tương thích tên vùng map: `residential`, `market`, `hospital`, `police`, `military`. Siêu thị ưu tiên đồ ăn/nước, bệnh viện ưu tiên thuốc; cảnh sát và quân sự ưu tiên vũ khí/đạn. Quân sự có xác suất nhận đồ huyền thoại. Đây là bảng cân bằng ban đầu, chưa đo nhịp tiến triển trong một buổi chơi.

Mỗi rương có RNG riêng từ bộ `(LOOT_VERSION, worldSeed, chestId, region)`, không dùng thời gian hay `Math.random`. Cùng bộ đầu vào cho cùng kết quả, không phụ thuộc thứ tự khám phá rương/chunk. ID phải ổn định trong thế giới, ví dụ `building:12:-8:chest:0`; không dùng ID người chơi hoặc thứ tự tải chunk. Seed dài 1–256 ký tự, ID dài 1–128 ký tự, đều không được chỉ có khoảng trắng.

**Host chỉ tạo rương một lần khi chưa có trạng thái.** Mở lại, quay về chunk cũ hay đổi host phải nạp snapshot hiện có, kể cả rương đã rỗng; không gọi lại generator để khôi phục đồ. Đổi bảng cân bằng hoặc thuật toán phải tăng `LOOT_VERSION` và có kế hoạch đọc/chuyển snapshot cũ; phiên bản hiện tại chỉ chấp nhận v1. Các ô giữ nguyên chỉ số sau khi lấy đồ. Snapshot gồm `opened`, `revision` và lượng đồ còn lại.

## Giao dịch của host

`applyLootCommand(chest, inventory, command)` trả `{ok, chest, inventory}`; khi từ chối có thêm `error`. `isChestState` kiểm tra dữ liệu JSON trước khi đưa vào UI/reducer.

Mọi intent gồm `chestId`, `expectedChestRevision`, `expectedInventoryRevision`:

- `open`: mở rương, tăng revision rương một lần; mở lại bằng revision hiện tại không thay đổi đồ hay revision.
- `take`: thêm `slot`, `quantity`; lấy đúng lượng yêu cầu hoặc từ chối toàn bộ. Không nhận item ID/độ hiếm do client tự chọn.
- `takeAll`: chuyển mọi stack còn lại trong một giao dịch. Nếu bất kỳ stack nào không vừa túi, giữ nguyên cả rương và túi.

Lệnh chuyển thành công tăng revision rương và túi mỗi bên đúng 1. Lệnh thất bại trả lại đúng hai object đầu vào, không thay đổi một phần. Kiểm tra cả hai revision chặn yêu cầu cũ, request bị gửi lại và hai người cùng lấy một snapshot rương. Túi đã kín ô vẫn nhận được vật phẩm nếu stack tương thích còn chỗ; stack khác rarity không gộp.

```ts
// Lấy chest/inventory từ trạng thái host, không lấy snapshot do client gửi lên.
const result = applyLootCommand(hostChest, playerInventory, intent);
if (result.ok) {
  // Cập nhật cả hai trong cùng lượt xử lý, không await giữa hai lần ghi.
  world.chests.set(result.chest.id, result.chest);
  world.inventories.set(playerId, result.inventory);
}
// Gửi kết quả và snapshot hiện tại về người yêu cầu; thông báo rương đổi cho người xem khác.
```

Trước khi gọi reducer, A cần xác thực người gửi, quyền sở hữu túi, vị trí/khoảng cách tới rương, trạng thái còn sống và quyền mở rương. Tuần tự hóa giao dịch trên host; gắn kết quả với request/phiên chơi; giới hạn tần suất; truyền trạng thái qua kênh reliable. Revision không thay thế những kiểm tra này. Host migration/save phải chứa **cả** trạng thái rương và túi, bảo toàn revision và xử lý giao dịch đang chờ. Hiện chưa có routing inventory/loot trong `GameMsg`; không gửi lệnh loot qua union sự kiện chiến đấu của A. Thay đổi hợp đồng `shared/types` làm ở PR riêng theo mục 7.8.

## UI và bản thử

`mountLootPanel(root, { initial: { chest, inventory }, onCommand })` nằm ở `client/ui/loot/lootPanel.ts`. Callback nhận intent và trả `LootResult` hoặc Promise. `update({chest, inventory})` nhận snapshot host; `destroy()` hủy panel. Giao diện chờ xác nhận rồi mới đổi số lượng, khóa thao tác trong lúc chờ và bỏ qua phản hồi cũ. Mỗi panel thuộc một vòng đời thế giới/người chơi; tạo panel mới khi đổi thế giới hoặc reset revision.

Mở `?loot=1&room=LOOT01` để thử: chọn khu, mở rương, chọn số lượng, lấy một phần hoặc lấy hết. Túi bên cạnh dùng cùng UI với PR #5. Chuyển khu rồi quay lại giữ đồ đã lấy trong phiên preview. Công cụ thử túi đầy và khôi phục túi chỉ thay đổi túi mẫu, không sinh lại rương. Tải lại trang khởi tạo lại toàn bộ mẫu.

Preview dùng callback cục bộ trễ 150ms để kiểm tra thao tác đang chờ; **chưa phải kiểm thử mạng 4 người hay loot online hoàn chỉnh**. Dữ liệu mẫu không lưu, không ảnh hưởng nhân vật thật. Điểm mở preview nằm trong `client/ui/lobbyPanel.ts` của B; không sửa scene của A, `main.ts`, `shared/types` hoặc `package.json`.

## Kiểm tra

Chạy `npm run check` và `npm run build`. Test logic kiểm tra tính tất định, vùng loot, snapshot không hợp lệ, chuyển một phần/toàn bộ, túi đầy, rollback toàn giao dịch, request lặp, hai người lấy cùng rương, tính bất biến và bảo toàn tổng vật phẩm.

Đã kiểm tra bản production trên Chromium: mở/lấy riêng/lấy hết, khóa bấm lặp, từ chối số lượng sai và túi đầy, đổi khu trong lúc chờ, quay lại rương đã lấy hết, thay túi khi đang nhặt, focus bàn phím sau mở/lấy hết/Escape. Đã thử chạm chọn đồ ở 390×844 và kiểm tra không tràn ngang ở 320px. Kiểm tra vòng đời panel gồm push mới thắng phản hồi cũ, đổi rương A→B→A khi còn request, snapshot/phản hồi lỗi, callback mất kết nối, hủy panel trong lúc chờ và không cập nhật DOM khi revision không đổi. Các kiểm tra trình duyệt này dùng authority cục bộ, không chứng minh transport online.

Khi ghép mạng thật cần kiểm tra thêm: 4 người cùng mở/nhặt, trễ 150ms và mất gói, ngắt kết nối sau gửi lệnh, đổi host lúc nhặt, rời/quay về chunk, tải save và yêu cầu ngoài tầm. Các tình huống này chưa được xác nhận bằng preview cục bộ.
