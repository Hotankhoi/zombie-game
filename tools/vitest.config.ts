import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from '../vite.config';

/** Cấu hình riêng cho `npm run loadtest` (không chạy trong `npm test`/CI vì mất vài phút). */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: { include: ['tools/**/*.loadtest.ts'], environment: 'node', testTimeout: 30 * 60_000 },
  }),
);
