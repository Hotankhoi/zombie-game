# Tiến độ của A (Claude Code)

File này để session mới đọc và làm tiếp nếu session cũ bị ngắt. Cập nhật sau mỗi giai đoạn.

## Cam kết với B (bắt buộc giữ)

- KHÔNG sửa điểm nối loot trong `host/`, `net/`, `client/scenes/WorldScene.ts` (luồng E/Interact với đồ vật, chỗ B thêm gói/handler loot).
- KHÔNG sửa `shared/types`. KHÔNG sửa vùng của B (`shared/mapgen`, `shared/data`, `client/ui`, `shared/inventory`, `shared/loot`).
- Không xếp chồng lên `b/loot-online` hay PR #7.
- Hệ quả: dữ liệu cân bằng mới của A để tạm ở `shared/sim/tuning/`; đổi định dạng gói theo cách tương thích (không tăng `PROTOCOL_VERSION`). Cả hai cần báo B.

## Thứ tự merge (phiên 2026-10-24, merge commit, không squash)

`#3 (map, B)` → `#4 (1a)` → `#15 (hợp đồng loot, B)` → `#6 (2a)` → `#8 (2b)` → `#9 (2c)` → `#10 (4)` → `#11 (5)` → `#12 (6)` → `#13 (7)` → `#14 (7b relay)`

## Nhật ký phiên merge 2026-10-24 (cập nhật sau mỗi bước)

- Bước 0: sửa 13 góp ý Codex còn mở trên #6–#13 ở nhánh `a/7-bots-perf` (commit 4fbafb2, 53915f0, fc2f29a, 02abae8), trả lời + resolve từng thread. Bản lưu thế giới: có byte phiên bản, gọn ~25 byte/zombie, mỗi người nhận 10s/lần (loadtest đợt tràn tối đa: 22.1 KB/s TB, đỉnh 24.98).
- Đã merge: #3, #4, #15, #6, #8, #9, #10, #11, #12 (xung đột chỉ ở AGENTS.md mục 8 và `PROTOCOL_VERSION` → giữ 3).
- Đang: #13 → #14 → PR spawn theo map B → thử link thật → Phần 2.

## Các giai đoạn

| GĐ  | Nhánh                                         | PR  | Trạng thái                                                                                                   |
| --- | --------------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------ |
| 1a  | `a/1a-core-gameplay`                          | #4  | Xong, chờ merge                                                                                              |
| 2a  | `a/2a-online-core` (base `b/map-generator`)   | #6  | Xong, chờ merge                                                                                              |
| 2b  | `a/2b-net-advanced` (base `a/2a-online-core`) | #8  | Xong, chờ merge                                                                                              |
| 2b' | —                                             | —   | Hoãn: delta snapshot, zombie tất định, ownership, hit client (viết lại đường snapshot, đụng chỗ B ghép loot) |
| 2c  | `a/2c-party` (base `a/2b-net-advanced`)       | #9  | Xong, chờ merge                                                                                              |
| 4   | `a/4-night-noise` (base `a/2c-party`)         | #10 | Xong, chờ merge                                                                                              |
| 5   | `a/5-horde` (base `a/4-night-noise`)          | #11 | Xong phần đợt tràn, chờ merge; lưu IndexedDB: cần báo B trước                                                |
| 6   | `a/6-turned` (base `a/5-horde`)               | #12 | Xong phần độc lập, chờ merge; hành động 2 người: cần báo B trước                                             |
| 7   | `a/7-bots-perf` (base `a/6-turned`)           | #13 | Xong phần A (bot, đo tải, tối ưu); TURN trên 4G: người dùng tự thử                                           |

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

## GĐ 4 – kế hoạch & kết quả

