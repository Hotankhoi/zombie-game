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

## Phiên 2026-10-25 (khuya): phần 2B — hiển thị + điều khiển loot (máy thật, Browser pane)

Nhánh `a/loot-ui` (mỗi bước 1 PR từ `main`, CI xanh thì merge commit). Bước 1 (vẽ rương) = PR #34 đã merge.

- Bước 2 — phím + panel (`client/loot/lootUi.ts`, `lootMessages.ts`, `outcome.ts`, `lootUi.css`): F cạnh rương = mở
  rương (gửi `open` rồi hiện panel rương của B), F lần nữa = đóng; xa rương F vẫn là đèn pin (lần nhấn dùng cho rương
  không bật đèn). I = túi, Esc = đóng mọi panel (bắt ở pha capture). Panel mở → không đi/chém/ngắm/E (chuột đang giữ
  lúc đóng panel không thành chém); thế giới vẫn chạy. Gục/chết → đóng hết; xa rương > 2 ô hoặc bị che → đóng panel
  rương (`canKeepChestOpen`). Chờ host: panel B khóa nút (`aria-busy`); ClientLoot trả `busy`. Lỗi → câu tiếng Việt
  (`LOOT_ERROR_TEXT` đủ mọi mã host + máy khách, typecheck bắt thiếu). Sửa vùng B tối thiểu: `inventoryPanel.ts`,
  `lootPanel.ts` nhận `describeError` + kiểu kết quả có mã lỗi online; panel rương đã mở sẵn thì câu đầu đúng.
  Không đóng panel khi chỉ bị cắn (yêu cầu: gục mới đóng). Thử Browser pane (cửa sổ Claude bị ẩn → requestAnimationFrame
  dừng, khung hình đứng ở 19; tôi đẩy vòng lặp bằng `setInterval(game.loop.step)` trong trang, ảnh chụp không được):
  F mở panel rương (6 ô thật), I thêm túi, giữ W khi panel mở → đứng yên, Esc → đóng hết + đi lại được, lấy 1 món → túi
  1 → 2 món, lúc chờ `aria-busy=true`; thao tác khi đang chờ → "Đang chờ host xác nhận thao tác trước."; F khi đang mở
  → đóng, đèn pin tắt; F xa rương → đèn pin bật. 327 test. PR #36 đã merge.
- Bước 3 — HUD (nhánh `a/loot-hud`): dòng "Túi 4/12 ô" cạnh thanh stamina (cam khi kín ô; tính lại chỉ khi ClientLoot
  báo đổi), gợi ý phím thêm "F đèn pin/mở rương · I túi · Esc đóng". Nhặt từ rương thành công → thông báo ngắn
  "+2 Đồ hộp (Tốt)" màu độ hiếm (`gainedItems` so tổng theo món + độ hiếm trước/sau, sắp xếp/gộp không báo). Browser
  pane: lấy hết rương → HUD 1/12 → 4/12, 3 thông báo đúng màu; ảnh chụp được khi cửa sổ Claude hiện. 330 test. PR #37 đã merge.
- Bước 4 — thử 2 tab (Browser pane, `?zombies=0`, vòng lặp đẩy tay bằng `setInterval(game.loop.step)` vì cửa sổ Claude
  hay bị ẩn; chụp ảnh được lúc cửa sổ hiện). Kết quả: 2 tab cùng tới 1 rương, thấy cùng 3 món; bấm "Lấy" cùng 1 ô **cùng
  mili-giây** → tab host được 3 Nước sạch, tab khách bị từ chối "Rương hoặc túi vừa thay đổi…" và ô thành trống (bảo toàn).
  Lần trước (lệch 208 ms) tab còn lại thấy ô trống trước khi kịp bấm. Tải lại tab khách → túi còn (dao + gậy). Đóng tab
  host → tab còn lại lên host (term 2) sau ~3 s, túi 2 người + rương (còn 2 đồ hộp) đúng. Ảnh: 6 tấm (báo cáo session).
  **Lỗi 2A tìm thấy** (chưa sửa, đụng `/net`/`/host` → cần duyệt): (1) 2 tab cùng trình duyệt cướp túi nhau —
  `loadPlayerKey` ghi khóa chung vào sessionStorage trước khi host chấp nhận → tab 2 tải lại sớm = `resume` → lấy túi tab 1;
  host cũng cho lấy khi tab 1 im ≥ 3 s (tab ẩn). Tab 1 không được báo (hiện túi tab 2, mọi thao tác `unknown_player`).
  (2) Tab vừa tải lại tự làm host riêng ~0,5 s (thế giới trống, túi chỉ có dao) rồi mới nhập host thật.
