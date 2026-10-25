# Ghép loot vào trận online

## Kế hoạch phần 2A — A nối tầng mạng + host (2026-10-25)

B giao phần nối loot cho A. Phần 2A chỉ làm logic + test (cloud session, không trình duyệt); **phần 2B** (session sau,
máy thật): vẽ rương, UI túi/rương trong trận, phím F/I/Esc, thử 2 tab. Không làm: súng/giáp/đói khát, thùng thưởng, đồ rơi.
Mỗi bước 1 PR từ `main`, CI xanh thì merge (merge commit).

1. **Codec 110–113** (`net/lootCodec.ts`, reliable). Nhị phân gọn: vật phẩm/độ hiếm/balo/khu = số thứ tự trong danh mục
   (`shared/data`) → giải mã lấy tên từ danh mục, không đọc chuỗi từ gói; số lượng 1..`maxStack`, số ô đúng sức chứa balo /
   6 ô rương, ≤ 4 túi, ≤ 4096 rương, không trùng ID, revision là số nguyên an toàn, gói thừa/thiếu byte → bỏ. ID rương ghi
   gọn (chunk + ô nhà). Replica có 2 dạng: **đầy đủ** (đúng `LootReplicaWire`) và **phần đổi** (chỉ túi/rương vừa đổi so với
   revision trước) — bên nhận ghép thành bản đầy đủ rồi mới kiểm tra và ACK.
2. **Host** (`host/hostLoot.ts`, gọi từ `HostServer`): giữ `LootAuthority`; người gửi = `from` của Transport; chỉ người đã vào
   trận; `isUp`, tầm với, đường nhìn (`hasLineOfSight` + `world.blocked`, cửa đóng chặn), revision (reducer của B);
   `requestId` lặp → gửi lại đúng kết quả cũ, không làm lại; giới hạn tần suất; `term` mới mỗi lần lên host. Người vào
   trận nhận replica đầy đủ; mỗi tick có thay đổi → mọi người nhận phần đổi; ACK theo từng người.
3. **ClientLoot** (`net/clientLoot.ts`, không UI): gửi intent (tự điền revision), nhận reply/replica, giữ túi của mình +
   rương đã biết + bản replica đầy đủ (để lên host). API ghi ở mục "API ClientLoot" bên dưới. `NetGame` chuyển gói.
4. **Đồng bộ + đổi host**: host chỉ trả `ok` sau khi **mọi người trong trận đã ACK** revision chứa giao dịch; host mới
   **thu bản replica của mọi người** (tối đa 3s) rồi chọn bản mới nhất (`term` có số thứ tự `epoch`) trước khi nhận ghi;
   yêu cầu đang chờ khi host rời → báo `host_changed`, trạng thái lấy theo replica của host mới (không mất/nhân đôi).
   Replica đầy đủ nằm ở **mẩu 0 gói 125** (bản lưu v6). **playerKey**: bí mật ngẫu nhiên lưu ở trình duyệt, gửi riêng cho
   host bằng intent `claim`; túi đồ khóa theo `ownerId = sha256(playerKey)` (công khai, không lộ khóa) → tải lại trang
   vẫn đúng túi. Đổi hợp đồng `shared/types` (thêm `claim`) + `PROTOCOL_VERSION`. Quyết định ghi ở `docs/save-format.md`.
   - Đã làm (PR bước 4): đúng như trên. Host mới chờ bản của mọi người trong phòng (kể cả chính nó) tối đa 3s; mỗi máy
     chưa có term của host hiện tại thì gửi bản mình giữ (hoặc bản rỗng) mỗi giây. `host/testMatch.ts` = trận thử nhiều
     `NetGame` thật trên LoopbackHub (host chạy trong tiến trình thay Worker).
5. **Test** LoopbackHub 2–4 client, trễ 150ms + mất 5%; bot loadtest thỉnh thoảng mở rương; đo băng thông (đợt tràn tối
   đa: đỉnh 5s 1 người ≤ 22 KB/s, loot ≤ 3 KB/s). Đã làm: đỉnh 20.84 KB/s, loot 0.13 KB/s (0.34 khi bot mở rương liên tục);
   bảng đầy đủ ở `docs/progress-A.md`.

### Điều kiện hoàn thành — trạng thái sau phần 2A (test chứng minh)

