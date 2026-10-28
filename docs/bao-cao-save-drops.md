# BÁO CÁO CHO REVIEWER — phiên 2026-10-28 (A)

Đồ trên đất tự dọn, zombie rơi đồ, thùng thưởng đợt tràn, lưu game. Mỗi việc 1 nhánh `a/…` từ `main`, 1 PR, CI xanh →
merge commit. `PROTOCOL_VERSION` 10 → **12**.

## 1. Các PR

| Việc | PR                                                          | Nội dung                                                                                     | Trạng thái                                                                                                                                                                              |
| ---- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | [#49](https://github.com/Hotankhoi/zombie-game/pull/49) (B) | Thanh nhanh 5 ô + thả/nhặt đồ (chứa [#48](https://github.com/Hotankhoi/zombie-game/pull/48)) | merged; #48 tự "merged"; [#35](https://github.com/Hotankhoi/zombie-game/pull/35), [#39](https://github.com/Hotankhoi/zombie-game/pull/39) (đã đóng sẵn) có bình luận "đã được thay thế" |
| 2    | [#50](https://github.com/Hotankhoi/zombie-game/pull/50)     | Đồ trên đất tự dọn sau 5 phút + gộp đồ gần nhau (giao thức 11)                               | merged                                                                                                                                                                                  |
| 3    | [#51](https://github.com/Hotankhoi/zombie-game/pull/51)     | Zombie rơi đồ                                                                                | merged                                                                                                                                                                                  |
| 4    | [#52](https://github.com/Hotankhoi/zombie-game/pull/52)     | Thùng thưởng huyền thoại sau đợt tràn (giao thức 12)                                         | merged                                                                                                                                                                                  |
| 5a   | [#21](https://github.com/Hotankhoi/zombie-game/pull/21)     | Định dạng file save — A chốt (B chưa góp ý định dạng)                                        | merged                                                                                                                                                                                  |
| 5    | [#53](https://github.com/Hotankhoi/zombie-game/pull/53)     | Lưu game: IndexedDB, tiếp tục/xuất/nhập file                                                 | merged                                                                                                                                                                                  |
| —    | PR này                                                      | Báo cáo + AGENTS mục 8 + progress                                                            | —                                                                                                                                                                                       |

## 2. File đổi (⚠ = vùng của B, sửa tối thiểu; ◆ = vùng chung)

- **#50**: ◆ `shared/types/loot.ts` (`GroundItemWire.t`), ◆ `shared/types/index.ts` (v11), ◆ `shared/types/loot-protocol.md`;
  ⚠ `shared/loot/authority.ts` (`drop(…, tick)`, `spawnGround`, `sweepGround`), ⚠ `shared/loot/ground.ts` (`placeGround`,
  `sweepGround`, `snapGround`, kiểm `t`), ⚠ `shared/data/ground.ts` (mới); ⚠ test của B: `host/dropOnline.test.ts` (1 dòng),
  `net/ground.test.ts` (1 dòng); A: `net/lootCodec.ts`, `host/hostLoot.ts`, `host/hostServer.ts`, `host/worker*.ts`,
  `client/net/netGame.ts`, `client/main.ts` (`?dondat=`), `tools/loadTest.ts`, `tools/scenarios.loadtest.ts`, test mới.
- **#51**: ⚠ `shared/data/zombieDrops.ts` (mới); A: `shared/sim/zombieDrops.ts` (mới), `shared/sim/world.ts`,
  `host/hostServer.ts`, `?roido=` qua worker/NetGame/main, test mới.
- **#52**: ◆ `shared/types/loot.ts` (`RewardCrateWire`, `rewards`, intent `reward`), ◆ `index.ts` (v12); ⚠
  `shared/loot/authority.ts` (`addReward`, `takeReward`, `rewardCrates`, lưu/kiểm `rewards`), ⚠ `shared/data/reward.ts`
  (mới), ⚠ `client/loot/lootMessages.ts` (1 câu `no_reward`); A: `shared/loot/reward.ts` (mới), `net/lootCodec.ts`,
  `net/clientLoot.ts`, `host/hostLoot.ts`, `host/hostServer.ts`, `shared/sim/world.ts` (`safeSpot`, `?tran=`),
  `client/loot/reward*.ts` (mới), `client/loot/lootUi.css`, `client/scenes/WorldScene.ts`, test mới.
- **#21**: `docs/save-format.md`.
- **#53**: ⚠ `client/ui/lobbyPanel.ts` (tùy chọn `extra`, 2 dòng); A: `shared/save/save.ts` (mới), `client/save/*` (mới),
  `host/hostServer.ts`, `host/hostLoot.ts` (hook `claimed`), `host/worker*.ts`, `host/testMatch.ts`,
  `client/net/netGame.ts`, `client/main.ts`, `client/style.css`, `shared/sim/world.ts` (`setFlowDirty`), test mới.

## 3. Bảng tỉ lệ rơi đồ (`shared/data/zombieDrops.ts`)

| Loại                              | Ngày | Đêm  | Số món  | Bảng đồ (trọng số, số lượng)                                                                                               | Độ hiếm                              |
| --------------------------------- | ---- | ---- | ------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Zombie thường (mọi loại trừ Boss) | 4%   | 8%   | 1       | băng gạc 25, nước 25, đồ hộp 25, đạn lục 15 (3–8), phế liệu 10 (1–3)                                                       | Thường 80 · Tốt 20                   |
| Từ xác đồng đội (`turnedFrom`)    | 60%  | 80%  | 2       | như trên + đạn trường 10 (5–10), kháng sinh 8                                                                              | Thường 55 · Tốt 35 · Hiếm 10         |
| Boss                              | 100% | 100% | 1 + đạn | súng lục 15, súng trường 20, mũ 15, áo 20, quần 15, sơ cứu 15 + đạn lục/trường 10–20                                       | Hiếm 60 · Sử thi 30 · Huyền thoại 10 |
| Thùng thưởng đợt tràn (mỗi người) | —    | —    | 4       | 1 Huyền thoại (súng trường 25, súng lục 15, áo 25, mũ 20, quần 15) + 40 đạn hợp súng + 2 sơ cứu Sử thi + 2 kháng sinh Hiếm | —                                    |

Quay số tất định: `Rng` gieo từ (id zombie, tick chết); thùng thưởng từ (seed, số đợt, ownerId). Ban đêm = `dayClock(tick).night`.

## 4. Băng thông (`npm run loadtest`, 4 bot, KB/s mỗi người; đo lần cuối trên `a/save-game` = toàn bộ thay đổi)

| Kịch bản                               | Nhận TB · đỉnh 5s nhóm · đỉnh 5s 1 người | Loot TB · đỉnh 1 người · gửi |
| -------------------------------------- | ---------------------------------------- | ---------------------------- |
| Bình thường, mạng tốt                  | 11.82 · 15.85 · 16.09                    | 0.04 · 0.14 · 0.01           |
| Trễ 150ms + mất 5%                     | 10.04 · 15.41 · 15.78                    | 0.05 · 0.18 · 0.01           |
| Đợt tràn tối đa (500 + 4 Boss), bất tử | 18.51 · 20.99 · 21.42                    | 0.04 · 0.13 · 0.01           |
| Đợt tràn 1, bot tự chơi                | 6.21 · 16.06 · 16.55                     | 0.05 · 0.18 · 0.01           |
| Đợt tràn tối đa + bot bắn súng trường  | 18.87 · 21.11 · 21.59                    | 0.04 · 0.13 · 0.01           |
| Đợt tràn tối đa + mở rương liên tục    | 14.14 · 17.54 · 17.97                    | 0.13 · 0.31 · 0.03           |
| Bình thường ngày 2 (đối chứng)         | 11.82 · 15.85 · 16.09                    | 0.04 · 0.14 · 0.01           |
| **Bình thường + 128 đồ trên đất**      | 12.03 · 16.16 · 16.41                    | 0.25 · 0.46 · 0.05           |
| **Đợt tràn tối đa + 128 đồ trên đất**  | 18.72 · 21.35 · **21.78**                | 0.26 · 0.49 · 0.05           |

128 đống đồ (~1 đống hết hạn + 1 đống mới mỗi giây) thêm ~0.2 KB/s TB, ~0.4 KB/s đỉnh. Trước #50 mỗi phần đổi loot mang
cả danh sách đồ (~3.9 KB với 128 đống) → ước ~7.7 KB/s ở cùng kịch bản. Mọi kịch bản < 25 KB/s (mức trần AGENTS mục 2).
Zombie rơi đồ: bot giết ~90 con/90 s ở đợt tràn → ~7 đống, không đổi bảng. Thùng thưởng: vài gói ~60 B mỗi đợt.

## 5. Đã thử bằng mắt (Browser pane, `npm run dev`; ảnh ở `docs/anh-ground/`)

Cửa sổ Claude bị ẩn nên vòng lặp game được đẩy bằng `setInterval` trong trang, ảnh chụp thẳng từ canvas (không có phần HTML).

- `1-gop-2-lan-tha.jpg` — `?dondat=20`: thả 2 lần băng gạc cùng chỗ → 1 đống, nút "V · Nhặt Băng gạc ×2"; 20.6 s sau tự biến
  mất (`2-tu-don-sau-20s.jpg`).
- `3-zombie-roi-do.jpg` — đêm, `?roido=12`: chém zombie 11 s → 3 đống đồ ở chỗ zombie chết ("Phế liệu ×2"…).
- `4-thung-thuong.jpg`, `5-nhan-thuong.jpg` — `?ngay=15&gio=0.799&tran=3`: sống tới sáng → thắng đợt 1, thùng vàng ở 12 ô,
  HUD "Thùng thưởng đợt 1 · 12 ô →", "F: nhận thưởng" → +Mũ bảo hộ (Huyền thoại), +40 đạn, +2 sơ cứu (Sử thi), +2 kháng
  sinh (Hiếm); thùng biến mất. Lần thử trước với `?kit=1` (máu 45) bị cắn chết → đợt tràn thua, không có thùng — đúng luật.
- `6-tai-lai-con-the-gioi.jpg` — `?room=SAV101`: đi, thả 2 đồ → tự lưu sau 30 s (3,9 KB) → tải lại trang → vị trí, máu 45,
  túi, 2 đồ trên đất còn nguyên, "Đã nạp thế giới đã lưu…"; nhập file hỏng → "Không nhập được: Seed thế giới không khớp mã
  phòng."; xóa IndexedDB, nhập file đúng ở phòng khác → tự mở SAV101 và nạp; rời trang → có bản lưu mới (`pagehide`).
- Console: không lỗi game (chỉ lỗi kết nối relay Nostr `wss://cdn.satellite.earth` có từ trước, và 1 lỗi của bản trung gian
  lúc đang sửa code — Vite nạp nóng, code hiện tại không còn).

**Chưa thử**: 2–4 máy thật / TURN / 4G; nút "Xuất file save" (tải file về máy); lưu khi đổi host thật; thùng thưởng nhiều
người bằng mắt (đã có test 4 máy giả); zombie rơi đồ ở đợt tràn thật với Boss bằng mắt (test có); ảnh phần HTML (phòng chờ,
HUD thùng thưởng, thông báo) — kiểm bằng nội dung chữ.

## 6. `npm run check`

`main` sau #53: typecheck + lint + **412 test / 57 file** đạt; `npm run build` đạt. Mỗi PR #50–#53: CI `check` xanh trước merge.

## 7. Rủi ro

1. **Gói mới (v12) không nói chuyện với bản cũ**: ai đang mở tab cũ sẽ thấy "bản cũ, tải lại" (chặn khác phiên bản #23).
2. **Tự nạp khi mở lại đúng phòng**: phòng trống + máy có bản lưu của phòng đó → luôn nạp. Muốn thế giới mới phải "Tạo phòng
   mới". Bản lưu chỉ ở máy từng làm host — người khác mở phòng đó (khi host cũ vắng) sẽ bắt đầu thế giới mới; host cũ vào
   sau thì phòng đã có host → không nạp đè (báo lỗi).
3. **Người rời giữa trận rồi trận được lưu**: túi còn, nhưng nhân vật (vị trí/máu) không còn trong file → vào lại xuất phát
   như người mới (giữ túi). Chỉ người có trong file mà chưa vào lại mới được giữ nhân vật.
4. **Lưu khi đóng tab** là "cố gắng hết sức" (trình duyệt có thể giết worker trước khi ghi xong) — bản 30 s trước vẫn còn.
5. Đồ trên đất đầy 128 đống: đồ của zombie bị bỏ (không đẩy đồ người chơi thả); người chơi thả thêm đống mới bị từ chối như cũ
   (nhưng giờ gộp được vào đống cùng loại gần đó).
6. Tham số chỉ bản dev mới: `?dondat=`, `?roido=`, `?tran=` (bị tắt ở bản build).

## 8. Tin nhắn cho B

> Chào B, A đã merge #49 (thanh nhanh + thả/nhặt của bạn, kèm #48) và làm tiếp trên đó, `PROTOCOL_VERSION` giờ là **12**:
>
> - **#50** đồ trên đất tự dọn sau 5 phút + gộp đồ cùng loại/độ hiếm trong 0.5 ô. A sửa tối thiểu vùng của bạn:
>   `shared/loot/authority.ts` (`drop` nhận thêm `tick`, thêm `spawnGround`/`sweepGround`), `shared/loot/ground.ts`,
>   `shared/data/ground.ts` (mới), `GroundItemWire.t` trong `shared/types/loot.ts`; 2 test của bạn đổi 1 dòng mỗi file
>   (thả 2 lần cùng chỗ giờ ra 1 đống 20). Phần đổi 112 giờ chỉ mang đồ rơi đã đổi (`dropsSet`/`dropsRemoved`).
> - **#51** zombie rơi đồ — bảng ở `shared/data/zombieDrops.ts` (file mới trong vùng của bạn, bạn chỉnh số thoải mái).
> - **#52** thùng thưởng sau đợt tràn: `rewards` trong replica, intent `reward`, `shared/data/reward.ts` (mới),
>   `LootAuthority.addReward/takeReward`, 1 câu lỗi `no_reward` trong `client/loot/lootMessages.ts`.
> - **#21 đã chốt** định dạng save (bạn chưa góp ý nên A trả lời mặc định mục 7): công trình căn cứ của bạn sau này nên là
>   phần **`base`** riêng có `version` riêng trong file save. **#53** lưu game: A thêm 2 dòng vào `client/ui/lobbyPanel.ts`
>   (tùy chọn `extra` để gắn hàng nút "Tiếp tục / Xuất / Nhập file save").
>
> Nhờ bạn review các PR đã merge (#50–#53) theo mục 7 AGENTS; góp ý gì A sửa ở PR sau. Chi tiết: `docs/bao-cao-save-drops.md`.
