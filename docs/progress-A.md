# Tiến độ của A (Claude Code)

File này để session mới đọc và làm tiếp nếu session cũ bị ngắt. Cập nhật sau mỗi giai đoạn.

## Cam kết với B (bắt buộc giữ)

- KHÔNG sửa điểm nối loot trong `host/`, `net/`, `client/scenes/WorldScene.ts` (luồng E/Interact với đồ vật, chỗ B thêm gói/handler loot).
- KHÔNG sửa `shared/types`. KHÔNG sửa vùng của B (`shared/mapgen`, `shared/data`, `client/ui`, `shared/inventory`, `shared/loot`).
- Không xếp chồng lên `b/loot-online` hay PR #7. (Hết hiệu lực 2026-10-25: B cho A merge #16 và làm tiếp phần nối loot.)
- Hệ quả: dữ liệu cân bằng mới của A để tạm ở `shared/sim/tuning/`; đổi định dạng gói theo cách tương thích (không tăng `PROTOCOL_VERSION`). Cả hai cần báo B.

## Thứ tự merge (phiên 2026-10-24, merge commit, không squash)

`#3 (map, B)` → `#4 (1a)` → `#15 (hợp đồng loot, B)` → `#6 (2a)` → `#8 (2b)` → `#9 (2c)` → `#10 (4)` → `#11 (5)` → `#12 (6)` → `#13 (7)` → `#14 (7b relay)`

## Nhật ký phiên merge 2026-10-24 (cập nhật sau mỗi bước)

