# Zombie Survival Co-op – Tài liệu dự án (dùng chung cho Claude Code và Codex)

Game 2D sinh tồn zombie thế giới mở, góc nhìn từ trên xuống, chơi trên trình duyệt, co-op online tối đa 4 người. **Toàn bộ hạ tầng phải miễn phí 100%, không cần thẻ tín dụng.**

Dự án do 2 người làm: **A** dùng Claude Code (Claude Desktop), **B** dùng Codex (ChatGPT). Mọi phiên làm việc: đọc file này trước, xem mục 7 (làm việc nhóm) và mục 8 (trạng thái), chỉ làm đúng việc được giao.

---

## 1. Công nghệ

| Phần               | Lựa chọn                                                                           |
| ------------------ | ---------------------------------------------------------------------------------- |
| Ngôn ngữ           | TypeScript (strict) cho toàn bộ dự án                                              |
| Build              | Vite                                                                               |
| Engine 2D          | Phaser 3 (WebGL)                                                                   |
| Mạng               | WebRTC DataChannel qua **Trystero** (P2P, host là một người chơi)                  |
| Relay khi NAT chặn | Metered Open Relay TURN (free 20 GB/tháng, không thẻ) + STUN `stun.cloudflare.com` |
| Lưu thế giới       | IndexedDB trên trình duyệt host + xuất/nhập file save                              |
| Âm thanh           | Howler.js                                                                          |
| Test               | Vitest                                                                             |
| Hosting web        | GitHub Pages, tự deploy mỗi lần merge vào `main` (GitHub Actions)                  |
| Dự phòng server    | Cloudflare Durable Objects (free plan) – chỉ làm nếu P2P không đủ                  |

Cấu trúc thư mục:

```
/client     – code chạy trên trình duyệt (render, input, UI)
/host       – mô phỏng thế giới, chạy trong Web Worker của máy host
/shared     – logic dùng chung: di chuyển, va chạm, vũ khí, sinh map từ seed
/shared/types – kiểu dữ liệu dùng chung (hợp đồng giữa các phần)
/shared/data  – bảng cân bằng: vũ khí, giáp, vật phẩm, zombie, tỉ lệ loot
/net        – lớp mạng "cắm rút được" (interface Transport; P2P trước, Durable Objects sau)
/assets     – sprite, âm thanh (CC0 ưu tiên). Ghi nguồn vào CREDITS.md
/tools      – bot giả lập người chơi, script đo tải
```

---

## 2. Kiến trúc mạng (bắt buộc tuân thủ)

1. **Host-authoritative P2P**: một người chơi làm host, chạy mô phỏng trong Web Worker. Tự chọn host theo ping + sức máy. **Host migration**: host gửi snapshot thế giới cho mọi peer mỗi ~10s; host rời thì peer tốt nhất lên thay.
2. **Mô phỏng dùng chung** (giống `BindToSimulation` của Roblox): logic di chuyển/va chạm nằm trong `/shared`, chạy giống hệt trên host và client. Tick cố định 20Hz, render 60fps.
3. **Client prediction + rollback/resimulation** cho nhân vật của chính mình. Sai lệch nhỏ thì làm mượt dần, không giật.
4. **Network ownership theo khoảng cách**: zombie đang tấn công người chơi nào thì máy người đó mô phỏng; host kiểm tra hợp lý. Chuyển quyền có độ trễ (hysteresis).
5. **Zombie tất định**: di chuyển theo flow field sinh từ seed; host chỉ gửi sự kiện (chết, đổi mục tiêu, sinh đợt) và chỉnh sửa nhỏ.
6. **Map từ seed**: không gửi map qua mạng, chỉ gửi thay đổi (rương đã mở, cửa phá, công trình xây).
7. **Interest management**: lưới ô, mỗi người chỉ nhận thực thể trong ~1.5 màn hình.
8. **Băng thông**: nhị phân (ArrayBuffer), lượng tử hóa (vị trí int16, góc 1 byte), delta so với ack gần nhất. Kênh unreliable/unordered cho vị trí; reliable cho sự kiện.
9. **Gửi dư input**: mỗi gói kèm 3 input gần nhất.
10. **Jitter buffer thích ứng** + bộ lọc làm mượt (Kalman) cho thực thể từ xa.
11. **Co-op tin client nhiều hơn**: hit của chính mình do client quyết, host sanity check. Loot/rương/cửa/căn cứ/ngày giờ do host quyết.
12. **Bảng debug mạng** trong game: giả lập trễ (0–300ms), jitter, mất gói (0–20%), hiện ping/băng thông/số thực thể.

Mục tiêu hiệu năng: 4 người + 500 zombie trong đợt tràn, ≤ 25 KB/s mỗi người, 60fps trên laptop phổ thông.

---

