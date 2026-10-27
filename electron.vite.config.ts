import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const shared = resolve(__dirname, 'src/shared');

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } },
    },
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    build: {
      // sandbox: true — preload должен быть одним CJS-файлом без внешних зависимостей
      externalizeDeps: false,
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias: { '@shared': shared, '@renderer': resolve(__dirname, 'src/renderer') } },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          app: resolve(__dirname, 'src/renderer/app/index.html'),
          widget: resolve(__dirname, 'src/renderer/widget/index.html'),
          audio: resolve(__dirname, 'src/renderer/audio/index.html'),
        },
      },
    },
  },
});
