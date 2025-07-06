import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'ElectronBridgeCore',
      fileName: 'index',
      formats: ['es', 'cjs']
    },
    target: 'node14',
    rollupOptions: {
      external: ['typescript', 'path', 'fs']
    }
  },
  test: {
    globals: true,
    environment: 'node'
  }
})