| Điều kiện (kế hoạch gốc của B)                                     | 2A                      | Test                                                                                              |
| ------------------------------------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------- |
| Hai người thấy cùng rương; cùng lấy 1 món → 1 thành công, bảo toàn | Đạt (logic)             | `host/lootMatch.test.ts` (4 người, 2 người cùng ô), `host/hostLoot.test.ts`                       |
| Túi đầy, lượng sai, yêu cầu lặp, revision cũ không mất/nhân đôi    | Đạt                     | `lootMatch` "túi đầy…", `hostLoot` "yêu cầu lặp…", `clientLoot` "lệnh của panel…"                 |
| Từ chối ngoài tầm, xuyên tường/cửa đóng, chết, sửa túi người khác  | Đạt                     | `hostLoot` "từ chối…" (map thêm cửa), `lootMatch` "ngoài tầm, đang gục", `hostLoot` "xem (view)…" |
| Người vào sau đúng túi + rương đã lấy; đổi chunk không hồi loot    | Đạt                     | `host/lootOnline.test.ts` "người vào sau…", "tải lại trang…"                                      |
| Host rời khi nhặt: không xác nhận kết quả host mới không khôi phục | Đạt                     | `lootOnline` "host rời giữa lúc nhặt" ×3, "host mới là người vừa vào"; `lootMatch` "host rời…"    |
| Test logic, typecheck, lint, build; 2–4 client trễ 150ms mất 5%    | Đạt phần logic          | `npm run check`, `npx vite build`, `lootMatch`                                                    |
| Bàn phím/chuột không xuyên xuống gameplay                          | **Chưa — phần 2B (UI)** | —                                                                                                 |
| Thử 2 tab / máy thật                                               | **Chưa — phần 2B**      | —                                                                                                 |

## API ClientLoot (cho phần 2B: UI/scene)

`NetGame.loot` (`net/clientLoot.ts`) — lớp dữ liệu, không có UI. Mọi máy (kể cả host) dùng như nhau; NetGame tự chuyển gói.

| API                                                          | Ý nghĩa                                                                                      |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `ready: boolean`                                             | đã có replica của host hiện tại + biết túi mình → mới cho thao tác                           |
| `inventory: InventoryState \| null`                          | túi của mình **đã xác nhận** (bản sao, sửa thoải mái)                                        |
| `chest(id): ChestState \| null`                              | rương đã biết; `null` = chưa ai đụng/chưa xem → gọi `view(id)` khi tới gần                   |
| `busy: boolean`                                              | đang chờ kết quả 1 thao tác sửa đồ (khóa nút)                                                |
| `claimError`                                                 | không nhận được túi: `inventory_limit` (thế giới đã đủ 4 túi), `invalid_key`…                |
| `changed.on(e => …)`                                         | `ready` / `reset` (đổi host) / `inventory` / `chest` (kèm `chestId`) — UI đọc lại trạng thái |
| `view(id)`, `open(id)`, `take(id, slot, qty)`, `takeAll(id)` | intent rương; revision tự điền từ trạng thái đã biết                                         |
| `move(from, to, qty)`, `sort()`, `refresh()`                 | túi của mình                                                                                 |
| `command(cmd)`                                               | nhận nguyên `LootCommand` / `InventoryCommand` của panel B (`client/ui/loot`, `inventory`)   |

Mọi intent trả `Promise<LootOutcome>` (không bao giờ reject): `{ ok: true, inventory, chest }` hoặc
`{ ok: false, error, inventory, chest }` — khi lỗi vẫn kèm trạng thái mới nhất để UI vẽ lại. Mã lỗi: của host
(`LOOT_ERRORS` trong `net/lootCodec.ts`: `out_of_reach`, `blocked`, `player_not_up`, `stale_revision`, `inventory_full`,
`rate_limited`, `inventory_limit`…) + của máy khách: `not_ready`, `busy`, `host_changed` (đổi host lúc chờ: KHÔNG biết thao
tác có xảy ra không — UI đọc lại `inventory`/`chest` sau sự kiện `ready`), `timeout` (15s). Panel của B cần thêm câu
tiếng Việt cho các mã này (`LOOT_MESSAGES` hiện chỉ có mã của reducer).

