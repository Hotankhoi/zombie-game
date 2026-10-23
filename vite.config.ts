import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
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