## 3. Thiết kế game

**Cốt lõi**: spawn với dao → loot dần lên súng/giáp theo độ hiếm → sống sót → mỗi 15 ngày có đợt tràn zombie khổng lồ.

- **Chỉ số**: Máu, Stamina (chạy), Đói, Khát, Nhiễm trùng. Đói/khát làm stamina hồi chậm. Bị cắn tăng nhiễm trùng → cần kháng sinh, không chữa thì máu tối đa giảm dần.
- **Hồi phục**: băng gạc (chậm), bộ sơ cứu (nhanh), adrenaline (máu + stamina). Băng cho đồng đội nhanh hơn tự băng.
- **Độ hiếm**: Thường (xám), Tốt (xanh lá), Hiếm (xanh dương), Sử thi (tím), Huyền thoại (vàng).
- **Cận chiến**: dao → gậy bóng chày → rìu → mã tấu → cưa máy. Có độ bền. Ám sát từ phía sau = hạ ngay, không ồn.
- **Súng**: súng lục → tiểu liên → shotgun → súng trường → bắn tỉa → súng máy. Đạn riêng từng loại. Phụ kiện: ống ngắm, băng đạn mở rộng, giảm thanh.
- **Giáp**: mũ, áo, quần + balo (thêm ô đồ). Giáp tốt giảm sát thương và tỉ lệ nhiễm trùng.
- **Ngày/đêm**: 1 ngày ≈ 10–12 phút. Đêm zombie mạnh hơn, loot hiếm nhiều hơn. Tầm nhìn hình nón, đèn pin (bật đèn thì zombie dễ thấy mình).
- **Tiếng ồn**: mọi hành động phát tiếng, zombie trong bán kính kéo tới. Súng ồn, dao êm.
- **Zombie**: thường, chạy nhanh, thét (gọi bầy), phình độc (nổ vũng độc), phun axit (mòn giáp), trốn (nấp trong tủ/xe), khổng lồ (phá tường). Boss ở đợt tràn.
- **Bản đồ**: sinh từ seed, theo chunk. Khu dân cư, siêu thị (đồ ăn), bệnh viện (thuốc), đồn cảnh sát (súng), căn cứ quân sự (huyền thoại, nguy hiểm nhất).
- **Đợt tràn mỗi 15 ngày**: thanh trên cùng "Ngày X · Đợt tràn còn Y ngày", trời đỏ dần từ ngày 13. Mỗi đợt mạnh hơn. Sống sót → thùng thưởng huyền thoại.
- **Căn cứ**: chọn tòa nhà, đóng ván cửa sổ, rào, bẫy chông, bẫy nổ, tháp súng tự động, chế tạo, rương chung, giường hồi sinh.
- **Sự kiện**: thả dù tiếp tế, thương nhân NPC, nhiệm vụ radio (cứu người sống sót về canh gác), thời tiết.

**Hợp tác & định vị**

- Mũi tên mép màn hình (tên, khoảng cách, màu riêng), viền xuyên tường, minimap có đồng đội, điểm hẹn trên bản đồ lớn, khung trạng thái đội.
- Ping, vòng câu nói nhanh ("Cần đạn", "Theo tôi", "Rút lui", "Cứu tôi", "Có đồ ngon").
- Gục thay vì chết, 30s để đồng đội cứu, kéo người gục đi. Chết → sau một lúc thành zombie mặc nguyên đồ của mình. Hồi sinh ở giường căn cứ (mất đồ trên người, giữ đồ trong rương).
- Hành động cần 2 người (két sắt, cửa cuốn, kho quân sự, nâng trèo tường). Kéo thả đồ lên tên đồng đội để đưa. Đánh dấu giữ đồ trong rương.
- Tinh thần đồng đội: đứng gần nhau hồi stamina nhanh hơn. Vai trò: Y tá, Thợ máy, Trinh sát, Lính.
- Súng pháo sáng, dụ zombie (ném chai, đồng hồ báo thức), ca gác đêm, nhiệm vụ giữ vị trí.
- Bảng thành tích đội sau mỗi đợt tràn.

---

## 4. Lộ trình và phân công

Mỗi việc: lên kế hoạch trước, chờ người dùng duyệt, làm, tự kiểm tra theo "Xong khi", mở Pull Request.

