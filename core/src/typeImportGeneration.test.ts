import { describe, it, expect, beforeEach } from 'vitest';
import { createElectronBridgeGenerator } from './index';
import { rmSync, existsSync, mkdtempSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Type Import Generation', () => {
  let testOutputDir: string;
  let generator: ReturnType<typeof createElectronBridgeGenerator>;

  beforeEach(() => {
    testOutputDir = mkdtempSync(join(tmpdir(), 'type-import-test-'));
    
    // Clean up test output directory
    if (existsSync(testOutputDir)) {
      rmSync(testOutputDir, { recursive: true, force: true });
    }

    generator = createElectronBridgeGenerator({
      mainProcessHandlerFile: join(testOutputDir, 'main', 'ipc-handlers.ts'),
      preloadHandlerFile: join(testOutputDir, 'preload', 'bridge.ts'),
      typeDefinitionsFile: join(testOutputDir, 'types', 'electron.d.ts'),
      baseDir: testOutputDir
    });
  });

  describe('Custom types in parameters and return values', () => {
    it('should generate type imports for custom types in parameters', async () => {
      const sourceCode = `
        export interface UserData {
          id: number;
          name: string;
          email: string;
        }

        export class UserService {
          /**
           * @decorator expose userAPI
           */
          async createUser(userData: UserData): Promise<string> {
            return "user-id";
          }
        }
      `;

      const methods = await generator.analyzeFile('src/services/UserService.ts', sourceCode);
      await generator.generateFiles(methods);

      const preloadContent = readFileSync(join(testOutputDir, 'preload', 'bridge.ts'), 'utf-8');
      const typeDefsContent = readFileSync(join(testOutputDir, 'types', 'electron.d.ts'), 'utf-8');

      // Should contain type import in preload
      expect(preloadContent).toContain("import type { UserData } from '../src/services/UserService';");
      
      // Should contain type import in type definitions
      expect(typeDefsContent).toContain("import type { UserData } from '../src/services/UserService';");
      
      // Should use the custom type in the interface
      expect(typeDefsContent).toContain('createUser(userData: UserData): Promise<string>;');
    });

    it('should generate type imports for custom types in return values', async () => {
      const sourceCode = `
        export interface UserProfile {
          id: number;
          name: string;
          preferences: object;
        }

        export class UserService {
          /**
           * @decorator expose userAPI
           */
          async getUser(id: number): Promise<UserProfile> {
            return { id, name: "test", preferences: {} };
          }
        }
      `;

      const methods = await generator.analyzeFile('src/services/UserService.ts', sourceCode);
      await generator.generateFiles(methods);

      const preloadContent = readFileSync(join(testOutputDir, 'preload', 'bridge.ts'), 'utf-8');
      const typeDefsContent = readFileSync(join(testOutputDir, 'types', 'electron.d.ts'), 'utf-8');

      // Should contain type import in preload
      expect(preloadContent).toContain("import type { UserProfile } from '../src/services/UserService';");
      
      // Should contain type import in type definitions
      expect(typeDefsContent).toContain("import type { UserProfile } from '../src/services/UserService';");
      
      // Should use the custom type in the interface
      expect(typeDefsContent).toContain('getUser(id: number): Promise<UserProfile>;');
    });

    it('should generate type imports for multiple custom types', async () => {
      const sourceCode = `
        export interface CreateUserRequest {
          name: string;
          email: string;
        }

        export interface UserResponse {
          id: number;
          name: string;
        }

        export class UserService {
          /**
           * @decorator expose userAPI
           */
          async createUser(request: CreateUserRequest): Promise<UserResponse> {
            return { id: 1, name: request.name };
          }
        }
      `;

      const methods = await generator.analyzeFile('src/services/UserService.ts', sourceCode);
      await generator.generateFiles(methods);

      const preloadContent = readFileSync(join(testOutputDir, 'preload', 'bridge.ts'), 'utf-8');
      const typeDefsContent = readFileSync(join(testOutputDir, 'types', 'electron.d.ts'), 'utf-8');

      // Should contain both type imports in preload
      expect(preloadContent).toContain("import type { CreateUserRequest, UserResponse } from '../src/services/UserService';");
      
      // Should contain both type imports in type definitions
      expect(typeDefsContent).toContain("import type { CreateUserRequest, UserResponse } from '../src/services/UserService';");
      
      // Should use both custom types in the interface
      expect(typeDefsContent).toContain('createUser(request: CreateUserRequest): Promise<UserResponse>;');
    });
  });

  describe('External package types', () => {
    it('should handle external package types in parameters', async () => {
      const sourceCode = `
        import { Buffer } from 'buffer';

        export class FileService {
          /**
           * @decorator expose fileAPI
           */
          async writeBuffer(path: string, data: Buffer): Promise<void> {
            // implementation
          }
        }
      `;

      const methods = await generator.analyzeFile('src/services/FileService.ts', sourceCode);
      await generator.generateFiles(methods);

      const typeDefsContent = readFileSync(join(testOutputDir, 'types', 'electron.d.ts'), 'utf-8');

      // Should use Buffer type directly (assumed to be available globally)
      expect(typeDefsContent).toContain('writeBuffer(path: string, data: Buffer): Promise<void>;');
    });

    it('should handle Node.js built-in types', async () => {
      const sourceCode = `
        import { ReadStream } from 'fs';

        export class FileService {
          /**
           * @decorator expose fileAPI
           */
          async processStream(stream: ReadStream): Promise<string> {
            return "processed";
          }
        }
      `;

      const methods = await generator.analyzeFile('src/services/FileService.ts', sourceCode);
      await generator.generateFiles(methods);

      const typeDefsContent = readFileSync(join(testOutputDir, 'types', 'electron.d.ts'), 'utf-8');

      // Should use ReadStream type directly (assumed to be available from Node.js types)
      expect(typeDefsContent).toContain('processStream(stream: ReadStream): Promise<string>;');
    });
  });

  describe('Complex generic types', () => {
    it('should handle generic types with custom interfaces', async () => {
      const sourceCode = `
        export interface ApiResponse<T> {
          data: T;
          success: boolean;
          message: string;
        }

        export interface User {
          id: number;
          name: string;
        }

        export class ApiService {
          /**
           * @decorator expose apiService
           */
          async getUser(id: number): Promise<ApiResponse<User>> {
            return { data: { id, name: "test" }, success: true, message: "ok" };
          }
        }
      `;

      const methods = await generator.analyzeFile('src/services/ApiService.ts', sourceCode);
      await generator.generateFiles(methods);

      const preloadContent = readFileSync(join(testOutputDir, 'preload', 'bridge.ts'), 'utf-8');
      const typeDefsContent = readFileSync(join(testOutputDir, 'types', 'electron.d.ts'), 'utf-8');

      // Should contain type imports for both ApiResponse and User
      expect(preloadContent).toContain("import type { ApiResponse, User } from '../src/services/ApiService';");
      expect(typeDefsContent).toContain("import type { ApiResponse, User } from '../src/services/ApiService';");
      
      // Should use the complex generic type
      expect(typeDefsContent).toContain('getUser(id: number): Promise<ApiResponse<User>>;');
    });

    it('should handle nested generic types', async () => {
      const sourceCode = `
        export interface PaginatedResponse<T> {
          items: T[];
          totalCount: number;
          hasMore: boolean;
        }

        export interface UserSummary {
          id: number;
          name: string;
        }

        export class UserService {
          /**
           * @decorator expose userAPI
           */
          async getUserList(page: number): Promise<PaginatedResponse<UserSummary>> {
            return { items: [], totalCount: 0, hasMore: false };
          }
        }
      `;

      const methods = await generator.analyzeFile('src/services/UserService.ts', sourceCode);
      await generator.generateFiles(methods);

      const typeDefsContent = readFileSync(join(testOutputDir, 'types', 'electron.d.ts'), 'utf-8');

      // Should contain type imports for both interfaces
      expect(typeDefsContent).toContain("import type { PaginatedResponse, UserSummary } from '../src/services/UserService';");
      
      // Should use the nested generic type
      expect(typeDefsContent).toContain('getUserList(page: number): Promise<PaginatedResponse<UserSummary>>;');
    });
  });

  describe('Built-in types (should not generate imports)', () => {
    it('should not generate imports for basic built-in types', async () => {
      const sourceCode = `
        export class UtilsService {
          /**
           * @decorator expose utilsAPI
           */
          async processData(input: string, count: number, isActive: boolean): Promise<object> {
            return { input, count, isActive };
          }
        }
      `;

      const methods = await generator.analyzeFile('src/services/UtilsService.ts', sourceCode);
      await generator.generateFiles(methods);

      const preloadContent = readFileSync(join(testOutputDir, 'preload', 'bridge.ts'), 'utf-8');
      const typeDefsContent = readFileSync(join(testOutputDir, 'types', 'electron.d.ts'), 'utf-8');

      // Should not contain any type imports
      expect(preloadContent).not.toContain('import type');
      expect(typeDefsContent).not.toContain('import type');
      
      // Should use built-in types directly
      expect(typeDefsContent).toContain('processData(input: string, count: number, isActive: boolean): Promise<object>;');
    });

    it('should not generate imports for array and Promise types', async () => {
      const sourceCode = `
        export class DataService {
          /**
           * @decorator expose dataAPI
           */
          async processItems(items: string[]): Promise<number[]> {
            return items.map(item => item.length);
          }
        }
      `;

      const methods = await generator.analyzeFile('src/services/DataService.ts', sourceCode);
      await generator.generateFiles(methods);

      const preloadContent = readFileSync(join(testOutputDir, 'preload', 'bridge.ts'), 'utf-8');
      const typeDefsContent = readFileSync(join(testOutputDir, 'types', 'electron.d.ts'), 'utf-8');

      // Should not contain any type imports
      expect(preloadContent).not.toContain('import type');
      expect(typeDefsContent).not.toContain('import type');
      
      // Should use built-in types directly
      expect(typeDefsContent).toContain('processItems(items: string[]): Promise<number[]>;');
    });
  });

  describe('Mixed custom and built-in types', () => {
    it('should generate imports only for custom types when mixed with built-in types', async () => {
      const sourceCode = `
        export interface UserPreferences {
          theme: string;
          notifications: boolean;
        }

        export class UserService {
          /**
           * @decorator expose userAPI
           */
          async updatePreferences(userId: number, preferences: UserPreferences): Promise<boolean> {
            return true;
          }
        }
      `;

      const methods = await generator.analyzeFile('src/services/UserService.ts', sourceCode);
      await generator.generateFiles(methods);

      const preloadContent = readFileSync(join(testOutputDir, 'preload', 'bridge.ts'), 'utf-8');
      const typeDefsContent = readFileSync(join(testOutputDir, 'types', 'electron.d.ts'), 'utf-8');

      // Should contain type import only for custom type
      expect(preloadContent).toContain("import type { UserPreferences } from '../src/services/UserService';");
      expect(typeDefsContent).toContain("import type { UserPreferences } from '../src/services/UserService';");
      
      // Should use both custom and built-in types
      expect(typeDefsContent).toContain('updatePreferences(userId: number, preferences: UserPreferences): Promise<boolean>;');
    });

    it('should handle optional parameters with custom types', async () => {
      const sourceCode = `
        export interface FilterOptions {
          sortBy?: string;
          ascending?: boolean;
        }

        export class DataService {
          /**
           * @decorator expose dataAPI
           */
          async getData(limit: number, options?: FilterOptions): Promise<any[]> {
            return [];
          }
        }
      `;

      const methods = await generator.analyzeFile('src/services/DataService.ts', sourceCode);
      await generator.generateFiles(methods);

      const typeDefsContent = readFileSync(join(testOutputDir, 'types', 'electron.d.ts'), 'utf-8');

      // Should contain type import for custom type
      expect(typeDefsContent).toContain("import type { FilterOptions } from '../src/services/DataService';");
      
      // Should handle optional parameter with custom type
      expect(typeDefsContent).toContain('getData(limit: number, options: FilterOptions): Promise<any[]>;');
    });
  });

  describe('Types from separate definition files', () => {
    it('should generate correct imports for types from different files', async () => {
      // Test with a service that has types defined in the same file
      const serviceCode = `
        export interface UserData {
          name: string;
          email: string;
        }

        export interface UserResponse {
          id: number;
          name: string;
        }

        export class UserService {
          /**
           * @decorator expose userAPI
           */
          async createUser(userData: UserData): Promise<UserResponse> {
            return { id: 1, name: userData.name };
          }
        }
      `;

      const serviceMethods = await generator.analyzeFile('src/services/UserService.ts', serviceCode);
      await generator.generateFiles(serviceMethods);

      const preloadContent = readFileSync(join(testOutputDir, 'preload', 'bridge.ts'), 'utf-8');
      const typeDefsContent = readFileSync(join(testOutputDir, 'types', 'electron.d.ts'), 'utf-8');

      // Should contain correct import paths from the same file
      expect(preloadContent).toContain("import type { UserData, UserResponse } from '../src/services/UserService';");
      expect(typeDefsContent).toContain("import type { UserData, UserResponse } from '../src/services/UserService';");
    });

    it('should handle types from multiple services in the same project', async () => {
      // Test with multiple services that have their own types
      const userServiceCode = `
        export interface UserData {
          name: string;
          email: string;
        }

        export class UserService {
          /**
           * @decorator expose userAPI
           */
          async createUser(userData: UserData): Promise<string> {
            return "user-id";
          }
        }
      `;

      const orderServiceCode = `
        export interface OrderData {
          userId: string;
          items: string[];
        }

        export class OrderService {
          /**
           * @decorator expose orderAPI
           */
          async createOrder(orderData: OrderData): Promise<number> {
            return 12345;
          }
        }
      `;

      const userMethods = await generator.analyzeFile('src/services/UserService.ts', userServiceCode);
      const orderMethods = await generator.analyzeFile('src/services/OrderService.ts', orderServiceCode);
      
      await generator.generateFiles([...userMethods, ...orderMethods]);

      const preloadContent = readFileSync(join(testOutputDir, 'preload', 'bridge.ts'), 'utf-8');
      const typeDefsContent = readFileSync(join(testOutputDir, 'types', 'electron.d.ts'), 'utf-8');

      // Should contain imports from both service files
      expect(preloadContent).toContain("import type { OrderData } from '../src/services/OrderService';");
      expect(preloadContent).toContain("import type { UserData } from '../src/services/UserService';");
      expect(typeDefsContent).toContain("import type { OrderData } from '../src/services/OrderService';");
      expect(typeDefsContent).toContain("import type { UserData } from '../src/services/UserService';");
    });
  });

  describe('Type import deduplication', () => {
    it('should deduplicate type imports from the same file', async () => {
      const sourceCode = `
        export interface UserData {
          id: number;
          name: string;
        }

        export class UserService {
          /**
           * @decorator expose userAPI
           */
          async createUser(userData: UserData): Promise<UserData> {
            return userData;
          }

          /**
           * @decorator expose userAPI
           */
          async updateUser(id: number, userData: UserData): Promise<UserData> {
            return userData;
          }
        }
      `;

      const methods = await generator.analyzeFile('src/services/UserService.ts', sourceCode);
      await generator.generateFiles(methods);

      const preloadContent = readFileSync(join(testOutputDir, 'preload', 'bridge.ts'), 'utf-8');
      const typeDefsContent = readFileSync(join(testOutputDir, 'types', 'electron.d.ts'), 'utf-8');

      // Should contain only one import statement for UserData
      const preloadImportMatches = preloadContent.match(/import type { UserData } from/g);
      const typeDefsImportMatches = typeDefsContent.match(/import type { UserData } from/g);

      expect(preloadImportMatches).toHaveLength(1);
      expect(typeDefsImportMatches).toHaveLength(1);
    });

    it('should group multiple types from same file in single import', async () => {
      const sourceCode = `
        export interface CreateUserRequest {
          name: string;
          email: string;
        }

        export interface UpdateUserRequest {
          name?: string;
          email?: string;
        }

        export interface UserResponse {
          id: number;
          name: string;
        }

        export class UserService {
          /**
           * @decorator expose userAPI
           */
          async createUser(request: CreateUserRequest): Promise<UserResponse> {
            return { id: 1, name: request.name };
          }

          /**
           * @decorator expose userAPI
           */
          async updateUser(id: number, request: UpdateUserRequest): Promise<UserResponse> {
            return { id, name: request.name || "unknown" };
          }
        }
      `;

      const methods = await generator.analyzeFile('src/services/UserService.ts', sourceCode);
      await generator.generateFiles(methods);

      const preloadContent = readFileSync(join(testOutputDir, 'preload', 'bridge.ts'), 'utf-8');
      const typeDefsContent = readFileSync(join(testOutputDir, 'types', 'electron.d.ts'), 'utf-8');

      // Should contain all types in a single import statement (alphabetically sorted)
      expect(preloadContent).toContain("import type { CreateUserRequest, UserResponse, UpdateUserRequest } from '../src/services/UserService';");
      expect(typeDefsContent).toContain("import type { CreateUserRequest, UserResponse, UpdateUserRequest } from '../src/services/UserService';");
    });
  });
});