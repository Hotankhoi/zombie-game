import type { LootClientError } from '@net/clientLoot';
import { LOOT_MESSAGES } from '../ui/loot/lootPanel';

/**
 * Câu tiếng Việt cho MỌI mã lỗi loot online (reducer của B + host + máy khách). Mã của reducer dùng câu của B
 * (`LOOT_MESSAGES`); mã mạng/host thêm ở đây. Record đủ khóa → thêm mã lỗi mới mà quên câu thì typecheck báo.
 */
export const LOOT_ERROR_TEXT: Record<LootClientError, string> = {
  ...LOOT_MESSAGES,
  internal_error: 'Host gặp lỗi khi xử lý. Đồ vẫn giữ nguyên; hãy thử lại.',
  unknown_player: 'Host chưa nhận túi đồ của bạn. Chờ vài giây rồi thử lại.',
  player_not_up: 'Bạn đang gục nên không lấy đồ được.',
  unknown_chest: 'Không tìm thấy rương này.',
  out_of_reach: 'Bạn đứng quá xa rương. Lại gần hơn rồi thử lại.',
  blocked: 'Có tường hoặc cửa đóng chắn giữa bạn và rương.',
  state_limit: 'Thế giới đã quá nhiều rương được mở. Không lưu thêm được.',
  not_in_match: 'Bạn chưa vào trận.',
  rate_limited: 'Thao tác quá nhanh. Chờ một chút rồi thử lại.',
  recovering: 'Host mới đang khôi phục đồ của mọi người. Chờ vài giây.',
  inventory_limit: 'Thế giới này đã đủ 4 túi đồ, bạn chưa có túi riêng.',
  key_in_use: 'Túi đồ của bạn đang mở ở tab khác.',
  invalid_key: 'Khóa túi đồ không hợp lệ. Tải lại trang.',
  not_ready: 'Đang tải túi đồ từ host… thử lại sau giây lát.',
  busy: 'Đang chờ host xác nhận thao tác trước.',
  host_changed: 'Vừa đổi host. Kiểm tra lại túi/rương rồi thử lại.',
  timeout: 'Host chưa trả lời. Kiểm tra kết nối rồi thử lại.',
};

export function lootErrorText(code: string): string {
  return Object.hasOwn(LOOT_ERROR_TEXT, code)
    ? LOOT_ERROR_TEXT[code as LootClientError]
    : 'Thao tác chưa được xác nhận.';
}
