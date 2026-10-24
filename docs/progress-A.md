# Tiến độ của A (Claude Code)

File này để session mới đọc và làm tiếp nếu session cũ bị ngắt. Cập nhật sau mỗi giai đoạn.

## Cam kết với B (bắt buộc giữ)

- KHÔNG sửa điểm nối loot trong `host/`, `net/`, `client/scenes/WorldScene.ts` (luồng E/Interact với đồ vật, chỗ B thêm gói/handler loot).
- KHÔNG sửa `shared/types`. KHÔNG sửa vùng của B (`shared/mapgen`, `shared/data`, `client/ui`, `shared/inventory`, `shared/loot`).
- Không xếp chồng lên `b/loot-online` hay PR #7.
- Hệ quả: dữ liệu cân bằng mới của A để tạm ở `shared/sim/tuning/`; đổi định dạng gói theo cách tương thích (không tăng `PROTOCOL_VERSION`). Cả hai cần báo B.

## Thứ tự merge (xếp chồng)

`#4 (1a)` → `#3 (map, B)` → `#6 (2a)` → `2b` → `2c` → `4` → `5` → `7`

## Các giai đoạn

| GĐ  | Nhánh                                         | PR        | Trạng thái                                                                                                   |
| --- | --------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------ |
| 1a  | `a/1a-core-gameplay`                          | #4        | Xong, chờ merge                                                                                              |
| 2a  | `a/2a-online-core` (base `b/map-generator`)   | #6        | Xong, chờ merge                                                                                              |
| 2b  | `a/2b-net-advanced` (base `a/2a-online-core`) | #8        | Xong, chờ merge                                                                                              |
| 2b' | —                                             | —         | Hoãn: delta snapshot, zombie tất định, ownership, hit client (viết lại đường snapshot, đụng chỗ B ghép loot) |
| 2c  | `a/2c-party` (base `a/2b-net-advanced`)       | (đang mở) | Xong, chờ merge                                                                                              |
| 4   | —                                             | —         | Chưa                                                                                                         |
| 5   | —                                             | —         | Chưa (phần lưu IndexedDB: cần báo B trước)                                                                   |
| 6   | —                                             | —         | Cần báo B trước (hành động 2 người = chỗ chứa loot); kéo người gục làm ở 2c                                  |
| 7   | —                                             | —         | Chưa (bot, đo tải)                                                                                           |

## Việc treo

- API `spawnPoint`/ô đường của B: chưa có trên `b/map-generator` (kiểm tra lại giữa các giai đoạn). Khi có: rebase #6, thay `spawn = { x: 16, y: 16 }` trong `shared/sim/mapgenSource.ts`, xóa comment TẠM và mục giả định trong mô tả #6.

## GĐ 2b – kế hoạch

1. `net/trystero.ts`: kênh unreliable thật — DataChannel `negotiated` (id cố định) `ordered: false, maxRetransmits: 0` trên chính RTCPeerConnection của Trystero (`room.getPeers()`); chưa mở thì gửi qua kênh reliable như cũ.
2. Chọn host theo ping + sức máy: mỗi máy phát điểm (ping TB tới mọi người + thời gian chạy thử mô phỏng); phòng chưa có host → điểm tốt nhất nhận host. Host đang chạy vẫn giữ quyền (thâm niên) để không đổi host liên tục.
3. Sao lưu thế giới mỗi 10s: host gửi toàn bộ `WorldState` (reliable) → chuyển host dựng lại đủ zombie/máu/trạng thái, không chỉ zombie quanh mình.
4. Làm mượt khi thiếu snapshot: ngoại suy có giới hạn (≤150ms) thay vì đứng hình.

### 2b – kết quả

- Xong cả 4 mục. Test: 112 đạt. Một tab + 200 zombie: host 0.83 ms/tick, frame TB 2.2 ms.
- 2 tab qua P2P: kênh unreliable mở, snapshot/input đi qua; chuyển host có bản lưu giữ đủ zombie.
- Gói mới dùng số loại riêng ngoài gameCodec: 125 = sao lưu thế giới (`net/worldBackup.ts`), 126 = điểm host (`net/hostElection.ts`). B tránh dùng 2 số này.

## GĐ 2c – kế hoạch & kết quả

- Kế hoạch: giới hạn 4 người (host từ chối người thứ 5, gói 124 "phòng đầy"); gục/cứu (R)/kéo (G) trong `SimWorld` + `shared/sim/tuning/party.ts`; trạng thái gục gửi bằng khối mở rộng cuối snapshot; HUD: khung đội, mũi tên mép màn hình, chữ khi gục/phòng đầy.
- Kết quả: 122 test; 2 tab: host bị cắn gục → khách giữ R → đứng dậy 30 máu; 200 zombie: host 0.79 ms/tick, frame TB 2.1 ms.
- Cần báo B: người gục vẫn mở/đóng cửa được (luồng E giữ nguyên vì B nối loot vào đó — B chặn `isUp` khi xử lý E). Số cân bằng ở `shared/sim/tuning/party.ts` → B chuyển vào `/shared/data`.
