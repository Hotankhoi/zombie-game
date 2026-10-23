/**
 * Cloudflare Worker phát mật khẩu TURN tạm thời (sống 24h) cho trình duyệt.
 * Khóa Cloudflare TURN là bí mật nên không để trong code game — chỉ nằm ở đây (wrangler secret).
 * Deploy: `npm run worker:deploy` (xem AGENTS.md mục 8).
 */
interface Env {
  TURN_KEY_ID: string;
  TURN_KEY_API_TOKEN: string;
}

/** Trang được phép xin mật khẩu (chặn trang khác dùng ké băng thông TURN miễn phí). */
const ALLOWED_ORIGINS = ['https://hotankhoi.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173'];
const TTL_SECONDS = 86400;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('Origin') ?? '';
    if (!ALLOWED_ORIGINS.includes(origin)) return new Response('forbidden', { status: 403 });

    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      Vary: 'Origin',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'GET' || new URL(req.url).pathname !== '/ice') {
      return new Response('not found', { status: 404, headers: cors });
    }

    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: TTL_SECONDS }),
      },
    );
    if (!res.ok) return new Response(`turn api ${res.status}`, { status: 502, headers: cors });

    return new Response(await res.text(), {
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  },
};
