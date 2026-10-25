/**
 * Mã bản build gửi kèm gói chào (Hello): commit SHA và thời điểm build (giây), do vite.config.ts đặt từ
 * GITHUB_SHA lúc GitHub Actions build. Chạy trên máy mình (`npm run dev`) = 'dev' / 0 → không nhắc tải lại.
 * Cùng PROTOCOL_VERSION mà khác build thì vẫn chơi chung được, chỉ nhắc người bản cũ hơn tải lại.
 */
export interface BuildInfo {
  id: string;
  /** Giây kể từ 1970; 0 = không rõ (bản dev, hoặc bản cũ chưa gửi). */
  time: number;
}

export const BUILD: BuildInfo = {
  id: String(import.meta.env.VITE_BUILD_ID ?? '') || 'dev',
  time: Number(import.meta.env.VITE_BUILD_TIME ?? 0) || 0,
};
