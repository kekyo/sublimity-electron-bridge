import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';
import screwUp from 'screw-up';

export default defineConfig({
  plugins: [
    dts({
      rollupTypes: true
    }),
    screwUp({
      outputMetadataFile: true
    })],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        worker: resolve(__dirname, 'src/worker.ts')
      },
      name: 'SublimityElectronBridgeVitePlugin',
      fileName: (format, entryName) => `${entryName}.${format === 'es' ? 'mjs' : 'js'}`,
      formats: ['es', 'cjs']
    },
    target: 'node14',
    rollupOptions: {
      external: ['vite', 'path', 'fs', 'fs/promises', 'typescript', 'crypto', 'worker_threads', 'glob', 'url', 'module', 'chokidar']
    }
  }
});
