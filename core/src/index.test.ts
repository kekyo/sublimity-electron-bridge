import { describe, it, expect, beforeEach } from 'vitest';
import * as ts from 'typescript';
import { createConsoleLogger, createElectronBridgeGenerator } from './index';
import { extractExposedMethods, isCamelCase, toPascalCase } from './visitor';
import { rmSync, existsSync, mkdtempSync } from 'fs';
import { join } from 'path';
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

  describe('Method Extraction', () => {
    it('should extract methods with @decorator expose JSDoc tag from classes', async () => {
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
      
      const methods = await extractExposedMethods(logger, sourceFile, 'test.ts', 'electronAPI');
      
      expect(methods).toHaveLength(2);
      
      expect(methods[0]).toMatchObject({
        declaredType: { name: 'FileService' },
        methodName: 'readFile',
        namespace: 'fileAPI',
        parameters: [{ name: 'path', type: { name: 'string' } }],
        returnType: { name: 'Promise<string>' }
      });
      
      expect(methods[1]).toMatchObject({
        declaredType: { name: 'FileService' },
        methodName: 'writeFile',
        namespace: 'electronAPI', // default namespace
        parameters: [
          { name: 'path', type: { name: 'string' } },
          { name: 'content', type: { name: 'string' } }
        ],
        returnType: { name: 'Promise<void>' }
      });
    });

    it('should handle mixed class methods and standalone functions', async () => {
      const sourceCode = `
        export class DatabaseService {
          /**
           * @decorator expose databaseAPI
           */
          async query(sql: string): Promise<any[]> {
            return []
          }
        }
        
        /**
         * @decorator expose utilsAPI
         */
        async function getTimestamp(): Promise<number> {
          return Date.now()
        }
      `;
      
      const sourceFile = ts.createSourceFile(
        'test.ts',
        sourceCode,
        ts.ScriptTarget.Latest,
        true
      );
      const logger = createConsoleLogger();
      
      const methods = await extractExposedMethods(logger, sourceFile, 'test.ts', 'mainProcess');
      
      expect(methods).toHaveLength(2);
      
      expect(methods[0]).toMatchObject({
        declaredType: { name: 'DatabaseService' },
        methodName: 'query',
        namespace: 'databaseAPI'
      });
      
      expect(methods[1]).toMatchObject({
        methodName: 'getTimestamp',
        namespace: 'utilsAPI'
      });
    });

    it('should extract standalone functions with @decorator expose JSDoc tag', async () => {
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

      const methods = await extractExposedMethods(logger, sourceFile, 'test.ts', 'electronAPI');
      
      expect(methods).toHaveLength(2);
      
      expect(methods[0]).toMatchObject({
        methodName: 'queryDatabase',
        namespace: 'databaseAPI',
        parameters: [{ name: 'sql', type: { name: 'string' } }],
        returnType: { name: 'Promise<any[]>' }
      });
      
      expect(methods[1]).toMatchObject({
        methodName: 'getVersion',
        namespace: 'electronAPI', // default namespace
        parameters: [],
        returnType: { name: 'Promise<string>' }
      });
    });

    it('should extract arrow functions with variable binding', async () => {
      const sourceCode = `
        /**
         * @decorator expose systemAPI
         */
        const getSystemInfo = async (): Promise<object> => {
          return { platform: 'win32', version: '10.0.0' }
        }
        
        /**
         * @decorator expose
         */
        const getCurrentUser = async (id: number): Promise<string> => {
          return "user"
        }
      `;
      
      const sourceFile = ts.createSourceFile(
        'test.ts',
        sourceCode,
        ts.ScriptTarget.Latest,
        true
      );
      const logger = createConsoleLogger();

      const methods = await extractExposedMethods(logger, sourceFile, 'test.ts', 'mainProcess');
      
      expect(methods).toHaveLength(2);
      
      expect(methods[0]).toMatchObject({
        methodName: 'getSystemInfo',
        namespace: 'systemAPI',
        parameters: [],
        returnType: { name: 'Promise<object>' }
      });
      
      expect(methods[1]).toMatchObject({
        methodName: 'getCurrentUser',
        namespace: 'mainProcess', // default namespace
        parameters: [{ name: 'id', type: { name: 'number' } }],
        returnType: { name: 'Promise<string>' }
      });
    });
  });

  describe('Validation', () => {
    it('should validate Promise return types', async () => {
      const sourceCode = `
        export class FileService {
          /**
           * @decorator expose fileAPI
           */
          readFile(path: string): string {
            return "content"
          }
        }
      `;
      
      const sourceFile = ts.createSourceFile(
        'test.ts',
        sourceCode,
        ts.ScriptTarget.Latest,
        true
      );
      const logger = createConsoleLogger();
      
      const methods = await extractExposedMethods(logger, sourceFile, 'test.ts', 'electronAPI');
      
      // Should still return 0 methods because it doesn't return Promise
      expect(methods).toHaveLength(0);
    });

    it('should validate camelCase namespace', async () => {
      const sourceCode = `
        export class FileService {
          /**
           * @decorator expose FileAPI
           */
          async readFile(path: string): Promise<string> {
            return "content"
          }
        }
      `;
      
      const sourceFile = ts.createSourceFile(
        'test.ts',
        sourceCode,
        ts.ScriptTarget.Latest,
        true
      );
      const logger = createConsoleLogger();
      
      const methods = await extractExposedMethods(logger, sourceFile, 'test.ts', 'electronAPI');
      
      // Should return 0 methods because namespace is not camelCase
      expect(methods).toHaveLength(0);
    });
  });

  describe('Custom Default Namespace', () => {
    it('should use custom default namespace when specified', async () => {
      const sourceCode = `
        export class FileService {
          /**
           * @decorator expose
           */
          async readFile(path: string): Promise<string> {
            return "content"
          }
        }
      `;
      
      const sourceFile = ts.createSourceFile(
        'test.ts',
        sourceCode,
        ts.ScriptTarget.Latest,
        true
      );
      const logger = createConsoleLogger();
      
      const methods = await extractExposedMethods(logger, sourceFile, 'test.ts', 'customAPI');
      
      expect(methods).toHaveLength(1);
      expect(methods[0]).toMatchObject({
        namespace: 'customAPI'
      });
    });
  });
});