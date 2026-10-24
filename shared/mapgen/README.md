# /shared/mapgen — sinh bản đồ từ seed (vùng của B)

Việc 1b. Dùng `Rng` trong `shared/util/rng.ts` (`new Rng(seed).fork('chunk:x,y')` cho mỗi chunk)
để cùng seed luôn ra cùng bản đồ trên mọi máy. Không import Phaser ở đây — chỉ sinh dữ liệu;
phần vẽ nằm ở `/client`.

## API bản đồ v1

- `generateChunk(seed, cx, cy)`: sinh dữ liệu thuần, chunk 32×32 tile; tile 16px khi vẽ. Nhận tọa độ chunk nguyên trong ±1.000.000. Cùng seed, tọa độ và phiên bản luôn cho cùng kết quả, không phụ thuộc thứ tự tải.
- `WorldMap(seed, capacity = 64)`: cache LRU có giới hạn; `getChunk(cx, cy)` và `tileAt(tileX, tileY)`. Xem dữ liệu trả về là chỉ đọc; thay đổi cửa/rương phải lưu riêng theo thế giới, không sửa map gốc.
- `tileToChunk(x, y)`: tọa độ tile sang chunk và vị trí trong chunk; dùng floor nên hỗ trợ tọa độ âm.
- `WorldMap.isSolid(tileX, tileY)`: tra vật cản theo tọa độ tile toàn cục (có hỗ trợ âm); `isSolid(tile)` dùng khi đã có TileId. Tường và cửa đóng là vật cản nền. A ghép va chạm, mở/phá cửa và trạng thái thay đổi trong `/shared/sim`; 1b chưa làm các hành vi đó.
- `worldSeedForRoom(room)`: seed thống nhất từ mã phòng chuẩn hóa cho giai đoạn phòng chờ. Khi có save/host ở giai đoạn sau, host cung cấp seed và `MAP_VERSION` của thế giới; không phụ thuộc người chơi nào làm host.

Mỗi chunk có đường chữ thập và vỉa hè liên thông với chunk bên cạnh. Các khu 2×2 chunk gồm dân cư, siêu thị, bệnh viện, cảnh sát và quân sự. Công trình có ID ổn định trong một thế giới, kích thước và cửa theo tọa độ tile toàn cục. Mỗi cửa có lối nối ra đường. Chỉ định loại công trình để các giai đoạn sau ghép loot; chưa sinh vật phẩm.

## Ghép vào client

`client/render/mapRenderer.ts` xuất `preloadMapTiles(scene)` (gọi trong `preload()`) và `MapRenderer(scene)` (tạo trong `create()`). Gọi `renderer.sync(visibleChunks)` với toàn bộ các chunk đang nhìn thấy; renderer tự tạo tilemap và giải phóng chunk ra khỏi tập này. Renderer không điều khiển camera, nhập phím, vòng tick mạng hay trạng thái người chơi. Có `destroy()` và tự dọn khi scene shutdown. Dữ liệu đầu vào là map nền tĩnh; A ghép thay đổi cửa/nhà vào mô phỏng sau.

```ts
// Trong scene.preload(): preloadMapTiles(this);
// Trong scene.create():
const world = new WorldMap(seed);
const renderer = new MapRenderer(scene);
renderer.sync([world.getChunk(0, 0), world.getChunk(1, 0)]);
const blocked = world.isSolid(tileX, tileY);
```

Mở `?map=1&room=MAP001` để xem thử bằng `client/scenes/MapPreviewScene.ts`: kéo chuột/chạm hoặc phím mũi tên để di chuyển camera; minimap hiển thị 5×5 chunk và khung vùng đang xem. Nút **Về phòng chờ** bỏ tham số `map`, giữ mã phòng và các tham số khác. Đây là scene kiểm tra bản đồ độc lập, không khởi tạo kết nối mạng hay giả lập vị trí người chơi.

`index.html` trỏ tới `client/bootstrap.ts`: có `map=1` thì nạp preview, còn lại nạp nguyên `client/main.ts` của A. Không sửa `client/main.ts` và `client/scenes/LobbyScene.ts` so với main mới nhất; không thêm dependency hay đổi `/shared/types`. A dùng renderer với scene/camera thật ở 1a. WorldMap dùng được cả phía host lẫn client, không phụ thuộc preview.

## Kiểm thử

`npm run check` và `npm run build`. Test gồm mẫu kết quả v1 cố định (đối chiếu cả Node/Chromium), thứ tự tải khác nhau, seed khác nhau, biên chunk, tọa độ âm, đủ loại khu, đường từ cửa ra phố và giới hạn cache. Khi đổi thuật toán có chủ ý, phải xét tăng `MAP_VERSION` và tương thích save; không cập nhật mẫu chỉ để làm test qua.

## Asset

Tilesheet Kenney **Roguelike Modern City 2.0**, giấy phép CC0, được lưu nguyên bản trong `assets/kenney/roguelike-modern-city/` cùng giấy phép và thông tin nguồn. `preloadMapTiles(scene)` nạp ảnh nội bộ; Vite đóng gói URL tương thích GitHub Pages. Renderer ánh xạ TileId logic sang index tile của Kenney, nên thay hình không ảnh hưởng dữ liệu map/va chạm. Minimap dùng bảng màu riêng để dễ đọc.

# API điểm xuất phát và đường

`spawnPoint(chunkX = 0, chunkY = 0)` từ `world.ts` trả tọa độ thế giới theo đơn vị ô, ở tâm một ô đường tại ngã tư. Mặc định là `{ x: 16.5, y: 16.5 }`; A có thể dùng `spawn = spawnPoint()` trong adapter thay tọa độ viết cố định. `isRoadTile(tileX, tileY)` nhận tọa độ ô nguyên, hỗ trợ cả tọa độ âm; `ROAD_MIN`/`ROAD_MAX` công bố các chỉ số đường cục bộ. API này giữ nguyên dữ liệu map v1 và các golden test.
