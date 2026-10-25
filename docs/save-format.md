# Đề xuất định dạng file save (bản nháp để B góp ý)

> Trạng thái: **đề xuất**, chưa có code. A chưa làm IndexedDB/xuất–nhập file cho tới khi A và B thống nhất tài liệu này (AGENTS.md mục 4, GĐ 5: "lưu IndexedDB + xuất/nhập save").
> Góp ý thẳng vào PR này. Mục "Câu hỏi cho B" ở cuối là chỗ cần B quyết.

## 1. Mục tiêu

- **Tải lại trang vẫn còn thế giới** (GĐ 5 "Xong khi": tải lại trang vẫn còn căn cứ): host tự lưu vào IndexedDB của máy host.
- **Xuất/nhập file** để mang thế giới sang máy khác (host mới), hoặc gửi cho nhau.
- Một file = **một thế giới** (một phòng/seed), gồm đủ 3 phần:
  1. trạng thái mô phỏng của A (`WorldState` — cùng các trường với bản sao lưu gói 125, nhưng ghi **đủ độ chính xác**, mục 3.1),
  2. trạng thái loot của B (`LootReplicaWire` — túi đồ + rương, `shared/types/loot.ts`),
  3. **các ô map đã đổi** so với map sinh từ seed (tường vỡ, cửa vỡ/mở; sau này: công trình B xây).
- Map gốc **không** nằm trong file: sinh lại từ seed + `MAP_VERSION` (AGENTS.md mục 2.6).

## 2. Vỏ file

JSON UTF-8 (dễ đọc, dễ sửa tay khi gỡ lỗi), đuôi `.zsave.json`. Có thể nén gzip (`CompressionStream`) khi lưu IndexedDB/xuất file. Ước lượng 650 zombie + 4 người + vài trăm rương ≈ 150–300 KB JSON, ≈ 30–60 KB gzip.

```jsonc
{
  "format": "zombie-coop-save",
  "saveVersion": 1, // phiên bản VỎ FILE này (mục 5)
  "protocolVersion": 3, // PROTOCOL_VERSION lúc lưu (shared/types) — chỉ để thông tin/gỡ lỗi
  "mapVersion": 1, // MAP_VERSION của B (shared/mapgen/world.ts) — khác thì KHÔNG tải (map đổi bố cục)
  "room": "ABC123",
  "seed": "…", // worldSeedForRoom(room) — kiểm tra lại khi tải
  "savedAt": "2026-10-25T09:30:00Z",
  "tick": 123456, // = world.tick (ngày/giờ suy ra từ tick)

  "players": {
    // mục 4: danh tính bền của người chơi
    "<playerKey>": { "name": "Người sống sót 12", "color": 4372281, "lastPeerId": "…" },
  },

  "world": { "version": 5, "state": {/* WorldState của A, mục 3.1 */} },
  "loot": { "version": 1, "state": {/* LootReplicaWire của B, mục 3.2 */} },
  "map": { "version": 1, "changes": [/* ô đã đổi, mục 3.3 */] },
}
```

Mỗi phần có **số phiên bản riêng** để A và B đổi phần của mình mà không phải đụng phần kia.

## 3. Ba phần nội dung

### 3.1 `world` — của A (`shared/sim/world.ts` `WorldState`)