Danh tính: NetGame tự đọc playerKey từ localStorage/sessionStorage (`net/playerKey.ts`) và tự `claim` mỗi khi có host
mới — UI không cần làm gì. Tải lại trang → đúng túi cũ. Mở 2 tab cùng trình duyệt → tab sau tự đổi khóa riêng (túi riêng).

Gợi ý nối (2B): tới gần rương (≤ `LOOT_INTERACTION.reach`) → `view(id)` một lần để hiện gợi ý; F → `open(id)` rồi mở
panel với `{ chest, inventory }`, `onCommand: (c) => loot.command(c)` (đổi `LootOutcome` → `LootResult` của panel); rời
xa/gục → đóng panel (host cũng từ chối). Vị trí rương: `chestLocations(chunk)` (`shared/mapgen/chests.ts`).

---

## Kế hoạch gốc của B

## Tiến độ nhánh triển khai

Đã ghép nền PR #14 của A, #7 của B và API spawn mới từ #3 trong nhánh này. Đã thêm vị trí rương tất định (`shared/mapgen/chests.ts`) và bộ quản lý loot (`shared/loot/authority.ts`) kiểm tra người được host cho vào, còn đứng, khoảng cách, đường nhìn qua callback host, chống request cũ bằng revision. Snapshot chứa đồng thời túi và rương, kiểm tra dữ liệu khôi phục và không cho bên nhận sửa ngược trạng thái lưu trữ. Đã dùng `spawnPoint` trong adapter mô phỏng và chặn người gục mở/đóng cửa.

Các module mới hiện chưa được gọi từ luồng mạng/gameplay. Còn phải làm PR hợp đồng riêng, codec, nối worker/client/UI, sao chép giao dịch trước xác nhận và kiểm thử nhiều client. Chưa công bố loot online hoàn thành. Giới hạn 4 inventory hiện tính cả người từng tham gia trong snapshot; trước khi nối vào phòng thật cần chốt vòng đời rời phòng/tái tham gia/chết và quyền giữ đồ, tránh tự xóa đồ để nhường chỗ.

Người dùng đã chọn triển khai phương án 1: đi trên map, mở rương, nhặt vào túi trong trận online; hai người cùng nhặt không nhân đôi đồ. Kế hoạch này dựa trên PR #6 (online của A) và #7 (loot của B, phụ thuộc #5). Các PR nền chưa merge tại thời điểm kiểm tra. Nhánh triển khai: `b/loot-online`; không push thẳng main.

## Các điểm đã đối chiếu

- `HostServer.receive` ở PR #6 chỉ xử lý `GameMsg.Input`. Union sự kiện chiến đấu chưa có lệnh túi đồ/rương.
- `ClientSync.toWorldState` phục hồi từ snapshot gameplay, chưa có túi đồ/rương. Không thể dùng cơ chế hiện tại để bảo đảm giữ loot khi đổi host.
- `WorldScene` đã ghép map thật và gameplay online; cần bổ sung tương tác rương cùng cơ chế khóa input khi mở UI để bấm lấy đồ không đồng thời chém.
- Map có ID tòa nhà ổn định, loại khu vực, cửa và tọa độ ô. Có thể đặt một rương trên ô sàn trong mỗi nhà, suy ID từ ID tòa nhà.
- Reducer PR #7 đã kiểm tra cả revision rương và túi, chuyển nguyên khối; host còn phải kiểm tra người gửi, khoảng cách, còn sống và đường nhìn.

## Phân chia PR và vùng sửa dự kiến

1. PR hợp đồng nhỏ cho `shared/types`: mô tả intent mở/xem/lấy rương và chuyển/sắp xếp túi; request ID, phiên authority, kết quả thành công/thất bại và snapshot liên quan. Phải thống nhất với A trước khi sửa vùng chung, tuân thủ mục 7.8.
2. B làm vị trí rương tất định trong `shared/mapgen`, dữ liệu khoảng cách tương tác trong `shared/data`, logic quản lý loot trong `shared/loot`, hiển thị rương và UI trong module riêng. Kiểm tra vị trí sàn, tọa độ âm, biên chunk và ID ổn định.
3. Phối hợp A nối `HostServer`, worker, lớp kết nối client và scene thế giới. Các thay đổi trong vùng A giữ nhỏ, chủ yếu gọi module. Tất cả lệnh cấp đồ do host xử lý; client không gửi snapshot hoặc item tự chọn làm nguồn chân lý.
4. Bổ sung truyền trạng thái loot để người vào sau và host mới nhận cùng một trạng thái. Phải xác định thứ tự xác nhận giao dịch và sao chép trước khi khẳng định đổi host không mất/nhân đôi đồ. Không chỉ sao chép túi của người sắp lên host.

