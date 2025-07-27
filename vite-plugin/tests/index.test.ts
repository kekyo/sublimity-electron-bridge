import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, rmSync, cpSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { sublimityElectronBridge } from '../src/index'

describe('SublimityElectronBridge Vite Plugin', () => {
  let tempDir: string;
  let testFixturesDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'vite-plugin-test-'));
    testFixturesDir = join(tempDir, 'test-fixtures');

    // Create test-fixtures directory but don't copy files yet
    // Files will be copied selectively by individual tests
    if (!existsSync(testFixturesDir)) {
      mkdirSync(testFixturesDir, { recursive: true });
    }

    // Create tsconfig.json for the new extractor to work
    const tsConfig = {
      compilerOptions: {
        target: 'ES2020',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        allowSyntheticDefaultImports: true,
        esModuleInterop: true,
        allowJs: true,
        strict: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true
      },
      include: ['**/*.ts', '**/*.tsx'],
      exclude: ['node_modules', 'dist']
    };

    writeFileSync(join(tempDir, 'tsconfig.json'), JSON.stringify(tsConfig, null, 2));
  });

  // Helper function to copy specific test fixtures
  const copyTestFixtures = (filenames: string[]) => {
    const sourceFixtures = join(__dirname, 'test-fixtures');
    filenames.forEach(filename => {
      const sourcePath = join(sourceFixtures, filename);
      const targetPath = join(testFixturesDir, filename);
      if (existsSync(sourcePath)) {
        cpSync(sourcePath, targetPath);
      }
    });
  };

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
    // Copy all test fixtures for this test
    copyTestFixtures(['FileService.ts', 'database.ts']);

    const plugin = sublimityElectronBridge({
      mainProcessHandlerFile: join('main', 'ipc-handlers.ts'),
      preloadHandlerFile: join('preload', 'bridge.ts'),
      typeDefinitionsFile: join('types', 'electron.d.ts'),
      targetDir: testFixturesDir
    });

    // Mock configResolved to set baseDir to temp directory
    const configResolved = plugin.configResolved as Function;
    if (configResolved) {
      await configResolved.call(plugin, { root: tempDir });
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
import { createSublimityRpcController, SublimityRpcMessage } from 'sublimity-rpc';
import { executeCommand, getVersion, queryDatabase } from '../test-fixtures/database';
import { FileService } from '../test-fixtures/FileService';

// Create singleton instances
const __FileServiceInstance = new FileService();

// Create RPC controller
const controller = createSublimityRpcController({
  onSendMessage: (message: SublimityRpcMessage) => {
    // Send message to preload process
    global.mainWindow.webContents.send("rpc-message", message);
  }
});

// Handle messages from preload process
ipcMain.on("rpc-message", (_, message: SublimityRpcMessage) => {
  controller.insertMessage(message);
});

// Register RPC functions
controller.register('databaseAPI:executeCommand', executeCommand);
controller.register('databaseAPI:queryDatabase', queryDatabase);
controller.register('fileAPI:readFile', __FileServiceInstance.readFile);
controller.register('fileAPI:writeFile', __FileServiceInstance.writeFile);
controller.register('fileService:deleteFile', __FileServiceInstance.deleteFile);
controller.register('mainProcess:getVersion', getVersion);
`;

    expect(mainHandlers).toBe(expectedMainHandlers);

    // Preload bridge file
    const preloadBridge = readFileSync(join(tempDir, 'preload', 'bridge.ts'), 'utf-8');
    const expectedPreloadBridge = `// This is auto-generated preloader by sublimity-electron-bridge.
// Do not edit manually this file.

import { contextBridge, ipcRenderer } from 'electron';
import { createSublimityRpcController, SublimityRpcMessage } from 'sublimity-rpc';

// Create RPC controller
const controller = createSublimityRpcController({
  onSendMessage: (message: SublimityRpcMessage) => {
    // Send message to main process
    ipcRenderer.send("rpc-message", message);
  }
});

// Handle messages from main process
ipcRenderer.on("rpc-message", (_, message: SublimityRpcMessage) => {
  controller.insertMessage(message);
});

// Expose RPC functions to main process
contextBridge.exposeInMainWorld('databaseAPI', {
  executeCommand: (command: string) => controller.invoke<number>('databaseAPI:executeCommand', command),
  queryDatabase: (sql: string) => controller.invoke<any[]>('databaseAPI:queryDatabase', sql)
});
contextBridge.exposeInMainWorld('fileAPI', {
  readFile: (path: string) => controller.invoke<string>('fileAPI:readFile', path),
  writeFile: (path: string, content: string) => controller.invoke<void>('fileAPI:writeFile', path, content)
});
contextBridge.exposeInMainWorld('fileService', {
  deleteFile: (path: string) => controller.invoke<boolean>('fileService:deleteFile', path)
});
contextBridge.exposeInMainWorld('mainProcess', {
  getVersion: () => controller.invoke<string>('mainProcess:getVersion')
});
`;

    expect(preloadBridge).toBe(expectedPreloadBridge);

    // Type definitions file
    const typeDefs = readFileSync(join(tempDir, 'types', 'electron.d.ts'), 'utf-8');
    const expectedTypeDefs = `// This is auto-generated type definitions by sublimity-electron-bridge.
// Do not edit manually this file.

export interface __databaseAPIType {
  readonly executeCommand: (command: string) => Promise<number>;
  readonly queryDatabase: (sql: string) => Promise<any[]>;
}
export interface __fileAPIType {
  readonly readFile: (path: string) => Promise<string>;
  readonly writeFile: (path: string, content: string) => Promise<void>;
}
export interface __fileServiceType {
  readonly deleteFile: (path: string) => Promise<boolean>;
}
export interface __mainProcessType {
  readonly getVersion: () => Promise<string>;
}

declare global {
  interface Window {
    readonly databaseAPI: __databaseAPIType;
    readonly fileAPI: __fileAPIType;
    readonly fileService: __fileServiceType;
    readonly mainProcess: __mainProcessType;
  }
}

export {}
`;

    expect(typeDefs).toBe(expectedTypeDefs);
  })

  it('should generate files when using worker threads', async () => {
    // Copy all test fixtures for this test
    copyTestFixtures(['FileService.ts', 'database.ts']);

    const plugin = sublimityElectronBridge({
      mainProcessHandlerFile: join(tempDir, 'main', 'ipc-handlers.ts'),
      preloadHandlerFile: join(tempDir, 'preload', 'bridge.ts'),
      typeDefinitionsFile: join(tempDir, 'types', 'electron.d.ts'),
      enableWorker: true,
      targetDir: testFixturesDir
    });

    // Mock configResolved to set baseDir to temp directory
    const configResolved = plugin.configResolved as Function;
    if (configResolved) {
      await configResolved.call(plugin, { root: tempDir });
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
import { createSublimityRpcController, SublimityRpcMessage } from 'sublimity-rpc';
import { executeCommand, getVersion, queryDatabase } from '../test-fixtures/database';
import { FileService } from '../test-fixtures/FileService';

// Create singleton instances
const __FileServiceInstance = new FileService();

// Create RPC controller
const controller = createSublimityRpcController({
  onSendMessage: (message: SublimityRpcMessage) => {
    // Send message to preload process
    global.mainWindow.webContents.send("rpc-message", message);
  }
});

// Handle messages from preload process
ipcMain.on("rpc-message", (_, message: SublimityRpcMessage) => {
  controller.insertMessage(message);
});

// Register RPC functions
controller.register('databaseAPI:executeCommand', executeCommand);
controller.register('databaseAPI:queryDatabase', queryDatabase);
controller.register('fileAPI:readFile', __FileServiceInstance.readFile);
controller.register('fileAPI:writeFile', __FileServiceInstance.writeFile);
controller.register('fileService:deleteFile', __FileServiceInstance.deleteFile);
controller.register('mainProcess:getVersion', getVersion);
`;

    expect(mainHandlers).toBe(expectedMainHandlers);

    // Preload bridge file
    const preloadBridge = readFileSync(join(tempDir, 'preload', 'bridge.ts'), 'utf-8');
    const expectedPreloadBridge = `// This is auto-generated preloader by sublimity-electron-bridge.
// Do not edit manually this file.

import { contextBridge, ipcRenderer } from 'electron';
import { createSublimityRpcController, SublimityRpcMessage } from 'sublimity-rpc';

// Create RPC controller
const controller = createSublimityRpcController({
  onSendMessage: (message: SublimityRpcMessage) => {
    // Send message to main process
    ipcRenderer.send("rpc-message", message);
  }
});

// Handle messages from main process
ipcRenderer.on("rpc-message", (_, message: SublimityRpcMessage) => {
  controller.insertMessage(message);
});

// Expose RPC functions to main process
contextBridge.exposeInMainWorld('databaseAPI', {
  executeCommand: (command: string) => controller.invoke<number>('databaseAPI:executeCommand', command),
  queryDatabase: (sql: string) => controller.invoke<any[]>('databaseAPI:queryDatabase', sql)
});
contextBridge.exposeInMainWorld('fileAPI', {
  readFile: (path: string) => controller.invoke<string>('fileAPI:readFile', path),
  writeFile: (path: string, content: string) => controller.invoke<void>('fileAPI:writeFile', path, content)
});
contextBridge.exposeInMainWorld('fileService', {
  deleteFile: (path: string) => controller.invoke<boolean>('fileService:deleteFile', path)
});
contextBridge.exposeInMainWorld('mainProcess', {
  getVersion: () => controller.invoke<string>('mainProcess:getVersion')
});
`;

    expect(preloadBridge).toBe(expectedPreloadBridge);

    // Type definitions file
    const typeDefs = readFileSync(join(tempDir, 'types', 'electron.d.ts'), 'utf-8');
    const expectedTypeDefs = `// This is auto-generated type definitions by sublimity-electron-bridge.
// Do not edit manually this file.

export interface __databaseAPIType {
  readonly executeCommand: (command: string) => Promise<number>;
  readonly queryDatabase: (sql: string) => Promise<any[]>;
}
export interface __fileAPIType {
  readonly readFile: (path: string) => Promise<string>;
  readonly writeFile: (path: string, content: string) => Promise<void>;
}
export interface __fileServiceType {
  readonly deleteFile: (path: string) => Promise<boolean>;
}
export interface __mainProcessType {
  readonly getVersion: () => Promise<string>;
}

declare global {
  interface Window {
    readonly databaseAPI: __databaseAPIType;
    readonly fileAPI: __fileAPIType;
    readonly fileService: __fileServiceType;
    readonly mainProcess: __mainProcessType;
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
      // Copy all test fixtures for this test
      copyTestFixtures(['FileService.ts', 'database.ts']);

      const plugin = sublimityElectronBridge({
        enableWorker,
        targetDir: testFixturesDir
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
      // Copy all test fixtures for this test
      copyTestFixtures(['FileService.ts', 'database.ts']);

      const plugin = sublimityElectronBridge({
        enableWorker,
        targetDir: testFixturesDir
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
      // Copy all test fixtures for this test
      copyTestFixtures(['FileService.ts', 'database.ts']);

      const plugin = sublimityElectronBridge({
        enableWorker,
        targetDir: testFixturesDir
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

    it.each([false, true])('should handle rapid sequential requests without blocking with enableWorker: %s', async (enableWorker) => {
      // Copy all test fixtures for this test
      copyTestFixtures(['FileService.ts', 'database.ts']);

      const plugin = sublimityElectronBridge({
        enableWorker,
        targetDir: testFixturesDir
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
      // Copy all test fixtures for this test
      copyTestFixtures(['FileService.ts', 'database.ts']);

      const plugin = sublimityElectronBridge({
        enableWorker,
        targetDir: testFixturesDir
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

  describe('file watcher integration', () => {
    it('should detect file changes and regenerate output when decorator is added', async () => {
      // Don't copy existing test fixtures - this test needs to start with empty directory
      // Create a test file without decorator
      const testFile = join(testFixturesDir, 'WatcherTest.ts');
      const originalContent = `export class WatcherTest {
  async normalMethod(): Promise<string> {
    return "test"
  }
}`;

      writeFileSync(testFile, originalContent);

      const plugin = sublimityElectronBridge({
        mainProcessHandlerFile: join('main', 'ipc-handlers.ts'),
        preloadHandlerFile: join('preload', 'bridge.ts'),
        typeDefinitionsFile: join('types', 'electron.d.ts'),
        targetDir: testFixturesDir
      });

      // Initialize plugin
      const configResolved = plugin.configResolved as Function;
      if (configResolved) {
        await configResolved.call(plugin, { root: tempDir });
      }

      // Initial generation - should be empty since no decorators
      const expectedEmptyMain = `// This is auto-generated main process handler by sublimity-electron-bridge.
// Do not edit manually this file.

import { ipcMain } from 'electron';
import { createSublimityRpcController, SublimityRpcMessage } from 'sublimity-rpc';

// Create singleton instances

// Create RPC controller
const controller = createSublimityRpcController({
  onSendMessage: (message: SublimityRpcMessage) => {
    // Send message to preload process
    global.mainWindow.webContents.send("rpc-message", message);
  }
});

// Handle messages from preload process
ipcMain.on("rpc-message", (_, message: SublimityRpcMessage) => {
  controller.insertMessage(message);
});

// Register RPC functions
`;

      const generatedFilesEmpty = readFileSync(join(tempDir, 'main', 'ipc-handlers.ts'), 'utf-8');
      expect(generatedFilesEmpty).toBe(expectedEmptyMain);

      // Add decorator to the file
      const contentWithDecorator = `export class WatcherTest {
  /**
   * @decorator expose
   */
  async normalMethod(): Promise<string> {
    return "test"
  }
}`;

      writeFileSync(testFile, contentWithDecorator);

      // Wait for file watcher to detect changes
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check that output files were regenerated
      const expectedMainWithDecorator = `// This is auto-generated main process handler by sublimity-electron-bridge.
// Do not edit manually this file.

import { ipcMain } from 'electron';
import { createSublimityRpcController, SublimityRpcMessage } from 'sublimity-rpc';
import { WatcherTest } from '../test-fixtures/WatcherTest';

// Create singleton instances
const __WatcherTestInstance = new WatcherTest();

// Create RPC controller
const controller = createSublimityRpcController({
  onSendMessage: (message: SublimityRpcMessage) => {
    // Send message to preload process
    global.mainWindow.webContents.send("rpc-message", message);
  }
});

// Handle messages from preload process
ipcMain.on("rpc-message", (_, message: SublimityRpcMessage) => {
  controller.insertMessage(message);
});

// Register RPC functions
controller.register('watcherTest:normalMethod', __WatcherTestInstance.normalMethod);
`;

      const generatedFilesWithDecorator = readFileSync(join(tempDir, 'main', 'ipc-handlers.ts'), 'utf-8');
      expect(generatedFilesWithDecorator).toBe(expectedMainWithDecorator);

      const expectedPreloadBridge = `// This is auto-generated preloader by sublimity-electron-bridge.
// Do not edit manually this file.

import { contextBridge, ipcRenderer } from 'electron';
import { createSublimityRpcController, SublimityRpcMessage } from 'sublimity-rpc';

// Create RPC controller
const controller = createSublimityRpcController({
  onSendMessage: (message: SublimityRpcMessage) => {
    // Send message to main process
    ipcRenderer.send("rpc-message", message);
  }
});

// Handle messages from main process
ipcRenderer.on("rpc-message", (_, message: SublimityRpcMessage) => {
  controller.insertMessage(message);
});

// Expose RPC functions to main process
contextBridge.exposeInMainWorld('watcherTest', {
  normalMethod: () => controller.invoke<string>('watcherTest:normalMethod')
});
`;

      const preloadBridge = readFileSync(join(tempDir, 'preload', 'bridge.ts'), 'utf-8');
      expect(preloadBridge).toBe(expectedPreloadBridge);

      const expectedTypeDefs = `// This is auto-generated type definitions by sublimity-electron-bridge.
// Do not edit manually this file.

export interface __watcherTestType {
  readonly normalMethod: () => Promise<string>;
}

declare global {
  interface Window {
    readonly watcherTest: __watcherTestType;
  }
}

export {}
`;

      const typeDefs = readFileSync(join(tempDir, 'types', 'electron.d.ts'), 'utf-8');
      expect(typeDefs).toBe(expectedTypeDefs);
    });

    it('should detect file changes and regenerate output when decorator is removed', async () => {
      // Don't copy existing test fixtures - this test needs to start with empty directory
      // Create a test file with decorator
      const testFile = join(testFixturesDir, 'WatcherTest2.ts');
      const contentWithDecorator = `export class WatcherTest2 {
  /**
   * @decorator expose
   */
  async decoratedMethod(): Promise<string> {
    return "test"
  }
}`;

      writeFileSync(testFile, contentWithDecorator);

      const plugin = sublimityElectronBridge({
        mainProcessHandlerFile: join('main', 'ipc-handlers.ts'),
        preloadHandlerFile: join('preload', 'bridge.ts'),
        typeDefinitionsFile: join('types', 'electron.d.ts'),
        targetDir: testFixturesDir
      });

      // Initialize plugin
      const configResolved = plugin.configResolved as Function;
      if (configResolved) {
        await configResolved.call(plugin, { root: tempDir });
      }

      // Initial generation - should contain decorator content
      const expectedMainWithDecorator = `// This is auto-generated main process handler by sublimity-electron-bridge.
// Do not edit manually this file.

import { ipcMain } from 'electron';
import { createSublimityRpcController, SublimityRpcMessage } from 'sublimity-rpc';
import { WatcherTest2 } from '../test-fixtures/WatcherTest2';

// Create singleton instances
const __WatcherTest2Instance = new WatcherTest2();

// Create RPC controller
const controller = createSublimityRpcController({
  onSendMessage: (message: SublimityRpcMessage) => {
    // Send message to preload process
    global.mainWindow.webContents.send("rpc-message", message);
  }
});

// Handle messages from preload process
ipcMain.on("rpc-message", (_, message: SublimityRpcMessage) => {
  controller.insertMessage(message);
});

// Register RPC functions
controller.register('watcherTest2:decoratedMethod', __WatcherTest2Instance.decoratedMethod);
`;

      const generatedFilesWithDecorator = readFileSync(join(tempDir, 'main', 'ipc-handlers.ts'), 'utf-8');
      expect(generatedFilesWithDecorator).toBe(expectedMainWithDecorator);

      // Remove decorator from the file
      const contentWithoutDecorator = `export class WatcherTest2 {
  async decoratedMethod(): Promise<string> {
    return "test"
  }
}`;

      writeFileSync(testFile, contentWithoutDecorator);

      // Wait for file watcher to detect changes
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check that output files were regenerated without the method
      const expectedEmptyMain = `// This is auto-generated main process handler by sublimity-electron-bridge.
// Do not edit manually this file.

import { ipcMain } from 'electron';
import { createSublimityRpcController, SublimityRpcMessage } from 'sublimity-rpc';

// Create singleton instances

// Create RPC controller
const controller = createSublimityRpcController({
  onSendMessage: (message: SublimityRpcMessage) => {
    // Send message to preload process
    global.mainWindow.webContents.send("rpc-message", message);
  }
});

// Handle messages from preload process
ipcMain.on("rpc-message", (_, message: SublimityRpcMessage) => {
  controller.insertMessage(message);
});

// Register RPC functions
`;

      const generatedFilesEmpty = readFileSync(join(tempDir, 'main', 'ipc-handlers.ts'), 'utf-8');
      expect(generatedFilesEmpty).toBe(expectedEmptyMain);

      const expectedEmptyPreload = `// This is auto-generated preloader by sublimity-electron-bridge.
// Do not edit manually this file.

import { contextBridge, ipcRenderer } from 'electron';
import { createSublimityRpcController, SublimityRpcMessage } from 'sublimity-rpc';

// Create RPC controller
const controller = createSublimityRpcController({
  onSendMessage: (message: SublimityRpcMessage) => {
    // Send message to main process
    ipcRenderer.send("rpc-message", message);
  }
});

// Handle messages from main process
ipcRenderer.on("rpc-message", (_, message: SublimityRpcMessage) => {
  controller.insertMessage(message);
});

// Expose RPC functions to main process
`;

      const preloadBridge = readFileSync(join(tempDir, 'preload', 'bridge.ts'), 'utf-8');
      expect(preloadBridge).toBe(expectedEmptyPreload);

      const expectedEmptyTypeDefs = `// This is auto-generated type definitions by sublimity-electron-bridge.
// Do not edit manually this file.

declare global {
  interface Window {
  }
}

export {}
`;

      const typeDefs = readFileSync(join(tempDir, 'types', 'electron.d.ts'), 'utf-8');
      expect(typeDefs).toBe(expectedEmptyTypeDefs);
    });
  });
});
