# Hợp đồng loot online (từ v3; hiện tại v8 — xem mục "Tương thích")

PR này chỉ khai báo hợp đồng và tăng `PROTOCOL_VERSION` lên 3 (A dùng v2 ở PR #6). Chưa có codec hay kết nối gameplay. Khi tích hợp các PR xếp chồng, giữ phiên bản 3; v1/v2 không được vào cùng phòng v3.

- Mã gói 110–113 dùng kênh reliable, không trùng 124–126 của A.
- Client gửi intent; host lấy danh tính từ Transport, kiểm tra người đã vào trận, `isUp`, khoảng cách, đường nhìn và revision. Không nhận yêu cầu tự cấp item/nâng balo.
- `term` định danh mỗi lần authority khởi động. Không chấp nhận gói của host cũ hoặc term cũ. `requestId` ghép phản hồi với yêu cầu; yêu cầu sửa trạng thái lặp phải không được áp dụng lại.
- Snapshot nguyên khối chứa cả túi và rương; decoder phải kiểm tra item ID, giới hạn số, kích thước, ID trùng, seed và phiên bản. TypeScript không thay thế kiểm tra dữ liệu mạng.
- `view` xem trạng thái rương trong tầm, không chuyển đồ. `open` mở rương; `take` và `takeAll` kiểm tra revision hai bên. `move`/`sort` chỉ sửa túi của người gửi.
- ACK chỉ được gửi sau khi đã nhận và xác thực nguyên snapshot. Bước ghép mạng phải sao chép giao dịch tới các peer tham gia trước khi báo thành công; khi peer mất kết nối, xác định lại nhóm xác nhận theo thành viên đã được host chấp nhận.
- Hợp đồng ACK chưa tự bảo đảm chuyển host an toàn. Triển khai phải khôi phục trạng thái được xác nhận, giải quyết snapshot khác revision giữa các peer và từ chối ghi khi chưa biết nguồn chân lý. Snapshot định kỳ 10 giây không thay thế bản ghi giao dịch mới.
- Kiểu state khớp cấu trúc module túi/rương nhưng đặt độc lập để PR hợp đồng có thể review trên main trước khi các PR tính năng merge.

## v5 (A, nối loot phần 2A)

- `PROTOCOL_VERSION` 4: host gửi gói 110–113 thật (codec `net/lootCodec.ts`). 5: thêm hành động `claim` + bản lưu 125 v6.
- `claim { key }`: máy khách gửi playerKey bí mật cho host hiện tại; túi đồ khóa theo `ownerId = "p" + sha256(key)[0..24]`
  (`net/playerKey.ts`). Chưa claim thì không thao tác được (`unknown_player`). Khóa đang được người khác trong phòng dùng →
  `key_in_use` (máy khách đổi khóa riêng cho tab đó).
- Replica 112 có thêm dạng **phần đổi** (chỉ túi/rương vừa đổi so với `baseRevision`); bên nhận ghép thành bản đầy đủ,
  kiểm tra nguyên bản rồi mới ACK. Máy khách cũng gửi 112 đầy đủ cho host MỚI (bản mình đang giữ) để host mới chọn bản mới
  nhất trước khi nhận ghi. `term = <epoch>.<ngẫu nhiên>`, epoch tăng mỗi lần đổi host.
- Kết quả 111 chỉ gửi khi mọi người trong trận đã ACK revision lúc tạo kết quả.

## Tương thích giữa các phiên bản (gộp từ PR #35 của B, sửa theo `main`)

`PROTOCOL_VERSION` hiện là **8** (`shared/types/index.ts`). Session chỉ cho người **cùng** `PROTOCOL_VERSION` vào chung
trận (PR #23: khác bản → "Bạn đang dùng bản cũ, bấm để tải lại").

| Bản | Ai / PR | Thay đổi                                                                                            |
| --- | ------- | --------------------------------------------------------------------------------------------------- |
| 3   | B, #15  | Khai báo hợp đồng loot 110–113 (chưa có codec, chưa nối gameplay).                                  |
| 4   | A, #30  | Host xử lý thật gói 110–113 (codec `net/lootCodec.ts`, authority trong `host/hostLoot.ts`).         |
| 5   | A, #32  | Hành động `claim` (playerKey → `ownerId`), host mới thu replica của mọi người trước khi nhận ghi.   |
| 6   | A, 3b   | Chỉ số sinh tồn trong snapshot (khối mở rộng) + bản lưu 125 bố cục 7.                               |
| 7   | A, 3b   | Host xử lý `use` (trừ đồ + hiệu ứng khi mọi người đã ACK), lỗi `not_usable`…, bản lưu 125 bố cục 8. |
| 8   | A, 3b   | Host xử lý `equip`/`reload`, sự kiện bắn (tia đạn), vũ khí trong snapshot, bản lưu 125 bố cục 9.    |

- Bản 5 yêu cầu xử lý đủ gói 110–113 và **thu hồi bản sao túi/rương trước khi host mới nhận ghi**; bản 3–4 thiếu phần này
  nên không được vào chung phòng bản 5.
- Gói sao lưu thế giới 125 có **phiên bản bố cục riêng** (`WORLD_BACKUP_VERSION` = 6, `net/worldBackup.ts`): bản 6 mang
  replica loot đầy đủ ở mẩu 0. Đổi bố cục 125 thì tăng số này, không nhất thiết tăng `PROTOCOL_VERSION`.
- Số gói dành riêng của A: 124 (phòng đầy), 125 (sao lưu), 126 (điểm host) — giữ nguyên, loot không dùng lại.
- PR #35 (B, đề xuất tăng lên 4) đã đóng: phần tăng bản đã làm ở #30; ghi chú tương thích của #35 gộp vào mục này.

## GĐ 3b — dùng đồ, nạp đạn, trang bị (A, hợp đồng PR `a/3b-contract`)

Thêm 3 hành động vào `LootAction` (mã 8, 9, 10 trong `net/lootCodec.ts`, thêm cuối danh mục):

| Hành động | Trường                               | Ý nghĩa                                                                                        |
| --------- | ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `use`     | `expectedRevision`, `slot`, `target` | Dùng 1 món ở ô `slot` (ăn/uống/y tế). `target` = PeerId đồng đội (băng gạc) hoặc `null` = mình |
| `reload`  | `expectedRevision`                   | Nạp đạn súng đang cầm: host lấy đạn đúng loại trong túi (mọi độ hiếm)                          |
| `equip`   | `itemId`, `rarity`                   | Cầm vũ khí / mặc giáp đang có trong túi (món vẫn ở trong túi, không đổi revision)              |

- **Một giao dịch**: host trừ đồ (revision R) và xếp hiệu ứng chờ; hiệu ứng chỉ áp lên nhân vật khi **mọi người trong trận
  đã ACK revision R** — cùng lúc gửi kết quả 111. Host rời trước đó → máy khách nhận `host_changed`; host mới chọn replica
  mới nhất (≥ R nếu đã có người nhận) → có thể mất hiệu ứng nhưng **không bao giờ** được hiệu ứng mà đồ vẫn còn (không nhân đôi).
- `equip` không sửa túi → áp ngay; host chỉ kiểm tra món có trong túi của người gửi.
- `ChestWire.version` nhận `1 | 2`: bảng sinh rương mới (giáp) tăng `LOOT_VERSION` lên 2 ở PR giáp.
- Ở PR hợp đồng host còn trả `invalid_command` cho 3 hành động này; các PR 3b sau mới xử lý (và tăng `PROTOCOL_VERSION`).
