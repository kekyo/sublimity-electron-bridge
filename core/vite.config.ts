import { defineConfig } from 'vite'
import { resolve } from 'path'
import dts from 'vite-plugin-dts'

export default defineConfig({
  plugins: [dts()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'ElectronBridgeCore',
      fileName: 'index',
      formats: ['es', 'cjs']
    },
    target: 'node14',
    rollupOptions: {
      external: ['typescript', 'path', 'fs', 'crypto']
    }
  },
  test: {
    globals: true,
    environment: 'node'
  }
});
