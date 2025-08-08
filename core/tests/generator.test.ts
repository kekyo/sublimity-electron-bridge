import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import dayjs from 'dayjs';
import { createElectronBridgeGenerator } from '../src/index';
import { isCamelCase, toPascalCase } from '../src/generator';
import { extractFunctions, loadTsConfig } from '../src/extractor';
import { createConsoleLogger } from '../src/logger';

describe('generator function', () => {
  const logger = createConsoleLogger('generator-test');
  const testOutputBaseDir = join(tmpdir(), 'seb-test/core/generator', dayjs().format('YYYYMMDD_HHmmssSSS'));
  let testOutputDir;
  let tsConfigFile;

  beforeEach(fn => {
    // Create unique temporary directory for each test
    testOutputDir = join(testOutputBaseDir, fn.task.name);
    mkdirSync(testOutputDir, { recursive: true });
    console.info(`Test output directory: ${testOutputDir}`);
  });

  // Helper function to create test files
  const createTestFiles = (baseDir: string, files: { path: string; content: string }[]) => {
    // Create base directory if it doesn't exist
    if (!existsSync(baseDir)) {
      mkdirSync(baseDir, { recursive: true });
    }

    // Create tsconfig.json
    const tsconfig = {
      compilerOptions: {
        target: "ES2020",
        module: "ESNext",
        moduleResolution: "node",
        strict: true,
        declaration: true,
        outDir: "./dist",
        rootDir: "./src"
        },
      include: ["src/**/*"],
      exclude: ["node_modules", "dist"]
    };

    tsConfigFile = join(baseDir, 'tsconfig.json');
    writeFileSync(tsConfigFile, JSON.stringify(tsconfig, null, 2));

    // Create test files
    files.forEach(file => {
      const filePath = join(baseDir, file.path);
      const dir = resolve(filePath, '..');

      // Create directory if it doesn't exist
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      writeFileSync(filePath, file.content);
    });
  };

  describe('ElectronBridgeGenerator', () => {
    it('should create generator with default options', () => {
      const generator = createElectronBridgeGenerator({
        baseDir: testOutputDir,
        mainProcessHandlerFile: join(testOutputDir, 'default-main', 'ipc-handlers.ts'),
        preloadHandlerFile: join(testOutputDir, 'default-preload', 'bridge.ts'),
        typeDefinitionsFile: join(testOutputDir, 'default-types.d.ts')
      });

      expect(generator).toBeDefined();
    });

    it('should accept custom options', () => {
      const options = {
        baseDir: testOutputDir,
        mainProcessHandlerFile: 'custom-main/ipc-handlers.ts',
        preloadHandlerFile: 'custom-preload/bridge.ts',
        typeDefinitionsFile: 'custom-types/electron.d.ts',
        defaultNamespace: 'customAPI'
      };

      const generator = createElectronBridgeGenerator(options);
      expect(generator).toBeDefined();
    });
  });

  describe('Utility Functions', () => {
    it('should validate camelCase correctly', () => {
      expect(isCamelCase('fileAPI')).toBe(true);
      expect(isCamelCase('electronAPI')).toBe(true);
      expect(isCamelCase('FileAPI')).toBe(false);
      expect(isCamelCase('file_api')).toBe(false);
    });

    it('should convert to PascalCase correctly', () => {
      expect(toPascalCase('fileAPI')).toBe('FileAPI');
      expect(toPascalCase('electronAPI')).toBe('ElectronAPI');
      expect(toPascalCase('userManager')).toBe('UserManager');
    });
  });

  describe('generateFiles', () => {
    it('should generate all three output files', async () => {
      const testBaseDir = join(testOutputDir, 'test-base');
      const mainFile = join(testOutputDir, 'main', 'ipc-handlers.ts');
      const preloadFile = join(testOutputDir, 'preload', 'bridge.ts');
      const typeDefFile = join(testOutputDir, 'types', 'electron-api.d.ts');

      // Create test files
      createTestFiles(testBaseDir, [
        {
          path: 'src/services/FileService.ts',
          content: `
/**
 * @decorator expose
 */
export class FileService {
  /**
   * @decorator expose
   */
  readFile(path: string): Promise<string> {
    return Promise.resolve('file content');
  }
}
`
        }
      ]);

      const generator = createElectronBridgeGenerator({
        baseDir: testBaseDir,
        mainProcessHandlerFile: mainFile,
        preloadHandlerFile: preloadFile,
        typeDefinitionsFile: typeDefFile,
      });

      const tsConfig = loadTsConfig(tsConfigFile, testBaseDir, logger);
      const functions = extractFunctions(
        tsConfig, testBaseDir,
        [
          join(testBaseDir, 'src/services/FileService.ts')
        ], logger);

      await generator.generateFiles(functions);

      // Check that all files are created
      expect(existsSync(mainFile)).toBe(true);
      expect(existsSync(preloadFile)).toBe(true);
      expect(existsSync(typeDefFile)).toBe(true);
    });

    it('should generate correct main handlers content', async () => {
      const baseDir = join(testOutputDir, 'main-handlers-test');
      const mainFile = join(testOutputDir, 'main-handlers', 'ipc-handlers.ts');
      const preloadFile = join(testOutputDir, 'preload-handlers', 'bridge.ts');
      const typeDefFile = join(testOutputDir, 'main-handlers-types.d.ts');

      // Create test files
      createTestFiles(baseDir, [
        {
          path: 'src/services/FileService.ts',
          content: `
/**
 * @decorator expose
 */
export class FileService {
  /**
   * @decorator expose
   */
  readFile(path: string): Promise<string> {
    return Promise.resolve('file content');
  }
}
`
        },
        {
          path: 'src/utils/version.ts',
          content: `
/**
 * @decorator expose
 */
export function getVersion(): Promise<string> {
  return Promise.resolve('1.0.0');
}
`
        }
      ]);

      const generator = createElectronBridgeGenerator({
        baseDir: baseDir,
        mainProcessHandlerFile: mainFile,
        preloadHandlerFile: preloadFile,
        typeDefinitionsFile: typeDefFile,
      });

      const tsConfig = loadTsConfig(tsConfigFile, baseDir, logger);
      const functions = extractFunctions(
        tsConfig, baseDir,
        [
          join(baseDir, 'src/services/FileService.ts'),
          join(baseDir, 'src/utils/version.ts')
        ], logger);

      await generator.generateFiles(functions);

      const mainContent = readFileSync(mainFile, 'utf8');

      const expectedMainContent = `// This is auto-generated main process handler by sublimity-electron-bridge.
// Do not edit manually this file.

import { app, BrowserWindow, ipcMain } from 'electron';
import { createSublimityRpcController, SublimityRpcController, SublimityRpcMessage } from 'sublimity-rpc';
import { FileService } from '../main-handlers-test/src/services/FileService';
import { getVersion } from '../main-handlers-test/src/utils/version';

// Create singleton instances
const __FileServiceInstance = new FileService();

// Store controllers for each window
const controllers = new Map<number, SublimityRpcController>();

// Setup RPC for each window
const setupWindowRPC = (window: BrowserWindow) => {
  const webContentsId = window.webContents.id;
  
  // Create RPC controller for this window
  const controller = createSublimityRpcController({
    onSendMessage: (message: SublimityRpcMessage) => {
      // Send message to this specific window
      if (!window.isDestroyed()) {
        window.webContents.send("rpc-message", message);
      }
    }
  });
  
  // Store controller
  controllers.set(webContentsId, controller);
  
  // Register RPC functions
  controller.register('fileService:readFile', __FileServiceInstance.readFile);
  controller.register('mainProcess:getVersion', getVersion);
  
  // Cleanup when window is closed
  window.on("closed", () => {
    controllers.delete(webContentsId);
  });
}

// Setup existing windows
app.on("ready", () => {
  BrowserWindow.getAllWindows().forEach(setupWindowRPC);
});

// Setup new windows
app.on("browser-window-created", (_, window) => {
  setupWindowRPC(window);
});

// Handle messages from preload process with Synchronous RPC mode
ipcMain.handle("rpc-message", async (event, message: SublimityRpcMessage): Promise<SublimityRpcMessage> => {
  const controller = controllers.get(event.sender.id);
  if (controller) {
    const response = await controller.insertMessageWaitable(message);
    return response;
  }
  throw new Error(\`Controller not found for webContents \${event.sender.id}\`);
});

// Legacy support: If global.mainWindow exists, set it up
if (typeof global !== "undefined" && global.mainWindow) {
  setupWindowRPC(global.mainWindow);
}
`;

      expect(mainContent).toBe(expectedMainContent);
    });

    it('should generate correct preload bridge content', async () => {
      const baseDir = join(testOutputDir, 'preload-bridge-test');
      const mainFile = join(testOutputDir, 'main-bridge', 'ipc-handlers.ts');
      const preloadFile = join(testOutputDir, 'preload-bridge', 'bridge.ts');
      const typeDefFile = join(testOutputDir, 'preload-bridge-types.d.ts');

      // Create test files
      createTestFiles(baseDir, [
        {
          path: 'src/services/FileService.ts',
          content: `
/**
 * @decorator expose
 */
export class FileService {
  /**
   * @decorator expose
   */
  readFile(path: string): Promise<string> {
    return Promise.resolve('file content');
  }
}
`
        },
        {
          path: 'src/utils/version.ts',
          content: `
/**
 * @decorator expose
 */
export function getVersion(): Promise<string> {
  return Promise.resolve('1.0.0');
}
`
        }
      ]);

      const generator = createElectronBridgeGenerator({
        baseDir: baseDir,
        mainProcessHandlerFile: mainFile,
        preloadHandlerFile: preloadFile,
        typeDefinitionsFile: typeDefFile,
      });

      const tsConfig = loadTsConfig(tsConfigFile, baseDir, logger);
      const functions = extractFunctions(
        tsConfig, baseDir,
        [
          join(baseDir, 'src/services/FileService.ts'),
          join(baseDir, 'src/utils/version.ts')
        ], logger);

      await generator.generateFiles(functions);

      const preloadContent = readFileSync(preloadFile, 'utf8');

      const expectedPreloadContent = `// This is auto-generated preloader by sublimity-electron-bridge.
// Do not edit manually this file.

import { contextBridge, ipcRenderer } from 'electron';
import { createSublimityRpcController, SublimityRpcMessage } from 'sublimity-rpc';

// Create RPC controller with Synchronous RPC mode
const controller = createSublimityRpcController({
  onSendMessage: async (message: SublimityRpcMessage): Promise<SublimityRpcMessage> => {
    // Send message to main process and get response synchronously
    const response = await ipcRenderer.invoke("rpc-message", message);
    return response;
  }
});

// Expose RPC functions to renderer process
contextBridge.exposeInMainWorld('fileService', {
  readFile: (path: string) => controller.invoke<string>('fileService:readFile', path)
});
contextBridge.exposeInMainWorld('mainProcess', {
  getVersion: () => controller.invoke<string>('mainProcess:getVersion')
});
`;

      expect(preloadContent).toBe(expectedPreloadContent);
    });

    it('should generate correct type definitions content', async () => {
      const baseDir = join(testOutputDir, 'type-definitions-test');
      const mainFile = join(testOutputDir, 'main-types', 'ipc-handlers.ts');
      const preloadFile = join(testOutputDir, 'preload-types', 'bridge.ts');
      const typeDefFile = join(testOutputDir, 'electron-api.d.ts');

      // Create test files
      createTestFiles(baseDir, [
        {
          path: 'src/services/FileService.ts',
          content: `
/**
 * @decorator expose
 */
export class FileService {
  /**
   * @decorator expose
   */
  readFile(path: string): Promise<string> {
    return Promise.resolve('file content');
  }
  
  /**
   * @decorator expose
   */
  writeFile(path: string, content: string): Promise<void> {
    return Promise.resolve();
  }
}
`
        }
      ]);

      const generator = createElectronBridgeGenerator({
        baseDir: baseDir,
        mainProcessHandlerFile: mainFile,
        preloadHandlerFile: preloadFile,
        typeDefinitionsFile: typeDefFile,
      });

      const tsConfig = loadTsConfig(tsConfigFile, baseDir, logger);
      const functions = extractFunctions(
        tsConfig, baseDir,
        [
          join(baseDir, 'src/services/FileService.ts')
        ], logger);

      await generator.generateFiles(functions);

      const typeContent = readFileSync(typeDefFile, 'utf8');

      const expectedTypeContent = `// This is auto-generated type definitions by sublimity-electron-bridge.
// Do not edit manually this file.

export interface __fileServiceType {
  readonly readFile: (path: string) => Promise<string>;
  readonly writeFile: (path: string, content: string) => Promise<void>;
}

declare global {
  interface Window {
    readonly fileService: __fileServiceType;
  }
}

export {}
`;

      expect(typeContent).toBe(expectedTypeContent);
    });

    it('should handle relative paths when baseDir is specified', async () => {
      const baseDir = join(testOutputDir, 'relative-test');
      const mainFile = join(testOutputDir, 'main-relative', 'ipc-handlers.ts');
      const preloadFile = join(testOutputDir, 'preload-relative', 'bridge.ts');
      const typeDefFile = join(testOutputDir, 'relative-types.d.ts');

      // Create test files in the base directory
      createTestFiles(baseDir, [
        {
          path: 'src/services/FileService.ts',
          content: `
export class FileService {
  /**
   * @decorator expose
   */
  readFile(path: string): Promise<string> {
    return Promise.resolve('file content');
  }
}
`
        }
      ]);

      const generator = createElectronBridgeGenerator({
        baseDir: baseDir,
        mainProcessHandlerFile: mainFile,
        preloadHandlerFile: preloadFile,
        typeDefinitionsFile: typeDefFile,
      });

      const tsConfig = loadTsConfig(tsConfigFile, baseDir, logger);
      const functions = extractFunctions(
        tsConfig, baseDir,
        [
          join(baseDir, 'src/services/FileService.ts')
        ], logger);

      await generator.generateFiles(functions);

      const mainContent = readFileSync(mainFile, 'utf8');

      // Should use relative path, not absolute path
      expect(mainContent).toBe(`// This is auto-generated main process handler by sublimity-electron-bridge.
// Do not edit manually this file.

import { app, BrowserWindow, ipcMain } from 'electron';
import { createSublimityRpcController, SublimityRpcController, SublimityRpcMessage } from 'sublimity-rpc';
import { FileService } from '../relative-test/src/services/FileService';

// Create singleton instances
const __FileServiceInstance = new FileService();

// Store controllers for each window
const controllers = new Map<number, SublimityRpcController>();

// Setup RPC for each window
const setupWindowRPC = (window: BrowserWindow) => {
  const webContentsId = window.webContents.id;
  
  // Create RPC controller for this window
  const controller = createSublimityRpcController({
    onSendMessage: (message: SublimityRpcMessage) => {
      // Send message to this specific window
      if (!window.isDestroyed()) {
        window.webContents.send("rpc-message", message);
      }
    }
  });
  
  // Store controller
  controllers.set(webContentsId, controller);
  
  // Register RPC functions
  controller.register('fileService:readFile', __FileServiceInstance.readFile);
  
  // Cleanup when window is closed
  window.on("closed", () => {
    controllers.delete(webContentsId);
  });
}

// Setup existing windows
app.on("ready", () => {
  BrowserWindow.getAllWindows().forEach(setupWindowRPC);
});

// Setup new windows
app.on("browser-window-created", (_, window) => {
  setupWindowRPC(window);
});

// Handle messages from preload process with Synchronous RPC mode
ipcMain.handle("rpc-message", async (event, message: SublimityRpcMessage): Promise<SublimityRpcMessage> => {
  const controller = controllers.get(event.sender.id);
  if (controller) {
    const response = await controller.insertMessageWaitable(message);
    return response;
  }
  throw new Error(\`Controller not found for webContents \${event.sender.id}\`);
});

// Legacy support: If global.mainWindow exists, set it up
if (typeof global !== "undefined" && global.mainWindow) {
  setupWindowRPC(global.mainWindow);
}
`);
    });

    it('should handle empty methods array', async () => {
      const mainFile = join(testOutputDir, 'empty-main', 'ipc-handlers.ts');
      const preloadFile = join(testOutputDir, 'empty-preload', 'bridge.ts');
      const typeDefFile = join(testOutputDir, 'empty-types.d.ts');

      const generator = createElectronBridgeGenerator({ 
        baseDir: testOutputDir,
        mainProcessHandlerFile: mainFile,
        preloadHandlerFile: preloadFile,
        typeDefinitionsFile: typeDefFile
      });

      // Should not create files when no methods provided
      await expect(generator.generateFiles([])).resolves.not.toThrow();

      const mainContent = readFileSync(mainFile, 'utf8');
      expect(mainContent).toBe(`// This is auto-generated main process handler by sublimity-electron-bridge.
// Do not edit manually this file.

import { app, BrowserWindow, ipcMain } from 'electron';
import { createSublimityRpcController, SublimityRpcController, SublimityRpcMessage } from 'sublimity-rpc';

// Create singleton instances

// Store controllers for each window
const controllers = new Map<number, SublimityRpcController>();

// Setup RPC for each window
const setupWindowRPC = (window: BrowserWindow) => {
  const webContentsId = window.webContents.id;
  
  // Create RPC controller for this window
  const controller = createSublimityRpcController({
    onSendMessage: (message: SublimityRpcMessage) => {
      // Send message to this specific window
      if (!window.isDestroyed()) {
        window.webContents.send("rpc-message", message);
      }
    }
  });
  
  // Store controller
  controllers.set(webContentsId, controller);
  
  // Register RPC functions
  
  // Cleanup when window is closed
  window.on("closed", () => {
    controllers.delete(webContentsId);
  });
}

// Setup existing windows
app.on("ready", () => {
  BrowserWindow.getAllWindows().forEach(setupWindowRPC);
});

// Setup new windows
app.on("browser-window-created", (_, window) => {
  setupWindowRPC(window);
});

// Handle messages from preload process with Synchronous RPC mode
ipcMain.handle("rpc-message", async (event, message: SublimityRpcMessage): Promise<SublimityRpcMessage> => {
  const controller = controllers.get(event.sender.id);
  if (controller) {
    const response = await controller.insertMessageWaitable(message);
    return response;
  }
  throw new Error(\`Controller not found for webContents \${event.sender.id}\`);
});

// Legacy support: If global.mainWindow exists, set it up
if (typeof global !== "undefined" && global.mainWindow) {
  setupWindowRPC(global.mainWindow);
}
`);

      const preloadContent = readFileSync(preloadFile, 'utf8');
      expect(preloadContent).toBe(`// This is auto-generated preloader by sublimity-electron-bridge.
// Do not edit manually this file.

import { contextBridge, ipcRenderer } from 'electron';
import { createSublimityRpcController, SublimityRpcMessage } from 'sublimity-rpc';

// Create RPC controller with Synchronous RPC mode
const controller = createSublimityRpcController({
  onSendMessage: async (message: SublimityRpcMessage): Promise<SublimityRpcMessage> => {
    // Send message to main process and get response synchronously
    const response = await ipcRenderer.invoke("rpc-message", message);
    return response;
  }
});

// Expose RPC functions to renderer process
`);

      const typeDefContent = readFileSync(typeDefFile, 'utf8');
      expect(typeDefContent).toBe(`// This is auto-generated type definitions by sublimity-electron-bridge.
// Do not edit manually this file.

declare global {
  interface Window {
  }
}

export {}
`);
    });

    it('should handle multiple namespaces correctly', async () => {
      const baseDir = join(testOutputDir, 'multi-namespace-test');
      const mainFile = join(testOutputDir, 'multi-namespace', 'ipc-handlers.ts');
      const preloadFile = join(testOutputDir, 'multi-preload', 'bridge.ts');
      const typeDefFile = join(testOutputDir, 'multi-types.d.ts');

      // Create test files
      createTestFiles(baseDir, [
        {
          path: 'src/services/FileService.ts',
          content: `
export class FileService {
  /**
   * @decorator expose fileAPI
   */
  readFile(path: string): Promise<string> {
    return Promise.resolve('file content');
  }
}
`
        },
        {
          path: 'src/utils/version.ts',
          content: `
/**
 * @decorator expose systemAPI
 */
export function getVersion(): Promise<string> {
  return Promise.resolve('1.0.0');
}
`
        },
        {
          path: 'src/services/DatabaseService.ts',
          content: `
export class DatabaseService {
  /**
   * @decorator expose dbAPI
   */
  query(sql: string): Promise<any[]> {
    return Promise.resolve([]);
  }
}
`
        }
      ]);

      const generator = createElectronBridgeGenerator({
        baseDir: baseDir,
        mainProcessHandlerFile: mainFile,
        preloadHandlerFile: preloadFile,
        typeDefinitionsFile: typeDefFile,
      });

      const tsConfig = loadTsConfig(tsConfigFile, baseDir, logger);
      const functions = extractFunctions(
        tsConfig, baseDir,
        [
          join(baseDir, 'src/services/FileService.ts'),
          join(baseDir, 'src/utils/version.ts'),
          join(baseDir, 'src/services/DatabaseService.ts')
        ], logger);

      await generator.generateFiles(functions);

      const preloadContent = readFileSync(preloadFile, 'utf8');

      // Should have all three namespaces
      expect(preloadContent).toBe(`// This is auto-generated preloader by sublimity-electron-bridge.
// Do not edit manually this file.

import { contextBridge, ipcRenderer } from 'electron';
import { createSublimityRpcController, SublimityRpcMessage } from 'sublimity-rpc';

// Create RPC controller with Synchronous RPC mode
const controller = createSublimityRpcController({
  onSendMessage: async (message: SublimityRpcMessage): Promise<SublimityRpcMessage> => {
    // Send message to main process and get response synchronously
    const response = await ipcRenderer.invoke("rpc-message", message);
    return response;
  }
});

// Expose RPC functions to renderer process
contextBridge.exposeInMainWorld('dbAPI', {
  query: (sql: string) => controller.invoke<any[]>('dbAPI:query', sql)
});
contextBridge.exposeInMainWorld('fileAPI', {
  readFile: (path: string) => controller.invoke<string>('fileAPI:readFile', path)
});
contextBridge.exposeInMainWorld('systemAPI', {
  getVersion: () => controller.invoke<string>('systemAPI:getVersion')
});
`);
    });

    it('should combine into one namespace when declared same class', async () => {
      const baseDir = join(testOutputDir, 'dedupe-test');
      const mainFile = join(testOutputDir, 'dedupe-main', 'ipc-handlers.ts');
      const preloadFile = join(testOutputDir, 'dedupe-preload', 'bridge.ts');
      const typeDefFile = join(testOutputDir, 'dedupe-types.d.ts');

      // Create test files
      createTestFiles(baseDir, [
        {
          path: 'src/services/FileService.ts',
          content: `
export class FileService {
  /**
   * @decorator expose
   */
  readFile(path: string): Promise<string> {
    return Promise.resolve('file content');
  }
  
  /**
   * @decorator expose
   */
  writeFile(path: string, content: string): Promise<void> {
    return Promise.resolve();
  }
}
`
        }
      ]);

      const generator = createElectronBridgeGenerator({
        baseDir: baseDir,
        mainProcessHandlerFile: mainFile,
        preloadHandlerFile: preloadFile,
        typeDefinitionsFile: typeDefFile,
      });

      const tsConfig = loadTsConfig(tsConfigFile, baseDir, logger);
      const functions = extractFunctions(
        tsConfig, baseDir,
        [
          join(baseDir, 'src/services/FileService.ts')
        ], logger);

      await generator.generateFiles(functions);

      const mainContent = readFileSync(mainFile, 'utf8');

      expect(mainContent).toBe(`// This is auto-generated main process handler by sublimity-electron-bridge.
// Do not edit manually this file.

import { app, BrowserWindow, ipcMain } from 'electron';
import { createSublimityRpcController, SublimityRpcController, SublimityRpcMessage } from 'sublimity-rpc';
import { FileService } from '../dedupe-test/src/services/FileService';

// Create singleton instances
const __FileServiceInstance = new FileService();

// Store controllers for each window
const controllers = new Map<number, SublimityRpcController>();

// Setup RPC for each window
const setupWindowRPC = (window: BrowserWindow) => {
  const webContentsId = window.webContents.id;
  
  // Create RPC controller for this window
  const controller = createSublimityRpcController({
    onSendMessage: (message: SublimityRpcMessage) => {
      // Send message to this specific window
      if (!window.isDestroyed()) {
        window.webContents.send("rpc-message", message);
      }
    }
  });
  
  // Store controller
  controllers.set(webContentsId, controller);
  
  // Register RPC functions
  controller.register('fileService:readFile', __FileServiceInstance.readFile);
  controller.register('fileService:writeFile', __FileServiceInstance.writeFile);
  
  // Cleanup when window is closed
  window.on("closed", () => {
    controllers.delete(webContentsId);
  });
}

// Setup existing windows
app.on("ready", () => {
  BrowserWindow.getAllWindows().forEach(setupWindowRPC);
});

// Setup new windows
app.on("browser-window-created", (_, window) => {
  setupWindowRPC(window);
});

// Handle messages from preload process with Synchronous RPC mode
ipcMain.handle("rpc-message", async (event, message: SublimityRpcMessage): Promise<SublimityRpcMessage> => {
  const controller = controllers.get(event.sender.id);
  if (controller) {
    const response = await controller.insertMessageWaitable(message);
    return response;
  }
  throw new Error(\`Controller not found for webContents \${event.sender.id}\`);
});

// Legacy support: If global.mainWindow exists, set it up
if (typeof global !== "undefined" && global.mainWindow) {
  setupWindowRPC(global.mainWindow);
}
`);
    });

    it('should generate files with complex namespace combinations', async () => {
      const baseDir = join(testOutputDir, 'complex-test');
      const mainFile = join(testOutputDir, 'complex-main', 'ipc-handlers.ts');
      const preloadFile = join(testOutputDir, 'complex-preload', 'bridge.ts');
      const typeDefFile = join(testOutputDir, 'complex-types.d.ts');
      
      // Create test files
      createTestFiles(baseDir, [
        {
          path: 'src/services/FileService.ts',
          content: `
export class FileService {
  /**
   * @decorator expose
   */
  readFile(path: string): Promise<string> {
    return Promise.resolve('file content');
  }
  
  /**
   * @decorator expose
   */
  writeFile(path: string, content: string): Promise<void> {
    return Promise.resolve();
  }
}
`
        },
        {
          path: 'src/utils/system.ts',
          content: `
/**
 * @decorator expose
 */
export function getVersion(): Promise<string> {
  return Promise.resolve('1.0.0');
}
`
        },
        {
          path: 'src/utils/format.ts',
          content: `
/**
 * @decorator expose
 */
export async function formatDate(date: Date): Promise<string> {
  return date.toISOString();
}
`
        }
      ]);
      
      const generator = createElectronBridgeGenerator({
        baseDir: baseDir,
        mainProcessHandlerFile: mainFile,
        preloadHandlerFile: preloadFile,
        typeDefinitionsFile: typeDefFile,
      });
      
      const tsConfig = loadTsConfig(tsConfigFile, baseDir, logger);
      const functions = extractFunctions(
        tsConfig, baseDir,
        [
          join(baseDir, 'src/services/FileService.ts'),
          join(baseDir, 'src/utils/system.ts'),
          join(baseDir, 'src/utils/format.ts')
        ], logger);
        
      await generator.generateFiles(functions);
      
      // Test main handlers
      const mainContent = readFileSync(mainFile, 'utf8');
      const expectedMainContent = `// This is auto-generated main process handler by sublimity-electron-bridge.
// Do not edit manually this file.

import { app, BrowserWindow, ipcMain } from 'electron';
import { createSublimityRpcController, SublimityRpcController, SublimityRpcMessage } from 'sublimity-rpc';
import { FileService } from '../complex-test/src/services/FileService';
import { formatDate } from '../complex-test/src/utils/format';
import { getVersion } from '../complex-test/src/utils/system';

// Create singleton instances
const __FileServiceInstance = new FileService();

// Store controllers for each window
const controllers = new Map<number, SublimityRpcController>();

// Setup RPC for each window
const setupWindowRPC = (window: BrowserWindow) => {
  const webContentsId = window.webContents.id;
  
  // Create RPC controller for this window
  const controller = createSublimityRpcController({
    onSendMessage: (message: SublimityRpcMessage) => {
      // Send message to this specific window
      if (!window.isDestroyed()) {
        window.webContents.send("rpc-message", message);
      }
    }
  });
  
  // Store controller
  controllers.set(webContentsId, controller);
  
  // Register RPC functions
  controller.register('fileService:readFile', __FileServiceInstance.readFile);
  controller.register('fileService:writeFile', __FileServiceInstance.writeFile);
  controller.register('mainProcess:formatDate', formatDate);
  controller.register('mainProcess:getVersion', getVersion);
  
  // Cleanup when window is closed
  window.on("closed", () => {
    controllers.delete(webContentsId);
  });
}

// Setup existing windows
app.on("ready", () => {
  BrowserWindow.getAllWindows().forEach(setupWindowRPC);
});

// Setup new windows
app.on("browser-window-created", (_, window) => {
  setupWindowRPC(window);
});

// Handle messages from preload process with Synchronous RPC mode
ipcMain.handle("rpc-message", async (event, message: SublimityRpcMessage): Promise<SublimityRpcMessage> => {
  const controller = controllers.get(event.sender.id);
  if (controller) {
    const response = await controller.insertMessageWaitable(message);
    return response;
  }
  throw new Error(\`Controller not found for webContents \${event.sender.id}\`);
});

// Legacy support: If global.mainWindow exists, set it up
if (typeof global !== "undefined" && global.mainWindow) {
  setupWindowRPC(global.mainWindow);
}
`;
      
      expect(mainContent).toBe(expectedMainContent);
      
      // Test preload bridge
      const preloadContent = readFileSync(preloadFile, 'utf8');
      const expectedPreloadContent = `// This is auto-generated preloader by sublimity-electron-bridge.
// Do not edit manually this file.

import { contextBridge, ipcRenderer } from 'electron';
import { createSublimityRpcController, SublimityRpcMessage } from 'sublimity-rpc';

// Create RPC controller with Synchronous RPC mode
const controller = createSublimityRpcController({
  onSendMessage: async (message: SublimityRpcMessage): Promise<SublimityRpcMessage> => {
    // Send message to main process and get response synchronously
    const response = await ipcRenderer.invoke("rpc-message", message);
    return response;
  }
});

// Expose RPC functions to renderer process
contextBridge.exposeInMainWorld('fileService', {
  readFile: (path: string) => controller.invoke<string>('fileService:readFile', path),
  writeFile: (path: string, content: string) => controller.invoke<void>('fileService:writeFile', path, content)
});
contextBridge.exposeInMainWorld('mainProcess', {
  formatDate: (date: Date) => controller.invoke<string>('mainProcess:formatDate', date),
  getVersion: () => controller.invoke<string>('mainProcess:getVersion')
});
`;
      
      expect(preloadContent).toBe(expectedPreloadContent);
      
      // Test type definitions
      const typeContent = readFileSync(typeDefFile, 'utf8');
      const expectedTypeContent = `// This is auto-generated type definitions by sublimity-electron-bridge.
// Do not edit manually this file.

export interface __fileServiceType {
  readonly readFile: (path: string) => Promise<string>;
  readonly writeFile: (path: string, content: string) => Promise<void>;
}
export interface __mainProcessType {
  readonly formatDate: (date: Date) => Promise<string>;
  readonly getVersion: () => Promise<string>;
}

declare global {
  interface Window {
    readonly fileService: __fileServiceType;
    readonly mainProcess: __mainProcessType;
  }
}

export {}
`;
      
      expect(typeContent).toBe(expectedTypeContent);
    });
  });

  describe('Type Import Generation', () => {
    it('should generate import statements for custom types in parameters and return values', async () => {
      const baseDir = join(testOutputDir, 'import-test-base');
      const mainFile = join(testOutputDir, 'import-test-main', 'ipc-handlers.ts');
      const preloadFile = join(testOutputDir, 'import-test-preload', 'bridge.ts');
      const typeDefFile = join(testOutputDir, 'import-test-types.d.ts');
      
      // Create test files with type definitions
      createTestFiles(baseDir, [
        {
          path: 'src/services/UserService.ts',
          content: `
export interface User {
  id: number;
  name: string;
}

export interface CreateUserRequest {
  name: string;
}

export class UserService {
  /**
   * @decorator expose
   */
  getUser(id: number): Promise<User> {
    return Promise.resolve({ id, name: 'John' });
  }
  
  /**
   * @decorator expose
   */
  createUser(userData: CreateUserRequest): Promise<User> {
    return Promise.resolve({ id: 1, name: userData.name });
  }
}
`
        },
        {
          path: 'src/utils/orderProcessor.ts',
          content: `
export interface Order {
  id: string;
  amount: number;
}

export interface ProcessOptions {
  priority: string;
}

export interface OrderResult {
  success: boolean;
  orderId: string;
}

/**
 * @decorator expose
 */
export function processOrder(order: Order, options: ProcessOptions): Promise<OrderResult> {
  return Promise.resolve({ success: true, orderId: order.id });
}
`
        }
      ]);
      
      const generator = createElectronBridgeGenerator({
        baseDir: baseDir,
        mainProcessHandlerFile: mainFile,
        preloadHandlerFile: preloadFile,
        typeDefinitionsFile: typeDefFile
      });
      
      const tsConfig = loadTsConfig(tsConfigFile, baseDir, logger);
      const functions = extractFunctions(
        tsConfig, baseDir,
        [
          join(baseDir, 'src/services/UserService.ts'),
          join(baseDir, 'src/utils/orderProcessor.ts')
        ], logger);
      
      await generator.generateFiles(functions);
      
      const typeContent = readFileSync(typeDefFile, 'utf8');

      expect(typeContent).toBe(`// This is auto-generated type definitions by sublimity-electron-bridge.
// Do not edit manually this file.

import type { CreateUserRequest, User } from './import-test-base/src/services/UserService';
import type { Order, OrderResult, ProcessOptions } from './import-test-base/src/utils/orderProcessor';

export interface __mainProcessType {
  readonly processOrder: (order: Order, options: ProcessOptions) => Promise<OrderResult>;
}
export interface __userServiceType {
  readonly createUser: (userData: CreateUserRequest) => Promise<User>;
  readonly getUser: (id: number) => Promise<User>;
}

declare global {
  interface Window {
    readonly mainProcess: __mainProcessType;
    readonly userService: __userServiceType;
  }
}

export {}
`);
    });

    it('should generate import statements for external package types', async () => {
      const baseDir = join(testOutputDir, 'external-import-base');
      const mainFile = join(testOutputDir, 'external-import-main', 'ipc-handlers.ts');
      const preloadFile = join(testOutputDir, 'external-import-preload', 'bridge.ts');
      const typeDefFile = join(testOutputDir, 'external-import-types.d.ts');

      // Create test files with TypeScript types
      createTestFiles(baseDir, [
        {
          path: 'src/services/TypeScriptService.ts',
          content: `
import { SourceFile, CompilerOptions, Program } from 'typescript';
export class TypeScriptService {
  /**
   * @decorator expose
   */
  analyzeFile(filePath: string): Promise<SourceFile> {
    return Promise.resolve({} as SourceFile);
  }
  
  /**
   * @decorator expose
   */
  createProgram(rootNames: string[], options: CompilerOptions): Promise<Program> {
    return Promise.resolve({} as Program);
  }
}
`
        },
        {
          path: 'src/utils/nodeUtils.ts',
          content: `
import { Node, SyntaxKind } from 'typescript';
/**
 * @decorator expose
 */
export function getNodeKind(node: Node): Promise<SyntaxKind> {
  return Promise.resolve({} as SyntaxKind);
}
`
        }
      ]);

      // Create package.json for npm install
      const packageJsonPath = join(baseDir, 'package.json');
      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          typescript: '^5.0.0'
        }
      };
      writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

      // Update tsconfig.json to use node moduleResolution
      const tsconfig = {
        compilerOptions: {
          target: "ES2020",
          module: "CommonJS",
          moduleResolution: "node",
          strict: true,
          declaration: true,
          outDir: "./dist",
          rootDir: "./src",
          esModuleInterop: true,
          skipLibCheck: true
        },
        include: ["src/**/*"],
        exclude: ["node_modules", "dist"]
      };
      tsConfigFile = join(baseDir, 'tsconfig.json');
      writeFileSync(tsConfigFile, JSON.stringify(tsconfig, null, 2));

      // Run npm install to create node_modules
      execSync('npm install --silent', { 
        cwd: baseDir, 
        stdio: 'pipe',
        timeout: 30000 // 30 seconds timeout
      });

      const generator = createElectronBridgeGenerator({
        baseDir: baseDir,
        mainProcessHandlerFile: mainFile,
        preloadHandlerFile: preloadFile,
        typeDefinitionsFile: typeDefFile
      });

      const tsConfig = loadTsConfig(tsConfigFile, baseDir, logger);
      const functions = extractFunctions(
        tsConfig, baseDir,
        [
          join(baseDir, 'src/services/TypeScriptService.ts'),
          join(baseDir, 'src/utils/nodeUtils.ts')
        ], logger);

      await generator.generateFiles(functions);

      const typeContent = readFileSync(typeDefFile, 'utf8');

      expect(typeContent).toBe(`// This is auto-generated type definitions by sublimity-electron-bridge.
// Do not edit manually this file.

import type { CompilerOptions, Node, Program, SourceFile, SyntaxKind } from 'typescript';

export interface __mainProcessType {
  readonly getNodeKind: (node: Node) => Promise<SyntaxKind>;
}
export interface __typeScriptServiceType {
  readonly analyzeFile: (filePath: string) => Promise<SourceFile>;
  readonly createProgram: (rootNames: string[], options: CompilerOptions) => Promise<Program>;
}

declare global {
  interface Window {
    readonly mainProcess: __mainProcessType;
    readonly typeScriptService: __typeScriptServiceType;
  }
}

export {}
`);
    });

    it('should handle complex generic types with custom types', async () => {
      const baseDir = join(testOutputDir, 'generic-import-base');
      const mainFile = join(testOutputDir, 'generic-import-main', 'ipc-handlers.ts');
      const preloadFile = join(testOutputDir, 'generic-import-preload', 'bridge.ts');
      const typeDefFile = join(testOutputDir, 'generic-import-types.d.ts');
      
      // Create test files with generic types
      createTestFiles(baseDir, [
        {
          path: 'src/services/DataService.ts',
          content: `
export interface Item {
  id: number;
  name: string;
}
export interface Filter<T> {
  criteria: string;
  value: T;
}
export interface SearchResult<T> {
  items: T[];
  total: number;
}
export interface User {
  id: number;
  name: string;
}
export interface Product {
  id: number;
  title: string;
}
/**
 * @decorator expose
 */
export class DataService {
  /**
   * @decorator expose
   */
  getItems(filter: Filter<Item>): Promise<Array<Item>> {
    return Promise.resolve([]);
  }
  
  /**
   * @decorator expose
   */
  getResults(query: string): Promise<SearchResult<Product>> {
    return Promise.resolve({ items: [{ id: 123, title: 'test' }], total: 1 });
  }
}
`
        },
        {
          path: 'src/utils/mapper.ts',
          content: `
import { Item, Filter } from '../services/DataService';
/**
 * @decorator expose
 */
export function mapData(input: Filter<Item>): Promise<Item[]> {
  return Promise.resolve([]);
}
`
        }
      ]);
      
      const generator = createElectronBridgeGenerator({
        baseDir: baseDir,
        mainProcessHandlerFile: mainFile,
        preloadHandlerFile: preloadFile,
        typeDefinitionsFile: typeDefFile
      });
      
      const tsConfig = loadTsConfig(tsConfigFile, baseDir, logger);
      const functions = extractFunctions(
        tsConfig, baseDir,
        [
          join(baseDir, 'src/services/DataService.ts'),
          join(baseDir, 'src/utils/mapper.ts')
        ], logger);

      await generator.generateFiles(functions);
      
      const typeContent = readFileSync(typeDefFile, 'utf8');

      expect(typeContent).toBe(`// This is auto-generated type definitions by sublimity-electron-bridge.
// Do not edit manually this file.

import type { Filter, Item, Product, SearchResult } from './generic-import-base/src/services/DataService';

export interface __dataServiceType {
  readonly getItems: (filter: Filter<Item>) => Promise<Item[]>;
  readonly getResults: (query: string) => Promise<SearchResult<Product>>;
}
export interface __mainProcessType {
  readonly mapData: (input: Filter<Item>) => Promise<Item[]>;
}

declare global {
  interface Window {
    readonly dataService: __dataServiceType;
    readonly mainProcess: __mainProcessType;
  }
}

export {}
`);
    });

    it('should not generate import statements for built-in types', async () => {
      const baseDir = join(testOutputDir, 'builtin-import-base');
      const mainFile = join(testOutputDir, 'builtin-import-main', 'ipc-handlers.ts');
      const preloadFile = join(testOutputDir, 'builtin-import-preload', 'bridge.ts');
      const typeDefFile = join(testOutputDir, 'builtin-import-types.d.ts');
      
      // Create test files with built-in types
      createTestFiles(baseDir, [
        {
          path: 'src/services/BuiltinService.ts',
          content: `
export class BuiltinService {
  /**
   * @decorator expose
   */
  processDate(date: Date): Promise<string> {
    return Promise.resolve(date.toISOString());
  }
  
  /**
   * @decorator expose
   */
  processArray(items: Array<string>): Promise<number> {
    return Promise.resolve(items.length);
  }
}
`
        },
        {
          path: 'src/utils/builtinUtils.ts',
          content: `
/**
 * @decorator expose
 */
export function processMap(data: Map<string, number>): Promise<Record<string, boolean>> {
  return Promise.resolve({});
}
`
        }
      ]);
      
      const generator = createElectronBridgeGenerator({
        baseDir: baseDir,
        mainProcessHandlerFile: mainFile,
        preloadHandlerFile: preloadFile,
        typeDefinitionsFile: typeDefFile
      });
      
      const tsConfig = loadTsConfig(tsConfigFile, baseDir, logger);
      const functions = extractFunctions(
        tsConfig, baseDir,
        [
          join(baseDir, 'src/services/BuiltinService.ts'),
          join(baseDir, 'src/utils/builtinUtils.ts')
        ], logger);
      
      await generator.generateFiles(functions);
      
      const typeContent = readFileSync(typeDefFile, 'utf8');

      expect(typeContent).toBe(`// This is auto-generated type definitions by sublimity-electron-bridge.
// Do not edit manually this file.

export interface __builtinServiceType {
  readonly processArray: (items: string[]) => Promise<number>;
  readonly processDate: (date: Date) => Promise<string>;
}
export interface __mainProcessType {
  readonly processMap: (data: Map<string, number>) => Promise<Record<string, boolean>>;
}

declare global {
  interface Window {
    readonly builtinService: __builtinServiceType;
    readonly mainProcess: __mainProcessType;
  }
}

export {}
`);
    });

    it('should handle mixed custom and built-in types correctly', async () => {
      const baseDir = join(testOutputDir, 'mixed-import-base');
      const mainFile = join(testOutputDir, 'mixed-import-main', 'ipc-handlers.ts');
      const preloadFile = join(testOutputDir, 'mixed-import-preload', 'bridge.ts');
      const typeDefFile = join(testOutputDir, 'mixed-import-types.d.ts');
      
      // Create test files with mixed custom and built-in types
      createTestFiles(baseDir, [
        {
          path: 'src/services/MixedService.ts',
          content: `
export interface User {
  id: number;
  name: string;
}
export interface UserMetadata {
  lastLogin: Date;
  preferences: Record<string, any>;
}
export interface ProcessedUser extends User {
  processed: boolean;
  timestamp: Date;
}
export enum UserStatus {
  Active = 'active',
  Inactive = 'inactive'
}
export class MixedService {
  /**
   * @decorator expose
   */
  processUserData(user?: User, timestamp: Date, options: { name?: string, id: number }, metadata: Record<string, UserMetadata>, ...args: any[]): Promise<ProcessedUser | UserStatus> {
    return Promise.resolve({ ...user!, processed: true, timestamp } as ProcessedUser);
  }
  /**
   * @decorator expose
   */
  prepareUserData(options: { name?: string, id: number }): Promise<UserStatus> {
    return Promise.resolve(UserStatus.Inactive);
  }
  /**
   * @decorator expose
   */
  activateUserData(options: { name?: string, id: number }): Promise<UserStatus.Active> {
    return Promise.resolve(UserStatus.Active);
  }
}
`
        },
        {
          path: 'src/utils/configValidator.ts',
          content: `
export interface AppConfig {
  apiUrl: string;
  timeout: number;
}
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}
/**
 * @decorator expose
 */
export function validateConfig(config: AppConfig | string): Promise<ValidationResult> {
  return Promise.resolve({ isValid: true, errors: [] });
}
`
        }
      ]);
      
      const generator = createElectronBridgeGenerator({
        baseDir: baseDir,
        mainProcessHandlerFile: mainFile,
        preloadHandlerFile: preloadFile,
        typeDefinitionsFile: typeDefFile
      });
      
      const tsConfig = loadTsConfig(tsConfigFile, baseDir, logger);
      const functions = extractFunctions(
        tsConfig, baseDir,
        [
          join(baseDir, 'src/services/MixedService.ts'),
          join(baseDir, 'src/utils/configValidator.ts')
        ], logger);
      
      await generator.generateFiles(functions);
      
      const typeContent = readFileSync(typeDefFile, 'utf8');
      
      expect(typeContent).toBe(`// This is auto-generated type definitions by sublimity-electron-bridge.
// Do not edit manually this file.

import type { ProcessedUser, User, UserMetadata, UserStatus } from './mixed-import-base/src/services/MixedService';
import type { AppConfig, ValidationResult } from './mixed-import-base/src/utils/configValidator';

export interface __mainProcessType {
  readonly validateConfig: (config: string | AppConfig) => Promise<ValidationResult>;
}
export interface __mixedServiceType {
  readonly activateUserData: (options: { name?: string | undefined; id: number; }) => Promise<UserStatus.Active>;
  readonly prepareUserData: (options: { name?: string | undefined; id: number; }) => Promise<UserStatus>;
  readonly processUserData: (user?: User | undefined, timestamp: Date, options: { name?: string | undefined; id: number; }, metadata: Record<string, UserMetadata>, args...: any[]) => Promise<ProcessedUser | UserStatus>;
}

declare global {
  interface Window {
    readonly mainProcess: __mainProcessType;
    readonly mixedService: __mixedServiceType;
  }
}

export {}
`);
    });

    it('should generate import statements for types from separate definition files', async () => {
      const baseDir = join(testOutputDir, 'separate-types-base');
      const mainFile = join(testOutputDir, 'separate-types-main', 'ipc-handlers.ts');
      const preloadFile = join(testOutputDir, 'separate-types-preload', 'bridge.ts');
      const typeDefFile = join(testOutputDir, 'separate-types.d.ts');
      
      // Create test files with types from separate definition files
      createTestFiles(baseDir, [
        {
          path: 'src/services/UserService.ts',
          content: `
export interface User {
  id: number;
  name: string;
  email: string;
}
export interface UserCreateRequest {
  name: string;
  email: string;
}
export class UserService {
  /**
   * @decorator expose
   */
  createUser(userData: UserCreateRequest): Promise<User> {
    return Promise.resolve({ id: 1, ...userData });
  }
}
`
        },
        {
          path: 'src/services/ProductService.ts',
          content: `
export interface Product {
  id: number;
  name: string;
  price: number;
}
export interface ProductSearchCriteria {
  category?: string;
  minPrice?: number;
  maxPrice?: number;
}
export class ProductService {
  /**
   * @decorator expose
   */
  findProduct(criteria: ProductSearchCriteria): Promise<Product[]> {
    return Promise.resolve([]);
  }
}
`
        },
        {
          path: 'src/types/common.ts',
          content: `
export interface ApiResponse<T> {
  data: T;
  status: string;
  message: string;
}
`
        },
        {
          path: 'src/processors/orderProcessor.ts',
          content: `
export interface OrderRequest {
  productId: number;
  quantity: number;
}
export interface PaymentInfo {
  cardNumber: string;
  amount: number;
}
export interface OrderResult {
  orderId: string;
  status: string;
}
/**
 * @decorator expose
 */
export function processOrder(order: OrderRequest, payment: PaymentInfo): Promise<OrderResult> {
  return Promise.resolve({ orderId: '123', status: 'processed' });
}
`
        }
      ]);
      
      const generator = createElectronBridgeGenerator({
        baseDir: baseDir,
        mainProcessHandlerFile: mainFile,
        preloadHandlerFile: preloadFile,
        typeDefinitionsFile: typeDefFile
      });
      
      const tsConfig = loadTsConfig(tsConfigFile, baseDir, logger);
      const functions = extractFunctions(
        tsConfig, baseDir,
        [
          join(baseDir, 'src/services/UserService.ts'),
          join(baseDir, 'src/services/ProductService.ts'),
          join(baseDir, 'src/processors/orderProcessor.ts')
        ], logger);
      await generator.generateFiles(functions);
      
      const mainContent = readFileSync(mainFile, 'utf8');

      expect(mainContent).toBe(`// This is auto-generated main process handler by sublimity-electron-bridge.
// Do not edit manually this file.

import { app, BrowserWindow, ipcMain } from 'electron';
import { createSublimityRpcController, SublimityRpcController, SublimityRpcMessage } from 'sublimity-rpc';
import { processOrder } from '../separate-types-base/src/processors/orderProcessor';
import { ProductService } from '../separate-types-base/src/services/ProductService';
import { UserService } from '../separate-types-base/src/services/UserService';

// Create singleton instances
const __ProductServiceInstance = new ProductService();
const __UserServiceInstance = new UserService();

// Store controllers for each window
const controllers = new Map<number, SublimityRpcController>();

// Setup RPC for each window
const setupWindowRPC = (window: BrowserWindow) => {
  const webContentsId = window.webContents.id;
  
  // Create RPC controller for this window
  const controller = createSublimityRpcController({
    onSendMessage: (message: SublimityRpcMessage) => {
      // Send message to this specific window
      if (!window.isDestroyed()) {
        window.webContents.send("rpc-message", message);
      }
    }
  });
  
  // Store controller
  controllers.set(webContentsId, controller);
  
  // Register RPC functions
  controller.register('mainProcess:processOrder', processOrder);
  controller.register('productService:findProduct', __ProductServiceInstance.findProduct);
  controller.register('userService:createUser', __UserServiceInstance.createUser);
  
  // Cleanup when window is closed
  window.on("closed", () => {
    controllers.delete(webContentsId);
  });
}

// Setup existing windows
app.on("ready", () => {
  BrowserWindow.getAllWindows().forEach(setupWindowRPC);
});

// Setup new windows
app.on("browser-window-created", (_, window) => {
  setupWindowRPC(window);
});

// Handle messages from preload process with Synchronous RPC mode
ipcMain.handle("rpc-message", async (event, message: SublimityRpcMessage): Promise<SublimityRpcMessage> => {
  const controller = controllers.get(event.sender.id);
  if (controller) {
    const response = await controller.insertMessageWaitable(message);
    return response;
  }
  throw new Error(\`Controller not found for webContents \${event.sender.id}\`);
});

// Legacy support: If global.mainWindow exists, set it up
if (typeof global !== "undefined" && global.mainWindow) {
  setupWindowRPC(global.mainWindow);
}
`);

      const preloadContent = readFileSync(preloadFile, 'utf8');

      expect(preloadContent).toBe(`// This is auto-generated preloader by sublimity-electron-bridge.
// Do not edit manually this file.

import { contextBridge, ipcRenderer } from 'electron';
import { createSublimityRpcController, SublimityRpcMessage } from 'sublimity-rpc';
import type { OrderRequest, OrderResult, PaymentInfo } from '../separate-types-base/src/processors/orderProcessor';
import type { Product, ProductSearchCriteria } from '../separate-types-base/src/services/ProductService';
import type { User, UserCreateRequest } from '../separate-types-base/src/services/UserService';

// Create RPC controller with Synchronous RPC mode
const controller = createSublimityRpcController({
  onSendMessage: async (message: SublimityRpcMessage): Promise<SublimityRpcMessage> => {
    // Send message to main process and get response synchronously
    const response = await ipcRenderer.invoke("rpc-message", message);
    return response;
  }
});

// Expose RPC functions to renderer process
contextBridge.exposeInMainWorld('mainProcess', {
  processOrder: (order: OrderRequest, payment: PaymentInfo) => controller.invoke<OrderResult>('mainProcess:processOrder', order, payment)
});
contextBridge.exposeInMainWorld('productService', {
  findProduct: (criteria: ProductSearchCriteria) => controller.invoke<Product[]>('productService:findProduct', criteria)
});
contextBridge.exposeInMainWorld('userService', {
  createUser: (userData: UserCreateRequest) => controller.invoke<User>('userService:createUser', userData)
});
`);

      const typeContent = readFileSync(typeDefFile, 'utf8');

      expect(typeContent).toBe(`// This is auto-generated type definitions by sublimity-electron-bridge.
// Do not edit manually this file.

import type { OrderRequest, OrderResult, PaymentInfo } from './separate-types-base/src/processors/orderProcessor';
import type { Product, ProductSearchCriteria } from './separate-types-base/src/services/ProductService';
import type { User, UserCreateRequest } from './separate-types-base/src/services/UserService';

export interface __mainProcessType {
  readonly processOrder: (order: OrderRequest, payment: PaymentInfo) => Promise<OrderResult>;
}
export interface __productServiceType {
  readonly findProduct: (criteria: ProductSearchCriteria) => Promise<Product[]>;
}
export interface __userServiceType {
  readonly createUser: (userData: UserCreateRequest) => Promise<User>;
}

declare global {
  interface Window {
    readonly mainProcess: __mainProcessType;
    readonly productService: __productServiceType;
    readonly userService: __userServiceType;
  }
}

export {}
`);
    });
  });
});
