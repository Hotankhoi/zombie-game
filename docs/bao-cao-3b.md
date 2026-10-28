# BÁO CÁO CHO REVIEWER — sửa 2 lỗi loot + GĐ 3b (A, 2026-10-26)

Người làm: A (Claude Code). B đồng ý để A làm phần dùng đồ và thêm dữ liệu vào `shared/data` (vùng B). Mỗi việc 1 nhánh
`a/<việc>` từ `main`, 1 PR, CI `check` xanh rồi merge commit. Kế hoạch đã được duyệt trước khi làm.

## 1. Các PR

| PR                                                      | Nhánh            | Việc                                                              | Test sau PR |
| ------------------------------------------------------- | ---------------- | ----------------------------------------------------------------- | ----------- |
| [#40](https://github.com/Hotankhoi/zombie-game/pull/40) | `a/loot-key-fix` | (a) 2 tab cùng trình duyệt cướp túi nhau                          | 334         |
| [#41](https://github.com/Hotankhoi/zombie-game/pull/41) | `a/host-wait`    | (b) tab vừa tải lại tự làm host ~0,5 s                            | 342         |
| [#42](https://github.com/Hotankhoi/zombie-game/pull/42) | `a/3b-contract`  | hợp đồng `shared/types/loot.ts`: `use` / `reload` / `equip`       | 342         |
| [#43](https://github.com/Hotankhoi/zombie-game/pull/43) | `a/3b-survival`  | (c) đói, khát, nhiễm trùng, máu tối đa + HUD 3 thanh              | 350         |
| [#44](https://github.com/Hotankhoi/zombie-game/pull/44) | `a/3b-use-items` | (d) dùng đồ: phím 1–4, nút "Dùng", sơ cứu đứng yên, băng đồng đội | 367         |
| [#45](https://github.com/Hotankhoi/zombie-game/pull/45) | `a/3b-weapons`   | (e) gậy, súng lục, súng trường, X đổi vũ khí, Q nạp đạn, tia đạn  | 378         |
| [#46](https://github.com/Hotankhoi/zombie-game/pull/46) | `a/3b-armor`     | (f) mũ, áo, quần + bảng loot theo khu, axit mòn giáp              | 385         |
| PR này                                                  | `a/3b-report`    | (g) đo tải có bot bắn súng, tài liệu, ảnh, báo cáo                | 385         |

(g) "trạng thái mới đi trong snapshot/sao lưu": làm trong từng PR #43–#46 (khối mở rộng snapshot + bản lưu 125 bố cục
7 → 10 + `ClientSync.toWorldState`), có test người vào sau / đổi host cho từng phần.

## 2. File đã đổi (★ = vùng B, ◆ = vùng chung)

- #40: `net/playerKey.ts`, `net/clientLoot.ts`, `host/hostLoot.ts`, `host/hostServer.ts`, `host/worker.ts`,
  `host/workerProtocol.ts`, `host/testMatch.ts`, `client/net/netGame.ts`, `client/loot/lootUi.ts`, `client/loot/lootMessages.ts`,
  `client/scenes/HudScene.ts` + test + docs.
- #41: `net/hostElection.ts`, `client/net/netGame.ts`, `client/scenes/HudScene.ts`, `host/testMatch.ts` + test + docs.
- #42: ◆ `shared/types/loot.ts`, ◆ `shared/types/loot-protocol.md`, `net/lootCodec.ts`, `host/hostLoot.ts` + test.
- #43: ★ `shared/data/survival.ts` (mới), `shared/sim/survival.ts` (mới), `shared/sim/player.ts`, `shared/sim/world.ts`,
  `net/gameCodec.ts`, `net/clientSync.ts`, `net/worldBackup.ts`, `host/hostServer.ts`, `client/scenes/HudScene.ts`,
  ◆ `shared/types/index.ts` (PROTOCOL_VERSION), ◆ `loot-protocol.md` + test.
- #44: ★ `shared/data/consumables.ts` (mới), ★ `shared/inventory/inventory.ts` (thêm `removeFromSlot`,
  `removeItemUpTo`, `countItem`), ★ `shared/inventory/consume.test.ts` (mới), ★ `shared/loot/authority.ts` (thêm
  `update`), ★ `client/ui/inventory/inventoryPanel.ts` (option `actionLabel`/`onAction`), `shared/sim/items.ts` (mới),
  `client/loot/quickUse.ts`, `client/loot/itemUse.ts` (mới), `host/hostLoot.ts`, `host/hostServer.ts`, `net/*`,
  `client/main.ts`, `client/scenes/*`, ◆ PROTOCOL_VERSION + test.
- #45: ★ `shared/data/guns.ts` (mới), ★ `shared/data/melee.ts` (thêm `BAT`, `FISTS`), `shared/sim/guns.ts` (mới),
  `shared/sim/input.ts` (`view?`), `shared/sim/prediction.ts`, `shared/sim/player.ts`, `shared/sim/world.ts`,
  `client/loot/weaponControl.ts` (mới), `host/*`, `net/*`, `client/*`, ◆ PROTOCOL_VERSION + test.
- #46: ★ `shared/data/items.ts` (3 món giáp cuối danh mục, loại `armor`), ★ `shared/data/armor.ts` (mới),
  ★ `shared/data/loot.ts`, ★ `shared/loot/chest.ts` (`LOOT_VERSION` 2), ★ `shared/loot/chest.test.ts` (cập nhật ảnh
  rương mẫu), ★ `client/ui/inventory/inventoryPanel.ts` + ★ `client/ui/loot/lootPanel.ts` (biểu tượng `armor`),
  `shared/sim/armor.ts` (mới), `net/lootCodec.ts` (sửa `version: 1` cứng), `host/*`, `net/*`, `client/*`, ◆ PROTOCOL_VERSION.
- PR này: `tools/loadTest.ts`, `tools/scenarios.loadtest.ts`, ★ `shared/data/README.md`, ◆ `AGENTS.md` mục 8,
  `docs/progress-A.md`, `docs/bao-cao-3b.md`, `docs/anh-3b/*.jpg`.

## 3. Phím mới

| Phím                     | Việc                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| 1                        | Băng gạc: ưu tiên đồng đội đang gục trong tầm 1,5 ô → mình (nếu bị thương) → đồng đội bị thương |
| 2                        | Bộ sơ cứu: đứng yên 3 s (thanh tiến độ dưới nhân vật; đi/đánh là hủy)                           |
| 3                        | Kháng sinh                                                                                      |
| 4                        | Ăn/uống (cái nào đang thấp hơn: nước sạch hoặc đồ hộp)                                          |
| X / lăn chuột            | Đổi vũ khí (xoay vòng vũ khí có trong túi: dao → gậy → súng lục → súng trường)                  |
| Q                        | Nạp đạn (R đang là cứu người nên chọn Q)                                                        |
| Chuột trái               | Chém / bắn (súng lục: mỗi lần bấm 1 phát; súng trường: giữ chuột) — hết đạn thì tự nạp          |
| Panel túi (I) → chọn món | Nút "Dùng" (đồ ăn/uống/y tế), "Cầm" (vũ khí), "Mặc" (giáp)                                      |

Chỉ bản dev (`npm run dev`, không có trên GitHub Pages): `?kit=1` (túi mới có đồ y tế/ăn uống, vào trận đói/khát/45
máu/nhiễm 40), `?den=police` (vào trận cạnh rương đồn cảnh sát gần nhất; phòng `GUN000`/`ARM009` có súng + đạn (+ giáp)).

## 4. Số cân bằng chính (`shared/data`)

- **Sinh tồn**: no hết sau 25 phút, nước 18 phút (chạy ×1.5); < 25 → stamina hồi ×0.5 mỗi thứ; = 0 → −0.5 máu/s mỗi thứ.
  Cắn: nhiễm +8 × hệ số cắn của loại zombie (× giáp); > 0 tự tăng 0.05/s; ≥ 50 → máu tối đa −1/6 s (sàn 40); = 0 →
  +0.1/s. Hồi sinh: nhiễm 0, máu tối đa 100, no/nước ≥ 60.
- **Đồ dùng**: băng gạc +20 máu dần (tự 8 s / đồng đội 3 s), đồng đội gục → đứng dậy 30 máu; sơ cứu đứng yên 3 s → +60;
  kháng sinh −60 nhiễm; nước +45; đồ hộp +40; độ hiếm × 1 · 1.15 · 1.3 · 1.5 · 1.75.
- **Súng lục**: 30 sát thương, 14 ô, 4 phát/s bán tự động, băng 12, nạp 1.2 s, tản 3°, giật 4°/phát (tối đa 12°, hồi
  10°/s), ồn 18 ô. **Súng trường**: 55, xuyên 1, 22 ô, 3 phát/s tự động, băng 20, nạp 2 s, tản 1.5°, giật 6° (tối đa
  15°, hồi 10°/s), ồn 28 ô. **Gậy**: 55, 1.4 ô, quạt 110°, 0.75 s, 14 stamina, không ám sát. Độ hiếm × sát thương
  1 · 1.1 · 1.2 · 1.35 · 1.5.
- **Giáp**: mũ 8% · áo 15% · quần 7% giảm sát thương × 1 · 1.25 · 1.5 · 1.8 · 2.1 (trần 70%, bộ huyền thoại 63%);
  nhiễm khi cắn × (1 − 0.8 × mức giảm); bền 100, mòn theo sát thương đỡ, axit ×3, vỡ → mất món. Trọng số loot giáp:
  dân cư 8/108, siêu thị 4/104, đồn cảnh sát 34/134, quân sự 48/148, bệnh viện 0.

## 5. Cách làm quan trọng

- **Dùng đồ / nạp đạn = 1 giao dịch ở host**: trừ đồ (revision R) → hiệu ứng chỉ áp khi **mọi người đã ACK R** (cùng lúc
  gửi kết quả 111). Host mới luôn chọn replica mới nhất ≥ R → **không bao giờ nhân đôi** (có test host rời ở 2 thời điểm).
  Host rời trước khi xác nhận → `host_changed`, có thể mất hiệu ứng (món đã trừ).
- **Bắn trúng do mô phỏng ở host quyết** (tất định), không dùng "hit do client" (AGENTS 2.11). Bù trễ: mỗi input mang tick
  máy khách đang vẽ zombie; host lùi vị trí zombie về đó (≤ 10 tick = 500 ms). Tản tất định theo (id người, số phát) nên
  máy khách vẽ tia đúng hướng ngay khi bấm.
- Mọi chỉ số mới tính theo input trong `stepPlayer` → dự đoán phía máy khách khớp host (có test so từng trường).

## 6. Băng thông (`npx vitest run --config tools/vitest.config.ts tools/scenarios.loadtest.ts --silent=false`)

KB/s nhận mỗi người, TB · đỉnh 5 s cả nhóm · **đỉnh 5 s 1 người** (4 bot):

| Kịch bản                                             | `main` trước (#37)        | #43                       | #44                       | #45                       | #46 (cuối)                |
| ---------------------------------------------------- | ------------------------- | ------------------------- | ------------------------- | ------------------------- | ------------------------- |
| Bình thường, mạng tốt                                | 10.90 · 14.92 · 15.16     | 11.14 · 15.17 · 15.41     | 11.31 · 15.33 · 15.58     | 11.58 · 15.61 · 15.85     | 11.82 · 15.84 · 16.08     |
| Trễ 150ms + mất 5%                                   | 9.15 · 14.50 · 14.87      | 9.39 · 14.74 · 15.12      | 9.54 · 14.90 · 15.28      | 9.81 · 15.17 · 15.55      | 10.04 · 15.41 · 15.78     |
| **Đợt tràn tối đa (500 + 4 Boss)**                   | 17.86 · 20.41 · **20.84** | 17.85 · 20.30 · **20.73** | 18.01 · 20.46 · **20.89** | 18.27 · 20.73 · **21.16** | 18.50 · 20.96 · **21.40** |
| Đợt tràn 1, bot tự chơi                              | 5.33 · 15.17 · 15.65      | 5.57 · 15.41 · 15.89      | 5.72 · 15.57 · 16.05      | 5.99 · 15.83 · 16.32      | 6.21 · 16.06 · 16.55      |
| Đợt tràn tối đa + bot bắn súng trường liên tục (mới) | —                         | —                         | —                         | —                         | 18.20 · 19.70 · **20.32** |
| Đợt tràn tối đa + mở rương liên tục                  | 14.44 · 16.69 · 16.99     | 14.68 · 16.94 · 17.24     | 14.84 · 17.10 · 17.41     | 15.10 · 17.37 · 17.68     | 14.13 · 17.53 · 17.95     |

Đỉnh 1 người đợt tràn tối đa **21.40 KB/s ≤ 22** (mục tiêu). Gửi lên 0.43 → 0.75 KB/s (tick đang xem trong input).
Loot vẫn 0.13 KB/s đỉnh (0.29 khi mở rương liên tục). Kịch bản bắn súng: bot giết 603 zombie trong 90 s nên bầy mỏng
hơn → đỉnh thấp hơn kịch bản không bắn.

## 7. Đã thử bằng mắt (Browser pane, `npm run dev`)

Cửa sổ Claude bị ẩn suốt phiên → `requestAnimationFrame` dừng; tôi đẩy vòng lặp bằng `setInterval(game.loop.step)`,
nhấn phím bằng sự kiện bàn phím, nhắm/bắn bằng sự kiện chuột trên canvas (đi đúng đường input của game), ảnh chụp thẳng
từ canvas (`renderer.snapshot`) — nên **chưa phải chơi tay thật**.

- HUD 3 thanh no/nước/nhiễm + thanh dùng nhanh: `docs/anh-3b/1-hud-3-thanh.jpg`.
- `?kit=1`: phím 4 nước 20 → 64.6, lần 2 đồ hộp no 30 → 69.7; phím 3 nhiễm 40 → 0; phím 2 đứng yên 3 s → máu 45 → 100.
- `?room=GUN000&den=police`: F mở rương đồn cảnh sát (`docs/anh-3b/2-ruong-don-canh-sat.jpg`), lấy hết (súng lục + 18
  đạn), X → gậy → súng lục, Q → 12/12 (túi 18 → 6), bắn: zombie −30 máu/phát, giết 2 con, hết đạn tự nạp.
- `?room=ARM009&den=police&kit=1`: lấy 2 súng lục + đạn + áo + quần, mặc áo + quần, cầm súng, nạp
  (`3-mac-giap-cam-sung.jpg`: "Áo Thường 100% · Quần Tốt 100%", "Súng lục 12/12 · túi 35"), bắn chết zombie phình 160 máu
  (`4-ban-zombie.jpg`: tia đạn, chớp nòng, zombie nháy trắng), bị cắn → nhiễm trùng tăng, giáp mòn 87%/93%, hết đạn báo
  "HẾT ĐẠN (Q nạp)" (`5-bi-can-het-dan.jpg`).

**Chưa thử bằng mắt**: 2 máy thật / 4G; 2–4 tab cùng lúc trong trình duyệt cho lỗi (a)/(b) (chỉ có test tự động
`host/lootOnline.test.ts`); súng trường, băng gạc cho đồng đội, giáp vỡ, axit mòn giáp trên trình duyệt (chỉ test tự
động); chơi tay bằng chuột/bàn phím thật.

## 8. Kết quả `npm run check`

Typecheck đạt, lint đạt, **385 test đạt** (47 file). `npx vite build` đạt. CI `check` xanh ở cả 7 PR.

## 9. Rủi ro / giới hạn

1. Đổi host đúng lúc đang dùng đồ/nạp đạn: món có thể mất mà không có hiệu ứng (không bao giờ nhân đôi).
2. Đỉnh băng thông đợt tràn tối đa 21.40 KB/s — còn ~0.6 KB/s tới ngưỡng 22; thêm trường vào snapshot nữa thì cần 2b' (delta).
3. Bù trễ tin tick máy khách gửi (kẹp ≤ 10 tick) — co-op nên chấp nhận.
4. `LOOT_VERSION` 2: mọi rương chưa mở sinh lại theo bảng mới (chưa có file save nên không ảnh hưởng thế giới đã lưu).
5. Tab **mới** (không phải tải lại) vào phòng khi WebRTC chưa nối được ai vẫn có thể tự làm host tạm (lỗi (b) chỉ chặn tab
   tải lại + trường hợp người đã nối báo có host).
6. Tab ẩn > 5 phút: Chrome có thể giảm hẹn giờ còn 1 lần/phút → host có thể coi là im ≥ 10 s và cho tab khác cùng khóa lấy
   túi; khi đó tab cũ được báo rõ, không giành lại.
7. Sửa nhiều file vùng B (mục 2, ★) — đều thêm mới, không đổi hàm cũ; B nên xem lại số cân bằng.
8. Vết chém của đồng đội vẫn vẽ theo tầm dao (gậy chỉ đúng cho chính mình); hình súng/giáp là hình tạm bằng code.

## 10. Tin nhắn cho B

> Chào B, A đã làm xong GĐ 3b (dùng đồ, vũ khí, giáp) theo đồng ý của B, PR #40–#46 đã merge (CI xanh). A có thêm/sửa
> trong vùng của B, đều chỉ thêm mới: `shared/data/survival.ts`, `consumables.ts`, `guns.ts`, `armor.ts` (mới),
> `melee.ts` (BAT, FISTS), `items.ts` (helmet/vest/pants ở cuối danh mục, loại `armor`), `loot.ts` (giáp theo khu,
> `LOOT_VERSION` 2 → test ảnh rương trong `chest.test.ts` đã cập nhật), `shared/inventory/inventory.ts` (`removeFromSlot`,
> `removeItemUpTo`, `countItem`), `shared/loot/authority.ts` (`update`), panel túi (`actionLabel`/`onAction` cho nút
> Dùng/Cầm/Mặc) và biểu tượng `armor`. Nhờ B: (1) xem lại số cân bằng trong `shared/data` (bảng ở `shared/data/README.md`),
> (2) thay biểu tượng/hình tạm của súng, giáp, (3) review PR này. Giao thức hiện là `PROTOCOL_VERSION` 9 (bảng trong
> `shared/types/loot-protocol.md`). Chưa làm: chế tạo, căn cứ, thùng thưởng, đồ rơi từ zombie — để B/A bàn tiếp.