- Kế hoạch: ngày/đêm suy từ tick (`shared/sim/dayNight.ts`, 11 phút/ngày); tầm nhìn nón + đèn pin (F) vẽ ở HUD; tiếng ồn (`SimWorld.emitNoise`, zombie "investigate"); 6 loại zombie (`shared/sim/tuning/zombieKinds.ts`); vũng độc/axit; khổng lồ phá cửa. `?gio=0.9` để thử ban đêm.
- Kết quả: 138 test; Browser pane: ngày/đêm/đèn pin hiển thị đúng; 200 zombie: frame TB 2.6 ms (lớp bóng tối 0.5 ms).
- Bỏ (cần B): giảm thanh (phụ kiện súng), axit mòn giáp (giáp), súng phát tiếng ồn (B gọi `world.emitNoise(x, y, r)`). Khổng lồ phá tường: chưa làm (phải đồng bộ thay đổi map). Tường chưa che tầm nhìn.

## GĐ 5 – kế hoạch & kết quả

- Kế hoạch: đợt tràn vào đêm ngày 15k (`SimWorld.directHorde`, `shared/sim/tuning/horde.ts`), số lượng 150 → +100/đợt (tối đa 500) + Boss (1..4, đập đất/gầm); zombie đợt tràn được dẫn tới người chơi; kết thúc khi sáng/giết hết/cả đội chết; bảng thành tích (giết/gục). HUD: "Đợt tràn còn Y ngày", trời đỏ từ ngày 13. `?ngay=15&gio=0.79` để thử.
- Băng thông: ngân sách 200 zombie/snapshot (130 gần nhất + xoay vòng), sao lưu thế giới xoay vòng 1 người/10s → 4 người + 648 zombie: 24.5 KB/s mỗi người.
- Kết quả: 147 test. Đo không giao diện (4 người bất tử, 648 zombie): host TB 10–20 ms/tick (p95 25 ms).
- Bỏ (cần báo B trước): lưu IndexedDB + xuất/nhập save (phải gồm túi đồ/rương/căn cứ của B + định dạng ở shared/types); thùng thưởng huyền thoại (loot) — HUD đã có chỗ, B nối khi `horde.survived === true`.

## GĐ 6 – kế hoạch & kết quả

- Làm: chết hẳn → xác ở lại, sau 8s thành zombie tại chỗ (`SimWorld.corpses`, `ZombieState.turnedFrom`), nhuộm màu người đó; kéo người gục đã làm ở 2c.
- Bỏ (cần báo B trước): hành động 2 người (két sắt, cửa cuốn, kho quân sự = chỗ chứa loot / tương tác E; cửa cuốn còn cần đối tượng map); "mặc nguyên đồ của mình" (túi đồ) — B thả đồ khi giết zombie có `turnedFrom`.

## GĐ 7 – kế hoạch & kết quả

- Làm: `tools/bot.ts` + `tools/loadTest.ts` + `npm run loadtest` (4 kịch bản), bản nhanh trong `npm test`; tối ưu host (`separate()` 5.6 → 3.4 ms ở 650 zombie dồn sát; tra ô 1 lần `tileKind`); lớp tối dùng mặt nạ hình học (~11 → ~2 ms/frame).
- Bảng đo cuối (4 bot): mạng tốt 200 zombie host 1.0 ms/tick, 17 KB/s; trễ 150ms + mất 5%: 1.6 ms, 17 KB/s, lệch dự đoán 0; đợt tràn tối đa (564 TB / 683 max zombie): host 7.3 ms (p95 11), 20.9 KB/s TB, đỉnh 24.7 KB/s.
- Còn lại (người dùng): thử TURN trên 4G; chơi 2–4 máy thật.

## Hết giai đoạn độc lập

Các phần còn lại của A đều cần B trước: lưu IndexedDB/xuất nhập save (GĐ 5), hành động 2 người (GĐ 6), giảm thanh/tiếng súng/giáp (GĐ 4), 2b' (delta snapshot, zombie tất định, ownership, hit do client — đụng chỗ B ghép loot online). API spawnPoint của B vẫn chưa có trên `b/map-generator` (kiểm tra lần cuối: commit 4248753).
