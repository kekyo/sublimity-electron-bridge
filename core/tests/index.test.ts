import { describe, it, expect, beforeEach } from 'vitest';
import { createElectronBridgeGenerator } from '../src/index';
import { isCamelCase, toPascalCase } from '../src/generator';
import { rmSync, existsSync, readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

describe('ElectronBridgeCore', () => {
  const testOutputDir = mkdtempSync(join(tmpdir(), 'cli-test-'));
  
  beforeEach(() => {
    // Clean up test output directory
    if (existsSync(testOutputDir)) {
      rmSync(testOutputDir, { recursive: true, force: true });
    }
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
        module: "commonjs",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        declaration: true,
        outDir: "./dist"
      },
      include: ["src/**/*"],
      exclude: ["node_modules", "dist"]
    };
    
    writeFileSync(join(baseDir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));
    
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
        mainProcessHandlerFile: join(testOutputDir, 'default-main', 'ipc-handlers.ts'),
        preloadHandlerFile: join(testOutputDir, 'default-preload', 'bridge.ts'),
        typeDefinitionsFile: join(testOutputDir, 'default-types.d.ts')
      });
      
      expect(generator).toBeDefined();
    });

    it('should accept custom options', () => {
      const options = {
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
    beforeEach(() => {
      // Ensure test output directory exists
      if (!existsSync(testOutputDir)) {
        mkdirSync(testOutputDir, { recursive: true });
      }
    });

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
        mainProcessHandlerFile: mainFile,
        preloadHandlerFile: preloadFile,
        typeDefinitionsFile: typeDefFile,
        baseDir: testBaseDir
      });
      
      const methods = [
        {
          className: 'FileService',
          methodName: 'readFile',
          namespace: 'fileAPI',
          parameters: [{ name: 'path', type: 'string' }],
          returnType: 'Promise<string>',
          filePath: 'src/services/FileService.ts'
        }
      ];
      
      await generator.generateFiles(methods);
      
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
        mainProcessHandlerFile: mainFile,
        preloadHandlerFile: preloadFile,
        typeDefinitionsFile: typeDefFile,
        baseDir: baseDir
      });
      
      const methods = [
        {
          className: 'FileService',
          methodName: 'readFile',
          namespace: 'fileAPI',
          parameters: [{ name: 'path', type: 'string' }],
          returnType: 'Promise<string>',
          filePath: 'src/services/FileService.ts'
        },
        {
          methodName: 'getVersion',
          namespace: 'systemAPI',
          parameters: [],
          returnType: 'Promise<string>',
          filePath: 'src/utils/version.ts'
        }
      ];
      
      await generator.generateFiles(methods);
      
      const mainContent = readFileSync(mainFile, 'utf8');
      
      const expectedMainContent = `// This is auto-generated main process handler by sublimity-electron-bridge.
// Do not edit manually this file.

import { ipcMain } from 'electron';
import { createSublimityRpcController } from 'sublimity-rpc';
import { FileService } from '../src/services/FileService';
import { getVersion } from '../src/utils/version';

// Create singleton instances
const fileserviceInstance = new FileService();

// Create RPC controller
const controller = createSublimityRpcController({
  onSendMessage: message => {
    // Send message to preload process
    global.mainWindow.webContents.send("rpc-message", message);
  }
});

// Handle messages from preload process
ipcMain.on("rpc-message", (_, message) => {
  controller.insertMessage(message);
});

// Register RPC functions
controller.register('fileAPI:readFile', (path) => fileserviceInstance.readFile(path));
controller.register('systemAPI:getVersion', () => getVersion());
`;
      
      expect(mainContent).toBe(expectedMainContent);
    });

    it('should generate correct preload bridge content', async () => {
      const mainFile = join(testOutputDir, 'main-bridge', 'ipc-handlers.ts');
      const preloadFile = join(testOutputDir, 'preload-bridge', 'bridge.ts');
      const typeDefFile = join(testOutputDir, 'preload-bridge-types.d.ts');
      
      const generator = createElectronBridgeGenerator({
        mainProcessHandlerFile: mainFile,
        preloadHandlerFile: preloadFile,
        typeDefinitionsFile: typeDefFile
      });
      
      const methods = [
        {
          className: 'FileService',
          methodName: 'readFile',
          namespace: 'fileAPI',
          parameters: [{ name: 'path', type: 'string' }],
          returnType: 'Promise<string>',
          filePath: 'src/services/FileService.ts'
        },
        {
          methodName: 'getVersion',
          namespace: 'systemAPI',
          parameters: [],
          returnType: 'Promise<string>',
          filePath: 'src/utils/version.ts'
        }
      ];
      
      await generator.generateFiles(methods);
      
      const preloadContent = readFileSync(preloadFile, 'utf8');
      
      const expectedPreloadContent = `// This is auto-generated preloader by sublimity-electron-bridge.
// Do not edit manually this file.

import { contextBridge, ipcRenderer } from 'electron';
import { createSublimityRpcController } from 'sublimity-rpc';


// Create RPC controller
const controller = createSublimityRpcController({
  onSendMessage: message => {
    // Send message to main process
    ipcRenderer.send("rpc-message", message);
  }
});

// Handle messages from main process
ipcRenderer.on("rpc-message", (_, message) => {
  controller.insertMessage(message);
});

contextBridge.exposeInMainWorld('fileAPI', {
  readFile: (path: string) => controller.invoke('fileAPI:readFile', path)
});
contextBridge.exposeInMainWorld('systemAPI', {
  getVersion: () => controller.invoke('systemAPI:getVersion')
});
`;
      
      expect(preloadContent).toBe(expectedPreloadContent);
    });

    it('should generate correct type definitions content', async () => {
      const mainFile = join(testOutputDir, 'main-types', 'ipc-handlers.ts');
      const preloadFile = join(testOutputDir, 'preload-types', 'bridge.ts');
      const typeDefFile = join(testOutputDir, 'electron-api.d.ts');
      
      const generator = createElectronBridgeGenerator({
        mainProcessHandlerFile: mainFile,
        preloadHandlerFile: preloadFile,
        typeDefinitionsFile: typeDefFile
      });
      
      const methods = [
        {
          className: 'FileService',
          methodName: 'readFile',
          namespace: 'fileAPI',
          parameters: [{ name: 'path', type: 'string' }],
          returnType: 'Promise<string>',
          filePath: 'src/services/FileService.ts'
        },
        {
          methodName: 'writeFile',
          namespace: 'fileAPI',
          parameters: [
            { name: 'path', type: 'string' },
            { name: 'content', type: 'string' }
          ],
          returnType: 'Promise<void>',
          filePath: 'src/services/FileService.ts'
        }
      ];
      
      await generator.generateFiles(methods);
      
      const typeContent = readFileSync(typeDefFile, 'utf8');
      
      const expectedTypeContent = `// This is auto-generated type definitions by sublimity-electron-bridge.
// Do not edit manually this file.

interface FileAPI {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}

declare global {
  interface Window {
    fileAPI: FileAPI;
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
        mainProcessHandlerFile: mainFile,
        preloadHandlerFile: preloadFile,
        typeDefinitionsFile: typeDefFile,
        baseDir: baseDir
      });
      
      const methods = [
        {
          className: 'FileService',
          methodName: 'readFile',
          namespace: 'fileAPI',
          parameters: [{ name: 'path', type: 'string' }],
          returnType: 'Promise<string>',
          filePath: 'src/services/FileService.ts'
        }
      ];
      
      await generator.generateFiles(methods);
      
      const mainContent = readFileSync(mainFile, 'utf8');
      
      // Should use relative path, not absolute path
      expect(mainContent).toContain("import { FileService } from '../relative-test/src/services/FileService'");
      expect(mainContent).not.toContain(resolve(baseDir, 'src/services/FileService'));
    });

    it('should handle empty methods array', async () => {
      const mainFile = join(testOutputDir, 'empty-main', 'ipc-handlers.ts');
      const preloadFile = join(testOutputDir, 'empty-preload', 'bridge.ts');
      const typeDefFile = join(testOutputDir, 'empty-types.d.ts');
      
      const generator = createElectronBridgeGenerator({
        mainProcessHandlerFile: mainFile,
        preloadHandlerFile: preloadFile,
        typeDefinitionsFile: typeDefFile
      });
      
      // Should not create files when no methods provided
      await expect(generator.generateFiles([])).resolves.not.toThrow();

      const mainContent = readFileSync(mainFile, 'utf8');
      expect(mainContent).toBe(`// This is auto-generated main process handler by sublimity-electron-bridge.
// Do not edit manually this file.

import { ipcMain } from 'electron';
import { createSublimityRpcController } from 'sublimity-rpc';

// Create singleton instances

// Create RPC controller
const controller = createSublimityRpcController({
  onSendMessage: message => {
    // Send message to preload process
    global.mainWindow.webContents.send("rpc-message", message);
  }
});

// Handle messages from preload process
ipcMain.on("rpc-message", (_, message) => {
  controller.insertMessage(message);
});

// Register RPC functions
`);

      const preloadContent = readFileSync(preloadFile, 'utf8');
      expect(preloadContent).toBe(`// This is auto-generated preloader by sublimity-electron-bridge.
// Do not edit manually this file.

import { contextBridge, ipcRenderer } from 'electron';
import { createSublimityRpcController } from 'sublimity-rpc';


// Create RPC controller
const controller = createSublimityRpcController({
  onSendMessage: message => {
    // Send message to main process
    ipcRenderer.send("rpc-message", message);
  }
});

// Handle messages from main process
ipcRenderer.on("rpc-message", (_, message) => {
  controller.insertMessage(message);
});

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
      const mainFile = join(testOutputDir, 'multi-namespace', 'ipc-handlers.ts');
      const preloadFile = join(testOutputDir, 'multi-preload', 'bridge.ts');
      const typeDefFile = join(testOutputDir, 'multi-types.d.ts');
      
      const generator = createElectronBridgeGenerator({
        mainProcessHandlerFile: mainFile,
        preloadHandlerFile: preloadFile,
        typeDefinitionsFile: typeDefFile
      });
      
      const methods = [
        {
          className: 'FileService',
          methodName: 'readFile',
          namespace: 'fileAPI',
          parameters: [{ name: 'path', type: 'string' }],
          returnType: 'Promise<string>',
          filePath: 'src/services/FileService.ts'
        },
        {
          methodName: 'getVersion',
          namespace: 'systemAPI',
          parameters: [],
          returnType: 'Promise<string>',
          filePath: 'src/utils/version.ts'
        },
        {
          className: 'DatabaseService',
          methodName: 'query',
          namespace: 'dbAPI',
          parameters: [{ name: 'sql', type: 'string' }],
          returnType: 'Promise<any[]>',
          filePath: 'src/services/DatabaseService.ts'
        }
      ];
      
      await generator.generateFiles(methods);
      
      const preloadContent = readFileSync(preloadFile, 'utf8');
      
      // Should have all three namespaces
      expect(preloadContent).toContain("contextBridge.exposeInMainWorld('fileAPI'");
      expect(preloadContent).toContain("contextBridge.exposeInMainWorld('systemAPI'");
      expect(preloadContent).toContain("contextBridge.exposeInMainWorld('dbAPI'");
    });

    it('should deduplicate identical class imports', async () => {
      const mainFile = join(testOutputDir, 'dedupe-main', 'ipc-handlers.ts');
      const preloadFile = join(testOutputDir, 'dedupe-preload', 'bridge.ts');
      const typeDefFile = join(testOutputDir, 'dedupe-types.d.ts');
      
      const generator = createElectronBridgeGenerator({
        mainProcessHandlerFile: mainFile,
        preloadHandlerFile: preloadFile,
        typeDefinitionsFile: typeDefFile
      });
      
      const methods = [
        {
          className: 'FileService',
          methodName: 'readFile',
          namespace: 'fileAPI',
          parameters: [{ name: 'path', type: 'string' }],
          returnType: 'Promise<string>',
          filePath: 'src/services/FileService.ts'
        },
        {
          className: 'FileService',
          methodName: 'writeFile',
          namespace: 'fileAPI',
          parameters: [{ name: 'path', type: 'string' }, { name: 'content', type: 'string' }],
          returnType: 'Promise<void>',
          filePath: 'src/services/FileService.ts'
        }
      ];
      
      await generator.generateFiles(methods);
      
      const mainContent = readFileSync(mainFile, 'utf8');
      
      // Should only have one import statement for FileService
      const importMatches = mainContent.match(/import { FileService } from/g);
      expect(importMatches).toHaveLength(1);
      
      // Should only have one singleton instance
      const instanceMatches = mainContent.match(/const fileserviceInstance = new FileService\(\)/g);
      expect(instanceMatches).toHaveLength(1);
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
export function formatDate(date: Date): string {
  return date.toISOString();
}
`
        }
      ]);
      
      const generator = createElectronBridgeGenerator({
        mainProcessHandlerFile: mainFile,
        preloadHandlerFile: preloadFile,
        typeDefinitionsFile: typeDefFile,
        baseDir: baseDir
      });
      
      const methods = [
        {
          className: 'FileService',
          methodName: 'readFile',
          namespace: 'fileAPI',
          parameters: [{ name: 'path', type: 'string' }],
          returnType: 'Promise<string>',
          filePath: 'src/services/FileService.ts'
        },
        {
          className: 'FileService',
          methodName: 'writeFile',
          namespace: 'fileAPI',
          parameters: [{ name: 'path', type: 'string' }, { name: 'content', type: 'string' }],
          returnType: 'Promise<void>',
          filePath: 'src/services/FileService.ts'
        },
        {
          methodName: 'getVersion',
          namespace: 'systemAPI',
          parameters: [],
          returnType: 'Promise<string>',
          filePath: 'src/utils/system.ts'
        },
        {
          methodName: 'formatDate',
          namespace: 'utilsAPI',
          parameters: [{ name: 'date', type: 'Date' }],
          returnType: 'Promise<string>',
          filePath: 'src/utils/format.ts'
        }
      ];
      
      await generator.generateFiles(methods);
      
      // Test main handlers
      const mainContent = readFileSync(mainFile, 'utf8');
      const expectedMainContent = `// This is auto-generated main process handler by sublimity-electron-bridge.
// Do not edit manually this file.

import { ipcMain } from 'electron';
import { createSublimityRpcController } from 'sublimity-rpc';
import { FileService } from '../src/services/FileService';
import { formatDate } from '../src/utils/format';
import { getVersion } from '../src/utils/system';

// Create singleton instances
const fileserviceInstance = new FileService();

// Create RPC controller
const controller = createSublimityRpcController({
  onSendMessage: message => {
    // Send message to preload process
    global.mainWindow.webContents.send("rpc-message", message);
  }
});

// Handle messages from preload process
ipcMain.on("rpc-message", (_, message) => {
  controller.insertMessage(message);
});

// Register RPC functions
controller.register('fileAPI:readFile', (path) => fileserviceInstance.readFile(path));
controller.register('fileAPI:writeFile', (path, content) => fileserviceInstance.writeFile(path, content));
controller.register('systemAPI:getVersion', () => getVersion());
controller.register('utilsAPI:formatDate', (date) => formatDate(date));
`;
      
      expect(mainContent).toBe(expectedMainContent);
      
      // Test preload bridge
      const preloadContent = readFileSync(preloadFile, 'utf8');
      const expectedPreloadContent = `// This is auto-generated preloader by sublimity-electron-bridge.
// Do not edit manually this file.

import { contextBridge, ipcRenderer } from 'electron';
import { createSublimityRpcController } from 'sublimity-rpc';


// Create RPC controller
const controller = createSublimityRpcController({
  onSendMessage: message => {
    // Send message to main process
    ipcRenderer.send("rpc-message", message);
  }
});

// Handle messages from main process
ipcRenderer.on("rpc-message", (_, message) => {
  controller.insertMessage(message);
});

contextBridge.exposeInMainWorld('fileAPI', {
  readFile: (path: string) => controller.invoke('fileAPI:readFile', path),
  writeFile: (path: string, content: string) => controller.invoke('fileAPI:writeFile', path, content)
});
contextBridge.exposeInMainWorld('systemAPI', {
  getVersion: () => controller.invoke('systemAPI:getVersion')
});
contextBridge.exposeInMainWorld('utilsAPI', {
  formatDate: (date: Date) => controller.invoke('utilsAPI:formatDate', date)
});
`;
      
      expect(preloadContent).toBe(expectedPreloadContent);
      
      // Test type definitions
      const typeContent = readFileSync(typeDefFile, 'utf8');
      const expectedTypeContent = `// This is auto-generated type definitions by sublimity-electron-bridge.
// Do not edit manually this file.

interface FileAPI {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}
interface SystemAPI {
  getVersion(): Promise<string>;
}
interface UtilsAPI {
  formatDate(date: Date): Promise<string>;
}

declare global {
  interface Window {
    fileAPI: FileAPI;
    systemAPI: SystemAPI;
    utilsAPI: UtilsAPI;
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

/**
 * @decorator expose
 */
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
        mainProcessHandlerFile: mainFile,
        preloadHandlerFile: preloadFile,
        typeDefinitionsFile: typeDefFile,
        baseDir: baseDir
      });
      
      const methods = [
        {
          className: 'UserService',
          methodName: 'getUser',
          namespace: 'userAPI',
          parameters: [{ name: 'id', type: 'number' }],
          returnType: 'Promise<User>',
          filePath: 'src/services/UserService.ts'
        },
        {
          className: 'UserService',
          methodName: 'createUser',
          namespace: 'userAPI',
          parameters: [{ name: 'userData', type: 'CreateUserRequest' }],
          returnType: 'Promise<User>',
          filePath: 'src/services/UserService.ts'
        },
        {
          methodName: 'processOrder',
          namespace: 'orderAPI',
          parameters: [
            { name: 'order', type: 'Order' },
            { name: 'options', type: 'ProcessOptions' }
          ],
          returnType: 'Promise<OrderResult>',
          filePath: 'src/utils/orderProcessor.ts'
        }
      ];
      
      await generator.generateFiles(methods);
      
      const typeContent = readFileSync(typeDefFile, 'utf8');
      
      // Should contain import statements for custom types
      expect(typeContent).toContain("import type { CreateUserRequest, User } from './src/services/UserService';");
      expect(typeContent).toContain("import type { Order, ProcessOptions, OrderResult } from './src/utils/orderProcessor';");
      
      // Should contain interface definitions
      expect(typeContent).toContain('interface UserAPI {');
      expect(typeContent).toContain('interface OrderAPI {');
      expect(typeContent).toContain('getUser(id: number): Promise<User>;');
      expect(typeContent).toContain('createUser(userData: CreateUserRequest): Promise<User>;');
      expect(typeContent).toContain('processOrder(order: Order, options: ProcessOptions): Promise<OrderResult>;');
      
      // Should contain window interface
      expect(typeContent).toContain('userAPI: UserAPI;');
      expect(typeContent).toContain('orderAPI: OrderAPI;');
    });

    it('should generate import statements for external package types', async () => {
      const mainFile = join(testOutputDir, 'external-import-main', 'ipc-handlers.ts');
      const preloadFile = join(testOutputDir, 'external-import-preload', 'bridge.ts');
      const typeDefFile = join(testOutputDir, 'external-import-types.d.ts');
      
      const generator = createElectronBridgeGenerator({
        mainProcessHandlerFile: mainFile,
        preloadHandlerFile: preloadFile,
        typeDefinitionsFile: typeDefFile,
        baseDir: testOutputDir
      });
      
      const methods = [
        {
          className: 'TypeScriptService',
          methodName: 'analyzeFile',
          namespace: 'tsAPI',
          parameters: [{ name: 'filePath', type: 'string' }],
          returnType: 'Promise<SourceFile>',
          filePath: 'src/services/TypeScriptService.ts'
        },
        {
          className: 'TypeScriptService',
          methodName: 'createProgram',
          namespace: 'tsAPI',
          parameters: [
            { name: 'rootNames', type: 'string[]' },
            { name: 'options', type: 'CompilerOptions' }
          ],
          returnType: 'Promise<Program>',
          filePath: 'src/services/TypeScriptService.ts'
        },
        {
          methodName: 'getNodeKind',
          namespace: 'tsAPI',
          parameters: [{ name: 'node', type: 'Node' }],
          returnType: 'Promise<SyntaxKind>',
          filePath: 'src/utils/nodeUtils.ts'
        }
      ];
      
      await generator.generateFiles(methods);
      
      const typeContent = readFileSync(typeDefFile, 'utf8');
      
      // Should contain import statements for TypeScript types
      expect(typeContent).toContain("import type { SourceFile, CompilerOptions, Program } from './src/services/TypeScriptService';");
      expect(typeContent).toContain("import type { Node, SyntaxKind } from './src/utils/nodeUtils';");
      
      // Should contain interface definitions with TypeScript types
      expect(typeContent).toContain('interface TsAPI {');
      expect(typeContent).toContain('analyzeFile(filePath: string): Promise<SourceFile>;');
      expect(typeContent).toContain('createProgram(rootNames: string[], options: CompilerOptions): Promise<Program>;');
      expect(typeContent).toContain('getNodeKind(node: Node): Promise<SyntaxKind>;');
      
      // Should contain window interface
      expect(typeContent).toContain('tsAPI: TsAPI;');
    });

    it('should handle complex generic types with custom types', async () => {
      const mainFile = join(testOutputDir, 'generic-import-main', 'ipc-handlers.ts');
      const preloadFile = join(testOutputDir, 'generic-import-preload', 'bridge.ts');
      const typeDefFile = join(testOutputDir, 'generic-import-types.d.ts');
      
      const generator = createElectronBridgeGenerator({
        mainProcessHandlerFile: mainFile,
        preloadHandlerFile: preloadFile,
        typeDefinitionsFile: typeDefFile,
        baseDir: testOutputDir
      });
      
      const methods = [
        {
          className: 'DataService',
          methodName: 'getItems',
          namespace: 'dataAPI',
          parameters: [{ name: 'filter', type: 'Filter<Item>' }],
          returnType: 'Promise<Array<Item>>',
          filePath: 'src/services/DataService.ts'
        },
        {
          className: 'DataService',
          methodName: 'getResults',
          namespace: 'dataAPI',
          parameters: [{ name: 'query', type: 'string' }],
          returnType: 'Promise<SearchResult<User | Product>>',
          filePath: 'src/services/DataService.ts'
        },
        {
          methodName: 'mapData',
          namespace: 'utilsAPI',
          parameters: [
            { name: 'data', type: 'Record<string, DataEntry>' },
            { name: 'mapper', type: 'Mapper<DataEntry, ResultType>' }
          ],
          returnType: 'Promise<ResultType[]>',
          filePath: 'src/utils/dataMapper.ts'
        }
      ];
      
      await generator.generateFiles(methods);
      
      const typeContent = readFileSync(typeDefFile, 'utf8');
      
      // Should contain import statements for custom types extracted from generics
      expect(typeContent).toContain("import type { Filter, Item } from './src/services/DataService';");
      expect(typeContent).toContain("import type { Mapper, DataEntry, ResultType } from './src/utils/dataMapper';");
      
      // Should contain interface definitions with complex generic types
      expect(typeContent).toContain('interface DataAPI {');
      expect(typeContent).toContain('interface UtilsAPI {');
      expect(typeContent).toContain('getItems(filter: Filter<Item>): Promise<Array<Item>>;');
      expect(typeContent).toContain('getResults(query: string): Promise<SearchResult<User | Product>>;');
      expect(typeContent).toContain('mapData(data: Record<string, DataEntry>, mapper: Mapper<DataEntry, ResultType>): Promise<ResultType[]>;');
    });

    it('should not generate import statements for built-in types', async () => {
      const mainFile = join(testOutputDir, 'builtin-import-main', 'ipc-handlers.ts');
      const preloadFile = join(testOutputDir, 'builtin-import-preload', 'bridge.ts');
      const typeDefFile = join(testOutputDir, 'builtin-import-types.d.ts');
      
      const generator = createElectronBridgeGenerator({
        mainProcessHandlerFile: mainFile,
        preloadHandlerFile: preloadFile,
        typeDefinitionsFile: typeDefFile,
        baseDir: testOutputDir
      });
      
      const methods = [
        {
          className: 'BuiltinService',
          methodName: 'processDate',
          namespace: 'builtinAPI',
          parameters: [{ name: 'date', type: 'Date' }],
          returnType: 'Promise<string>',
          filePath: 'src/services/BuiltinService.ts'
        },
        {
          className: 'BuiltinService',
          methodName: 'processArray',
          namespace: 'builtinAPI',
          parameters: [{ name: 'items', type: 'Array<string>' }],
          returnType: 'Promise<number>',
          filePath: 'src/services/BuiltinService.ts'
        },
        {
          methodName: 'processMap',
          namespace: 'builtinAPI',
          parameters: [{ name: 'data', type: 'Map<string, number>' }],
          returnType: 'Promise<Record<string, boolean>>',
          filePath: 'src/utils/builtinUtils.ts'
        }
      ];
      
      await generator.generateFiles(methods);
      
      const typeContent = readFileSync(typeDefFile, 'utf8');
      
      // Should NOT contain import statements for built-in types
      expect(typeContent).not.toContain('import type { Date }');
      expect(typeContent).not.toContain('import type { Array }');
      expect(typeContent).not.toContain('import type { Map }');
      expect(typeContent).not.toContain('import type { Record }');
      expect(typeContent).not.toContain('import type { Promise }');
      
      // Should contain interface definitions with built-in types
      expect(typeContent).toContain('interface BuiltinAPI {');
      expect(typeContent).toContain('processDate(date: Date): Promise<string>;');
      expect(typeContent).toContain('processArray(items: Array<string>): Promise<number>;');
      expect(typeContent).toContain('processMap(data: Map<string, number>): Promise<Record<string, boolean>>;');
      
      // Should contain window interface
      expect(typeContent).toContain('builtinAPI: BuiltinAPI;');
    });

    it('should handle mixed custom and built-in types correctly', async () => {
      const mainFile = join(testOutputDir, 'mixed-import-main', 'ipc-handlers.ts');
      const preloadFile = join(testOutputDir, 'mixed-import-preload', 'bridge.ts');
      const typeDefFile = join(testOutputDir, 'mixed-import-types.d.ts');
      
      const generator = createElectronBridgeGenerator({
        mainProcessHandlerFile: mainFile,
        preloadHandlerFile: preloadFile,
        typeDefinitionsFile: typeDefFile,
        baseDir: testOutputDir
      });
      
      const methods = [
        {
          className: 'MixedService',
          methodName: 'processUserData',
          namespace: 'mixedAPI',
          parameters: [
            { name: 'user', type: 'User' },
            { name: 'timestamp', type: 'Date' },
            { name: 'metadata', type: 'Record<string, UserMetadata>' }
          ],
          returnType: 'Promise<ProcessedUser>',
          filePath: 'src/services/MixedService.ts'
        },
        {
          methodName: 'validateConfig',
          namespace: 'mixedAPI',
          parameters: [{ name: 'config', type: 'AppConfig | string' }],
          returnType: 'Promise<ValidationResult>',
          filePath: 'src/utils/configValidator.ts'
        }
      ];
      
      await generator.generateFiles(methods);
      
      const typeContent = readFileSync(typeDefFile, 'utf8');
      
      // Should contain import statements for custom types only
      expect(typeContent).toContain("import type { User, ProcessedUser } from './src/services/MixedService';");
      expect(typeContent).toContain("import type { AppConfig, ValidationResult } from './src/utils/configValidator';");
      
      // Should NOT contain import statements for built-in types
      expect(typeContent).not.toContain('import type { Date }');
      expect(typeContent).not.toContain('import type { Record }');
      expect(typeContent).not.toContain('import type { Promise }');
      
      // Should contain interface definitions with mixed types
      expect(typeContent).toContain('interface MixedAPI {');
      expect(typeContent).toContain('processUserData(user: User, timestamp: Date, metadata: Record<string, UserMetadata>): Promise<ProcessedUser>;');
      expect(typeContent).toContain('validateConfig(config: AppConfig | string): Promise<ValidationResult>;');
      
      // Should contain window interface
      expect(typeContent).toContain('mixedAPI: MixedAPI;');
    });

    it('should generate import statements for types from separate definition files', async () => {
      const mainFile = join(testOutputDir, 'separate-types-main', 'ipc-handlers.ts');
      const preloadFile = join(testOutputDir, 'separate-types-preload', 'bridge.ts');
      const typeDefFile = join(testOutputDir, 'separate-types.d.ts');
      
      const generator = createElectronBridgeGenerator({
        mainProcessHandlerFile: mainFile,
        preloadHandlerFile: preloadFile,
        typeDefinitionsFile: typeDefFile,
        baseDir: testOutputDir
      });
      
      const methods = [
        {
          className: 'UserService',
          methodName: 'createUser',
          namespace: 'userAPI',
          parameters: [{ name: 'userData', type: 'UserCreateRequest' }],
          returnType: 'Promise<User>',
          filePath: 'src/services/UserService.ts'
        },
        {
          className: 'ProductService',
          methodName: 'findProduct',
          namespace: 'productAPI',
          parameters: [{ name: 'criteria', type: 'ProductSearchCriteria' }],
          returnType: 'Promise<Product[]>',
          filePath: 'src/services/ProductService.ts'
        },
        {
          methodName: 'processOrder',
          namespace: 'orderAPI',
          parameters: [
            { name: 'order', type: 'OrderRequest' },
            { name: 'payment', type: 'PaymentInfo' }
          ],
          returnType: 'Promise<OrderResult>',
          filePath: 'src/processors/orderProcessor.ts'
        }
      ];
      
      await generator.generateFiles(methods);
      
      const typeContent = readFileSync(typeDefFile, 'utf8');
      const preloadContent = readFileSync(preloadFile, 'utf8');
      
      // Should contain import statements for custom types from separate files
      expect(typeContent).toContain("import type { UserCreateRequest, User } from './src/services/UserService';");
      expect(typeContent).toContain("import type { ProductSearchCriteria, Product } from './src/services/ProductService';");
      expect(typeContent).toContain("import type { OrderRequest, PaymentInfo, OrderResult } from './src/processors/orderProcessor';");
      
      // Should contain interface definitions
      expect(typeContent).toContain('interface UserAPI {');
      expect(typeContent).toContain('interface ProductAPI {');
      expect(typeContent).toContain('interface OrderAPI {');
      
      // Should contain methods with imported types
      expect(typeContent).toContain('createUser(userData: UserCreateRequest): Promise<User>;');
      expect(typeContent).toContain('findProduct(criteria: ProductSearchCriteria): Promise<Product[]>;');
      expect(typeContent).toContain('processOrder(order: OrderRequest, payment: PaymentInfo): Promise<OrderResult>;');
      
      // Should contain window interface
      expect(typeContent).toContain('userAPI: UserAPI;');
      expect(typeContent).toContain('productAPI: ProductAPI;');
      expect(typeContent).toContain('orderAPI: OrderAPI;');
      
      // Preload file should also contain import statements for custom types
      expect(preloadContent).toContain("import type { UserCreateRequest, User } from '../src/services/UserService';");
      expect(preloadContent).toContain("import type { ProductSearchCriteria, Product } from '../src/services/ProductService';");
      expect(preloadContent).toContain("import type { OrderRequest, PaymentInfo, OrderResult } from '../src/processors/orderProcessor';");
      
      // Preload file should contain typed method signatures
      expect(preloadContent).toContain('createUser: (userData: UserCreateRequest) => controller.invoke');
      expect(preloadContent).toContain('findProduct: (criteria: ProductSearchCriteria) => controller.invoke');
      expect(preloadContent).toContain('processOrder: (order: OrderRequest, payment: PaymentInfo) => controller.invoke');
    });
  });
});
