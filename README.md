# Zombie Co-op

Game 2D sinh tồn zombie, thế giới mở, góc nhìn từ trên xuống, chơi trên trình duyệt, co-op online tối đa 4 người.
Mạng P2P (WebRTC) — không cần server, miễn phí hoàn toàn.

Thiết kế đầy đủ và quy tắc làm việc: **[AGENTS.md](AGENTS.md)**.

## Chạy trên máy

```bash
npm install
npm run dev      # mở http://localhost:5173
```

Mở 2 tab cùng một link (có `?room=...`) để thử 2 người. Bấm **F3** để bật/tắt bảng giả lập mạng xấu.

## Lệnh hay dùng

| Lệnh            | Việc                                                         |
| --------------- | ------------------------------------------------------------ |
| `npm run dev`   | Chạy thử                                                     |
| `npm run check` | Kiểm tra kiểu + lint + test (chạy trước khi mở Pull Request) |
| `npm test`      | Chỉ chạy test                                                |
| `npm run build` | Build bản phát hành vào `dist/`                              |

## Cấu trúc

| Thư mục   | Nội dung                                                                                            |
| --------- | --------------------------------------------------------------------------------------------------- |
| `client/` | Phaser, giao diện                                                                                   |
| `net/`    | Lớp mạng: `Transport`, Trystero, mạng giả (loopback), giả lập mạng xấu, phòng chờ                   |
| `shared/` | Logic dùng chung, không phụ thuộc trình duyệt (`types/`, `util/rng.ts`, `sim/`, `mapgen/`, `data/`) |
| `host/`   | Mô phỏng thế giới trên máy host (giai đoạn 2)                                                       |
| `tools/`  | Bot, đo tải                                                                                         |

Mỗi lần merge vào `main`, GitHub Actions tự đưa game lên GitHub Pages.
