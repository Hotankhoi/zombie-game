# Định dạng file save

> Trạng thái: **ĐÃ CHỐT** (A, 2026-10-28). Đề xuất mở từ 2026-10-25 (PR #21); B chưa có góp ý về định dạng nên A chốt
> theo mục 7 để làm GĐ 5 "lưu IndexedDB + xuất/nhập save". B muốn đổi phần `loot` (của B) thì tăng `loot.version` +
> viết hàm nâng cấp (mục 5), không cần đổi phần khác. Code: `shared/save/` (định dạng, thuần), `client/save/` (IndexedDB,
> nút phòng chờ).

## 1. Mục tiêu

- **Tải lại trang vẫn còn thế giới** (GĐ 5 "Xong khi": tải lại trang vẫn còn căn cứ): host tự lưu vào IndexedDB của máy host.
- **Xuất/nhập file** để mang thế giới sang máy khác (host mới), hoặc gửi cho nhau.
- Một file = **một thế giới** (một phòng/seed), gồm đủ 3 phần:
  1. trạng thái mô phỏng của A (`WorldState`, ghi **đủ độ chính xác**, mục 3.1),
  2. trạng thái loot của B (`LootReplicaWire` — túi đồ, rương, đồ trên đất, thùng thưởng; `shared/types/loot.ts`),
  3. **các ô map đã đổi** so với map sinh từ seed (tường vỡ/đang bị húc, cửa vỡ/mở; sau này: công trình B xây).
- Map gốc **không** nằm trong file: sinh lại từ seed + `MAP_VERSION` (AGENTS.md mục 2.6).

## 2. Vỏ file

JSON UTF-8 (dễ đọc, dễ sửa tay khi gỡ lỗi), đuôi `.zsave.json`. Chưa nén (thế giới thường 50–300 KB; nén gzip để sau
nếu cần, sẽ tăng `saveVersion`).

```jsonc
{
  "format": "zombie-coop-save",
  "saveVersion": 1, // phiên bản VỎ FILE này (mục 5)
  "protocolVersion": 12, // PROTOCOL_VERSION lúc lưu — chỉ để thông tin/gỡ lỗi
  "mapVersion": 1, // MAP_VERSION của B (shared/mapgen/world.ts) — khác thì KHÔNG tải (map đổi bố cục)
  "room": "ABC123",
  "seed": "…", // worldSeedForRoom(room) — kiểm tra lại khi tải
  "savedAt": "2026-10-28T09:30:00.000Z",
  "tick": 123456, // = world.tick (ngày/giờ suy ra từ tick)
  "players": { "p0123…": { "name": "Người sống sót 12" } }, // theo ownerId (mục 4), tên chỉ để hiện
  "world": { "version": 1, "state": {/* WorldState, mục 3.1 */} },
  "loot": { "version": 1, "state": {/* LootReplicaWire, mục 3.2 */} },
  "map": { "version": 1, "changes": [/* ô đã đổi, mục 3.3 */] },
}
```

Mỗi phần có **số phiên bản riêng** để A và B đổi phần của mình mà không phải đụng phần kia.

## 3. Ba phần nội dung

### 3.1 `world` — của A (`shared/sim/world.ts` `WorldState`)

`world.version` = `WORLD_SAVE_VERSION` (`shared/save/save.ts`, hiện **1**) — độc lập với phiên bản gói sao lưu 125
(gói 125 ghi gọn có sai số để tiết kiệm băng thông; file save ghi số thực đầy đủ).

| Trường                                                          | Ghi chú                                                                                |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `tick`, `rngState`, `nextZombieId`                              | RNG chạy tiếp đúng dãy số → mô phỏng tất định sau khi tải                              |
| `players[]`                                                     | `PlayerState` (vị trí, máu, chỉ số, trang bị, đạn…), **`id` = ownerId** (mục 4)        |
| `zombies[]`                                                     | đủ trạng thái; `target`/`turnedFrom` = ownerId (người chưa nhận túi → `null`)          |
| `openDoors[]`, `brokenDoors[]`, `brokenWalls[]`, `wallDamage[]` | **chuyển sang `map.changes`** (mục 3.3) để map có một nguồn duy nhất                   |
| `pools[]`, `nextPoolId`, `noises[]`, `flowTargets`, `flowDirty` | giữ nguyên (để mã băm thế giới sau khi tải khớp bản trước khi lưu)                     |
| `horde`                                                         | đợt tràn đang diễn ra / vừa xong + bảng thành tích (`kills`/`downs` khóa theo ownerId) |
| `corpses[]`                                                     | xác chờ thành zombie (`player` = ownerId)                                              |

Khi một người vào lại phòng và nhận túi (`claim`) đúng ownerId, host trả nhân vật đã lưu cho kết nối đó và đổi mọi
tham chiếu ownerId → PeerId mới (zombie đang đuổi, xác, bảng thành tích).

### 3.2 `loot` — của B (`shared/types/loot.ts` `LootReplicaWire`)

`loot.version` = `LootReplicaWire.version` (hiện **1**). Lấy nguyên replica mà **mọi người trong trận đã ACK** (host
chỉ lưu khi `confirmedRevision === currentRevision`). Túi khóa theo ownerId (không bao giờ có playerKey). Gồm cả đồ trên
đất (`drops`, có tick rơi — tự dọn tiếp sau khi tải) và thùng thưởng (`rewards`). Kiểm tra khi tải bằng
`isValidReplica` (item ID, giới hạn số, kích thước, ID trùng, seed, phiên bản).

### 3.3 `map` — ô đã đổi so với map sinh từ seed

```jsonc
"changes": [
  { "x": 27, "y": 10, "kind": "wallBroken" },             // khổng lồ húc vỡ (GameMsg.MapDelta, PR #20)
  { "x": 8,  "y": 11, "kind": "doorBroken" },             // cửa bị phá: mở mãi
  { "x": 24, "y": 10, "kind": "doorOpen" },               // cửa đang mở
  { "x": 30, "y": 5,  "kind": "wallDamaged", "hp": 42.5 } // tường đang bị húc dở
  // sau này (B, GĐ 5): công trình căn cứ ở phần `base` riêng (mục 7.2)
]
```

Một danh sách, sắp xếp theo `(y, x, kind)` để file tất định (hai lần lưu cùng trạng thái → cùng file).

### 3.4 Quan hệ với gói sao lưu 125 (chuyển host)

Gói 125 (A) là bản sao lưu **trên mạng** cho chuyển host: 10 mẩu, zombie gọn, mẩu 0 mang gói loot 112 đầy đủ. File save
là bản **trên đĩa**: không chia mẩu, không sai số. Hai thứ dùng chung `WorldState`/`LootReplicaWire` nhưng bố cục riêng.

## 4. Danh tính bền của người chơi (`playerKey`) — đã chốt (A, 2026-10-25, PR #32)

- **`playerKey` là BÍ MẬT** (16 byte ngẫu nhiên, `localStorage` + `sessionStorage`), chỉ gửi cho **host hiện tại** bằng
  intent loot `claim { key, resume }`. Không đi trong Hello.
- **`ownerId = "p" + 24 ký tự hex đầu của sha256("zombie-coop/owner/" + playerKey)`** — công khai, là khóa túi đồ và
  khóa nhân vật trong file save. File save **không bao giờ chứa playerKey**.
- Người có túi nhưng đang vắng: túi + nhân vật giữ nguyên tới khi họ vào lại bằng đúng khóa.
- Đổi trình duyệt/máy = khóa khác = người mới (túi có dao). Giới hạn 4 túi mỗi thế giới tính cả người đã rời.

## 5. Quy tắc phiên bản

- `saveVersion` đổi khi **vỏ file** đổi. Bộ đọc nâng cấp từng bước; không đọc được thì báo lỗi rõ ràng, **không** tải nửa vời.
- `world.version` / `loot.version` / `map.version` do chủ từng phần tăng khi đổi nội dung phần đó, kèm hàm nâng cấp.
- `mapVersion` khác bản đang chạy → **không tải**. `seed` khác `worldSeedForRoom(room)` → từ chối.

## 6. Lưu ở đâu, khi nào

- IndexedDB của **máy host**: database `zombie-coop`, store `saves`, khóa `room#0..2` — giữ 3 bản gần nhất mỗi phòng
  (ghi đè bản cũ nhất), phòng khi bản mới hỏng.
- Tự lưu: **mỗi 30 s**, ngay khi đợt tràn kết thúc, và khi tab host bị ẩn/đóng (`visibilitychange`/`pagehide`, cố gắng
  hết sức). Chỉ lưu loot đã được mọi người xác nhận (chưa → thử lại tick sau).
- Đổi host: host mới tự lưu theo nhịp 30 s vào IndexedDB của máy mình.
- Phòng chờ (nút do A thêm vào bảng của B, `client/save/saveMenu.ts`):
  - **Tiếp tục thế giới đã lưu** (bản mới nhất, hiện phòng + ngày + giờ lưu): mở đúng phòng đó; máy mình lên host thì nạp
    bản lưu. Phòng đang có người chơi (đã có host) → không nạp, báo lỗi.
  - **Xuất file save**: mình là host → lưu ngay rồi tải file; không → tải bản mới nhất của phòng này trong IndexedDB.
  - **Nhập file save**: kiểm tra (định dạng, phiên bản, seed, map) → ghi vào IndexedDB → mở phòng của file như "Tiếp tục".

## 7. Câu hỏi cho B — A đã chốt (B muốn đổi thì mở PR, đổi phần của mình + tăng version)

1. `LootReplicaWire` đủ để lưu: túi, rương, đồ trên đất (có tick rơi), thùng thưởng. Trang bị đang cầm/mặc, đạn trong
   băng, tiến độ nạp/chữa nằm trong `PlayerState` (phần `world`). Độ bền giáp: `PlayerState.durHead/Body/Legs`.
2. Công trình căn cứ (GĐ 5, B): phần **`base`** riêng có `version` riêng (không trộn vào `map.changes`) — B định nội dung.
3. ~~playerKey/Hello~~ — xong (mục 4).
4. Người vắng mặt: **giữ đồ trong túi của họ** (không thả ra rương).
5. **JSON**, chưa gzip.
6. ~~Loot ở mẩu 0 gói 125~~ — xong (gói 125 v6+).
