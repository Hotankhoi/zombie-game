# Hợp đồng loot online v3

PR này chỉ khai báo hợp đồng và tăng `PROTOCOL_VERSION` lên 3 (A dùng v2 ở PR #6). Chưa có codec hay kết nối gameplay. Khi tích hợp các PR xếp chồng, giữ phiên bản 3; v1/v2 không được vào cùng phòng v3.

- Mã gói 110–113 dùng kênh reliable, không trùng 124–126 của A.
- Client gửi intent; host lấy danh tính từ Transport, kiểm tra người đã vào trận, `isUp`, khoảng cách, đường nhìn và revision. Không nhận yêu cầu tự cấp item/nâng balo.
- `term` định danh mỗi lần authority khởi động. Không chấp nhận gói của host cũ hoặc term cũ. `requestId` ghép phản hồi với yêu cầu; yêu cầu sửa trạng thái lặp phải không được áp dụng lại.
- Snapshot nguyên khối chứa cả túi và rương; decoder phải kiểm tra item ID, giới hạn số, kích thước, ID trùng, seed và phiên bản. TypeScript không thay thế kiểm tra dữ liệu mạng.
- `view` xem trạng thái rương trong tầm, không chuyển đồ. `open` mở rương; `take` và `takeAll` kiểm tra revision hai bên. `move`/`sort` chỉ sửa túi của người gửi.
- ACK chỉ được gửi sau khi đã nhận và xác thực nguyên snapshot. Bước ghép mạng phải sao chép giao dịch tới các peer tham gia trước khi báo thành công; khi peer mất kết nối, xác định lại nhóm xác nhận theo thành viên đã được host chấp nhận.
- Hợp đồng ACK chưa tự bảo đảm chuyển host an toàn. Triển khai phải khôi phục trạng thái được xác nhận, giải quyết snapshot khác revision giữa các peer và từ chối ghi khi chưa biết nguồn chân lý. Snapshot định kỳ 10 giây không thay thế bản ghi giao dịch mới.
- Kiểu state khớp cấu trúc module túi/rương nhưng đặt độc lập để PR hợp đồng có thể review trên main trước khi các PR tính năng merge.
# Tương thích giao thức v4

Phiên bản 4 yêu cầu xử lý đầy đủ gói loot 110–113 và thu hồi bản sao túi/rương trước khi kích hoạt host mới. Các bản v3 chưa có đầy đủ phần này nên không được vào chung phòng v4. Bố cục gói sao lưu 125 có phiên bản riêng (v6 chứa loot trong mẩu 0); các số dành riêng 124–126 giữ nguyên.

