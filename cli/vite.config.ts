import { defineConfig } from 'vite';
import { resolve } from 'path';
import screwUp from 'screw-up';

export default defineConfig({
  plugins: [
    screwUp({
      outputMetadataFile: true
    })
  ],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        cli: resolve(__dirname, 'src/cli.ts')
      },
      name: 'ElectronBridgeCLI',
      fileName: (format, entryName) => `${entryName}.${format === 'es' ? 'mjs' : 'js'}`,
      formats: ['es', 'cjs']
    },
    target: 'node14',
    rollupOptions: {
      external: ['commander', 'glob', 'fs', 'fs/promises', 'path', 'typescript', 'crypto']
    }
  }
});
