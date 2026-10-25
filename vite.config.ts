import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Mã bản build gửi trong gói chào (net/build.ts): GitHub Actions tự có GITHUB_SHA; máy mình = 'dev'.
const buildId = (process.env.GITHUB_SHA ?? '').slice(0, 12) || 'dev';
const buildTime = buildId === 'dev' ? 0 : Math.floor(Date.now() / 1000);

export default defineConfig({
  define: {
    'import.meta.env.VITE_BUILD_ID': JSON.stringify(buildId),
    'import.meta.env.VITE_BUILD_TIME': JSON.stringify(String(buildTime)),
  },
  // './' để chạy được ở GitHub Pages (https://<user>.github.io/zombie-game/)
  base: './',
  resolve: {
    alias: {
      '@shared': r('./shared'),
      '@net': r('./net'),
      '@host': r('./host'),
      '@client': r('./client'),
    },
  },
  server: { port: 5173, host: true },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 2000 },
  worker: { format: 'es' },
});