- Bước 5 — tài liệu (nhánh `a/loot-docs`): bảng "Điều kiện hoàn thành" ở `docs/loot-online-plan.md` (sau 2B + 2 lỗi 2A),
  AGENTS.md mục 8, ghi chú tương thích của PR #35 (B, đã đóng) gộp vào `shared/types/loot-protocol.md` (bản hiện tại 5,
  sao lưu 125 bản bố cục 6).

## Phiên 2026-10-26: sửa 2 lỗi loot + GĐ 3b (kế hoạch đã duyệt)

Kế hoạch 8 PR (mỗi PR 1 nhánh từ `main`, CI xanh → merge commit): (1) `a/loot-key-fix` lỗi cướp túi · (2) `a/host-wait` tab
tải lại tự làm host · (3) `a/3b-contract` hợp đồng `shared/types/loot.ts` (use/reload/equip) · (4) `a/3b-survival` đói/khát/
nhiễm trùng · (5) `a/3b-use-items` dùng đồ (phím 1–4, hiệu ứng áp khi giao dịch đã được mọi người ACK) · (6) `a/3b-weapons`
gậy/súng lục/súng trường, X đổi vũ khí, Q nạp đạn, trúng do host quyết + bù trễ · (7) `a/3b-armor` mũ/áo/quần + bảng loot ·
(8) `a/3b-report` đo tải + tài liệu. Chi tiết số cân bằng ở từng mục bên dưới khi làm xong.

- PR 1 (`a/loot-key-fix`): `loadPlayerKey` không ghi sessionStorage; `rememberPlayerKey` khi claim thành công
  (`ClientLoot.onClaimed`); host đếm im lặng theo mọi gói (`HostServer.heard`, worker `seen`), `LOOT_TAKEOVER_IDLE_TICKS`
  60 → 200; host báo tab cũ (reply `key_in_use` đúng requestId claim cũ) → `claimError = 'key_taken'`, sự kiện `lost`,
  HUD "Túi đang mở ở tab khác"; `unknown_player` → claim lại không resume. `TestMatch`: `MemStorage`, `hidden`, `frozen`.
  334 test.
  PR #40 đã merge.
- PR 2 (`a/host-wait`): `HostElection` `expectHostUntil` / `waitHostMs` (10 s) / `waitingForHostMs()`, gói 126 byte cờ
  "đang theo host"; NetGame ghi `zombie-coop.lastRoom` (sessionStorage) khi có host, tải lại < 60 s cùng phòng có người →
  chờ host thật; HUD đếm giây. `TestMatch.join(..., connectAfterMs)` giả WebRTC nối chậm. 342 test.
  PR #41 đã merge.
- PR 3 (`a/3b-contract`): `LootAction` thêm `use {expectedRevision, slot, target}`, `reload {expectedRevision}`,
  `equip {itemId, rarity}` (mã 8–10 trong `net/lootCodec.ts`), `ChestWire.version` `1 | 2`; host tạm trả
  `invalid_command`. Ghi `shared/types/loot-protocol.md` mục "GĐ 3b". 342 test.
  PR #42 đã merge.
- PR 4 (`a/3b-survival`): `shared/data/survival.ts` (vùng B) + `shared/sim/survival.ts`; `PlayerState` thêm `food`,
  `water`, `infection`, `maxHp` (tính trong `stepPlayer` theo input → dự đoán khớp host). No hết ~25 phút, nước ~18 phút
  (chạy ×1.5); < 25 → stamina hồi ×0.5 mỗi thứ; = 0 → −0.5 máu/s mỗi thứ, hết máu → gục. Cắn: nhiễm +8 × hệ số cắn của
  loại zombie; > 0 tự tăng 0.05/s; ≥ 50 → máu tối đa −1/6 s (sàn 40); = 0 → +0.1/s. Hồi sinh: nhiễm 0, máu tối đa 100,
  no/nước ≥ 60. Snapshot: khối "chỉ số" (người nhận + 1 đồng đội xoay vòng, u16 1/600); `ClientSync` nhớ chỉ số từng người
  → `toWorldState`; bản lưu 125 bố cục 7. HUD: 3 thanh (no cam / nước xanh / nhiễm xanh bệnh, thấp/nặng thì nháy đỏ) +
  phần xám máu tối đa. `PROTOCOL_VERSION` 6. 350 test. Loadtest (KB/s TB · đỉnh nhóm · đỉnh 1 người): bình thường
  11.14 · 15.17 · 15.41; trễ 150 + mất 5% 9.39 · 14.74 · 15.12; **đợt tràn tối đa 17.85 · 20.30 · 20.73**; đợt tràn 1
  5.57 · 15.41 · 15.89; tràn + mở rương liên tục 14.68 · 16.94 · 17.24.
  Ghi chú: `npm run loadtest` không in bảng nếu không có `--silent=false` → dùng
  `npx vitest run --config tools/vitest.config.ts tools/scenarios.loadtest.ts --silent=false`.
  PR #43 đã merge.
