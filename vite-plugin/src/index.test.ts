import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sublimityElectronBridge } from './index'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createServer } from 'vite'

describe('SublimityElectronBridge Vite Plugin', () => {
  let tempDir: string
  let testFixturesDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'vite-plugin-test-'))
    testFixturesDir = join(__dirname, 'test-fixtures')
  })

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('should create plugin with default options', () => {
    const plugin = sublimityElectronBridge()
    
    expect(plugin).toBeDefined()
    expect(plugin.name).toBe('sublimity-electron-bridge')
  })

  it('should generate files when processing source files', async () => {
    const plugin = sublimityElectronBridge({
      outputDirs: {
        main: join(tempDir, 'main'),
        preload: join(tempDir, 'preload')
      },
      typeDefinitionsFile: join(tempDir, 'types', 'electron.d.ts')
    })

    const mockContext = {
      resolve: (id: string) => Promise.resolve({ id }),
      error: (msg: string) => { throw new Error(msg) }
    }

    // Simulate Vite's buildStart hook
    const buildStart = plugin.buildStart as Function
    if (buildStart) {
      await buildStart.call(mockContext)
    }

    // Simulate file processing
    const transform = plugin.transform as Function
    if (transform) {
      const fileServiceCode = readFileSync(join(testFixturesDir, 'FileService.ts'), 'utf-8')
      const databaseCode = readFileSync(join(testFixturesDir, 'database.ts'), 'utf-8')
      
      await transform.call(mockContext, fileServiceCode, join(testFixturesDir, 'FileService.ts'))
      await transform.call(mockContext, databaseCode, join(testFixturesDir, 'database.ts'))
    }

    // Simulate buildEnd hook to generate files
    const buildEnd = plugin.buildEnd as Function
    if (buildEnd) {
      await buildEnd.call(mockContext)
    }

    // Verify generated files exist
    expect(existsSync(join(tempDir, 'main'))).toBe(true)
    expect(existsSync(join(tempDir, 'preload'))).toBe(true)
    expect(existsSync(join(tempDir, 'types', 'electron.d.ts'))).toBe(true)

    // Verify content of generated files
    const mainFiles = require('fs').readdirSync(join(tempDir, 'main'))
    const preloadFiles = require('fs').readdirSync(join(tempDir, 'preload'))
    
    expect(mainFiles.length).toBeGreaterThan(0)
    expect(preloadFiles.length).toBeGreaterThan(0)
    
    // Check that type definitions contain expected interfaces
    const typeDefs = readFileSync(join(tempDir, 'types', 'electron.d.ts'), 'utf-8')
    expect(typeDefs).toContain('FileAPI')
    expect(typeDefs).toContain('DatabaseAPI')
    expect(typeDefs).toContain('ElectronAPI')
  })

  it('should handle empty source files gracefully', async () => {
    const plugin = sublimityElectronBridge({
      outputDirs: {
        main: join(tempDir, 'main'),
        preload: join(tempDir, 'preload')
      },
      typeDefinitionsFile: join(tempDir, 'types', 'electron.d.ts')
    })

    const mockContext = {
      resolve: (id: string) => Promise.resolve({ id }),
      error: (msg: string) => { throw new Error(msg) }
    }

    const transform = plugin.transform as Function
    if (transform) {
      const result = await transform.call(mockContext, 'export const dummy = true;', 'dummy.ts')
      
      // Should return the code with map since it's a valid transform
      expect(result).toEqual({
        code: 'export const dummy = true;',
        map: null
      })
    }
  })
})