| #   | Giai đoạn                                                                                                                                       | Ai                                                                                                                            | Xong khi                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 0   | **Nền móng**: Vite + Phaser + TS, cấu trúc thư mục, `/shared/types`, interface Transport, ESLint/Prettier, Vitest, deploy GitHub Pages tự động  | A                                                                                                                             | `npm run dev` chạy; link GitHub Pages mở được; 2 máy khác nhau thấy nhau qua Trystero (ping/pong) |
| 1a  | **Lõi chơi**: di chuyển, camera, stamina, dao + ám sát, zombie thường, va chạm, cửa                                                             | A                                                                                                                             | Chém được zombie, 60fps                                                                           |
| 1b  | **Sinh map**: map từ seed theo chunk (đường, nhà, tòa nhà, các khu), minimap, gắn tile Kenney                                                   | B                                                                                                                             | Cùng seed → cùng map trên mọi máy (có test)                                                       |
| 2   | **Online & party**: toàn bộ mục 2, phòng mã mời tối đa 4, chọn host, host migration, mũi tên đồng đội, khung máu đội, gục/cứu, bảng debug mạng  | A                                                                                                                             | 4 tab mượt với trễ giả 150ms + 5% mất gói, 200 zombie; tắt tab host vẫn chơi tiếp                 |
| 3   | **Sinh tồn & loot**: túi đồ dạng ô, balo, độ hiếm, rương do host quyết, súng/đạn/phụ kiện, giáp, đói/khát/nhiễm trùng, đồ hồi phục, đưa đồ      | B (logic + UI + dữ liệu bắt đầu song song với GĐ 2, ghép mạng sau khi GĐ 2 xong)                                              | Từ dao lên được súng tím trong một buổi chơi                                                      |
| 4   | **Zombie, đêm, tiếng ồn**: ngày/đêm, tầm nhìn nón, đèn pin, tiếng ồn, giảm thanh, đủ loại zombie                                                | A                                                                                                                             | Ban đêm phải tính trước mỗi phát súng                                                             |
| 5   | **Căn cứ & đợt tràn**: xây/gia cố, bẫy, tháp súng, chế tạo, rương chung, giường, đếm ngày, horde director, Boss, lưu IndexedDB + xuất/nhập save | A (đợt tràn, lưu) + B (xây dựng, chế tạo)                                                                                     | Phòng thủ trọn một đợt tràn 500 zombie; tải lại trang vẫn còn căn cứ                              |
| 6   | **Hợp tác nâng cao & sự kiện**                                                                                                                  | B (ping, câu nói nhanh, sự kiện, thương nhân, radio, thời tiết) + A (hành động 2 người, kéo người gục, đồng đội thành zombie) | Mọi tính năng "Hợp tác & định vị" chạy online                                                     |
| 7   | **Hoàn thiện & phát hành**: âm thanh, hiệu ứng, menu, cài đặt phím, hướng dẫn (B); bot 4 người, đo tải, tối ưu, kiểm tra TURN trên 4G (A)       | A + B                                                                                                                         | Bạn bè mở link là vào chơi được, kể cả trên 4G                                                    |

---

## 5. Quy tắc code

- **Không dùng dịch vụ trả phí** hoặc dịch vụ bắt buộc thẻ tín dụng.
- Asset: ưu tiên CC0 (Kenney). Asset cần ghi công → thêm vào `CREDITS.md`. Thiếu asset thì vẽ tạm bằng code, đặt tên rõ để thay sau.
- Dữ liệu cân bằng để trong `/shared/data`, không rải trong code.
- Mọi tính năng mới phải chạy được ở chế độ online (4 người), không làm bản chỉ-offline. Trước khi GĐ 2 xong, viết logic sao cho dễ ghép mạng: trạng thái nằm trong `/shared`, UI chỉ đọc trạng thái.
- Viết test cho logic trong `/shared`. Chạy `npm test` + typecheck + lint trước khi mở PR.
- Tính năng có đồng bộ: kiểm tra bằng bảng debug mạng với trễ giả 150ms trước khi mở PR.
- Không commit file bí mật (`.env`, khóa, token).
- Giao tiếp với người dùng bằng **tiếng Việt**, ngắn gọn, dễ hiểu (người dùng không phải lập trình viên chuyên nghiệp).

---

## 6. Vùng sở hữu (tránh sửa đè nhau)

| Thư mục                                                                  | Chủ chính                                         |
| ------------------------------------------------------------------------ | ------------------------------------------------- |
| `/net`, `/host`, `/shared/sim` (mô phỏng, di chuyển, va chạm, zombie AI) | A                                                 |
| `/shared/mapgen`, `/shared/data`, `/client/ui` (túi đồ, menu, HUD)       | B                                                 |
| `/shared/types`, `package.json`, file cấu hình, `AGENTS.md`              | Chung – sửa phải ghi rõ trong PR và báo người kia |

Cần sửa file trong vùng của người kia: làm thay đổi nhỏ nhất có thể và ghi rõ lý do trong PR.

---

## 7. Làm việc nhóm (Git)

