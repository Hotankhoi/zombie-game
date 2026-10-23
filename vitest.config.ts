import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ['shared/**/*.test.ts', 'net/**/*.test.ts', 'host/**/*.test.ts'],
      environment: 'node',
    },
  }),
);
