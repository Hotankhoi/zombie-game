# Ghép loot vào trận online — B

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