`world.version` = `WORLD_BACKUP_VERSION` (`net/worldBackup.ts`, hiện **5**). Nội dung = `SimWorld.state()` ở dạng JSON, **không** dùng bố cục nhị phân của gói 125: gói 125 (phiên bản 5, PR #26) chia thành 10 mẩu gửi 1 mẩu/giây và ghi zombie gọn (~18 byte/con: id chênh lệch dạng varint, vị trí/đích i16 theo 1/32 ô, máu theo 0.1, đồng hồ 1/100 giây) để tiết kiệm băng thông — chỉ dùng cho chuyển host, chấp nhận sai số. File save thì ghi số thực đầy đủ.

Phiên bản 4 → 5 chỉ đổi **bố cục gói mạng**, `WorldState` không thêm/bớt trường → hàm nâng cấp `world` v4 → v5 của file save là không làm gì (chỉ đổi số).

| Trường                                                          | Ghi chú                                                                           |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `tick`, `rngState`, `nextZombieId`                              | RNG chạy tiếp đúng dãy số → mô phỏng tất định sau khi tải                         |
| `players[]`                                                     | `PlayerState`, **thay `id` (PeerId) bằng `playerKey`** khi ghi file (mục 4)       |
| `zombies[]`                                                     | đủ trạng thái (máu, chế độ, đồng hồ…), `target` đổi sang `playerKey` hoặc `null`  |
| `openDoors[]`, `brokenDoors[]`, `brokenWalls[]`, `wallDamage[]` | **chuyển sang `map.changes`** khi ghi file (mục 3.3) để map có một nguồn duy nhất |
| `pools[]`, `nextPoolId`, `noises[]`                             | vũng độc/axit; `noises` có thể bỏ (chỉ sống 1 tick)                               |
| `horde`                                                         | đợt tràn đang diễn ra + bảng thành tích (`kills`/`downs` theo `playerKey`)        |
| `corpses[]`                                                     | xác chờ thành zombie (`player` → `playerKey`)                                     |
| `flowTargets`, `flowDirty`                                      | có thể bỏ: tải xong đặt `flowDirty = true`                                        |

### 3.2 `loot` — của B (`shared/types/loot.ts` `LootReplicaWire`)

`loot.version` = `LootReplicaWire.version` (hiện **1**). Lấy nguyên `LootReplicaWire` mà authority loot của B đã xác nhận (revision mới nhất), **đổi khóa `inventories[].id` từ PeerId sang `playerKey`**. Kiểm tra khi tải theo đúng quy tắc trong `shared/types/loot-protocol.md` (item ID, giới hạn số, kích thước, ID trùng, seed, phiên bản).

### 3.3 `map` — ô đã đổi so với map sinh từ seed

```jsonc
"changes": [
  { "x": 27, "y": 10, "kind": "wallBroken" },             // khổng lồ húc vỡ (GameMsg.MapDelta, PR #20)
  { "x": 8,  "y": 11, "kind": "doorBroken" },             // cửa bị phá: mở mãi
  { "x": 24, "y": 10, "kind": "doorOpen" },               // cửa đang mở
  { "x": 30, "y": 5,  "kind": "wallDamaged", "hp": 42.5 } // tường đang bị húc dở
  // sau này (B, GĐ 5): { "x":…, "y":…, "kind": "built", "item": "barricade_wood", "hp": … }
]
```

Một danh sách, sắp xếp theo `(y, x, kind)` để file tất định (hai lần lưu cùng trạng thái → cùng file). Cùng ý tưởng với gói `MapDelta` (21) trên mạng: chỉ gửi/lưu ô đã đổi.

### 3.4 Quan hệ với gói sao lưu 125 (chuyển host) — chỗ cho loot của B

Gói 125 hiện chỉ mang `WorldState` của A (chưa có túi đồ/rương). Khi ghép loot online, B cần chuyển host cũng giữ được loot; **đề xuất đặt phần loot (túi đồ + rương, `LootReplicaWire`) vào phần chung ở mẩu 0** của gói 125:

- Mẩu 0 đã là chỗ của mọi trạng thái "chỉ có một bản" (cửa, vũng, tường vỡ, đợt tràn, xác); mẩu 1–9 chỉ chứa zombie `id % 10 === k` + danh sách người chơi.
- Phần loot chèn vào cuối phần chung của mẩu 0 dưới dạng khối có độ dài (`u32` + byte; B tự định bố cục, A chỉ cắt/ghép byte) và tăng `WORLD_BACKUP_VERSION` lên 6.
- Mẩu 0 sẽ to hơn các mẩu khác (rương + túi đồ có thể vài chục KB). Nếu mẩu 0 vượt ~5 KB thì tách thành mẩu riêng gửi thưa hơn (30s) — cần đo lại ngân sách. Ngưỡng chính thức là **25 KB/s mỗi người** (AGENTS.md mục 2); 20 KB/s chỉ là mức A tự đặt để chừa chỗ cho B. Ở đợt tràn tối đa, đỉnh 5s của 1 người hiện là 19.70 KB/s → B có ~5 KB/s tới ngưỡng 25 cho loot (nên giữ loot ≤ 3 KB/s để còn dư). B đo kích thước thật rồi báo A.
- File save (mục 2) không bị ràng buộc bởi mẩu: `loot` ở file là `LootReplicaWire` nguyên vẹn.

## 4. Danh tính bền của người chơi (`playerKey`) — cần thống nhất trước

PeerId do Trystero cấp **đổi mỗi lần mở trang**, nên không dùng được làm khóa để trả lại túi đồ/vị trí cho đúng người sau khi tải. Đề xuất:

- Mỗi trình duyệt tạo một `playerKey` ngẫu nhiên (UUID) lưu ở `localStorage`, gửi trong gói Hello (thêm trường → **tăng `PROTOCOL_VERSION` lên 4** trong một PR hợp đồng riêng, nhỏ, ở `shared/types`).
- Host giữ bảng `PeerId ↔ playerKey`; khi ghi file thì đổi mọi PeerId sang `playerKey`, khi tải thì đổi ngược cho người đang có mặt.
- Người có trong file nhưng chưa vào phòng: giữ nguyên dữ liệu (nhân vật không xuất hiện), tới khi họ vào bằng đúng `playerKey`.
- Người mới (không có trong file): vào như người mới.

## 5. Quy tắc phiên bản

- `saveVersion` đổi khi **vỏ file** đổi. Bộ đọc có hàm nâng cấp từng bước `v1 → v2 → …`; không đọc được thì báo lỗi rõ ràng, **không** tải nửa vời.
- `world.version` / `loot.version` / `map.version` do chủ từng phần tăng khi đổi nội dung phần đó, kèm hàm nâng cấp từ bản ngay trước (vd: `world` v3 → v4 thêm `brokenWalls = []`, `wallDamage = []`).
- `mapVersion` khác bản đang chạy → **không tải** (map sinh từ seed đã khác, tọa độ ô đã đổi vô nghĩa).
- `seed` khác `worldSeedForRoom(room)` → từ chối.

## 6. Lưu ở đâu, khi nào (A làm sau khi chốt)

- IndexedDB của **máy host**: database `zombie-coop`, store `saves`, khóa = `room`. Giữ 3 bản gần nhất (`room#0..2`) phòng khi bản mới hỏng.
- Tự lưu: mỗi 2 phút, khi hết đợt tràn, và khi host rời phòng (`pagehide`). Ghi **sau** khi B xác nhận revision loot (không lưu trạng thái loot chưa được xác nhận).
- Chuyển host: host mới lưu ngay sau khi dựng lại thế giới (bản sao lưu 10s + snapshot).
- Nút "Xuất save" / "Nhập save" ở menu (B, `client/ui`): nhập file chỉ được khi mình là host và phòng chưa bắt đầu trận (hoặc hỏi xác nhận ghi đè).

## 7. Câu hỏi cho B

1. `LootReplicaWire` có đủ để lưu chưa, hay cần thêm gì (đồ rơi trên đất, trang bị đang mặc, độ bền vũ khí)?
2. Công trình căn cứ (GĐ 5, phần B) lưu chung trong `map.changes` (`kind: "built"`) hay một phần `base` riêng có `version` riêng?
3. Đồng ý dùng `playerKey` + tăng `PROTOCOL_VERSION` lên 4 cho Hello? Ai làm PR hợp đồng đó (đề xuất: A, PR nhỏ ở `shared/types`)? (Từ PR #23, bản khác `PROTOCOL_VERSION` không vào chung trận; Hello đã có khối mã build nối cuối, thêm `playerKey` cũng nối cuối được.)
4. Khi tải save: người chơi ở trong file mà chưa vào thì giữ đồ trong túi của họ, hay thả vào một rương "đồ của người vắng mặt"?
5. Đồng ý JSON (+gzip tùy chọn) thay vì nhị phân?
6. Loot vào mẩu 0 của gói 125 như mục 3.4 — B định bố cục khối loot và đo kích thước thật được không?
