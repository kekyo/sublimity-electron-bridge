import { describe, it, expect, beforeEach } from 'vitest'
import * as ts from 'typescript'
import { ElectronBridgeGenerator, extractExposedMethods, isCamelCase, toPascalCase } from './index'
import { rmSync, existsSync } from 'fs'

describe('ElectronBridgeCore', () => {
  const testOutputDir = 'test-output'
  
  beforeEach(() => {
    // Clean up test output directory
    if (existsSync(testOutputDir)) {
      rmSync(testOutputDir, { recursive: true, force: true })
    }
  })

  describe('ElectronBridgeGenerator', () => {
    it('should create generator with default options', () => {
      const generator = new ElectronBridgeGenerator()
      
      expect(generator).toBeDefined()
    })

    it('should accept custom options', () => {
      const options = {
        outputDirs: {
          main: 'custom-main',
          preload: 'custom-preload'
        },
        typeDefinitionsFile: 'custom-types/electron.d.ts',
        defaultNamespace: 'customAPI'
      }
      
      const generator = new ElectronBridgeGenerator(options)
      expect(generator).toBeDefined()
    })
  })

  describe('Utility Functions', () => {
    it('should validate camelCase correctly', () => {
      expect(isCamelCase('fileAPI')).toBe(true)
      expect(isCamelCase('electronAPI')).toBe(true)
      expect(isCamelCase('FileAPI')).toBe(false)
      expect(isCamelCase('file_api')).toBe(false)
    })

    it('should convert to PascalCase correctly', () => {
      expect(toPascalCase('fileAPI')).toBe('FileAPI')
      expect(toPascalCase('electronAPI')).toBe('ElectronAPI')
      expect(toPascalCase('userManager')).toBe('UserManager')
    })
  })

  describe('Method Extraction', () => {
    it('should extract methods with @ExposeToRenderer decorator from classes', () => {
      const sourceCode = `
        export class FileService {
          @ExposeToRenderer("fileAPI")
          async readFile(path: string): Promise<string> {
            return "content"
          }
          
          @ExposeToRenderer()
          async writeFile(path: string, content: string): Promise<void> {
            // implementation
          }
          
          // Method without decorator should be ignored
          private helperMethod(): void {}
        }
      `
      
      const sourceFile = ts.createSourceFile(
        'test.ts',
        sourceCode,
        ts.ScriptTarget.Latest,
        true
      )
      
      const methods = extractExposedMethods(sourceFile, 'test.ts')
      
      expect(methods).toHaveLength(2)
      
      expect(methods[0]).toMatchObject({
        className: 'FileService',
        methodName: 'readFile',
        namespace: 'fileAPI',
        parameters: [{ name: 'path', type: 'string' }],
        returnType: 'Promise<string>'
      })
      
      expect(methods[1]).toMatchObject({
        className: 'FileService',
        methodName: 'writeFile',
        namespace: 'electronAPI', // default namespace
        parameters: [
          { name: 'path', type: 'string' },
          { name: 'content', type: 'string' }
        ],
        returnType: 'Promise<void>'
      })
    })

    it('should extract standalone functions with @ExposeToRenderer decorator', () => {
      const sourceCode = `
        @ExposeToRenderer("databaseAPI")
        async function queryDatabase(sql: string): Promise<any[]> {
          return []
        }
        
        @ExposeToRenderer()
        async function getVersion(): Promise<string> {
          return "1.0.0"
        }
        
        // Function without decorator should be ignored
        function helperFunction(): void {}
      `
      
      const sourceFile = ts.createSourceFile(
        'test.ts',
        sourceCode,
        ts.ScriptTarget.Latest,
        true
      )
      
      const methods = extractExposedMethods(sourceFile, 'test.ts')
      
      expect(methods).toHaveLength(2)
      
      expect(methods[0]).toMatchObject({
        methodName: 'queryDatabase',
        namespace: 'databaseAPI',
        parameters: [{ name: 'sql', type: 'string' }],
        returnType: 'Promise<any[]>'
      })
      
      expect(methods[1]).toMatchObject({
        methodName: 'getVersion',
        namespace: 'electronAPI',
        parameters: [],
        returnType: 'Promise<string>'
      })
    })

    it('should handle mixed class methods and standalone functions', () => {
      const sourceCode = `
        export class UserService {
          @ExposeToRenderer("userAPI")
          async getUser(id: number): Promise<User> {
            return {} as User
          }
        }
        
        @ExposeToRenderer("systemAPI")
        async function getSystemInfo(): Promise<SystemInfo> {
          return {} as SystemInfo
        }
      `
      
      const sourceFile = ts.createSourceFile(
        'test.ts',
        sourceCode,
        ts.ScriptTarget.Latest,
        true
      )
      
      const methods = extractExposedMethods(sourceFile, 'test.ts')
      
      expect(methods).toHaveLength(2)
      expect(methods[0].className).toBe('UserService')
      expect(methods[1].className).toBeUndefined()
    })
  })

  describe('Validation', () => {
    it('should validate camelCase namespace arguments', () => {
      const sourceCode = `
        export class TestService {
          @ExposeToRenderer("FileAPI") // PascalCase - should throw error
          async readFile(): Promise<string> {
            return ""
          }
        }
      `
      
      const sourceFile = ts.createSourceFile(
        'test.ts',
        sourceCode,
        ts.ScriptTarget.Latest,
        true
      )
      
      expect(() => {
        extractExposedMethods(sourceFile, 'test.ts')
      }).toThrow('ExposeToRenderer argument must be camelCase: "FileAPI"')
    })

    it('should validate Promise return types', () => {
      const sourceCode = `
        export class TestService {
          @ExposeToRenderer()
          readFileSync(): string { // Non-Promise return type - should throw error
            return ""
          }
        }
      `
      
      const sourceFile = ts.createSourceFile(
        'test.ts',
        sourceCode,
        ts.ScriptTarget.Latest,
        true
      )
      
      expect(() => {
        extractExposedMethods(sourceFile, 'test.ts')
      }).toThrow('ExposeToRenderer method must return Promise')
    })
  })
})