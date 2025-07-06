import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'SublimityElectronBridge',
      fileName: 'index'
    },
    rollupOptions: {
      external: ['typescript', 'vite'],
      output: {
        globals: {
          typescript: 'typescript',
          vite: 'vite'
        }
      }
    }
  },
  test: {
    globals: true,
    environment: 'node'
  }
})