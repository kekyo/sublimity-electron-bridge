import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [dts()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'SublimityElectronBridgeVitePlugin',
      fileName: 'index',
      formats: ['es', 'cjs']
    },
    target: 'node14',
    rollupOptions: {
      external: ['vite', 'path', 'fs', 'typescript', 'crypto', 'worker_threads', 'glob', 'sublimity-electron-bridge-core']
    }
  },
  test: {
    globals: true,
    environment: 'node'
  }
});
