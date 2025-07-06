import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
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
      external: ['commander', 'glob', 'fs', 'path', 'typescript']
    }
  },
  test: {
    globals: true,
    environment: 'node'
  }
})