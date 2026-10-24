# /tools — bot giả lập và đo tải

- `bot.ts` — bot người chơi: chỉ đọc những gì một máy khách thật thấy (`ClientSync`), tự đánh zombie gần,
  cứu đồng đội gục (R), chạy khi máu thấp, bật đèn pin ban đêm.
- `loadTest.ts` — `runLoadTest(...)`: host thật (`HostServer`) + N máy khách thật (`ClientSync` + `Bot`) nối bằng
  mạng giả có trễ/mất gói, chạy nhanh hết mức không cần trình duyệt. Trả về: ms/tick của host và khách, KB/s
  nhận/gửi mỗi người (trung bình + đỉnh 5 giây), lệch dự đoán, % snapshot mất, giết/chết/cứu, kết quả đợt tràn.
- `scenarios.loadtest.ts` — bảng đo đầy đủ (4 kịch bản: mạng tốt, trễ 150ms + mất 5%, đợt tràn tối đa 500 + 4 Boss,
  đợt tràn 1 bot tự chơi).

Chạy bảng đo (mất khoảng 20–60 giây):

```bash
npm run loadtest -- --silent=false
```

Bản chạy nhanh (15 giây, 4 bot) nằm trong `npm test` (`host/loadTest.test.ts`) để CI bắt lỗi băng thông/dự đoán.

Đo qua relay Cloudflare thật (`relayLoadTest.ts`, `relay.loadtest.ts`; bỏ qua nếu không có `RELAY_URL`):

```bash
cd relay && npm install && npx wrangler dev        # terminal 1
RELAY_URL=ws://127.0.0.1:8787 npm run loadtest -- --silent=false   # terminal 2
```

In ra số khung gửi lên relay mỗi giây và số giờ chơi/ngày trong hạn mức free (chi tiết: `docs/relay.md`).