- PR 5 (`a/3b-use-items`): `shared/data/consumables.ts` (vùng B): băng gạc hồi 20 máu dần trong 8 s (tự) / 3 s (cho đồng
  đội), đồng đội gục → đứng dậy 30 máu; bộ sơ cứu đứng yên 3 s (host chấp nhận ≥ 2.5 s) → +60; kháng sinh −60 nhiễm;
  nước +45; đồ hộp +40; độ hiếm × 1 · 1.15 · 1.3 · 1.5 · 1.75; tầm băng đồng đội 1.5 ô + nhìn thấy. `shared/sim/items.ts`
  (`checkUse`/`applyUse`), `SimWorld.checkItemUse/applyItemUse`; `PlayerState` thêm `healLeft`, `healRate`, `stillFor`.
  Host (`hostLoot.use`): kiểm tra → `authority.update` (vùng B, mới) + `removeFromSlot`/`removeItemUpTo`/`countItem`
  (`shared/inventory/inventory.ts`, vùng B, mới) → hiệu ứng gắn vào kết quả đang chờ, áp khi mọi người đã ACK.
  `HostLoot.hostUpdate` (host tự sửa túi). Mã lỗi mới `not_usable`, `not_still`, `no_target`, `not_needed`. Client:
  `client/loot/quickUse.ts` (1 băng gạc · 2 sơ cứu · 3 kháng sinh · 4 ăn/uống cái thấp hơn), `client/loot/itemUse.ts`
  (sơ cứu: tiến độ đứng yên, đi/đánh → hủy), panel túi của B có nút "Dùng" (`actionLabel`/`onAction`, vùng B), HUD thanh
  dùng nhanh góc phải dưới. Chỉ bản dev: `?kit=1` (túi mới có đồ y tế/ăn uống + vào trận đói/khát/45 máu/nhiễm 40).
  `PROTOCOL_VERSION` 7, bản lưu 125 bố cục 8. 367 test. Browser pane (pane ẩn → đẩy vòng lặp bằng `setInterval`): phím 4
  nước 20 → 64.6 rồi đồ hộp no 30 → 69.7; phím 3 nhiễm 40 → 0; phím 2 đứng yên 3 s → máu 45 → 100. Loadtest đợt tràn
  tối đa 18.01 · 20.46 · **20.89**.
  PR #44 đã merge.