1. `main` luôn chạy được. Không push thẳng lên `main`.
2. Trước khi bắt đầu: `git checkout main && git pull`, rồi tạo nhánh mới: `a/<tên-việc>` (người A) hoặc `b/<tên-việc>` (người B). Ví dụ `b/map-generator`.
3. Ghi việc đang làm vào mục 8 ("Ai đang làm gì") ngay trong nhánh của mình.
4. Commit nhỏ, thường xuyên. Message: `<giai-đoạn>: <tóm tắt>`, ví dụ `1b: sinh đường phố theo seed`.
5. Xong việc: chạy test/typecheck/lint → push nhánh → mở Pull Request vào `main`, mô tả bằng tiếng Việt: làm gì, test thế nào, có sửa vùng chung không.
6. **AI của người kia review PR** trước khi merge (Claude Code `/code-review`, Codex review). Sửa theo góp ý rồi mới merge.
7. Mỗi lần merge vào `main`, GitHub Actions tự deploy lên GitHub Pages để cả hai cùng mở link chơi thử online.
8. Thay đổi `/shared/types` (hợp đồng giữa các phần): làm PR riêng, nhỏ, merge sớm để người kia dùng được.

---

## 8. Trạng thái

- Giai đoạn hiện tại: **0 – xong hẳn** (đã đạt cả 3 tiêu chí "Xong khi"). Đang làm 1a (A) và 1b (B).
- Repo: https://github.com/Hotankhoi/zombie-game · Game: https://hotankhoi.github.io/zombie-game/
  - Đã kiểm tra: 2 tab cùng `?room=` thấy nhau, có ping/pong; trễ 150ms ở cả 2 tab → ping ≈ 300ms.
  - Đã kiểm tra: **2 máy khác mạng** thấy nhau qua link GitHub Pages (ping ≈ 240ms, có TURN). `&relay=1` (chỉ đi qua TURN) cũng kết nối được.
  - Nhánh `main` được bảo vệ: phải qua Pull Request và CI `check` phải qua.
- Ai đang làm gì:
  - A: 1a xong, PR #4 đã sửa theo review, chờ merge. Đang làm GĐ 2 phần 1 (2a: ghép map thật của B + host-authoritative trong Web Worker, dự đoán phía client, chọn/chuyển host cơ bản) — nhánh `a/2a-online-core`, xếp chồng lên PR #4 và PR #3 (merge 2 PR đó trước). Tiếp theo: 2b (kênh unreliable thật, delta, zombie tất định, ownership), 2c (giới hạn 4 người, mũi tên/khung máu đội, gục/cứu).
  - B: đã triển khai 1b trên `b/map-generator`: sinh map theo seed/chunk, renderer riêng, minimap và tile Kenney CC0; PR #3 chờ A review.
- Ghi chú:
  - Map (B): API tại `shared/mapgen/world.ts`; `WorldMap.isSolid(tileX, tileY)` trả va chạm nền. `client/render/mapRenderer.ts`: gọi `preloadMapTiles(scene)` trong preload, rồi tạo `MapRenderer(scene)` và truyền các chunk; không điều khiển camera. Xem thử bằng `?map=1&room=MAP001`; A ghép renderer vào scene 1a.
  - Mạng: `net/transport.ts` là interface duy nhất game được dùng. `net/loopback.ts` = mạng giả cho test, `net/conditions.ts` = giả lập trễ/giật/mất gói (bảng F3 trong game).
  - Trystero hiện chỉ có kênh reliable; kênh unreliable thật (DataChannel unordered) làm ở GĐ 2.
  - **TURN** (relay khi router/4G chặn nối thẳng): Metered Open Relay, URL lấy từ biến `VITE_TURN_URL` (GitHub secret khi deploy; `.env.local` khi chạy máy mình — không commit). Cloudflare TURN bắt nhập thẻ nên không dùng. Thử relay: thêm `&relay=1` vào link (ép đi qua TURN).
  - **Giới hạn TURN**: đang dùng gói Metered **500 MB/tháng** (gói 20 GB đòi thẻ). Đủ cho phòng chờ/test, nhưng khi chơi thật (~25 KB/s/người) chỉ đủ vài giờ relay mỗi tháng → GĐ 2/7 (A) cần relay dự phòng không thẻ (Cloudflare Workers/Durable Objects free) hoặc TURN miễn phí khác.
  - Asset bản đồ (B): Kenney Roguelike Modern City 2.0 đã có trong `assets/kenney/roguelike-modern-city/`, kèm giấy phép CC0 và nguồn trong `CREDITS.md`.
  - GitHub Pages miễn phí yêu cầu repo **public**.
  - Trễ ở bảng F3 chỉ cộng vào gói **gửi đi** của tab đó: đặt 150ms ở 1 tab → ping +150ms; ở cả 2 tab → +300ms.
  - Tab bị ẩn thì trình duyệt dừng vòng lặp game nên tab đó hiện "đang đo…" — bình thường, không phải lỗi mạng.
