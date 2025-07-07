import { describe, it, expect, beforeEach } from 'vitest';
import * as ts from 'typescript';
import { createConsoleLogger, createElectronBridgeGenerator } from './index';
import { extractExposedMethods, isCamelCase, toPascalCase } from './visitor';
import { rmSync, existsSync, readFileSync, mkdirSync, mkdtempSync } from 'fs';
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

  describe('ElectronBridgeGenerator', () => {
    it('should create generator with default options', () => {
      const generator = createElectronBridgeGenerator({
        outputDirs: {
          main: join(testOutputDir, 'default-main'),
          preload: join(testOutputDir, 'default-preload')
        },
        typeDefinitionsFile: join(testOutputDir, 'default-types.d.ts')
      });
      
      expect(generator).toBeDefined();
    });

    it('should accept custom options', () => {
      const options = {
        outputDirs: {
          main: 'custom-main',
          preload: 'custom-preload'
        },
        typeDefinitionsFile: 'custom-types/electron.d.ts',
        defaultNamespace: 'customAPI'
      };
      
      const generator = createElectronBridgeGenerator(options);
      expect(generator).toBeDefined();
    });
  });

  describe('Utility Functions', () => {
    it('should validate camelCase correctly', () => {
      expect(isCamelCase('fileAPI')).toBe(true)
      expect(isCamelCase('electronAPI')).toBe(true)
      expect(isCamelCase('FileAPI')).toBe(false)
      expect(isCamelCase('file_api')).toBe(false)
    });

    it('should convert to PascalCase correctly', () => {
      expect(toPascalCase('fileAPI')).toBe('FileAPI')
      expect(toPascalCase('electronAPI')).toBe('ElectronAPI')
      expect(toPascalCase('userManager')).toBe('UserManager')
    });
  });

  describe('Method Extraction', () => {
    it('should extract methods with @decorator expose JSDoc tag from classes', () => {
      const sourceCode = `
        export class FileService {
          /**
           * @decorator expose fileAPI
           */
          async readFile(path: string): Promise<string> {
            return "content"
          }
          
          /**
           * @decorator expose
           */
          async writeFile(path: string, content: string): Promise<void> {
            // implementation
          }
          
          // Method without JSDoc tag should be ignored
          private helperMethod(): void {}
        }
      `;
      
      const sourceFile = ts.createSourceFile(
        'test.ts',
        sourceCode,
        ts.ScriptTarget.Latest,
        true
      );
      const logger = createConsoleLogger();
      
      const methods = extractExposedMethods(logger, sourceFile, 'test.ts', 'electronAPI');
      
      expect(methods).toHaveLength(2);
      
      expect(methods[0]).toMatchObject({
        className: 'FileService',
        methodName: 'readFile',
        namespace: 'fileAPI',
        parameters: [{ name: 'path', type: 'string' }],
        returnType: 'Promise<string>'
      });
      
      expect(methods[1]).toMatchObject({
        className: 'FileService',
        methodName: 'writeFile',
        namespace: 'electronAPI', // default namespace
        parameters: [
          { name: 'path', type: 'string' },
          { name: 'content', type: 'string' }
        ],
        returnType: 'Promise<void>'
      });
    });

    it('should extract standalone functions with @decorator expose JSDoc tag', () => {
      const sourceCode = `
        /**
         * @decorator expose databaseAPI
         */
        async function queryDatabase(sql: string): Promise<any[]> {
          return []
        }
        
        /**
         * @decorator expose
         */
        async function getVersion(): Promise<string> {
          return "1.0.0"
        }
        
        // Function without JSDoc tag should be ignored
        function helperFunction(): void {}
      `;
      
      const sourceFile = ts.createSourceFile(
        'test.ts',
        sourceCode,
        ts.ScriptTarget.Latest,
        true
      );
      const logger = createConsoleLogger();

      const methods = extractExposedMethods(logger, sourceFile, 'test.ts', 'electronAPI');
      
      expect(methods).toHaveLength(2);
      
      expect(methods[0]).toMatchObject({
        methodName: 'queryDatabase',
        namespace: 'databaseAPI',
        parameters: [{ name: 'sql', type: 'string' }],
        returnType: 'Promise<any[]>'
      });
      
      expect(methods[1]).toMatchObject({
        methodName: 'getVersion',
        namespace: 'electronAPI',
        parameters: [],
        returnType: 'Promise<string>'
      });
    });

    it('should handle mixed class methods and standalone functions', () => {
      const sourceCode = `
        export class UserService {
          /**
           * @decorator expose userAPI
           */
          async getUser(id: number): Promise<User> {
            return {} as User
          }
        }
        
        /**
         * @decorator expose systemAPI
         */
        async function getSystemInfo(): Promise<SystemInfo> {
          return {} as SystemInfo
        }
      `;
      
      const sourceFile = ts.createSourceFile(
        'test.ts',
        sourceCode,
        ts.ScriptTarget.Latest,
        true
      );
      const logger = createConsoleLogger();

      const methods = extractExposedMethods(logger, sourceFile, 'test.ts', 'electronAPI');
      
      expect(methods).toHaveLength(2);
      expect(methods[0].className).toBe('UserService');
      expect(methods[1].className).toBeUndefined();
    })

    it('should extract arrow functions with variable binding', () => {
      const sourceCode = `
        /**
         * @decorator expose utilsAPI
         */
        const getSystemInfo = async (): Promise<SystemInfo> => {
          return {} as SystemInfo
        }
        
        /**
         * @decorator expose
         */
        export const processData = async (data: string): Promise<string> => {
          return data.toUpperCase()
        }
      `;
      
      const sourceFile = ts.createSourceFile(
        'test.ts',
        sourceCode,
        ts.ScriptTarget.Latest,
        true
      );
      const logger = createConsoleLogger();

      const methods = extractExposedMethods(logger, sourceFile, 'test.ts', 'electronAPI');
      
      expect(methods).toHaveLength(2);
      
      expect(methods[0]).toMatchObject({
        methodName: 'getSystemInfo',
        namespace: 'utilsAPI',
        parameters: [],
        returnType: 'Promise<SystemInfo>'
      });
      
      expect(methods[1]).toMatchObject({
        methodName: 'processData',
        namespace: 'electronAPI',
        parameters: [{ name: 'data', type: 'string' }],
        returnType: 'Promise<string>'
      });
    });
  });

  describe('Validation', () => {
    it('should validate camelCase namespace arguments', () => {
      const sourceCode = `
        export class TestService {
          /**
           * @decorator expose FileAPI
           */
          async readFile(): Promise<string> {
            return ""
          }
        }
      `;
      
      const sourceFile = ts.createSourceFile(
        'test.ts',
        sourceCode,
        ts.ScriptTarget.Latest,
        true
      );
      
      const warnings: string[] = [];
      const logger = {
        info: () => {},
        warn: (message: string) => warnings.push(message),
        error: () => {}
      };

      const methods = extractExposedMethods(logger, sourceFile, 'test.ts', 'electronAPI');
      
      expect(methods).toHaveLength(0);
      expect(warnings[0]).toMatch(/\[electron-bridge\] Warning: @decorator expose argument should be camelCase: "FileAPI" in TestService\.readFile at test\.ts:\d+/);
    });

    it('should validate Promise return types', () => {
      const sourceCode = `
        export class TestService {
          /**
           * @decorator expose
           */
          readFileSync(): string { // Non-Promise return type - should warn
            return ""
          }
        }
      `;
      
      const sourceFile = ts.createSourceFile(
        'test.ts',
        sourceCode,
        ts.ScriptTarget.Latest,
        true
      );
      
      const warnings: string[] = [];
      const logger = {
        info: () => {},
        warn: (message: string) => warnings.push(message),
        error: () => {}
      };
      
      const methods = extractExposedMethods(logger, sourceFile, 'test.ts', 'electronAPI');
      
      expect(methods).toHaveLength(0);
      expect(warnings[0]).toMatch(/\[electron-bridge\] Warning: @decorator expose method should return Promise: TestService\.readFileSync in test\.ts:\d+/);
    });
  });

  describe('Custom Default Namespace', () => {
    it('should use custom default namespace when specified', () => {
      const sourceCode = `
        export class TestService {
          /**
           * @decorator expose
           */
          async getTest(): Promise<string> {
            return "test"
          }
        }
        
        /**
         * @decorator expose
         */
        export async function getInfo(): Promise<string> {
          return "info"
        }
      `;
      
      const sourceFile = ts.createSourceFile(
        'test.ts',
        sourceCode,
        ts.ScriptTarget.Latest,
        true
      );
      
      const methods = extractExposedMethods(createConsoleLogger(), sourceFile, 'test.ts', 'customAPI');
      
      expect(methods).toHaveLength(2);
      
      // Both methods should use the custom default namespace
      expect(methods[0]).toMatchObject({
        className: 'TestService',
        methodName: 'getTest',
        namespace: 'customAPI',
        returnType: 'Promise<string>'
      });
      
      expect(methods[1]).toMatchObject({
        methodName: 'getInfo',
        namespace: 'customAPI',
        returnType: 'Promise<string>'
      });
    });
  });

  describe('analyzeFile', () => {
    it('should analyze TypeScript code and return exposed methods', () => {
      const generator = createElectronBridgeGenerator({
        outputDirs: {
          main: join(testOutputDir, 'analyze-main'),
          preload: join(testOutputDir, 'analyze-preload')
        },
        typeDefinitionsFile: join(testOutputDir, 'analyze-types.d.ts')
      });
      
      const sourceCode = `
        export class FileService {
          /**
           * @decorator expose fileAPI
           */
          async readFile(path: string): Promise<string> {
            return "content"
          }
        }
      `;
      
      const methods = generator.analyzeFile('src/services/FileService.ts', sourceCode);
      
      expect(methods).toHaveLength(1);
      expect(methods[0]).toMatchObject({
        className: 'FileService',
        methodName: 'readFile',
        namespace: 'fileAPI',
        filePath: 'src/services/FileService.ts'
      });
    });

    it('should skip generated files to avoid analysis loops', () => {
      const tempMainDir = join(testOutputDir, 'temp-main');
      const tempPreloadDir = join(testOutputDir, 'temp-preload');
      const tempTypeFile = join(testOutputDir, 'temp-types.d.ts');
      
      const generator = createElectronBridgeGenerator({
        outputDirs: {
          main: tempMainDir,
          preload: tempPreloadDir
        },
        typeDefinitionsFile: tempTypeFile
      });
      
      const sourceCode = `
        export class FileService {
          /**
           * @decorator expose fileAPI
           */
          async readFile(path: string): Promise<string> {
            return "content"
          }
        }
      `;
      
      // Should skip files in output directories
      expect(generator.analyzeFile(join(tempMainDir, 'ipc-handlers.ts'), sourceCode)).toHaveLength(0);
      expect(generator.analyzeFile(join(tempPreloadDir, 'bridge.ts'), sourceCode)).toHaveLength(0);
      expect(generator.analyzeFile(tempTypeFile, sourceCode)).toHaveLength(0);
      
      // Should analyze files not in output directories
      expect(generator.analyzeFile('src/services/FileService.ts', sourceCode)).toHaveLength(1);
    });

    it('should handle different file paths correctly', () => {
      const generator = createElectronBridgeGenerator({
        outputDirs: {
          main: join(testOutputDir, 'paths-main'),
          preload: join(testOutputDir, 'paths-preload')
        },
        typeDefinitionsFile: join(testOutputDir, 'paths-types.d.ts')
      });
      
      const sourceCode = `
        /**
         * @decorator expose utilsAPI
         */
        export async function processData(): Promise<string> {
          return "processed"
        }
      `;
      
      const methods1 = generator.analyzeFile('/absolute/path/utils.ts', sourceCode);
      const methods2 = generator.analyzeFile('relative/path/utils.ts', sourceCode);
      const methods3 = generator.analyzeFile('utils.ts', sourceCode);
      
      expect(methods1[0].filePath).toBe('/absolute/path/utils.ts');
      expect(methods2[0].filePath).toBe('relative/path/utils.ts');
      expect(methods3[0].filePath).toBe('utils.ts');
    });

    it('should handle malformed TypeScript code gracefully', () => {
      const generator = createElectronBridgeGenerator({
        outputDirs: {
          main: join(testOutputDir, 'malformed-main'),
          preload: join(testOutputDir, 'malformed-preload')
        },
        typeDefinitionsFile: join(testOutputDir, 'malformed-types.d.ts')
      });
      
      // This should not throw an error, but may not extract methods correctly
      const sourceCode = `
        export class FileService {
          /**
           * @decorator expose fileAPI
           */
          async readFile(path: string): Promise<string> {
            return "content"
          // Missing closing brace
      `;
      
      expect(() => {
        const methods = generator.analyzeFile('test.ts', sourceCode);
        // Should return empty array or whatever TypeScript parser can handle
        expect(Array.isArray(methods)).toBe(true);
      }).not.toThrow();
    });
  });

  describe('generateFiles', () => {
    beforeEach(() => {
      // Ensure test output directory exists
      if (!existsSync(testOutputDir)) {
        mkdirSync(testOutputDir, { recursive: true });
      }
    });

    it('should generate all three output files', () => {
      const mainDir = join(testOutputDir, 'main');
      const preloadDir = join(testOutputDir, 'preload');
      const typeFile = join(testOutputDir, 'types', 'electron-api.d.ts');
      
      const generator = createElectronBridgeGenerator({
        outputDirs: {
          main: mainDir,
          preload: preloadDir
        },
        typeDefinitionsFile: typeFile
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
      
      generator.generateFiles(methods);
      
      // Check that all files are created
      expect(existsSync(join(mainDir, 'ipc-handlers.ts'))).toBe(true);
      expect(existsSync(join(preloadDir, 'bridge.ts'))).toBe(true);
      expect(existsSync(typeFile)).toBe(true);
    });

    it('should generate correct main handlers content', () => {
      const mainDir = join(testOutputDir, 'main-handlers');
      const preloadDir = join(testOutputDir, 'preload-handlers');
      
      const generator = createElectronBridgeGenerator({
        outputDirs: {
          main: mainDir,
          preload: preloadDir
        },
        typeDefinitionsFile: join(testOutputDir, 'main-handlers-types.d.ts'),
        baseDir: testOutputDir
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
      
      generator.generateFiles(methods);
      
      const mainContent = readFileSync(join(mainDir, 'ipc-handlers.ts'), 'utf8');
      
      const expectedMainContent = `import { ipcMain } from 'electron'
import { FileService } from '../src/services/FileService'
import { getVersion } from '../src/utils/version'

// Create singleton instances
const fileserviceInstance = new FileService()

// Register IPC handlers
ipcMain.handle('api:fileAPI:readFile', (event, path) => fileserviceInstance.readFile(path))
ipcMain.handle('api:systemAPI:getVersion', (event) => getVersion())`;
      
      expect(mainContent).toBe(expectedMainContent);
    });

    it('should generate correct preload bridge content', () => {
      const mainDir = join(testOutputDir, 'main-bridge');
      const preloadDir = join(testOutputDir, 'preload-bridge');
      
      const generator = createElectronBridgeGenerator({
        outputDirs: {
          main: mainDir,
          preload: preloadDir
        },
        typeDefinitionsFile: join(testOutputDir, 'preload-bridge-types.d.ts')
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
      
      generator.generateFiles(methods);
      
      const preloadContent = readFileSync(join(preloadDir, 'bridge.ts'), 'utf8');
      
      const expectedPreloadContent = `import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('fileAPI', {
  readFile: (path: string) => ipcRenderer.invoke('api:fileAPI:readFile', path)
})
contextBridge.exposeInMainWorld('systemAPI', {
  getVersion: () => ipcRenderer.invoke('api:systemAPI:getVersion')
})`;
      
      expect(preloadContent).toBe(expectedPreloadContent);
    });

    it('should generate correct type definitions content', () => {
      const mainDir = join(testOutputDir, 'main-types');
      const preloadDir = join(testOutputDir, 'preload-types');
      const typeFile = join(testOutputDir, 'electron-api.d.ts');
      
      const generator = createElectronBridgeGenerator({
        outputDirs: {
          main: mainDir,
          preload: preloadDir
        },
        typeDefinitionsFile: typeFile
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
      
      generator.generateFiles(methods);
      
      const typeContent = readFileSync(typeFile, 'utf8');
      
      const expectedTypeContent = `interface FileAPI {
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
}

declare global {
  interface Window {
    fileAPI: FileAPI
  }
}

export {}`;
      
      expect(typeContent).toBe(expectedTypeContent);
    });

    it('should handle relative paths when baseDir is specified', () => {
      const mainDir = join(testOutputDir, 'main-relative');
      const baseDir = testOutputDir;
      
      const generator = createElectronBridgeGenerator({
        outputDirs: {
          main: mainDir,
          preload: join(testOutputDir, 'preload-relative')
        },
        typeDefinitionsFile: join(testOutputDir, 'relative-types.d.ts'),
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
      
      generator.generateFiles(methods);
      
      const mainContent = readFileSync(join(mainDir, 'ipc-handlers.ts'), 'utf8');
      
      // Should use relative path, not absolute path
      expect(mainContent).toContain("import { FileService } from '../src/services/FileService'");
      expect(mainContent).not.toContain(resolve(baseDir, 'src/services/FileService'));
    });

    it('should handle empty methods array', () => {
      const generator = createElectronBridgeGenerator({
        outputDirs: {
          main: join(testOutputDir, 'empty-main'),
          preload: join(testOutputDir, 'empty-preload')
        },
        typeDefinitionsFile: join(testOutputDir, 'empty-types.d.ts')
      });
      
      // Should not create files when no methods provided
      expect(() => generator.generateFiles([])).not.toThrow();
      
      // Files should not be created
      expect(existsSync(join(testOutputDir, 'empty-main', 'ipc-handlers.ts'))).toBe(false);
      expect(existsSync(join(testOutputDir, 'empty-preload', 'bridge.ts'))).toBe(false);
    });

    it('should handle multiple namespaces correctly', () => {
      const mainDir = join(testOutputDir, 'multi-namespace');
      const preloadDir = join(testOutputDir, 'multi-preload');
      
      const generator = createElectronBridgeGenerator({
        outputDirs: {
          main: mainDir,
          preload: preloadDir
        },
        typeDefinitionsFile: join(testOutputDir, 'multi-types.d.ts')
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
      
      generator.generateFiles(methods);
      
      const preloadContent = readFileSync(join(preloadDir, 'bridge.ts'), 'utf8');
      
      // Should have all three namespaces
      expect(preloadContent).toContain("contextBridge.exposeInMainWorld('fileAPI'");
      expect(preloadContent).toContain("contextBridge.exposeInMainWorld('systemAPI'");
      expect(preloadContent).toContain("contextBridge.exposeInMainWorld('dbAPI'");
    });

    it('should deduplicate identical class imports', () => {
      const mainDir = join(testOutputDir, 'dedupe-main');
      
      const generator = createElectronBridgeGenerator({
        outputDirs: {
          main: mainDir,
          preload: join(testOutputDir, 'dedupe-preload')
        },
        typeDefinitionsFile: join(testOutputDir, 'dedupe-types.d.ts')
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
      
      generator.generateFiles(methods);
      
      const mainContent = readFileSync(join(mainDir, 'ipc-handlers.ts'), 'utf8');
      
      // Should only have one import statement for FileService
      const importMatches = mainContent.match(/import { FileService } from/g);
      expect(importMatches).toHaveLength(1);
      
      // Should only have one singleton instance
      const instanceMatches = mainContent.match(/const fileserviceInstance = new FileService\(\)/g);
      expect(instanceMatches).toHaveLength(1);
    });

    it('should generate files with complex namespace combinations', () => {
      const mainDir = join(testOutputDir, 'complex-main');
      const preloadDir = join(testOutputDir, 'complex-preload');
      const typeFile = join(testOutputDir, 'complex-types.d.ts');
      
      const generator = createElectronBridgeGenerator({
        outputDirs: {
          main: mainDir,
          preload: preloadDir
        },
        typeDefinitionsFile: typeFile,
        baseDir: testOutputDir
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
      
      generator.generateFiles(methods);
      
      // Test main handlers
      const mainContent = readFileSync(join(mainDir, 'ipc-handlers.ts'), 'utf8');
      const expectedMainContent = `import { ipcMain } from 'electron'
import { FileService } from '../src/services/FileService'
import { formatDate } from '../src/utils/format'
import { getVersion } from '../src/utils/system'

// Create singleton instances
const fileserviceInstance = new FileService()

// Register IPC handlers
ipcMain.handle('api:fileAPI:readFile', (event, path) => fileserviceInstance.readFile(path))
ipcMain.handle('api:fileAPI:writeFile', (event, path, content) => fileserviceInstance.writeFile(path, content))
ipcMain.handle('api:systemAPI:getVersion', (event) => getVersion())
ipcMain.handle('api:utilsAPI:formatDate', (event, date) => formatDate(date))`;
      
      expect(mainContent).toBe(expectedMainContent);
      
      // Test preload bridge
      const preloadContent = readFileSync(join(preloadDir, 'bridge.ts'), 'utf8');
      const expectedPreloadContent = `import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('fileAPI', {
  readFile: (path: string) => ipcRenderer.invoke('api:fileAPI:readFile', path),
  writeFile: (path: string, content: string) => ipcRenderer.invoke('api:fileAPI:writeFile', path, content)
})
contextBridge.exposeInMainWorld('systemAPI', {
  getVersion: () => ipcRenderer.invoke('api:systemAPI:getVersion')
})
contextBridge.exposeInMainWorld('utilsAPI', {
  formatDate: (date: Date) => ipcRenderer.invoke('api:utilsAPI:formatDate', date)
})`;
      
      expect(preloadContent).toBe(expectedPreloadContent);
      
      // Test type definitions
      const typeContent = readFileSync(typeFile, 'utf8');
      const expectedTypeContent = `interface FileAPI {
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
}
interface SystemAPI {
  getVersion(): Promise<string>
}
interface UtilsAPI {
  formatDate(date: Date): Promise<string>
}

declare global {
  interface Window {
    fileAPI: FileAPI
    systemAPI: SystemAPI
    utilsAPI: UtilsAPI
  }
}

export {}`;
      
      expect(typeContent).toBe(expectedTypeContent);
    });
  });
});