- PR 6 (`a/3b-weapons`): `shared/data/guns.ts` + `BAT`/`FISTS` trong `shared/data/melee.ts` (vùng B). Súng lục 30 sát
  thương, 14 ô, 4 phát/s bán tự động, băng 12, nạp 1.2 s, tản 3°, giật +4°/phát (tối đa 12°, hồi 10°/s), ồn 18 ô; súng
  trường 55, 22 ô, 3 phát/s giữ chuột, băng 20, nạp 2 s, tản 1.5°, giật +6° (tối đa 15°, hồi 10°/s), xuyên 1, ồn 28 ô;
  gậy 55, 1.4 ô, 110°, 0.75 s, 14 stamina, không ám sát; độ hiếm × 1 · 1.1 · 1.2 · 1.35 · 1.5. `shared/sim/guns.ts`:
  tia + tản tất định (hash id + số phát mod 64), tường/cửa đóng chặn, `SimWorld.shoot` **trúng do host quyết** + bù trễ
  (input có `view` = tick máy khách đang vẽ, host lùi vị trí zombie ≤ 10 tick, lịch sử chỉ ghi khi có người cầm súng).
  `PlayerState`: `weapon`, `weaponRarity`, `magPistol`, `magRifle`, `reloadGun/Left/Amount`, `recoil`, `shots`. Host:
  `equip` (món phải có trong túi), `reload` (trừ đạn đúng loại ≤ số thiếu, bắt đầu nạp khi đã ACK, đạn vào đúng súng
  lúc yêu cầu). Mã lỗi mới `not_equippable`, `not_owned`, `no_gun`, `mag_full`, `no_ammo`, `reloading`. Mạng: sự kiện
  `shot` (EV 7), khối "trang bị" (vũ khí mọi người), trường súng trong khối chỉ số (đồng đội xoay vòng còn mỗi 2
  snapshot), input nối `view` u32. Client: X / lăn chuột đổi vũ khí, Q nạp, bắn hết đạn tự nạp, tia vàng + chớp nòng,
  súng/gậy vẽ trên tay, HUD "Súng lục 8/12 · túi 24", panel túi nút "Cầm". Chỉ bản dev: `?den=police` (vào trận cạnh rương
  đồn cảnh sát gần nhất; phòng `GUN000` có súng lục + đạn). `PROTOCOL_VERSION` 8, bản lưu 125 bố cục 9. 378 test.
  Browser pane (`?room=GUN000&zombies=10&den=police`, pane ẩn → đẩy vòng lặp + chuột giả trên canvas): mở rương, lấy hết
  (súng lục + 18 đạn), X → gậy → súng lục, Q nạp 12/12 (túi 18 → 6), bắn: zombie −30 máu/phát, giết 2 con, hết đạn tự
  nạp. Loadtest đợt tràn tối đa 18.27 · 20.73 · **21.16** (gửi 0.43 → 0.75 KB/s vì `view`).
  PR #45 đã merge.
- PR 7 (`a/3b-armor`): `shared/data/items.ts` (vùng B) thêm cuối danh mục `helmet`/`vest`/`pants` (loại `armor`),
  `shared/data/armor.ts` (giảm sát thương mũ 8% · áo 15% · quần 7% × độ hiếm 1 · 1.25 · 1.5 · 1.8 · 2.1, trần 70%;
  nhiễm trùng khi cắn × (1 − 0.8 × mức giảm); bền 100, mòn theo sát thương đỡ, axit ×3), `shared/data/loot.ts` thêm giáp
  (dân cư 8/108, siêu thị 4/104, đồn cảnh sát 34/134, quân sự 48/148 trọng số; bệnh viện không có), `LOOT_VERSION` 2
  (`shared/loot/chest.ts`, test ảnh rương của B cập nhật). `shared/sim/armor.ts`; `PlayerState` `armorHead/Body/Legs`
  (0 = không, 1..5 độ hiếm) + `durHead/Body/Legs`; độ bền thuộc chỗ mặc; cắn/Boss/vũng đi qua `SimWorld.hurt`; giáp vỡ →
  `armorBreaks` → host `hostUpdate` trừ đúng món. Mặc = intent `equip` (nút "Mặc" ở panel túi). HUD "Mũ — · Áo Thường 100%
  · Quần Tốt 100%", thông báo "… đã vỡ!". Sửa lỗi codec: rương giải mã ghi cứng `version: 1` → `LOOT_VERSION`.
  `PROTOCOL_VERSION` 9, bản lưu 125 bố cục 10. 385 test. Browser pane (`?room=ARM009&zombies=60&den=police&kit=1`): lấy
  hết rương đồn cảnh sát (2 súng lục, đạn, áo, quần), mặc áo + quần, cầm súng, nạp, bắn chết zombie phình (160 máu, 6
  phát trúng), bị cắn → nhiễm trùng tăng, 4 ăn/uống → no/nước ~99. Ảnh chụp thẳng từ canvas (`renderer.snapshot`) vì cửa
  sổ Claude ẩn. Loadtest đợt tràn tối đa 18.50 · 20.96 · **21.40**.
  PR #46 đã merge.