## Hành vi người chơi

- Rương xuất hiện ở vị trí cố định trong nhà, có dấu hiệu nhận biết và gợi ý tương tác khi tới gần.
- Dự kiến F mở rương, I mở túi, Esc đóng; giữ E mở cửa của A. Phím là đề xuất triển khai, cần đối chiếu với thay đổi input mới nhất của A.
- UI dùng snapshot host; khi chờ thì khóa gửi lặp, khi bị từ chối thì giữ đồ và hiển thị lý do.
- Mở UI ngăn nhân vật tự di chuyển/chém do thao tác trên panel; thế giới online vẫn tiếp tục chạy.
- Rời xa rương hoặc chết thì chặn nhặt. Quay lại chunk không sinh lại đồ đã lấy.
- Chuyển host làm ngừng gửi intent tới host cũ; kết quả cũ không được ghi đè trạng thái của phiên authority mới.

## Điều kiện hoàn thành

- Hai người thấy cùng rương; cùng lấy một món chỉ có một lần chuyển đồ thành công, tổng đồ được bảo toàn.
- Túi đầy, lượng sai, yêu cầu lặp hoặc revision cũ không làm mất/nhân đôi đồ.
- Host từ chối lấy ngoài tầm, xuyên tường/cửa đóng, khi chết hoặc sửa túi của người khác.
- Người vào sau nhận đúng túi của mình và trạng thái rương đã lấy; đổi chunk rồi quay lại không hồi loot.
- Kiểm tra host rời khi nhặt: không xác nhận một kết quả mà host mới không thể khôi phục; xác định rõ xử lý yêu cầu đang chờ.
- Chạy test logic, typecheck, lint, build; kiểm tra 2–4 client với trễ 150ms và mất gói 5%, thao tác bàn phím/chuột không xuyên xuống gameplay.
- PR mô tả phần sửa vùng A/chung, các kiểm tra đã thực hiện và giới hạn còn lại. A review trước khi merge.

## Phối hợp đã xác nhận

Người dùng đã chuyển phản hồi của A: PR #8–#13 nối tiếp #6, A để trống điểm ghép loot và shared/types cho B. Đã kiểm tra thêm có PR #14 relay nối sau #13; cần bảo đảm điểm ghép dùng interface Transport để tương thích cả hai đường truyền.

- Các gói riêng 124 (phòng đầy), 125 (sao lưu thế giới), 126 (điểm host) thuộc A, không tái sử dụng cho loot. PR hợp đồng của B tăng PROTOCOL_VERSION từ giá trị mới nhất của A.
- B bổ sung API `spawnPoint()` và `isRoadTile()` trên nhánh map; A không cần giả định đường ở ô 15–16. API mặc định trả tâm ô đường (16.5,16.5), đơn vị ô.
- Tương tác phải kiểm tra `isUp(p)` phía host, gồm cả cửa khi ghép phím E; người gục không được mở cửa hoặc nhặt đồ.
- Gói sao lưu 125 hiện chưa có túi/rương. Sao lưu định kỳ 10 giây không đủ để bảo đảm giao dịch vừa được xác nhận tồn tại sau khi host rời; cần đồng bộ trạng thái loot theo giao dịch và gắn phiên authority.
- Các điểm nối tương lai A đã cung cấp: `world.emitNoise` cho súng, `dayClock(tick).night` cho cân bằng loot, `horde.survived` cho thùng thưởng, `turnedFrom` cho đồ rơi. Chưa mở rộng phạm vi bước ghép rương cơ bản sang súng/thưởng/đồ rơi trước khi định nghĩa quyền sở hữu và vòng đời các vật phẩm đó.
- Các bảng tạm trong `shared/sim/tuning` và công việc IndexedDB, hành động hai người, delta snapshot cần phối hợp riêng với A; không tự di chuyển trong PR ghép loot.
