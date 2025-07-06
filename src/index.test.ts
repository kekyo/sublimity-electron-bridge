import { describe, it, expect } from 'vitest'
import { sublimityElectronBridge } from './index'

describe('sublimityElectronBridge', () => {
  it('should return a Vite plugin', () => {
    const plugin = sublimityElectronBridge()
    
    expect(plugin).toBeDefined()
    expect(plugin.name).toBe('sublimity-electron-bridge')
    expect(typeof plugin.transform).toBe('function')
  })

  it('should handle TypeScript files', () => {
    const plugin = sublimityElectronBridge()
    const result = plugin.transform?.('const test = "hello";', 'test.ts')
    
    expect(result).toBeDefined()
  })

  it('should ignore non-TypeScript files', () => {
    const plugin = sublimityElectronBridge()
    const result = plugin.transform?.('const test = "hello";', 'test.js')
    
    expect(result).toBeNull()
  })
})