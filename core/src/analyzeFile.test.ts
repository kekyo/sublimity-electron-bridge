import { describe, it, expect, beforeEach } from 'vitest';
import { createElectronBridgeGenerator } from './index';
import { rmSync, existsSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ElectronBridgeCore - analyzeFile', () => {
  const testOutputDir = mkdtempSync(join(tmpdir(), 'cli-test-'));
  
  beforeEach(() => {
    // Clean up test output directory
    if (existsSync(testOutputDir)) {
      rmSync(testOutputDir, { recursive: true, force: true });
    }
  });

  describe('analyzeFile', () => {
    it('should analyze TypeScript code and return exposed methods', async () => {
      const generator = createElectronBridgeGenerator({
        mainProcessHandlerFile: join(testOutputDir, 'analyze-main', 'ipc-handlers.ts'),
        preloadHandlerFile: join(testOutputDir, 'analyze-preload', 'bridge.ts'),
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

      const methods = await generator.analyzeFile('src/services/FileService.ts', sourceCode);
      
      expect(methods).toHaveLength(1);
      expect(methods[0]).toMatchObject({
        declaredType: { name: 'FileService' },
        methodName: 'readFile',
        namespace: 'fileAPI',
        parameters: [{ name: 'path', type: { name: 'string' } }],
        returnType: { name: 'Promise<string>' }
      });
    });

    it('should skip generated files to avoid analysis loops', async () => {
      const generator = createElectronBridgeGenerator({
        mainProcessHandlerFile: join(testOutputDir, 'main', 'ipc-handlers.ts'),
        preloadHandlerFile: join(testOutputDir, 'preload', 'bridge.ts'),
        typeDefinitionsFile: join(testOutputDir, 'types.d.ts')
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

      // Should skip the generated file
      const methods = await generator.analyzeFile('src/services/FileService.ts', sourceCode);
      expect(methods).toHaveLength(1);
      
      // Should skip main process handler file
      const mainMethods = await generator.analyzeFile(join(testOutputDir, 'main', 'ipc-handlers.ts'), sourceCode);
      expect(mainMethods).toHaveLength(0);
      
      // Should skip preload handler file
      const preloadMethods = await generator.analyzeFile(join(testOutputDir, 'preload', 'bridge.ts'), sourceCode);
      expect(preloadMethods).toHaveLength(0);
      
      // Should skip type definitions file
      const typeMethods = await generator.analyzeFile(join(testOutputDir, 'types.d.ts'), sourceCode);
      expect(typeMethods).toHaveLength(0);
    });

    it('should handle different file paths correctly', async () => {
      const generator = createElectronBridgeGenerator({
        mainProcessHandlerFile: join(testOutputDir, 'main', 'ipc-handlers.ts'),
        preloadHandlerFile: join(testOutputDir, 'preload', 'bridge.ts'),
        typeDefinitionsFile: join(testOutputDir, 'types.d.ts')
      });
      
      const sourceCode = `
        /**
         * @decorator expose utilsAPI
         */
        async function processData(data: any): Promise<any> {
          return data;
        }
      `;

      // Test with absolute path
      const absoluteMethods = await generator.analyzeFile('/absolute/path/utils.ts', sourceCode);
      expect(absoluteMethods).toHaveLength(1);
      expect(absoluteMethods[0]).toMatchObject({
        methodName: 'processData',
        namespace: 'utilsAPI',
        filePath: '/absolute/path/utils.ts'
      });
      
      // Test with relative path
      const relativeMethods = await generator.analyzeFile('relative/path/utils.ts', sourceCode);
      expect(relativeMethods).toHaveLength(1);
      expect(relativeMethods[0]).toMatchObject({
        methodName: 'processData',
        namespace: 'utilsAPI',
        filePath: 'relative/path/utils.ts'
      });
      
      // Test with file name only
      const fileOnlyMethods = await generator.analyzeFile('utils.ts', sourceCode);
      expect(fileOnlyMethods).toHaveLength(1);
      expect(fileOnlyMethods[0]).toMatchObject({
        methodName: 'processData',
        namespace: 'utilsAPI',
        filePath: 'utils.ts'
      });
    });

    it('should handle malformed TypeScript code gracefully', async () => {
      const generator = createElectronBridgeGenerator({
        mainProcessHandlerFile: join(testOutputDir, 'main', 'ipc-handlers.ts'),
        preloadHandlerFile: join(testOutputDir, 'preload', 'bridge.ts'),
        typeDefinitionsFile: join(testOutputDir, 'types.d.ts')
      });
      
      const malformedCode = `
        export class FileService {
          /**
           * @decorator expose fileAPI
           */
          async readFile(path: string): Promise<string> {
            return "content"
          }
          // Missing closing brace
      `;

      expect(async () => {
        await generator.analyzeFile('test.ts', malformedCode);
      }).not.toThrow();
    });
  });
});