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
    screwUp()
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'ElectronBridgeCore',
      fileName: (format, entryName) => `${entryName}.${format === 'es' ? 'mjs' : 'js'}`,
      formats: ['es', 'cjs']
    },
    target: 'node14',
    rollupOptions: {
      external: ['typescript', 'path', 'fs', 'fs/promises', 'crypto']
    }
  }
});
