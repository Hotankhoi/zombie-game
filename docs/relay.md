# Relay dự phòng (Cloudflare Workers + Durable Objects, gói Free)

Khi 2 máy không nối thẳng WebRTC được (4G, router khó) và TURN Metered hết hạn mức 500 MB/tháng, gói game đi
qua relay WebSocket trên Cloudflare. Miễn phí, không cần thẻ.

## Cách hoạt động

- `relay/` — Worker + Durable Object `RelayRoom`. Mỗi phòng game = 1 Durable Object (loại SQLite — gói Free chỉ cho
  loại này; không lưu gì). Dùng WebSocket Hibernation: phòng rảnh thì ngủ, không tính thời gian chạy.
- `net/relayProtocol.ts` — định dạng khung WebSocket, dùng chung cho game và worker. Gói game nằm nguyên bên trong,
  **không đổi định dạng gói game**.
- `net/relay.ts` — `RelayTransport` (WebSocket). Gộp mọi gói trong cùng nhịp thành 1 khung, tối đa 1 khung/50ms.
- `net/auto.ts` — `AutoTransport`: thử WebRTC trước; ai đã có trên relay mà sau 8s chưa nối thẳng được thì đi
  relay. Nối thẳng được muộn → quay về đường thẳng. Rớt đường thẳng mà còn relay → chơi tiếp, không ai "rời phòng".
  Game chỉ thấy interface `Transport` như cũ.
- Bật bằng biến build `VITE_RELAY_URL` (vd `wss://zombie-relay.<tên>.workers.dev`). **Không có biến → tắt relay,
  game chạy y như trước.**
- Link `?relay=ws` → bỏ WebRTC, đi hẳn relay (để thử relay trên một máy). `?relay=1` vẫn là "WebRTC chỉ qua TURN".
- Bảng F3 có dòng `Đường: thẳng X · relay Y người (… khung/s)`.

## Hạn mức free: 4 người qua relay chơi được bao lâu mỗi ngày?

Gói Free của Durable Objects (tính chung cả tài khoản, reset 0h UTC = 7h sáng giờ VN):

| Hạn mức        | Free/ngày   | Relay dùng                                                            |
| -------------- | ----------- | --------------------------------------------------------------------- |
| Request        | 100.000     | mỗi **20 tin WebSocket gửi lên** = 1 request; tin relay gửi xuống = 0 |
| Thời gian chạy | 13.000 GB-s | 128 MB × thời gian phòng đang chuyển gói = 104.000 s ≈ 28,9 giờ       |
| Request Worker | 100.000     | chỉ lúc mở WebSocket (vài lần mỗi trận)                               |

Request là giới hạn chặt nhất. Cả 4 người cùng đi relay:

| Cách gửi                         | Tin gửi lên/s (cả phòng) | Request/s | Giờ chơi/ngày |
| -------------------------------- | ------------------------ | --------- | ------------- |
| Không gộp (1 gói = 1 tin) — đo   | ~127                     | 6,35      | **≈ 4,4 giờ** |
| Gộp, trần lý thuyết (4 × 20/s)   | 80                       | 4         | **≈ 6,9 giờ** |
| Gộp — đo thật qua `wrangler dev` | 73–74                    | 3,7       | **≈ 7,5 giờ** |

Công thức: `giờ/ngày = 100.000 × 20 / (tin/s) / 3600`.
Không gộp chỉ được ~4,4 giờ (< 6) nên `RelayTransport` gộp gói: 1,73 gói game/khung (host gộp snapshot của 3 khách
\+ ping vào 1 khung), mỗi máy tối đa 20 khung/giây → **≥ 6,9 giờ/ngày** dù game gửi nhiều cỡ nào.

- Chỉ 1 trong 4 người đi relay (thường gặp: 1 bạn dùng 4G): chỉ host và người đó gửi lên relay (≤ 40 tin/s)
  → **≥ 13,9 giờ/ngày**.
- Khi mọi người nối thẳng được: relay chỉ giữ kết nối để biết ai trong phòng (ngủ, ping 30s/lần khi rảnh) → gần 0.
- Hết hạn mức trong ngày: relay từ chối kết nối, người không nối thẳng được thì chờ tới 7h sáng hôm sau; người
  nối thẳng được vẫn chơi bình thường.
- Gộp gói làm trễ thêm tối đa 50ms mỗi chiều cho người đi relay (đo ping qua `wrangler dev` trên cùng máy ≈ 56ms).

## Chạy thử trên máy mình

```bash
cd relay && npm install && npx wrangler dev          # relay chạy ở ws://127.0.0.1:8787
# terminal khác, ở thư mục gốc:
RELAY_URL=ws://127.0.0.1:8787 npm run loadtest -- --silent=false   # 4 máy Node nói chuyện + đo tải qua relay
echo VITE_RELAY_URL=ws://127.0.0.1:8787 >> .env.local && npm run dev   # mở 2 tab với &relay=ws
```

## Cài lên Cloudflare (người dùng làm 1 lần)

Xem mục "VIỆC NGƯỜI DÙNG CẦN LÀM" trong mô tả PR, tóm tắt:

1. Tạo tài khoản Cloudflare (miễn phí, không cần thẻ), vào **Workers & Pages** để chọn tên miền con `*.workers.dev`.
2. Tạo API token theo mẫu **Edit Cloudflare Workers**, chép **Account ID**.
3. GitHub → Settings → Secrets and variables → Actions: thêm `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
4. Chạy workflow **Relay Cloudflare** (tự chạy khi `relay/` đổi trên `main`) → lấy địa chỉ
   `https://zombie-relay.<tên>.workers.dev` trong log, mở thử thấy `zombie relay ok`.
5. Thêm secret `VITE_RELAY_URL` = `wss://zombie-relay.<tên>.workers.dev`, chạy lại workflow GitHub Pages.

Thiếu secret nào thì bước đó bỏ qua, CI không đỏ.

## Rủi ro đã biết

- Ai biết địa chỉ relay cũng mở được WebSocket (kiểm tra `Origin` chỉ chặn trang web khác, không chặn script) →
  có thể bị dùng hết hạn mức ngày. Chỉ ảnh hưởng người cần relay, không tốn tiền (gói Free không có thẻ).
- Lúc đổi đường (relay ↔ thẳng) vài gói reliable có thể tới lệch thứ tự trong ~100ms.
