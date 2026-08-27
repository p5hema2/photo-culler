import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        // Bundled rather than externalised. electron-builder.yml excludes
        // node_modules and ships only the vendored subset (sharp,
        // exiftool-vendored), so an externalised pure-JS dependency would be
        // missing at runtime in a packaged build. exifr is pure JS, and the
        // scanner needs it in the main process to read ratings.
        exclude: ['electron-store', 'exifr', '@photo-culler/image-utils', '@photo-culler/types'],
      }),
    ],
    resolve: {
      alias: {
        '@photo-culler/types': resolve(__dirname, '../../packages/types/src'),
        '@photo-culler/image-utils': resolve(__dirname, '../../packages/image-utils/src'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@photo-culler/types': resolve(__dirname, '../../packages/types/src'),
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@photo-culler/types': resolve(__dirname, '../../packages/types/src'),
        '@photo-culler/image-utils/sorting': resolve(
          __dirname,
          '../../packages/image-utils/src/sorting',
        ),
        '@photo-culler/image-utils/grouping': resolve(
          __dirname,
          '../../packages/image-utils/src/grouping',
        ),
        '@photo-culler/image-utils/focus': resolve(
          __dirname,
          '../../packages/image-utils/src/focus',
        ),
        '@photo-culler/image-utils/folders': resolve(
          __dirname,
          '../../packages/image-utils/src/folders',
        ),
        // rating.ts and NOT metadata.ts: the latter imports exifr at module
        // scope, which the browser bundle has no business carrying.
        '@photo-culler/image-utils/rating': resolve(
          __dirname,
          '../../packages/image-utils/src/rating',
        ),
      },
    },
    plugins: [tailwindcss(), react()],
  },
});
