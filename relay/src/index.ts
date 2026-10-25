import { DurableObject } from 'cloudflare:workers';
import {
  RELAY_MAX_FRAME,
  RELAY_PEER_ID,
  RELAY_KEY,
  RELAY_PING,
  RELAY_PONG,
  RELAY_PROTOCOL,
  admitPeer,
  decodeClientBatch,
  encodeJoin,
  encodeLeave,
  encodeServerData,
  encodeWelcome,
  freeSlot,
  routeBatch,
} from '../../net/relayProtocol';

/**
 * Relay WebSocket dự phòng (GĐ 7): máy chơi không nối thẳng WebRTC được thì gửi gói qua đây.
 * Worker chỉ chuyển yêu cầu /room/<MÃ> tới Durable Object của phòng đó; Durable Object chuyển tiếp gói
 * giữa các WebSocket trong phòng. Không lưu gì, không đọc nội dung gói game.
 *
 * Dùng WebSocket Hibernation (ctx.acceptWebSocket): phòng rảnh thì Durable Object ngủ, không tính thời gian chạy;
 * mọi thông tin của từng kết nối (id, ghế) nằm trong attachment của WebSocket nên ngủ dậy vẫn còn.
 */
export interface Env {
  RELAY_ROOM: DurableObjectNamespace<RelayRoom>;
  ALLOWED_ORIGINS?: string;
}

interface Member {
  id: string;
  slot: number;
  /** Mã bí mật máy đó gửi lúc vào (RELAY_KEY) — chỉ kết nối cùng mã mới được thay kết nối này. */
  key: string;
}

const ROOM_PATH = /^\/room\/([A-Z0-9]{4,12})$/;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/') return new Response('zombie relay ok\n');
    const m = ROOM_PATH.exec(url.pathname);
    if (!m) return new Response('not found', { status: 404 });
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('cần WebSocket', { status: 426 });
    }
    const origin = req.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (origin && allowed.length > 0 && !allowed.includes(origin)) {
      return new Response('origin không được phép', { status: 403 });
    }
    const peer = url.searchParams.get('peer') ?? '';
    if (!RELAY_PEER_ID.test(peer)) return new Response('peer sai', { status: 400 });
    if (!RELAY_KEY.test(url.searchParams.get('k') ?? '')) return new Response('thiếu mã', { status: 400 });
    if (url.searchParams.get('v') !== String(RELAY_PROTOCOL)) {
      return new Response('khác phiên bản relay', { status: 409 });
    }
    const stub = env.RELAY_ROOM.get(env.RELAY_ROOM.idFromName(m[1]!));
    return stub.fetch(req);
  },
} satisfies ExportedHandler<Env>;

export class RelayRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // "ping" → "pong" do Cloudflare tự trả, không đánh thức Durable Object
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(RELAY_PING, RELAY_PONG));
  }

  override async fetch(req: Request): Promise<Response> {
    const params = new URL(req.url).searchParams;
    const id = params.get('peer') ?? '';
    const key = params.get('k') ?? '';
    const members = this.members();
    // cùng id nối lại (mạng chập chờn): đóng kết nối cũ — chỉ khi đúng mã của kết nối cũ (không thì ai biết id cũng đá được)
    if (admitPeer(members.values(), id, key) === 'reject') {
      return new Response('peer id đang được dùng', { status: 409 });
    }
    for (const [ws, m] of members) {
      if (m.id !== id) continue;
      members.delete(ws);
      this.broadcast(encodeLeave(m.slot), members);
      safeClose(ws, 4000, 'replaced');
    }
    const slot = freeSlot([...members.values()].map((m) => m.slot));
    if (slot < 0) return new Response('phòng relay đầy', { status: 403 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id, slot, key } satisfies Member);
    server.send(encodeWelcome(slot));
    for (const [ws, m] of members) {
      server.send(encodeJoin(m.slot, m.id));
      safeSend(ws, encodeJoin(slot, id));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    if (typeof message === 'string' || message.byteLength > RELAY_MAX_FRAME) return;
    const me = attachment(ws);
    if (!me) return;
    const entries = decodeClientBatch(new Uint8Array(message));
    if (!entries) return;
    const members = this.members();
    members.delete(ws);
    const bySlot = new Map<number, WebSocket>();
    for (const [other, m] of members) bySlot.set(m.slot, other);
    for (const [slot, list] of routeBatch(me.slot, entries, [...bySlot.keys()])) {
      safeSend(bySlot.get(slot)!, encodeServerData(list));
    }
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    this.drop(ws);
    safeClose(ws, code === 1005 || code === 1006 ? 1000 : code, 'bye');
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.drop(ws);
  }

  private drop(ws: WebSocket): void {
    const me = attachment(ws);
    if (!me) return;
    ws.serializeAttachment(null);
    const members = this.members();
    members.delete(ws);
    // ghế đã có người khác (kết nối mới cùng id thay thế) thì không báo rời
    if ([...members.values()].some((m) => m.slot === me.slot)) return;
    this.broadcast(encodeLeave(me.slot), members);
  }

  private members(): Map<WebSocket, Member> {
    const out = new Map<WebSocket, Member>();
    for (const ws of this.ctx.getWebSockets()) {
      const m = attachment(ws);
      if (m && ws.readyState === WebSocket.OPEN) out.set(ws, m);
    }
    return out;
  }

  private broadcast(data: Uint8Array, members: Map<WebSocket, Member>): void {
    for (const ws of members.keys()) safeSend(ws, data);
  }
}

function attachment(ws: WebSocket): Member | null {
  return (ws.deserializeAttachment() as Member | null) ?? null;
}

function safeSend(ws: WebSocket, data: Uint8Array): void {
  try {
    ws.send(data);
  } catch {
    /* kết nối vừa đóng: bỏ qua */
  }
}

function safeClose(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {
    /* đã đóng */
  }
}
