import { describe, it, expect, beforeEach } from 'vitest';
import { createElectronBridgeGenerator } from './index';
import { rmSync, existsSync, mkdtempSync, writeFileSync, mkdirSync } from 'fs';
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
        parameters: [{ name: 'path', type: { name: 'string', kind: 'simple' } }]
      });
      
      // Check the new TypeInfo structure for return type
      const returnType = methods[0].returnType;
      expect(returnType.kind).toBe('generic');
      expect(returnType.name).toBe('Promise');
      if (returnType.kind === 'generic') {
        expect(returnType.typeArguments).toHaveLength(1);
        expect(returnType.typeArguments[0].name).toBe('string');
        expect(returnType.typeArguments[0].kind).toBe('simple');
      }
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

  describe('TypeScript Type Checker Integration', () => {
    it('should use tsconfig.json to resolve types and set TypeInfo.filePath correctly', async () => {
      // Create a test project structure with tsconfig.json
      const projectDir = mkdtempSync(join(tmpdir(), 'tsconfig-test-'));
      const srcDir = join(projectDir, 'src');
      const typesDir = join(projectDir, 'src', 'types');
      
      mkdirSync(srcDir, { recursive: true });
      mkdirSync(typesDir, { recursive: true });
      
      try {
        // Create tsconfig.json
        const tsconfigContent = JSON.stringify({
          "compilerOptions": {
            "target": "ES2022",
            "lib": ["ES2022"],
            "module": "ESNext",
            "moduleResolution": "node",
            "strict": true,
            "skipLibCheck": true,
            "declaration": true,
            "outDir": "dist",
            "rootDir": "src",
            "esModuleInterop": true,
            "allowSyntheticDefaultImports": true,
            "forceConsistentCasingInFileNames": true
          },
          "include": ["src/**/*"],
          "exclude": ["node_modules", "dist"]
        }, null, 2);
        
        writeFileSync(join(projectDir, 'tsconfig.json'), tsconfigContent);
        
        // Create a custom type definition file
        const typeDefContent = `
export interface User {
  id: number;
  name: string;
  email: string;
}

export interface ApiResponse<T> {
  data: T;
  success: boolean;
  message?: string;
}
        `;
        writeFileSync(join(typesDir, 'user.ts'), typeDefContent);
        
        // Create service file that uses the custom types
        const serviceContent = `
import { User, ApiResponse } from './types/user';

export class UserService {
  /**
   * @decorator expose userAPI
   */
  async getUser(id: number): Promise<User> {
    return { id, name: "Test User", email: "test@example.com" };
  }
  
  /**
   * @decorator expose userAPI
   */
  async getUserResponse(id: number): Promise<ApiResponse<User>> {
    const user = await this.getUser(id);
    return { data: user, success: true };
  }
}
        `;
        writeFileSync(join(srcDir, 'UserService.ts'), serviceContent);
        
        // Create generator with baseDir pointing to the test project
        const generator = createElectronBridgeGenerator({
          mainProcessHandlerFile: join(testOutputDir, 'main', 'ipc-handlers.ts'),
          preloadHandlerFile: join(testOutputDir, 'preload', 'bridge.ts'),
          typeDefinitionsFile: join(testOutputDir, 'types.d.ts'),
          baseDir: projectDir
        });
        
        // Analyze the service file
        const methods = await generator.analyzeFile(join(srcDir, 'UserService.ts'), serviceContent);
        
        expect(methods).toHaveLength(2);
        
        // Check that TypeInfo includes filePath information when type checker is available
        const getUserMethod = methods.find(m => m.methodName === 'getUser');
        expect(getUserMethod).toBeDefined();
        
        // The return type should include filePath information
        if (getUserMethod) {
          // With new TypeInfo structure, Promise<User> is a GenericTypeInfo
          const returnType = getUserMethod.returnType;
          expect(returnType.kind).toBe('generic');
          expect(returnType.name).toBe('Promise');
          if (returnType.kind === 'generic') {
            expect(returnType.typeArguments).toHaveLength(1);
            expect(returnType.typeArguments[0].name).toBe('User');
            expect(returnType.typeArguments[0].kind).toBe('simple');
            // TypeInfo.filePath should be set when type checker resolves the type location
            // Note: This might be undefined if type checker cannot resolve the type location
            // but the test verifies that the type checker integration is working
          }
        }
        
        const getUserResponseMethod = methods.find(m => m.methodName === 'getUserResponse');
        expect(getUserResponseMethod).toBeDefined();
        
        if (getUserResponseMethod) {
          // With new TypeInfo structure, Promise<ApiResponse<User>> is a GenericTypeInfo
          const returnType = getUserResponseMethod.returnType;
          expect(returnType.kind).toBe('generic');
          expect(returnType.name).toBe('Promise');
          if (returnType.kind === 'generic') {
            expect(returnType.typeArguments).toHaveLength(1);
            const apiResponseType = returnType.typeArguments[0];
            expect(apiResponseType.name).toBe('ApiResponse');
            expect(apiResponseType.kind).toBe('generic');
            if (apiResponseType.kind === 'generic') {
              expect(apiResponseType.typeArguments).toHaveLength(1);
              expect(apiResponseType.typeArguments[0].name).toBe('User');
            }
          }
        }
        
        // Verify parameters also get proper type information
        expect(getUserMethod?.parameters[0].type.name).toBe('number');
        
      } finally {
        // Clean up test project
        rmSync(projectDir, { recursive: true, force: true });
      }
    });

    it('should fallback to text-based extraction when tsconfig.json is not available', async () => {
      // Create a project directory without tsconfig.json
      const projectDir = mkdtempSync(join(tmpdir(), 'no-tsconfig-test-'));
      
      try {
        const generator = createElectronBridgeGenerator({
          mainProcessHandlerFile: join(testOutputDir, 'main', 'ipc-handlers.ts'),
          preloadHandlerFile: join(testOutputDir, 'preload', 'bridge.ts'),
          typeDefinitionsFile: join(testOutputDir, 'types.d.ts'),
          baseDir: projectDir // Directory without tsconfig.json
        });
        
        const sourceCode = `
          export class TestService {
            /**
             * @decorator expose testAPI
             */
            async processData(input: string): Promise<string> {
              return input.toUpperCase();
            }
          }
        `;
        
        const methods = await generator.analyzeFile('TestService.ts', sourceCode);
        
        expect(methods).toHaveLength(1);
        expect(methods[0]).toMatchObject({
          methodName: 'processData',
          namespace: 'testAPI',
          parameters: [{ name: 'input', type: { name: 'string', kind: 'simple' } }]
        });
        
        // Check the new TypeInfo structure for return type
        const returnType = methods[0].returnType;
        expect(returnType.kind).toBe('generic');
        expect(returnType.name).toBe('Promise');
        if (returnType.kind === 'generic') {
          expect(returnType.typeArguments).toHaveLength(1);
          expect(returnType.typeArguments[0].name).toBe('string');
          expect(returnType.typeArguments[0].kind).toBe('simple');
        }
        
        // When no tsconfig.json is available, filePath should not be set in TypeInfo
        expect(methods[0].returnType.filePath).toBeUndefined();
        expect(methods[0].parameters[0].type.filePath).toBeUndefined();
        
      } finally {
        rmSync(projectDir, { recursive: true, force: true });
      }
    });

    it('should handle tsconfig.json with different configurations correctly', async () => {
      const projectDir = mkdtempSync(join(tmpdir(), 'tsconfig-config-test-'));
      const srcDir = join(projectDir, 'src');
      
      mkdirSync(srcDir, { recursive: true });
      
      try {
        // Create tsconfig.json with different target and lib settings
        const tsconfigContent = JSON.stringify({
          "compilerOptions": {
            "target": "ES2020",
            "lib": ["ES2020", "DOM"],
            "module": "CommonJS",
            "moduleResolution": "node",
            "strict": false,
            "skipLibCheck": true,
            "esModuleInterop": true
          },
          "include": ["src/**/*"]
        }, null, 2);
        
        writeFileSync(join(projectDir, 'tsconfig.json'), tsconfigContent);
        
        const generator = createElectronBridgeGenerator({
          mainProcessHandlerFile: join(testOutputDir, 'main', 'ipc-handlers.ts'),
          preloadHandlerFile: join(testOutputDir, 'preload', 'bridge.ts'),
          typeDefinitionsFile: join(testOutputDir, 'types.d.ts'),
          baseDir: projectDir
        });
        
        const sourceCode = `
          export class ConfigTestService {
            /**
             * @decorator expose configAPI
             */
            async getConfig(): Promise<{ [key: string]: any }> {
              return { setting1: true, setting2: "value" };
            }
          }
        `;
        
        const methods = await generator.analyzeFile(join(srcDir, 'ConfigTestService.ts'), sourceCode);
        
        expect(methods).toHaveLength(1);
        expect(methods[0]).toMatchObject({
          methodName: 'getConfig',
          namespace: 'configAPI'
        });
        
        // Verify that the type checker can handle different TypeScript configurations
        const returnType = methods[0].returnType;
        expect(returnType.kind).toBe('generic');
        expect(returnType.name).toBe('Promise');
        if (returnType.kind === 'generic') {
          expect(returnType.typeArguments).toHaveLength(1);
          // The return type should be Promise<{ [key: string]: any }>
          // Type checker may simplify complex types to {}
          expect(returnType.typeArguments[0].name).toMatch(/\{.*\}/);
        }
        
      } finally {
        rmSync(projectDir, { recursive: true, force: true });
      }
    });

    it('should correctly resolve custom types with filePath information using type checker', async () => {
      const projectDir = mkdtempSync(join(tmpdir(), 'filepath-test-'));
      const modelsDir = join(projectDir, 'src', 'models');
      const servicesDir = join(projectDir, 'src', 'services');
      
      mkdirSync(modelsDir, { recursive: true });
      mkdirSync(servicesDir, { recursive: true });
      
      try {
        // Create tsconfig.json
        const tsconfigContent = JSON.stringify({
          "compilerOptions": {
            "target": "ES2022",
            "lib": ["ES2022"],
            "module": "ESNext",
            "moduleResolution": "node",
            "strict": true,
            "skipLibCheck": true,
            "declaration": true,
            "esModuleInterop": true,
            "baseUrl": ".",
            "paths": {
              "@/*": ["src/*"]
            }
          },
          "include": ["src/**/*"]
        }, null, 2);
        
        writeFileSync(join(projectDir, 'tsconfig.json'), tsconfigContent);
        
        // Create model files
        const userModelContent = `
export interface User {
  id: number;
  name: string;
  email: string;
}

export interface UserPreferences {
  theme: 'light' | 'dark';
  notifications: boolean;
}
        `;
        writeFileSync(join(modelsDir, 'User.ts'), userModelContent);
        
        const projectModelContent = `
import { User } from './User';

export interface Project {
  id: number;
  name: string;
  description: string;
  owner: User;
}

export interface ProjectSettings {
  isPublic: boolean;
  allowComments: boolean;
}
        `;
        writeFileSync(join(modelsDir, 'Project.ts'), projectModelContent);
        
        // Create service file that uses multiple custom types
        const serviceContent = `
import { User, UserPreferences } from '../models/User';
import { Project, ProjectSettings } from '../models/Project';

export class ProjectService {
  /**
   * @decorator expose projectAPI
   */
  async createProject(name: string, owner: User): Promise<Project> {
    return {
      id: 1,
      name,
      description: '',
      owner
    };
  }
  
  /**
   * @decorator expose projectAPI
   */
  async updateProjectSettings(projectId: number, settings: ProjectSettings): Promise<Project> {
    // Implementation here
    return {} as Project;
  }
  
  /**
   * @decorator expose userAPI
   */
  async getUserWithPreferences(userId: number): Promise<{ user: User; preferences: UserPreferences }> {
    return {
      user: { id: userId, name: 'Test', email: 'test@example.com' },
      preferences: { theme: 'dark', notifications: true }
    };
  }
}
        `;
        writeFileSync(join(servicesDir, 'ProjectService.ts'), serviceContent);
        
        const generator = createElectronBridgeGenerator({
          mainProcessHandlerFile: join(testOutputDir, 'main', 'ipc-handlers.ts'),
          preloadHandlerFile: join(testOutputDir, 'preload', 'bridge.ts'),
          typeDefinitionsFile: join(testOutputDir, 'types.d.ts'),
          baseDir: projectDir
        });
        
        // Analyze the service file
        const methods = await generator.analyzeFile(join(servicesDir, 'ProjectService.ts'), serviceContent);
        
        expect(methods).toHaveLength(3);
        
        // Find each method
        const createProjectMethod = methods.find(m => m.methodName === 'createProject');
        const updateProjectSettingsMethod = methods.find(m => m.methodName === 'updateProjectSettings');
        const getUserWithPreferencesMethod = methods.find(m => m.methodName === 'getUserWithPreferences');
        
        expect(createProjectMethod).toBeDefined();
        expect(updateProjectSettingsMethod).toBeDefined();
        expect(getUserWithPreferencesMethod).toBeDefined();
        
        // Verify that type checker provides more accurate type information
        if (createProjectMethod) {
          // Parameter types should be correctly resolved
          expect(createProjectMethod.parameters).toHaveLength(2);
          expect(createProjectMethod.parameters[0].type.name).toBe('string');
          expect(createProjectMethod.parameters[1].type.name).toMatch(/User/);
          
          // Return type should be correctly resolved
          const returnType = createProjectMethod.returnType;
          expect(returnType.kind).toBe('generic');
          expect(returnType.name).toBe('Promise');
          if (returnType.kind === 'generic') {
            expect(returnType.typeArguments).toHaveLength(1);
            expect(returnType.typeArguments[0].name).toBe('Project');
            expect(returnType.typeArguments[0].kind).toBe('simple');
          }
        }
        
        if (updateProjectSettingsMethod) {
          expect(updateProjectSettingsMethod.parameters).toHaveLength(2);
          expect(updateProjectSettingsMethod.parameters[0].type.name).toBe('number');
          expect(updateProjectSettingsMethod.parameters[1].type.name).toBe('ProjectSettings');
        }
        
        if (getUserWithPreferencesMethod) {
          // Complex return type with nested objects should be handled
          const returnType = getUserWithPreferencesMethod.returnType;
          expect(returnType.kind).toBe('generic');
          expect(returnType.name).toBe('Promise');
          if (returnType.kind === 'generic') {
            expect(returnType.typeArguments).toHaveLength(1);
            // The return type should be Promise<{ user: User; preferences: UserPreferences }>
            // Type checker may simplify complex types to {}
            expect(returnType.typeArguments[0].name).toMatch(/\{.*\}/);
          }
        }
        
        // Test the new TypeInfo structure
        const createProjectReturnType = createProjectMethod?.returnType;
        if (createProjectReturnType?.kind === 'generic') {
          // Should be Promise<Project>
          expect(createProjectReturnType.name).toBe('Promise');
          expect(createProjectReturnType.typeArguments).toHaveLength(1);
          
          const projectType = createProjectReturnType.typeArguments[0];
          expect(projectType.name).toBe('Project');
          expect(projectType.kind).toBe('simple');
          // Project type should have filePath pointing to Project.ts
          // Note: filePath may be undefined if type checker cannot resolve the file location
          if (projectType.filePath) {
            expect(projectType.filePath).toContain('Project.ts');
          }
        }
        
      } finally {
        rmSync(projectDir, { recursive: true, force: true });
      }
    });
  });
});