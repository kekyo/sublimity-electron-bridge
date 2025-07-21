import { defineConfig } from 'vitest/config'
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Read version from package.json
const packageJson = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));

export default defineConfig({
  define: {
    __VERSION__: JSON.stringify(packageJson.version)
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    hookTimeout: 30000,
    testTimeout: 30000
  }
})