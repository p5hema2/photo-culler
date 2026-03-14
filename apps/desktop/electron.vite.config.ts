import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['electron-store'] })],
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
      },
    },
    plugins: [react()],
  },
});
