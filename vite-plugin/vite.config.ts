import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [dts()],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        worker: resolve(__dirname, 'src/worker.js')
      },
      name: 'SublimityElectronBridgeVitePlugin',
      fileName: (format, entryName) => `${entryName}.${format === 'es' ? 'mjs' : 'js'}`,
      formats: ['es', 'cjs']
    },
    target: 'node14',
    rollupOptions: {
      external: ['vite', 'path', 'fs', 'typescript', 'crypto', 'worker_threads', 'glob', 'url']
    }
  }
});
