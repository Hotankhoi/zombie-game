import { afterEach, describe, expect, it, vi } from 'vitest';
import { STUN_SERVERS, loadIceServers } from './ice';

const URL = 'https://turn.example/ice';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('loadIceServers', () => {
  afterEach(() => vi.restoreAllMocks());

  it('ghép STUN với TURN lấy từ Worker', async () => {
    const turn = { urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' };
    const servers = await loadIceServers(URL, async () => jsonResponse({ iceServers: [turn] }));
    expect(servers).toEqual([...STUN_SERVERS, turn]);
  });

  it('đọc được kiểu trả về dạng mảng của Metered', async () => {
    const turn = { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: 'u', credential: 'c' };
    const servers = await loadIceServers(URL, async () => jsonResponse([turn]));
    expect(servers).toEqual([...STUN_SERVERS, { ...turn, urls: [turn.urls] }]);
  });

  it('bỏ các URL cổng 53', async () => {
    const turn = {
      urls: [
        'stun:stun.cloudflare.com:53',
        'turn:turn.cloudflare.com:53?transport=udp',
        'turn:turn.cloudflare.com:3478?transport=udp',
      ],
      username: 'u',
      credential: 'c',
    };
    const onlyPort53 = { urls: 'stun:stun.cloudflare.com:53' };
    const servers = await loadIceServers(URL, async () => jsonResponse({ iceServers: [turn, onlyPort53] }));
    expect(servers.slice(STUN_SERVERS.length)).toEqual([
      { urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' },
    ]);
  });

  it('Worker lỗi → chỉ STUN', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const servers = await loadIceServers(URL, async () => jsonResponse('forbidden', 403));
    expect(servers).toEqual(STUN_SERVERS);
  });

  it('Worker quá chậm → chỉ STUN', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const never = (_u: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new Error('abort'))),
      );
    const servers = await loadIceServers(URL, never, 10);
    expect(servers).toEqual(STUN_SERVERS);
  });

  it('chưa cấu hình URL → chỉ STUN, không gọi mạng', async () => {
    const fetchFn = vi.fn();
    expect(await loadIceServers('', fetchFn)).toEqual(STUN_SERVERS);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
