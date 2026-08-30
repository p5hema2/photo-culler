import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    environmentMatchGlobs: [
      // Main process tests run in node environment
      ['src/main/**', 'node'],
    ],
  },
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@photo-culler/types': resolve(__dirname, '../../packages/types/src'),
      '@photo-culler/image-utils/sorting': resolve(
        __dirname,
        '../../packages/image-utils/src/sorting',
      ),
      '@photo-culler/image-utils/grouping': resolve(
        __dirname,
        '../../packages/image-utils/src/grouping',
      ),
      '@photo-culler/image-utils/focus': resolve(__dirname, '../../packages/image-utils/src/focus'),
      '@photo-culler/image-utils/folders': resolve(
        __dirname,
        '../../packages/image-utils/src/folders',
      ),
      '@photo-culler/image-utils/rating': resolve(
        __dirname,
        '../../packages/image-utils/src/rating',
      ),
      '@photo-culler/image-utils/media': resolve(__dirname, '../../packages/image-utils/src/media'),
      '@photo-culler/image-utils/rename': resolve(
        __dirname,
        '../../packages/image-utils/src/rename',
      ),
      '@photo-culler/image-utils': resolve(__dirname, '../../packages/image-utils/src'),
    },
  },
});