- Bước 0: sửa 13 góp ý Codex còn mở trên #6–#13 ở nhánh `a/7-bots-perf` (commit 4fbafb2, 53915f0, fc2f29a, 02abae8), trả lời + resolve từng thread. Bản lưu thế giới: có byte phiên bản, gọn ~25 byte/zombie, mỗi người nhận 10s/lần (loadtest đợt tràn tối đa: 22.1 KB/s TB, đỉnh 24.98).
- Đã merge: #3, #4, #15, #6, #8, #9, #10, #11, #12 (xung đột chỉ ở AGENTS.md mục 8 và `PROTOCOL_VERSION` → giữ 3).
- Đã merge thêm: #13, #14 (xung đột chỉ AGENTS.md mục 8 + docs/progress-A.md).
- PR #17 (spawn theo `spawnPoint()`/`isRoadTile()` của B) đã merge.
- Thử link thật (2 tab, Browser pane bị ẩn nên chạy chậm 1–15 FPS): 2 tab cùng `?room=` thấy nhau (ping ~80 ms), khách thấy host, ngày/đêm + nón nhìn đúng, zombie đuổi và cắn. Lỗi thấy: hồi sinh ngay giữa bầy zombie ở điểm xuất phát → chết liên tục (Phần 2b sửa). Chém zombie trên link thật chưa xác nhận được (pane ẩn, phím không giữ được).
- Phần 2a (#18, đã merge): tường/cửa đóng chặn nón nhìn, vòng quanh mình, đèn pin (raycast lưới, `shared/sim/vision.ts`); zombie sau tường không vẽ. Đo CPU (`tools/vision.loadtest.ts`): 0.2–0.3 ms/frame. F3 thêm "HUD ms".
- Phần 2a: PR #18 đã merge.
- Phần 2b (#19, đã merge): hồi sinh ở ô đường gần đồng đội còn sống nhất (không còn ai → gần điểm xuất phát), không zombie trong 10 ô; bất tử 4s (`PlayerState.shield`, không mất máu vì cắn/vũng/Boss); vòng sáng quanh người vừa hồi sinh. Bản lưu thế giới lên phiên bản 3 (thêm `shield`).
- Phần 2b: PR #19 đã merge.
- Phần 2c (#20, đã merge): khổng lồ/Boss đuổi người trong 9 ô thì đi thẳng, húc tường trước mặt (tường 100 máu, 30/s, Boss ×2) → ô trống mãi mãi. `SimWorld.mapChanges` → host gửi `GameMsg.MapDelta` (21, reliable: ô vừa vỡ cho mọi người; cả danh sách cho người mới vào/khi đổi host). Bản lưu thế giới phiên bản 4 (`brokenWalls`, `wallDamage`). Loadtest: đợt tràn tối đa 22.2 KB/s TB, đỉnh 24.7.
- Phần 2d: `docs/save-format.md` ở PR #21 — CHỜ B GÓP Ý, A không tự merge. Sau khi chốt: PR hợp đồng `playerKey` (PROTOCOL_VERSION 4) rồi mới làm IndexedDB/xuất–nhập.
- Thử ghép `b/loot-online` (#16) lên `main` (2026-10-25): chỉ xung đột chữ ở AGENTS.md và `shared/sim/mapgenSource.ts` (lấy bản `main`), typecheck đạt, 257 test đạt.

## Phiên 2026-10-25 (chiều): 3 việc rủi ro

- Việc 1 — chặn khác phiên bản (nhánh `a/version-gate`): Hello thêm khối build (`net/build.ts`, SHA + giờ build do
  `vite.config.ts` đặt từ `GITHUB_SHA`); `Session.game` = Transport chỉ gồm người cùng PROTOCOL_VERSION → NetGame/bầu
  host/snapshot/sao lưu/loot đều không đi tới người khác bản. `client/net/versionNotice.ts`: "Bạn đang dùng bản cũ,
  bấm để tải lại" (che màn hình) hoặc "Có bản mới, nên tải lại" (dải nhỏ, cùng giao thức khác build). Thử bản dev:
  thêm `&v=2` vào link. 199 test. Browser pane: tab `&v=2` hiện bảng bản cũ, 2 tab mỗi bên tự làm host, ↑↓ 0 KB/s.
  PR #23 đã merge.
- Việc 2 — chừa băng thông cho loot (nhánh `a/bandwidth-horde`), đo `npm run loadtest` (đợt tràn tối đa, KB/s TB · đỉnh 5s):
  gốc 22.18 · 24.72 → bước 1 (zombie > 20 ô gửi gọn 5 byte, khối mở rộng cuối snapshot) 21.63 · 24.25 → bước 2
  (sao lưu gửi phần thay đổi) BỎ: đo được chỉ 0.9% zombie không đổi sau 10s (đợt tràn), sao lưu chỉ chiếm 8.7% băng
  thông → không đáng → bước 3 (`ZOMBIE_BUDGET` 200 → 170, chỗ xoay vòng ưu tiên zombie trên màn hình, ngoài màn hình
  tối đa 8 con/snapshot; client giữ zombie vắng mặt 40 tick thay vì 24) **19.71 · 22.19**. Cơ cấu đợt tràn: snapshot
  82%, sự kiện 10%, sao lưu 9%. Đỉnh 5s còn > 20 vì bản sao lưu ~23 KB dồn 1 lần/10s mỗi người → việc sau: rải bản sao
  lưu thành nhiều mẩu.
- Rủi ro 5 (kịch bản thường 17 → 12 KB/s): tụt đúng ở #19 (hồi sinh an toàn). Cho bot bất tử thì trước/sau #19 y hệt
  (16.94 KB/s) → không phải lỗi gói/đo; do luật chơi: người hồi sinh ở chỗ không zombie trong 10 ô + bất tử 4s → chết
  24 → 4 lần, mỗi snapshot TB 120 zombie thay vì 181.
  PR #24 đã merge.
- Việc 3 — mã bí mật relay (nhánh `a/relay-key`): `RelayTransport` tạo mã ngẫu nhiên 16 byte 1 lần/trang (`newRelayKey`),
  gửi `&k=` mỗi lần nối/nối lại; relay lưu mã trong attachment, `admitPeer()` (net/relayProtocol.ts): cùng id + đúng mã
  → thay kết nối cũ, khác mã → 409, không đá ai. `RELAY_PROTOCOL` 1 → 2 (bản game cũ gặp relay mới bị 409, việc 1 nhắc
  tải lại). 204 test. `wrangler dev`: 2 bài relay thật đạt (người lạ cùng id bị 409); bài đo tải hụt 7.96 < 8 snapshot/s
  vì `setInterval(50)` trên Windows chạy 62.5 ms (16 tick/s) — lỗi đồng hồ của công cụ đo, không phải relay.
- Số test: AGENTS.md mục 8 (186 = `main` trước #20; 194 = sau #20).
  PR #25 đã merge.
- Việc 4 — đỉnh 5s đợt tràn ≤ 20 (nhánh `a/backup-parts`). `tools/loadTest.ts` thêm cột "đỉnh 5s 1 người" (cột cũ là
  trung bình cả nhóm, che mất người xui nhận cả bản lưu 23 KB). Đợt tràn tối đa, KB/s TB · đỉnh nhóm · đỉnh 1 người:
  main 19.71 · 22.19 · 24.99 → rải 10 mẩu (gói 125 v5, `BackupParts`) 19.96 · 22.53 · 22.96 → zombie trong bản lưu gọn
  (~18 B/con: varint id, i16 1/32 ô, máu u16) 19.18 · 21.61 · 22.04 → gộp sự kiện cắn (1/người/tick; trước ~8, chiếm 2.2
  KB/s) 17.93 · 19.66 · 20.09 → `ZOMBIE_BUDGET` 165 **17.55 · 19.33 · 19.70**. Bỏ hẳn sao lưu: đỉnh nhóm 19.83 (snapshot
  gần chạm trần). Browser pane: tab khách có "bản lưu 10/10 mẩu", đóng tab host → lên host với 198/200 zombie.
  PR #26 đã merge. `docs/save-format.md` (PR #21, chưa merge) đã cập nhật theo gói sao lưu v5 + chỗ cho loot ở mẩu 0.
- PR #23, #24, #25, #26 đã merge (2026-10-25). Bảng băng thông cuối, đợt tràn tối đa (500 + 4 Boss), KB/s mỗi người:

  | Bước                                                 | TB        | Đỉnh 5s cả nhóm | Đỉnh 5s 1 người |
  | ---------------------------------------------------- | --------- | --------------- | --------------- |
  | `main` trước #24                                     | 22.18     | 24.72           | —               |
  | sau #24 (zombie xa gọn, ngân sách 170)               | 19.71     | 22.19           | 24.99           |
  | sau #26 (10 mẩu, zombie gọn, gộp cắn, ngân sách 165) | **17.55** | 19.33           | **19.70**       |

  Kịch bản khác sau #26 (TB · đỉnh nhóm · đỉnh 1 người): bình thường 10.31 · 14.88 · 15.01; trễ 150ms + mất 5% 9.28 · 14.58 ·
  15.08; đợt tràn 1: 5.65 · 15.21 · 15.55. Còn ~0.3 KB/s đỉnh dưới ngưỡng 20 KB/s cho loot của B ở đợt tràn tối đa.

## Phiên 2026-10-25 (tối): đưa #16 của B vào `main`

- B đồng ý cho A merge PR loot và làm tiếp phần nối loot. Không viết tính năng mới trong bước này.
- #16 (`b/loot-online`) đã chứa đủ #5 (`b/inventory-core` 160a591) và #7 (`b/loot-containers` 7406d83).
- Merge `main` vào `b/loot-online` (merge commit f7f1458, không rebase/force-push). Xung đột:
  - `shared/sim/mapgenSource.ts`: lấy bản `main` (B chỉ có `spawn = spawnPoint()`, `main` đã bao trùm + `spawns` + `isRoadTile`).
  - `AGENTS.md` mục 8: giữ dòng A + B theo hiện trạng.
  - `shared/sim/world.ts` tự gộp, còn chặn người gục bấm E (`isUp`) của B.
- File vùng A bị B sửa: `shared/sim/world.ts` (1 dòng `isUp`), `shared/sim/doors.test.ts` (+1 test). Vùng chung: `AGENTS.md`.
- `npm run check`: typecheck + lint + **271 test** (31 file, +63 so với 208). `npm run build` đạt.
- Browser pane: `?inventory=1` (chọn món, sắp xếp & gộp), `?loot=1` (mở rương, lấy hết 4 món vào túi) chạy, không lỗi
  console; 2 tab cùng `?room=` vào trận (host "2 người · 41 zombie", khách nhận snapshot + bản lưu 10 mẩu, ping ~95 ms).
- #16 đổi tên "3: module túi đồ + rương + loot authority (chưa nối gameplay)", merge bằng merge commit.
- Module mới (`shared/inventory`, `shared/loot`, `shared/mapgen/chests.ts`, `client/ui/inventory|loot`) **chưa được gọi
  từ trận**. Việc tiếp: nối loot vào trận theo `docs/loot-online-plan.md` (hợp đồng, codec, host/worker/UI, đổi host).

## Phiên 2026-10-25 (đêm): nối loot phần 2A (cloud session, không trình duyệt)

Kế hoạch: đầu `docs/loot-online-plan.md`. Mỗi bước 1 PR từ `main` (nhánh `claude/magical-brahmagupta-cuezvn`, làm lại từ
`main` sau mỗi lần merge), CI xanh thì merge commit.

- Bước 1 — codec 110–113 (`net/lootCodec.ts`, PR #29): danh mục theo số thứ tự (độ hiếm/món lấy từ danh mục), kiểm tra
  chặt, ID rương gọn, replica đầy đủ + phần đổi (`applyLootPatch`, `isValidReplica`, `isValidPatch`). 279 test.
- Bước 2 — loot ở host (`host/hostLoot.ts`, PR #30): authority trong HostServer, người gửi = `from` của Transport, chỉ
  người trong trận, `isUp`, tầm với + `hasLineOfSight(world.blocked)`, requestId lặp → gửi lại kết quả cũ, 10 yêu cầu/s,
  term `<epoch>.<ngẫu nhiên>`; replica đầy đủ khi vào trận + phần đổi mỗi tick; kết quả chỉ gửi khi mọi người ACK.
  Sửa vùng B: `LootAuthority.currentRevision/chest/view` (thêm, không đổi cũ). `PROTOCOL_VERSION` 3 → 4. 287 test.
- Bước 3 — ClientLoot (`net/clientLoot.ts`, PR #31): intent tự điền revision, túi đã xác nhận, rương đã biết, replica
  đầy đủ đã kiểm tra (để lên host), `busy`/`not_ready`/`host_changed`/`timeout`; `NetGame.loot` chuyển gói (host: tới
  worker). API cho 2B: `docs/loot-online-plan.md` mục "API ClientLoot". 293 test.
- Bước 4 — đồng bộ + đổi host + playerKey (PR #32): kết quả chỉ báo sau khi mọi người ACK (đã có từ bước 2); host mới
  **thu bản replica của mọi người** (≤ 3s, cả bản rỗng của người mới) rồi chọn bản mới nhất theo (epoch, revision) trước
  khi nhận ghi; yêu cầu đang chờ khi host rời → `host_changed`; mẩu 0 gói 125 (v6) mang gói 112 đầy đủ; playerKey bí mật
  → `claim`, túi theo `ownerId = sha256` (`net/playerKey.ts`, `net/sha256.ts`); hợp đồng `claim` + `PROTOCOL_VERSION` 5.
  NetGame nhận `test` (đồng hồ giả + host trong tiến trình) → `host/testMatch.ts` chạy nhiều NetGame thật trên
  LoopbackHub. `host/lootOnline.test.ts`: người vào sau, tải lại trang, 2 tab cùng khóa, host rời giữa lúc nhặt (3 thời
  điểm), host mới là người vừa vào. Quyết định playerKey ghi vào `docs/save-format.md` mục 4 (PR #21). 310 test.
- Bước 5 — test nhiều máy + đo tải (PR #33): `host/lootMatch.test.ts` (4 NetGame, trễ 150ms + mất 5%): 4 người cùng lấy
  hết 1 rương → đúng 1 thành công; 2 người cùng lấy 1 ô; túi đầy / lượng sai / gói intent lặp 3 lần / revision cũ; ngoài
  tầm, đang gục; host rời khi 2 người đang nhặt → mọi máy về cùng bản, tổng đồ bảo toàn. `tools/lootBot.ts`: bot tới
  rương gần nhất mỗi 15–30 s (dịch nhân vật phía host tới rương vì bot không tự đi vào nhà), mở, lấy hết, túi đầy thì
  sắp xếp. `npm test` (bản nhanh) kiểm tra loot ≤ 3 KB/s. 315 test.

  Bảng đo `npm run loadtest` (4 bot, KB/s mỗi người; loot = gói 110–113 + khối loot trong mẩu 0 gói 125):

  | Kịch bản                                    | Nhận TB · đỉnh 5s nhóm · đỉnh 5s 1 người | Loot TB · đỉnh 5s 1 người · gửi | Tới rương / thành công / đồ |
  | ------------------------------------------- | ---------------------------------------- | ------------------------------- | --------------------------- |
  | Bình thường, mạng tốt                       | 10.90 · 14.92 · 15.16                    | 0.04 · 0.13 · 0.01              | 10 / 12 / 40                |
  | Trễ 150ms + mất 5%                          | 9.15 · 14.50 · 14.87                     | 0.05 · 0.16 · 0.01              | 10 / 16 / 75                |
  | Đợt tràn tối đa (500 + 4 Boss), bất tử      | 17.86 · 20.41 · **20.84**                | 0.03 · **0.13** · 0             | 16 / 13 / 126               |
  | Đợt tràn 1, bot tự chơi                     | 5.33 · 15.17 · 15.65                     | 0.05 · 0.18 · 0.01              | 21 / 29 / 105               |
  | Đợt tràn tối đa + mở rương liên tục (3–6 s) | 14.44 · 16.69 · 16.99                    | 0.13 · **0.34** · 0.02          | 67 / 70 / 244               |
  | Đợt tràn tối đa, bot KHÔNG loot (đối chứng) | 17.57 · 19.37 · 19.74                    | 0.08 (chỉ khối mẩu 0) · —       | —                           |

  Đợt tràn tối đa: đỉnh 1 người 19.74 → 20.84 (+1.1) nhưng phần loot chỉ 0.13 — phần tăng còn lại do bot bị dịch tới rương
  (đứng ở chỗ khác so với bầy zombie), không phải gói loot. Cùng lý do: "lệch dự đoán max 1.4 ô" và 29 lần "chết" ở kịch
  bản bất tử (dịch nhân vật < 2 ô bị tính là lệch dự đoán). Trên máy thật người chơi tự đi tới rương.

- Phần 2B còn lại (session sau, máy thật): vẽ rương, UI túi/rương trong trận, phím F/I/Esc, thử 2 tab.

## Việc còn lại của A (sau phiên 2026-10-25)

- Nối loot vào trận (A làm tiếp theo đồng ý của B), theo `docs/loot-online-plan.md`.
- Chờ B: file save (#21), hành động 2 người, 2b' (delta snapshot, zombie tất định, ownership, hit do client) — #16 đã vào `main`.
- Người dùng tự thử: chơi 2–4 máy thật, TURN trên 4G (Browser pane của Claude bị ẩn nên chạy 1–15 FPS, không thử chém/di chuyển được).
- Giao diện: vào trận mất ~10–25 s khi tab bị ẩn (hẹn giờ bị trình duyệt làm chậm) — kiểm tra lại trên tab hiện bình thường.

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
| 7b  | `a/7b-relay` (base `a/7-bots-perf`)           | #14 | Xong code + test với `wrangler dev`; deploy Cloudflare: người dùng thêm secret (docs/relay.md)               |

## Việc treo

- ~~API `spawnPoint`/ô đường của B~~: xong (nhánh `a/spawn-road`) — `MapgenSource.spawn = spawnPoint()`, `spawns` = 4 ô đường trống quanh đó; `SimWorld` đặt mỗi người (và người hồi sinh) vào chỗ chưa ai đứng.

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

## GĐ 7b – relay dự phòng (kế hoạch & kết quả)

- Lý do: TURN Metered chỉ 500 MB/tháng → người 4G không vào được khi hết. Thêm relay WebSocket miễn phí, không thẻ.
- Làm: `relay/` (Worker + Durable Object SQLite `RelayRoom`, WebSocket Hibernation, 1 phòng = 1 DO);
  `net/relayProtocol.ts` (khung dùng chung game + worker), `net/relay.ts` (`RelayTransport`, gộp gói ≤ 1 khung/50ms),
  `net/auto.ts` (`AutoTransport`: WebRTC trước, sau 8s chưa nối thẳng → relay; `?relay=ws` đi hẳn relay);
  `client/main.ts` nối vào + dòng F3. Không đổi gói game, không đụng điểm nối loot, không sửa `shared/types`.
- Hạn mức: 4 người cùng qua relay ≈ 7,5 giờ/ngày (đo, gộp gói); không gộp chỉ ~4,4 giờ. Chi tiết `docs/relay.md`.
- Test: 14 unit test (LoopbackHub + relay giả); relay thật bằng `wrangler dev`: 4 client Node, chuyển đường sau 8,0s,
  đo tải 4 bot 60s (73 khung/s, 10 snapshot/s mỗi khách, 17 KB/s).
- Deploy: `.github/workflows/relay.yml` (secret `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`), `deploy.yml` nhận
  `VITE_RELAY_URL`. Thiếu secret → bỏ qua. Người dùng cần làm các bước trong `docs/relay.md`.
- Cần báo B: `client/main.ts` đổi chỗ tạo Transport (nếu B sửa main.ts thì ghép tay); không có thay đổi giao thức.

## Hết giai đoạn độc lập

Các phần còn lại của A đều cần B trước: lưu IndexedDB/xuất nhập save (GĐ 5), hành động 2 người (GĐ 6), giảm thanh/tiếng súng/giáp (GĐ 4), 2b' (delta snapshot, zombie tất định, ownership, hit do client — đụng chỗ B ghép loot online). API spawnPoint của B vẫn chưa có trên `b/map-generator` (kiểm tra lần cuối: commit 4248753).
