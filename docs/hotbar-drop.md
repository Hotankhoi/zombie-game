# Hotbar 5 ô và thả/nhặt đồ

Nền: main sau #47. Giữ hệ Inventory/ClientLoot/HostLoot và gameplay của A. Hợp đồng riêng #48 nâng v9 → v10; không sửa ghi chú tương thích cũ.

## Điều khiển

- I mở túi → chọn vật phẩm → **Gán thanh nhanh** → click ô 1–5. Hotbar hiện cả khi đóng túi.
- 1–5, cuộn chuột hoặc click chọn ô. Vũ khí được host trang bị; đồ dùng gọi cơ chế dùng đồ hiện có. Ô trống chuyển về tay không. Khi nhập liệu hoặc mở túi, phím số không đổi vũ khí.
- Kéo giữa các ô để hoán đổi; kéo ra ngoài hoặc chuột phải bỏ gán, không xóa đồ trong túi. Gán từ túi dùng click thay cho kéo từ túi.
- **Thả 1 / Thả tất cả** trong túi. Đồ nằm trên đất gần phía trước ở ô hợp lệ; **V** hoặc nút nhặt để lấy lại. Không có chỗ thả thì không trừ đồ; túi đầy thì đồ vẫn nằm dưới đất.
- Q nạp đạn, F rương/đèn pin, E cửa, R cứu đồng đội giữ như main. Thả súng hoàn đạn đã nạp về túi rồi thả khẩu rỗng; không tạo thêm đạn.

## Dữ liệu và giới hạn

Túi là nguồn số lượng duy nhất. Hotbar lưu tham chiếu loại món + độ hiếm, đọc tổng số lượng cùng loại/độ hiếm trong túi; không sao chép vật phẩm. Di chuyển/sắp xếp túi không làm mất gán. Nếu hết loại món đó, gán được xóa. Đây là tham chiếu theo nhóm món hiện có của A, chưa phải định danh riêng cho từng khẩu súng giống hệt nhau; băng đạn vẫn theo loại súng của hệ hiện tại. Gán hotbar là tùy chọn cục bộ trong phiên, chưa lưu qua tải lại trang.

Host xác thực người gửi và revision; thả/nhặt cập nhật túi + danh sách đồ rơi cùng revision và dùng cơ chế ACK/khôi phục của A. Danh sách đồ rơi giới hạn 128, đầy thì từ chối thả, không tự xóa đồ. Đồ rơi dùng hình 2D tạm có màu độ hiếm, không thêm asset/effect/Blender hay dependency. Phục hồi trong phiên khi đổi host, chưa thay thế IndexedDB của A.

## Kiểm tra

- Unit/integration: model 5 ô, vòng cuộn, tham chiếu sau di chuyển; codec đồ rơi và xóa qua delta; Drop 1/all; túi đầy; ngoài tầm/tường/gục; hoàn đạn.
- Bốn NetGame thật trên LoopbackHub, trễ 150 ms và mất 5% gói unreliable: drop → tranh pickup chỉ một người thắng, tổng đồ bảo toàn, yêu cầu cũ bị từ chối, đổi host giữ đồ rơi.
- Chromium + Worker thật: gán dao bằng UI, phím 1 trang bị, ô 5 trống về tay không, nút thả → V/nút nhặt; đổi ô liên tục và hoán đổi ô bằng sự kiện drag/drop; không lỗi runtime trong lượt kiểm tra. Hotbar 5 ô nằm vừa viewport 390 px và desktop 1280 px.
- Chưa kiểm tra 2 máy thật/TURN, tải tối đa 128 đồ rơi hoặc kéo/thả bằng thiết bị cảm ứng. Không coi đây là nghiệm thu toàn bộ GĐ3 (các loại vũ khí/công cụ và phụ kiện ngoài main chưa được bổ sung).

## Bàn giao

Kiểm tra ngày 26/10/2026: `npm run check` đạt (391 test/50 file, typecheck và lint); `npm run build` đạt. PR hợp đồng #48 đã mở. Push/PR triển khai bị chặn bởi GitHub HTTP 401 (Bad credentials), không phải lỗi build.

Các file chính:

- UI: `client/ui/hotbar/{model.ts,hotbar.ts,hotbar.css,model.test.ts}`, `client/ui/inventory/inventoryPanel.ts`, `client/loot/{lootUi.ts,groundLayer.ts}`, `client/scenes/{WorldScene.ts,HudScene.ts}`.
- Logic/mạng: `shared/loot/{ground.ts,authority.ts}`, `host/{hostLoot.ts,hostServer.ts,dropOnline.test.ts}`, `net/{clientLoot.ts,lootCodec.ts,ground.test.ts}`.
- Hợp đồng và phối hợp: `shared/types/{loot.ts,index.ts}`, dòng B của `AGENTS.md`; `shared/sim/armor.ts` giữ độ bền đang dùng khi tháo/mặc lại trong cùng phiên.
