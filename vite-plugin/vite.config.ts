import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'SublimityElectronBridgeVitePlugin',
      fileName: 'index',
      formats: ['es', 'cjs']
    },
    target: 'node14',
    rollupOptions: {
      external: ['vite', 'path', 'fs', 'typescript']
    }
  },
  test: {
    globals: true,
    environment: 'node'
  }
})