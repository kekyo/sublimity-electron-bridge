import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';
import screwUp from 'screw-up';

export default defineConfig({
  logLevel: 'info',
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
      fileName: (format, entryName) => `${entryName}.${format === 'es' ? 'js' : 'cjs'}`,
      formats: ['es', 'cjs']
    },
    target: 'node14',
    sourcemap: true,
    rollupOptions: {
      external: ['vite', 'path', 'fs', 'fs/promises', 'typescript', 'crypto', 'worker_threads', 'glob', 'url', 'module', 'chokidar']
    }
  }
});
