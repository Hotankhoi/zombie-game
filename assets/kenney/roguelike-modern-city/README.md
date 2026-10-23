# Kenney — Roguelike Modern City 2.0

- Tác giả: Kenney (https://kenney.nl).
- Nguồn: https://kenney.nl/assets/roguelike-modern-city
- Gói gốc: https://kenney.nl/media/pages/assets/roguelike-modern-city/0ff3dfff2b-1677694743/kenney_roguelike-modern-city.zip
- Giấy phép: CC0, giữ nguyên `License.txt` từ gói gốc.
- Tải ngày 2026-10-23 qua HTTPS; kiểm tra CRC toàn bộ ZIP thành công.
- SHA-256 gói tải về: `2a3f36b1bc3a3d1cb4b9da051c493d163c493fe54adc66e78e76b3fb4abcfc56`.
- SHA-256 `tilemap_packed.png`: `e8b653bd3f32a537a2634eaa55d6abb97f20e09fd974bc1278a2ea55c1cda59f`.

Giữ nguyên tilesheet gốc, không chỉnh sửa: 592×448 px, 37 cột × 28 hàng, mỗi tile 16×16 px, không có khoảng cách trong bản **packed**. Chỉ đưa tilesheet và giấy phép vào repo.

Ánh xạ TileId → frame nằm trong `client/render/mapRenderer.ts`: cỏ 963, đường 750, vỉa hè 741, sàn 743, tường 190, cửa 653 (index bắt đầu từ 0, theo hàng). Logic và va chạm không phụ thuộc index hình ảnh. Có thể thay tile mà không thay dữ liệu bản đồ hoặc MAP_VERSION.
