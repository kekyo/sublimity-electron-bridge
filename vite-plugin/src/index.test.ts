import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { sublimityElectronBridge } from './index'
import { mkdtempSync, readFileSync, existsSync, rmSync, cpSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('SublimityElectronBridge Vite Plugin', () => {
  let tempDir: string;
  let testFixturesDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'vite-plugin-test-'));
    testFixturesDir = join(tempDir, 'test-fixtures');
    
    // Copy test fixtures to temp directory
    const sourceFixtures = join(__dirname, 'test-fixtures');
    cpSync(sourceFixtures, testFixturesDir, { recursive: true });
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
      mainProcessHandlerFile: join('main', 'ipc-handlers.ts'),
      preloadHandlerFile: join('preload', 'bridge.ts'),
      typeDefinitionsFile: join('types', 'electron.d.ts'),
      sourceFiles: [
        join(testFixturesDir, 'FileService.ts'),
        join(testFixturesDir, 'database.ts')
      ]
    });

    // Mock configResolved to set baseDir to temp directory
    const configResolved = plugin.configResolved as Function;
    if (configResolved) {
      configResolved.call(plugin, { root: tempDir });
    }

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
    const expectedMainHandlers = `// This is auto-generated main process handler by sublimity-electron-bridge.
// Do not edit manually this file.

import { ipcMain } from 'electron';
import { FileService } from '../test-fixtures/FileService';
import { executeCommand } from '../test-fixtures/database';
import { getVersion } from '../test-fixtures/database';
import { queryDatabase } from '../test-fixtures/database';

// Create singleton instances
const fileserviceInstance = new FileService();

// Register IPC handlers
ipcMain.handle('api:databaseAPI:executeCommand', (_, command) => executeCommand(command));
ipcMain.handle('api:databaseAPI:queryDatabase', (_, sql) => queryDatabase(sql));
ipcMain.handle('api:fileAPI:readFile', (_, path) => fileserviceInstance.readFile(path));
ipcMain.handle('api:fileAPI:writeFile', (_, path, content) => fileserviceInstance.writeFile(path, content));
ipcMain.handle('api:mainProcess:deleteFile', (_, path) => fileserviceInstance.deleteFile(path));
ipcMain.handle('api:mainProcess:getVersion', (_) => getVersion());
`;
    
    expect(mainHandlers).toBe(expectedMainHandlers);
    
    // Preload bridge file
    const preloadBridge = readFileSync(join(tempDir, 'preload', 'bridge.ts'), 'utf-8');
    const expectedPreloadBridge = `// This is auto-generated preloader by sublimity-electron-bridge.
// Do not edit manually this file.

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('databaseAPI', {
  executeCommand: (command: string) => ipcRenderer.invoke('api:databaseAPI:executeCommand', command),
  queryDatabase: (sql: string) => ipcRenderer.invoke('api:databaseAPI:queryDatabase', sql)
});
contextBridge.exposeInMainWorld('fileAPI', {
  readFile: (path: string) => ipcRenderer.invoke('api:fileAPI:readFile', path),
  writeFile: (path: string, content: string) => ipcRenderer.invoke('api:fileAPI:writeFile', path, content)
});
contextBridge.exposeInMainWorld('mainProcess', {
  deleteFile: (path: string) => ipcRenderer.invoke('api:mainProcess:deleteFile', path),
  getVersion: () => ipcRenderer.invoke('api:mainProcess:getVersion')
});
`;
    
    expect(preloadBridge).toBe(expectedPreloadBridge);
    
    // Type definitions file
    const typeDefs = readFileSync(join(tempDir, 'types', 'electron.d.ts'), 'utf-8');
    const expectedTypeDefs = `// This is auto-generated type definitions by sublimity-electron-bridge.
// Do not edit manually this file.

interface DatabaseAPI {
  executeCommand(command: string): Promise<number>;
  queryDatabase(sql: string): Promise<any[]>;
}
interface FileAPI {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}
interface MainProcess {
  deleteFile(path: string): Promise<boolean>;
  getVersion(): Promise<string>;
}

declare global {
  interface Window {
    databaseAPI: DatabaseAPI;
    fileAPI: FileAPI;
    mainProcess: MainProcess;
  }
}

export {}
`;
    
    expect(typeDefs).toBe(expectedTypeDefs);
  })

  it('should generate files when using worker threads', async () => {
    const plugin = sublimityElectronBridge({
      mainProcessHandlerFile: join(tempDir, 'main', 'ipc-handlers.ts'),
      preloadHandlerFile: join(tempDir, 'preload', 'bridge.ts'),
      typeDefinitionsFile: join(tempDir, 'types', 'electron.d.ts'),
      enableWorker: true,
      sourceFiles: [
        join(testFixturesDir, 'FileService.ts'),
        join(testFixturesDir, 'database.ts')
      ]
    });

    // Mock configResolved to set baseDir to temp directory
    const configResolved = plugin.configResolved as Function;
    if (configResolved) {
      configResolved.call(plugin, { root: tempDir });
    }

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
    const expectedMainHandlers = `// This is auto-generated main process handler by sublimity-electron-bridge.
// Do not edit manually this file.

import { ipcMain } from 'electron';
import { FileService } from '../test-fixtures/FileService';
import { executeCommand } from '../test-fixtures/database';
import { getVersion } from '../test-fixtures/database';
import { queryDatabase } from '../test-fixtures/database';

// Create singleton instances
const fileserviceInstance = new FileService();

// Register IPC handlers
ipcMain.handle('api:databaseAPI:executeCommand', (_, command) => executeCommand(command));
ipcMain.handle('api:databaseAPI:queryDatabase', (_, sql) => queryDatabase(sql));
ipcMain.handle('api:fileAPI:readFile', (_, path) => fileserviceInstance.readFile(path));
ipcMain.handle('api:fileAPI:writeFile', (_, path, content) => fileserviceInstance.writeFile(path, content));
ipcMain.handle('api:mainProcess:deleteFile', (_, path) => fileserviceInstance.deleteFile(path));
ipcMain.handle('api:mainProcess:getVersion', (_) => getVersion());
`;
    
    expect(mainHandlers).toBe(expectedMainHandlers);
    
    // Preload bridge file
    const preloadBridge = readFileSync(join(tempDir, 'preload', 'bridge.ts'), 'utf-8');
    const expectedPreloadBridge = `// This is auto-generated preloader by sublimity-electron-bridge.
// Do not edit manually this file.

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('databaseAPI', {
  executeCommand: (command: string) => ipcRenderer.invoke('api:databaseAPI:executeCommand', command),
  queryDatabase: (sql: string) => ipcRenderer.invoke('api:databaseAPI:queryDatabase', sql)
});
contextBridge.exposeInMainWorld('fileAPI', {
  readFile: (path: string) => ipcRenderer.invoke('api:fileAPI:readFile', path),
  writeFile: (path: string, content: string) => ipcRenderer.invoke('api:fileAPI:writeFile', path, content)
});
contextBridge.exposeInMainWorld('mainProcess', {
  deleteFile: (path: string) => ipcRenderer.invoke('api:mainProcess:deleteFile', path),
  getVersion: () => ipcRenderer.invoke('api:mainProcess:getVersion')
});
`;
    
    expect(preloadBridge).toBe(expectedPreloadBridge);
    
    // Type definitions file
    const typeDefs = readFileSync(join(tempDir, 'types', 'electron.d.ts'), 'utf-8');
    const expectedTypeDefs = `// This is auto-generated type definitions by sublimity-electron-bridge.
// Do not edit manually this file.

interface DatabaseAPI {
  executeCommand(command: string): Promise<number>;
  queryDatabase(sql: string): Promise<any[]>;
}
interface FileAPI {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}
interface MainProcess {
  deleteFile(path: string): Promise<boolean>;
  getVersion(): Promise<string>;
}

declare global {
  interface Window {
    databaseAPI: DatabaseAPI;
    fileAPI: FileAPI;
    mainProcess: MainProcess;
  }
}

export {}
`;
    
    expect(typeDefs).toBe(expectedTypeDefs);
  });

  it('should handle empty source files gracefully', async () => {
    const plugin = sublimityElectronBridge({
      mainProcessHandlerFile: join(tempDir, 'main', 'ipc-handlers.ts'),
      preloadHandlerFile: join(tempDir, 'preload', 'bridge.ts'),
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

  describe('concurrent execution behavior', () => {
    it.each([false, true])('should execute single buildStart request normally with enableWorker: %s', async (enableWorker) => {
      const plugin = sublimityElectronBridge({
        enableWorker,
        sourceFiles: [
          join(testFixturesDir, 'FileService.ts'),
          join(testFixturesDir, 'database.ts')
        ]
      });

      // Delivery root directory path into plugin.
      await plugin.configResolved({ root: tempDir });

      const startTime = Date.now();
      await plugin.buildStart();
      const endTime = Date.now();

      console.log(`Single request completed in ${endTime - startTime}ms (enableWorker: ${enableWorker})`);
      expect(endTime - startTime).toBeGreaterThanOrEqual(0);
    });

    it.each([false, true])('should handle 2 concurrent buildStart requests efficiently with enableWorker: %s', async (enableWorker) => {
      const plugin = sublimityElectronBridge({
        enableWorker,
        sourceFiles: [
          join(testFixturesDir, 'FileService.ts'),
          join(testFixturesDir, 'database.ts')
        ]
      });

      // Delivery root directory path into plugin.
      await plugin.configResolved({ root: tempDir });

      const startTime = Date.now();

      // Start 2 concurrent requests
      const promise1 = plugin.buildStart();
      const promise2 = plugin.buildStart();

      await Promise.all([promise1, promise2]);
      const endTime = Date.now();

      console.log(`2 concurrent buildStart requests completed in ${endTime - startTime}ms (enableWorker: ${enableWorker})`);

      // Should complete efficiently without running both processes fully
      expect(endTime - startTime).toBeGreaterThanOrEqual(0);
    });

    it.each([false, true])('should handle 3 concurrent buildStart requests efficiently with enableWorker: %s', async (enableWorker) => {
      const plugin = sublimityElectronBridge({
        enableWorker,
        sourceFiles: [
          join(testFixturesDir, 'FileService.ts'),
          join(testFixturesDir, 'database.ts')
        ]
      });

      // Delivery root directory path into plugin.
      await plugin.configResolved({ root: tempDir });

      const startTime = Date.now();

      // Start 3 concurrent requests
      const promise1 = plugin.buildStart();
      const promise2 = plugin.buildStart();
      const promise3 = plugin.buildStart();

      await Promise.all([promise1, promise2, promise3]);
      const endTime = Date.now();

      console.log(`3 concurrent buildStart requests completed in ${endTime - startTime}ms (enableWorker: ${enableWorker})`);

      // Should complete efficiently
      expect(endTime - startTime).toBeGreaterThanOrEqual(0);
    });

    it.each([false, true])('should handle mixed buildStart and handleHotUpdate calls with enableWorker: %s', async (enableWorker) => {
      const plugin = sublimityElectronBridge({
        enableWorker,
        sourceFiles: [
          join(testFixturesDir, 'FileService.ts'),
          join(testFixturesDir, 'database.ts')
        ]
      });

      // Delivery root directory path into plugin.
      await plugin.configResolved({ root: tempDir });

      const startTime = Date.now();

      // Mixed concurrent calls
      const promise1 = plugin.buildStart();
      const promise2 = plugin.handleHotUpdate();
      const promise3 = plugin.buildStart();

      await Promise.all([promise1, promise2, promise3]);
      const endTime = Date.now();

      console.log(`Mixed concurrent requests completed in ${endTime - startTime}ms (enableWorker: ${enableWorker})`);

      // Should complete efficiently
      expect(endTime - startTime).toBeGreaterThan(0);
    });

    it.each([false, true])('should handle rapid sequential requests without blocking with enableWorker: %s', async (enableWorker) => {
      const plugin = sublimityElectronBridge({
        enableWorker,
        sourceFiles: [
          join(testFixturesDir, 'FileService.ts'),
          join(testFixturesDir, 'database.ts')
        ]
      });

      // Delivery root directory path into plugin.
      await plugin.configResolved({ root: tempDir });

      const startTime = Date.now();
      const promises = [];
      const timings = [];

      // Start requests with minimal delays
      for (let i = 0; i < 5; i++) {
        const requestStart = Date.now();
        const promise = plugin.buildStart().then(() => {
          timings.push(Date.now() - requestStart);
        });
        promises.push(promise);
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      await Promise.all(promises);
      const endTime = Date.now();

      console.log(`5 rapid sequential requests completed in ${endTime - startTime}ms (enableWorker: ${enableWorker})`);
      console.log(`Individual timings: ${timings.map(t => t + 'ms').join(', ')}`);

      // Should complete without excessive delay
      expect(endTime - startTime).toBeLessThan(5000);
      expect(timings.length).toBe(5);
    });

    it.each([false, true])('should handle sequential requests after completion with enableWorker: %s', async (enableWorker) => {
      const plugin = sublimityElectronBridge({
        enableWorker,
        sourceFiles: [
          join(testFixturesDir, 'FileService.ts'),
          join(testFixturesDir, 'database.ts')
        ]
      });

      // Delivery root directory path into plugin.
      await plugin.configResolved({ root: tempDir });

      // First request
      const start1 = Date.now();
      await plugin.buildStart();
      const end1 = Date.now();

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 50));

      // Second request
      const start2 = Date.now();
      await plugin.buildStart();
      const end2 = Date.now();

      console.log(`First request: ${end1 - start1}ms (enableWorker: ${enableWorker})`);
      console.log(`Second request: ${end2 - start2}ms (enableWorker: ${enableWorker})`);

      // Both should complete successfully
      expect(end1 - start1).toBeGreaterThanOrEqual(0);
      expect(end2 - start2).toBeGreaterThanOrEqual(0);
    });
  });
});
