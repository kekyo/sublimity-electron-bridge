import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ElectronBridgeGenerator } from '@sublimity-electron-bridge/core'
import { mkdtempSync, readFileSync, existsSync, rmSync, readdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { glob } from 'glob'

describe('CLI Package', () => {
  let tempDir: string
  let testFixturesDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cli-test-'))
    testFixturesDir = join(__dirname, 'test-fixtures')
  })

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('should process files and generate bridge code', async () => {
    const generator = new ElectronBridgeGenerator({
      outputDirs: {
        main: join(tempDir, 'main'),
        preload: join(tempDir, 'preload')
      },
      typeDefinitionsFile: join(tempDir, 'types', 'electron.d.ts')
    })

    // Read test fixture files
    const userServiceCode = readFileSync(join(testFixturesDir, 'UserService.ts'), 'utf-8')
    const systemCode = readFileSync(join(testFixturesDir, 'system.ts'), 'utf-8')

    // Analyze files
    const userServiceMethods = generator.analyzeFile(join(testFixturesDir, 'UserService.ts'), userServiceCode)
    const systemMethods = generator.analyzeFile(join(testFixturesDir, 'system.ts'), systemCode)

    // Verify methods were extracted
    expect(userServiceMethods).toHaveLength(3)
    expect(systemMethods).toHaveLength(3)

    // Verify method details
    expect(userServiceMethods[0]).toMatchObject({
      className: 'UserService',
      methodName: 'getUser',
      namespace: 'userAPI',
      returnType: 'Promise<User>'
    })

    expect(systemMethods[0]).toMatchObject({
      methodName: 'getSystemInfo',
      namespace: 'systemAPI',
      returnType: 'Promise<SystemInfo>'
    })

    // Generate files
    const allMethods = [...userServiceMethods, ...systemMethods]
    generator.generateFiles(allMethods)

    // Verify generated files exist
    expect(existsSync(join(tempDir, 'main'))).toBe(true)
    expect(existsSync(join(tempDir, 'preload'))).toBe(true)
    expect(existsSync(join(tempDir, 'types', 'electron.d.ts'))).toBe(true)

    // Verify main handler files
    const mainFiles = readdirSync(join(tempDir, 'main'))
    expect(mainFiles).toContain('ipc-handlers.ts')
    
    // Verify preload bridge files
    const preloadFiles = readdirSync(join(tempDir, 'preload'))
    expect(preloadFiles).toContain('bridge.ts')
    
    // Verify contents of generated files contain expected methods
    const mainHandlers = readFileSync(join(tempDir, 'main', 'ipc-handlers.ts'), 'utf-8')
    expect(mainHandlers).toContain('getUser')
    expect(mainHandlers).toContain('getSystemInfo')
    expect(mainHandlers).toContain('getCurrentUser')
    
    const preloadBridge = readFileSync(join(tempDir, 'preload', 'bridge.ts'), 'utf-8')
    expect(preloadBridge).toContain('userAPI')
    expect(preloadBridge).toContain('systemAPI')
    expect(preloadBridge).toContain('electronAPI')

    // Verify type definitions content
    const typeDefs = readFileSync(join(tempDir, 'types', 'electron.d.ts'), 'utf-8')
    expect(typeDefs).toContain('UserAPI')
    expect(typeDefs).toContain('SystemAPI')
    expect(typeDefs).toContain('ElectronAPI')
    expect(typeDefs).toContain('getUser')
    expect(typeDefs).toContain('getSystemInfo')
  })

  it('should handle file discovery with glob patterns', async () => {
    // Test the glob functionality that CLI would use
    const pattern = join(testFixturesDir, '**/*.ts')
    const files = await glob(pattern)
    
    expect(files.length).toBeGreaterThan(0)
    expect(files.some(f => f.includes('UserService.ts'))).toBe(true)
    expect(files.some(f => f.includes('system.ts'))).toBe(true)
  })

  it('should handle files with no exposed methods gracefully', async () => {
    const generator = new ElectronBridgeGenerator({
      outputDirs: {
        main: join(tempDir, 'main'),
        preload: join(tempDir, 'preload')
      },
      typeDefinitionsFile: join(tempDir, 'types', 'electron.d.ts')
    })

    const emptyFileCode = 'export const dummy = true;'
    const methods = generator.analyzeFile('dummy.ts', emptyFileCode)
    
    expect(methods).toHaveLength(0)
  })
})