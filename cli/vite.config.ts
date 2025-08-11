import { defineConfig } from 'vite';
import { resolve } from 'path';
import screwUp from 'screw-up';

export default defineConfig({
  logLevel: 'info',
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
      fileName: (format, entryName) => `${entryName}.${format === 'es' ? 'js' : 'cjs'}`,
      formats: ['es', 'cjs']
    },
    target: 'node14',
    sourcemap: true,
    rollupOptions: {
      external: ['commander', 'glob', 'fs', 'fs/promises', 'path', 'typescript', 'crypto']
    }
  }
});
