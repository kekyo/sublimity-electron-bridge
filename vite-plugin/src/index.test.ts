import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sublimityElectronBridge } from './index'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('SublimityElectronBridge Vite Plugin', () => {
  let tempDir: string;
  let testFixturesDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'vite-plugin-test-'));
    testFixturesDir = join(__dirname, 'test-fixtures');
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should create plugin with default options', () => {
    const plugin = sublimityElectronBridge();
    
    expect(plugin).toBeDefined();
    expect(plugin.name).toBe('sublimity-electron-bridge');
  });

  it('should generate files when processing source files', async () => {
    const plugin = sublimityElectronBridge({
      outputDirs: {
        main: join(tempDir, 'main'),
        preload: join(tempDir, 'preload')
      },
      typeDefinitionsFile: join(tempDir, 'types', 'electron.d.ts')
    });

    const mockContext = {
      resolve: (id: string) => Promise.resolve({ id }),
      error: (msg: string) => { throw new Error(msg) }
    };

    // Simulate Vite's buildStart hook
    const buildStart = plugin.buildStart as Function;
    if (buildStart) {
      await buildStart.call(mockContext);
    }

    // Verify generated files exist
    expect(existsSync(join(tempDir, 'main', 'ipc-handlers.ts'))).toBe(true);
    expect(existsSync(join(tempDir, 'preload', 'bridge.ts'))).toBe(true);
    expect(existsSync(join(tempDir, 'types', 'electron.d.ts'))).toBe(true);

    // Verify complete content of generated files
    
    // Main handlers file (based on actual output order)
    const mainHandlers = readFileSync(join(tempDir, 'main', 'ipc-handlers.ts'), 'utf-8');
    const expectedMainHandlers = `import { ipcMain } from 'electron'
import { FileService } from '${testFixturesDir}/FileService'
import { executeCommand } from '${testFixturesDir}/database'
import { getVersion } from '${testFixturesDir}/database'
import { queryDatabase } from '${testFixturesDir}/database'

// Create singleton instances
const fileserviceInstance = new FileService()

// Register IPC handlers
ipcMain.handle('api:databaseAPI:executeCommand', (event, command) => executeCommand(command))
ipcMain.handle('api:databaseAPI:queryDatabase', (event, sql) => queryDatabase(sql))
ipcMain.handle('api:electronAPI:deleteFile', (event, path) => fileserviceInstance.deleteFile(path))
ipcMain.handle('api:electronAPI:getVersion', (event) => getVersion())
ipcMain.handle('api:fileAPI:readFile', (event, path) => fileserviceInstance.readFile(path))
ipcMain.handle('api:fileAPI:writeFile', (event, path, content) => fileserviceInstance.writeFile(path, content))`;
    
    expect(mainHandlers).toBe(expectedMainHandlers);
    
    // Preload bridge file
    const preloadBridge = readFileSync(join(tempDir, 'preload', 'bridge.ts'), 'utf-8');
    const expectedPreloadBridge = `import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('databaseAPI', {
  executeCommand: (command: string) => ipcRenderer.invoke('api:databaseAPI:executeCommand', command),
  queryDatabase: (sql: string) => ipcRenderer.invoke('api:databaseAPI:queryDatabase', sql)
})
contextBridge.exposeInMainWorld('electronAPI', {
  deleteFile: (path: string) => ipcRenderer.invoke('api:electronAPI:deleteFile', path),
  getVersion: () => ipcRenderer.invoke('api:electronAPI:getVersion')
})
contextBridge.exposeInMainWorld('fileAPI', {
  readFile: (path: string) => ipcRenderer.invoke('api:fileAPI:readFile', path),
  writeFile: (path: string, content: string) => ipcRenderer.invoke('api:fileAPI:writeFile', path, content)
})`;
    
    expect(preloadBridge).toBe(expectedPreloadBridge);
    
    // Type definitions file
    const typeDefs = readFileSync(join(tempDir, 'types', 'electron.d.ts'), 'utf-8');
    const expectedTypeDefs = `interface DatabaseAPI {
  executeCommand(command: string): Promise<number>
  queryDatabase(sql: string): Promise<any[]>
}
interface ElectronAPI {
  deleteFile(path: string): Promise<boolean>
  getVersion(): Promise<string>
}
interface FileAPI {
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
}

declare global {
  interface Window {
    databaseAPI: DatabaseAPI
    electronAPI: ElectronAPI
    fileAPI: FileAPI
  }
}

export {}`;
    
    expect(typeDefs).toBe(expectedTypeDefs);
  })

  it('should generate files when using worker threads', async () => {
    const plugin = sublimityElectronBridge({
      outputDirs: {
        main: join(tempDir, 'main'),
        preload: join(tempDir, 'preload')
      },
      typeDefinitionsFile: join(tempDir, 'types', 'electron.d.ts'),
      enableWorker: true
    });

    const mockContext = {
      resolve: (id: string) => Promise.resolve({ id }),
      error: (msg: string) => { throw new Error(msg) }
    };

    // Simulate Vite's buildStart hook
    const buildStart = plugin.buildStart as Function;
    if (buildStart) {
      await buildStart.call(mockContext);
    }

    // Verify generated files exist
    expect(existsSync(join(tempDir, 'main', 'ipc-handlers.ts'))).toBe(true);
    expect(existsSync(join(tempDir, 'preload', 'bridge.ts'))).toBe(true);
    expect(existsSync(join(tempDir, 'types', 'electron.d.ts'))).toBe(true);

    // Verify complete content of generated files (should be identical to direct processing)
    
    // Main handlers file
    const mainHandlers = readFileSync(join(tempDir, 'main', 'ipc-handlers.ts'), 'utf-8');
    const expectedMainHandlers = `import { ipcMain } from 'electron'
import { FileService } from '${testFixturesDir}/FileService'
import { executeCommand } from '${testFixturesDir}/database'
import { getVersion } from '${testFixturesDir}/database'
import { queryDatabase } from '${testFixturesDir}/database'

// Create singleton instances
const fileserviceInstance = new FileService()

// Register IPC handlers
ipcMain.handle('api:databaseAPI:executeCommand', (event, command) => executeCommand(command))
ipcMain.handle('api:databaseAPI:queryDatabase', (event, sql) => queryDatabase(sql))
ipcMain.handle('api:electronAPI:deleteFile', (event, path) => fileserviceInstance.deleteFile(path))
ipcMain.handle('api:electronAPI:getVersion', (event) => getVersion())
ipcMain.handle('api:fileAPI:readFile', (event, path) => fileserviceInstance.readFile(path))
ipcMain.handle('api:fileAPI:writeFile', (event, path, content) => fileserviceInstance.writeFile(path, content))`;
    
    expect(mainHandlers).toBe(expectedMainHandlers);
    
    // Preload bridge file
    const preloadBridge = readFileSync(join(tempDir, 'preload', 'bridge.ts'), 'utf-8');
    const expectedPreloadBridge = `import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('databaseAPI', {
  executeCommand: (command: string) => ipcRenderer.invoke('api:databaseAPI:executeCommand', command),
  queryDatabase: (sql: string) => ipcRenderer.invoke('api:databaseAPI:queryDatabase', sql)
})
contextBridge.exposeInMainWorld('electronAPI', {
  deleteFile: (path: string) => ipcRenderer.invoke('api:electronAPI:deleteFile', path),
  getVersion: () => ipcRenderer.invoke('api:electronAPI:getVersion')
})
contextBridge.exposeInMainWorld('fileAPI', {
  readFile: (path: string) => ipcRenderer.invoke('api:fileAPI:readFile', path),
  writeFile: (path: string, content: string) => ipcRenderer.invoke('api:fileAPI:writeFile', path, content)
})`;
    
    expect(preloadBridge).toBe(expectedPreloadBridge);
    
    // Type definitions file
    const typeDefs = readFileSync(join(tempDir, 'types', 'electron.d.ts'), 'utf-8');
    const expectedTypeDefs = `interface DatabaseAPI {
  executeCommand(command: string): Promise<number>
  queryDatabase(sql: string): Promise<any[]>
}
interface ElectronAPI {
  deleteFile(path: string): Promise<boolean>
  getVersion(): Promise<string>
}
interface FileAPI {
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
}

declare global {
  interface Window {
    databaseAPI: DatabaseAPI
    electronAPI: ElectronAPI
    fileAPI: FileAPI
  }
}

export {}`;
    
    expect(typeDefs).toBe(expectedTypeDefs);
  });

  it('should handle empty source files gracefully', async () => {
    const plugin = sublimityElectronBridge({
      outputDirs: {
        main: join(tempDir, 'main'),
        preload: join(tempDir, 'preload')
      },
      typeDefinitionsFile: join(tempDir, 'types', 'electron.d.ts')
    });

    const mockContext = {
      resolve: (id: string) => Promise.resolve({ id }),
      error: (msg: string) => { throw new Error(msg) }
    };

    const transform = plugin.transform as Function;
    if (transform) {
      const result = await transform.call(mockContext, 'export const dummy = true;', 'dummy.ts');
      
      // Should return the code with map since it's a valid transform
      expect(result).toEqual({
        code: 'export const dummy = true;',
        map: null
      });
    }
  });
});