- PR 8 (`a/3b-report`): kịch bản đo tải mới "đợt tràn tối đa + bot bắn súng trường liên tục" (`LoadOptions.guns`:
  host cấp súng trường + băng đầy) → 18.20 · 19.70 · 20.32; ảnh `docs/anh-3b/`; báo cáo `docs/bao-cao-3b.md`; AGENTS mục 8;
  `shared/data/README.md`. **GĐ 3b xong phần A.** Việc tiếp (cần bàn với B): chế tạo/căn cứ, thùng thưởng, đồ rơi từ
  zombie, file save (#21), hành động 2 người, 2b' (delta snapshot — băng thông đợt tràn còn ~0.6 KB/s tới ngưỡng 22);
  người dùng tự thử 2–4 máy thật.

## Phiên 2026-10-28: merge #49 + đồ trên đất, zombie rơi đồ, thùng thưởng, lưu game (kế hoạch đã duyệt)

- Việc 1: PR #49 của B (thanh nhanh 5 ô + thả/nhặt, chứa #48) đã cập nhật với `main`, `npm run check` 393 test → merge
  commit; #48 tự "merged". #35, #39 (đã đóng sẵn) thêm bình luận "đã được thay thế". `main` ở `PROTOCOL_VERSION` 10.
- Việc 2 (`a/ground-cleanup`): `GroundItemWire.t` (tick rơi), `shared/data/ground.ts` (hết hạn 300 s, gộp ≤ 0.5 ô, tối đa
  128, quét mỗi 20 tick, lưới 1/32 ô); `shared/loot/ground.ts` `placeGround`/`sweepGround`/`snapGround`, authority
  `drop(..., tick)` gộp ngay + `spawnGround` + `sweepGround` (vùng B, tối thiểu); HostLoot quét ở `flush` theo tick thế
  giới; codec: đồ rơi ~10–17 B/đống, phần đổi 112 chỉ mang `dropsSet` + `dropsRemoved` (trước: cả danh sách mỗi lần đổi).
  Bản dev `?dondat=20` (hết hạn 20 s). `PROTOCOL_VERSION` 11. 400 test. Test B sửa: `host/dropOnline.test.ts` (2 lần thả
  cùng chỗ → 1 đống 20), `net/ground.test.ts` (patch mới). Browser pane: thả 2 lần băng gạc → 1 đống ×2, 20.6 s sau tự
  biến mất, không lỗi console (ảnh `docs/anh-ground/`). Loadtest (KB/s mỗi người, TB · đỉnh 5s nhóm · đỉnh 5s 1 người;
  loot TB · đỉnh 1 người):

  | Kịch bản                          | Nhận                  | Loot        |
  | --------------------------------- | --------------------- | ----------- |
  | Bình thường ngày 2 (đối chứng)    | 11.82 · 15.85 · 16.09 | 0.04 · 0.14 |
  | Bình thường + 128 đồ trên đất     | 12.02 · 16.16 · 16.40 | 0.25 · 0.46 |
  | Đợt tràn tối đa (đối chứng)       | 18.50 · 20.96 · 21.40 | 0.04 · 0.13 |
  | Đợt tràn tối đa + 128 đồ trên đất | 18.72 · 21.34 · 21.78 | 0.26 · 0.49 |

  128 đống, ~1 đống hết hạn + 1 đống mới mỗi giây. Cách cũ (cả danh sách ~3.9 KB mỗi lần đổi, 2 lần/s) ước ~7.7 KB/s.

- Việc 2: PR #50 đã merge.
- Việc 3 (`a/zombie-drops`): `shared/data/zombieDrops.ts` (vùng B, mới) — zombie thường (mọi loại trừ Boss) ngày 4% /
  đêm 8%, 1 món lặt vặt (băng gạc/nước/đồ hộp 25, đạn lục 15 [3–8], phế liệu 10 [1–3]; Thường 80/Tốt 20); từ xác đồng đội
  (`turnedFrom`) 60% / 80%, 2 món (+ đạn trường [5–10] 10, kháng sinh 8; Thường 55/Tốt 35/Hiếm 10); Boss 100%, 1 món
  (súng lục 15/súng trường 20/mũ 15/áo 20/quần 15/sơ cứu 15; Hiếm 60/Sử thi 30/Huyền thoại 10) + 1 đống đạn [10–20].
  `shared/sim/zombieDrops.ts` quay số bằng `Rng` gieo từ (id zombie, tick chết) — tất định, không xáo dãy RNG chính;
  `SimWorld.reapZombies` ghi `zombieDrops`, `HostServer.placeZombieDrops` → `HostLoot.spawnGround` (gộp, đủ 128 → bỏ).
  Bản dev `?roido=10` (nhân tỉ lệ). 404 test. Browser pane (`?room=DRP003&kit=1&gio=0.93&zombies=80&roido=12`): chém
  ban đêm 11 s → 3 đống đồ rơi đúng chỗ zombie chết, nút "V · Nhặt Phế liệu ×2". Loadtest: không đổi đáng kể (đợt tràn
  tối đa + bắn súng 18.87 · 21.11 · 21.59; bot giết ~90 con/90 s → ~7 đống).

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
