import type { Plugin } from 'vite'
import { ElectronBridgeGenerator, type ElectronBridgeOptions } from 'sublimity-electron-bridge-core'

export interface SublimityElectronBridgeOptions extends ElectronBridgeOptions {}

export function sublimityElectronBridge(options: SublimityElectronBridgeOptions = {}): Plugin {
  const generator = new ElectronBridgeGenerator(options)
  const allMethods: any[] = []
  
  return {
    name: 'sublimity-electron-bridge',
    configResolved() {
      // Plugin initialization logic
    },
    buildStart() {
      // Clear previous methods on new build
      allMethods.length = 0
    },
    transform(code, id) {
      // Transform logic using TypeScript compiler API
      if (!id.endsWith('.ts') && !id.endsWith('.tsx')) {
        return null
      }

      try {
        const methods = generator.analyzeFile(id, code)
        allMethods.push(...methods)
      } catch (error) {
        this.error(error instanceof Error ? error.message : String(error))
      }

      return {
        code,
        map: null
      }
    },
    buildEnd() {
      // Generate files at the end of build
      try {
        generator.generateFiles(allMethods)
      } catch (error) {
        this.error(error instanceof Error ? error.message : String(error))
      }
    }
  }
}

export default sublimityElectronBridge