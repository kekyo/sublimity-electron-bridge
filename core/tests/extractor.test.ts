import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { extractInterfaces, extractFunctionMethods } from '../src/extractor';

describe('extractInterfaces function', () => {
  let tempDir: string;
  let testInterfaceFile: string;
  let noInterfaceFile: string;
  let tsConfigFile: string;
  let decoratorTestFile: string;
  
  // Test file content
  const testInterfaceContent = `
export interface NestedInterface {
  value: string;
  count: number;
}

export interface TestInterface {
  id: number;
  name: string;
  isActive: boolean;
  add: (a: number, b: number) => number;
  nested: NestedInterface;
  varArgs: (...args: string[]) => number;
  mixedArgs: (first: number, ...rest: string[]) => void;
  items: string[];
  matrix: number[][];
  promise: Promise<string>;
  mapData: Map<string, number>;
  setValue: Set<NestedInterface>;
}
`;
  
  const noInterfaceContent = `
export const someFunction = () => {
  return 'hello';
};

export class TestClass {
  value: string = 'test';
}

export class TestClass2 extends TestInterface {
  id: number = 1;
  name: string = 'test';
  isActive: boolean = true;
  add(a: number, b: number): number {
    return a + b;
  }
}
`;

  const decoratorTestContent = `
/**
 * @decorator native libc
 */
export interface NativeInterface {
  id: string;
  response: ResponseData;
}

/**
 * @decorator api nodejs
 */
export interface ApiInterface {
  id: string;
  response: ResponseData;
}

/**
 * @decorator entity database
 */
export interface UserEntity {
  userId: number;
  profile: UserProfile;
  settings: Settings;
}

export interface ResponseData {
  status: number;
  message: string;
  data: any;
}

export interface UserProfile {
  name: string;
  email: string;
}

/**
 * @decorator entity config
 */
export interface Settings {
  theme: string;
  notifications: boolean;
}

/**
 * Regular interface (no decorator)
 */
export interface RegularInterface {
  value: string;
}

/**
 * @decorator other
 */
export interface OtherInterface {
  data: number;
}

/**
 * @decorator native stdlibc
 */
export interface NativeStdlibInterface {
  value: number;
}

/**
 * @decorator test generic
 */
export interface GenericTestInterface {
  promise: Promise<string>;
  mapData: Map<string, number>;
  setValue: Set<UserProfile>;
}
`;

  const tsConfigContent = {
    compilerOptions: {
      target: "ES2020",
      module: "ESNext",
      moduleResolution: "bundler",
      strict: true,
      declaration: true,
      outDir: "./dist",
      rootDir: "./src"
    },
    include: ["src/**/*"],
    exclude: ["node_modules", "dist"]
  };

  beforeAll(async () => {
    // Create temporary directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'interface-extractor-test-'));
    
    // Create src directory
    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    
    // Set test file paths
    testInterfaceFile = path.join(srcDir, 'test-interface.ts');
    noInterfaceFile = path.join(srcDir, 'no-interface.ts');
    decoratorTestFile = path.join(srcDir, 'decorator-test.ts');
    tsConfigFile = path.join(tempDir, 'tsconfig.json');
    
    // Create files
    fs.writeFileSync(testInterfaceFile, testInterfaceContent);
    fs.writeFileSync(noInterfaceFile, noInterfaceContent);
    fs.writeFileSync(decoratorTestFile, decoratorTestContent);
    fs.writeFileSync(tsConfigFile, JSON.stringify(tsConfigContent, null, 2));
  });

  afterAll(async () => {
    // Delete temporary directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should extract interfaces from TypeScript file', () => {
    // Since targetDecorator is required, verify that error occurs for nonexistent decorator
    expect(() => {
      extractInterfaces(tempDir, [testInterfaceFile], 'nonexistent');
    }).toThrow(`No interfaces found with decorator '@decorator nonexistent'`);
  });

  it('should extract interfaces with target decorator and library', () => {
    const results = extractInterfaces(tempDir, [decoratorTestFile], 'native');
    
    expect(results).toBeDefined();
    expect(results).toHaveLength(2); // NativeInterface and NativeStdlibInterface
    
    // Find NativeInterface
    const nativeInterface = results.find(item => item.name === 'NativeInterface');
    expect(nativeInterface).toBeDefined();
    expect(nativeInterface!.targetLibrary).toBe('libc');
    
    // Find NativeStdlibInterface
    const nativeStdlibInterface = results.find(item => item.name === 'NativeStdlibInterface');
    expect(nativeStdlibInterface).toBeDefined();
    expect(nativeStdlibInterface!.targetLibrary).toBe('stdlibc');
    
    // Verify that interfaces with other decorators are not included
    expect(results.find(item => item.name === 'ApiInterface')).toBeUndefined();
    expect(results.find(item => item.name === 'UserEntity')).toBeUndefined();
  });

  it('should extract interfaces with api decorator and library', () => {
    const results = extractInterfaces(tempDir, [decoratorTestFile], 'api');
    
    expect(results).toBeDefined();
    expect(results).toHaveLength(1); // ApiInterface only
    
    const apiInterface = results.find(item => item.name === 'ApiInterface');
    expect(apiInterface).toBeDefined();
    expect(apiInterface!.targetLibrary).toBe('nodejs');
  });

  it('should extract interfaces with entity decorator and library', () => {
    const results = extractInterfaces(tempDir, [decoratorTestFile], 'entity');
    
    expect(results).toBeDefined();
    expect(results).toHaveLength(2); // UserEntity, Settings
    
    const userEntity = results.find(item => item.name === 'UserEntity');
    expect(userEntity).toBeDefined();
    expect(userEntity!.targetLibrary).toBe('database');
    
    const settings = results.find(item => item.name === 'Settings');
    expect(settings).toBeDefined();
    expect(settings!.targetLibrary).toBe('config');
  });

  it('should throw error when tsconfig.json is not found', () => {
    const invalidPath = '/nonexistent/path';
    
    expect(() => {
      extractInterfaces(invalidPath, [testInterfaceFile], 'native');
    }).toThrow('tsconfig.json not found');
  });

  it('should throw error when source file is not found', () => {
    const nonExistentFile = path.join(tempDir, 'nonexistent.ts');
    
    expect(() => {
      extractInterfaces(tempDir, [nonExistentFile], 'native');
    }).toThrow(`No interfaces found with decorator '@decorator native'`);
  });

  it('should throw error when no interface is found in file', () => {
    expect(() => {
      extractInterfaces(tempDir, [noInterfaceFile], 'native');
    }).toThrow(`No interfaces found with decorator '@decorator native'`);
  });

  it('should throw error when no source file paths are provided', () => {
    expect(() => {
      extractInterfaces(tempDir, [], 'native');
    }).toThrow('Source file paths are not specified');
  });

  it('should throw error when targetDecorator is not provided', () => {
    expect(() => {
      (extractInterfaces as any)(tempDir, [decoratorTestFile]);
          }).toThrow('targetDecorator is not specified');
      
      expect(() => {
        extractInterfaces(tempDir, [decoratorTestFile], '');
      }).toThrow('targetDecorator is not specified');
      
      expect(() => {
        extractInterfaces(tempDir, [decoratorTestFile], '   ');
      }).toThrow('targetDecorator is not specified');
  });

  // Decorator filtering test cases
  describe('Decorator filtering', () => {
    it('should extract only interfaces with specified decorator and their references', () => {
      const results = extractInterfaces(tempDir, [decoratorTestFile], 'api');
      
      expect(results).toBeDefined();
      expect(results).toHaveLength(1); // ApiInterface only (referenced ResponseData not included)
      
      // Verify ApiInterface is included
      const apiInterface = results.find(item => item.name === 'ApiInterface');
      expect(apiInterface).toBeDefined();
      expect(apiInterface!.targetLibrary).toBe('nodejs');
      expect(apiInterface!.properties).toHaveLength(2); // id, response
      
      // Verify ResponseData information is inlined in response property
      const responseProperty = apiInterface!.properties.find(prop => prop.name === 'response');
      expect(responseProperty).toBeDefined();
      expect(responseProperty!.type.kind).toBe('interface');
      expect((responseProperty!.type as any).name).toBe('ResponseData');
      expect((responseProperty!.type as any).properties).toHaveLength(3); // status, message, data
      
      // Verify that interfaces with other decorators are not included
      expect(results.find(item => item.name === 'UserEntity')).toBeUndefined();
      expect(results.find(item => item.name === 'RegularInterface')).toBeUndefined();
      expect(results.find(item => item.name === 'OtherInterface')).toBeUndefined();
      expect(results.find(item => item.name === 'ResponseData')).toBeUndefined(); // Not included as separate interface
    });

    it('should extract entity decorator interfaces with their nested references', () => {
      const results = extractInterfaces(tempDir, [decoratorTestFile], 'entity');
      
      expect(results).toBeDefined();
      expect(results).toHaveLength(2); // UserEntity, Settings only (referenced interfaces not included)
      
      // Verify UserEntity is included
      const userEntity = results.find(item => item.name === 'UserEntity');
      expect(userEntity).toBeDefined();
      expect(userEntity!.targetLibrary).toBe('database');
      expect(userEntity!.properties).toHaveLength(3); // userId, profile, settings
      
      // Verify user profile information is inlined in profile property
      const profileProperty = userEntity!.properties.find(prop => prop.name === 'profile');
      expect(profileProperty).toBeDefined();
      expect(profileProperty!.type.kind).toBe('interface');
      expect((profileProperty!.type as any).name).toBe('UserProfile');
      expect((profileProperty!.type as any).properties).toHaveLength(2); // name, email
      
      // Verify that Settings is included (this interface itself also has @decorator entity)
      const settings = results.find(item => item.name === 'Settings');
      expect(settings).toBeDefined();
      expect(settings!.targetLibrary).toBe('config');
      expect(settings!.properties).toHaveLength(2); // theme, notifications
      
      // Verify that ApiInterface is not included
      expect(results.find(item => item.name === 'ApiInterface')).toBeUndefined();
      expect(results.find(item => item.name === 'ResponseData')).toBeUndefined();
      expect(results.find(item => item.name === 'RegularInterface')).toBeUndefined();
      expect(results.find(item => item.name === 'OtherInterface')).toBeUndefined();
      expect(results.find(item => item.name === 'UserProfile')).toBeUndefined(); // Not included as separate interface
    });

    it('should handle multiple decorator names in single JSDoc tag', () => {
      const results = extractInterfaces(tempDir, [decoratorTestFile], 'entity');
      
      expect(results).toBeDefined();
      expect(results).toHaveLength(2); // UserEntity, Settings
      
      const settings = results.find(item => item.name === 'Settings');
      expect(settings).toBeDefined();
      expect(settings!.targetLibrary).toBe('config');
      expect(settings!.properties).toHaveLength(2);
    });

    it('should throw error when no interfaces with specified decorator are found', () => {
      expect(() => {
        extractInterfaces(tempDir, [decoratorTestFile], 'nonexistent');
      }).toThrow(`No interfaces found with decorator '@decorator nonexistent'`);
    });

    it('should work with complex nested references', () => {
      // Test file with complex reference relationships
      const complexTestFile = path.join(path.dirname(decoratorTestFile), 'complex-test.ts');
      const complexTestContent = `
/**
 * @decorator target mylib
 */
export interface MainInterface {
  level1: Level1Interface;
}

export interface Level1Interface {
  level2: Level2Interface;
  items: Level3Interface[];
}

export interface Level2Interface {
  level3: Level3Interface;
  mapping: Map<string, Level3Interface>;
}

export interface Level3Interface {
  value: string;
  callback: (data: Level4Interface) => void;
}

export interface Level4Interface {
  id: number;
}
`;
      
      fs.writeFileSync(complexTestFile, complexTestContent);
      
      try {
        const results = extractInterfaces(tempDir, [complexTestFile], 'target');
        
        expect(results).toBeDefined();
        expect(results).toHaveLength(1); // MainInterface only (referenced interfaces not included)
        
        const mainInterface = results.find(item => item.name === 'MainInterface');
        expect(mainInterface).toBeDefined();
        expect(mainInterface!.targetLibrary).toBe('mylib');
        expect(mainInterface!.properties).toHaveLength(1); // level1
        
        // Verify level1 property includes Level1Interface information inlined
        const level1Property = mainInterface!.properties.find(prop => prop.name === 'level1');
        expect(level1Property).toBeDefined();
        expect(level1Property!.type.kind).toBe('interface');
        expect((level1Property!.type as any).name).toBe('Level1Interface');
        expect((level1Property!.type as any).properties).toHaveLength(2); // level2, items
        
        // Verify further nesting
        const level1Type = level1Property!.type as any;
        const level2Property = level1Type.properties.find((prop: any) => prop.name === 'level2');
        expect(level2Property).toBeDefined();
        expect(level2Property.type.kind).toBe('interface');
        expect(level2Property.type.name).toBe('Level2Interface');
      } finally {
        // Cleanup
        if (fs.existsSync(complexTestFile)) {
          fs.unlinkSync(complexTestFile);
        }
      }
    });

    it('should handle duplicate references correctly', () => {
      // Test file with duplicate references
      const duplicateTestFile = path.join(path.dirname(decoratorTestFile), 'duplicate-test.ts');
      const duplicateTestContent = `
/**
 * @decorator shared lib1
 */
export interface Interface1 {
  common: CommonInterface;
  data: string;
}

/**
 * @decorator shared lib2
 */
export interface Interface2 {
  common: CommonInterface;
  value: number;
}

export interface CommonInterface {
  id: string;
  name: string;
}
`;
      
      fs.writeFileSync(duplicateTestFile, duplicateTestContent);
      
      try {
        const results = extractInterfaces(tempDir, [duplicateTestFile], 'shared');
        
        expect(results).toBeDefined();
        expect(results).toHaveLength(2); // Interface1, Interface2 only (Common not included)
        
        // Verify both interfaces are included
        const interface1 = results.find(item => item.name === 'Interface1');
        const interface2 = results.find(item => item.name === 'Interface2');
        
        expect(interface1).toBeDefined();
        expect(interface1!.targetLibrary).toBe('lib1');
        expect(interface2).toBeDefined();
        expect(interface2!.targetLibrary).toBe('lib2');
        
        // Verify that CommonInterface information is inlined in both interfaces
        const interface1CommonProperty = interface1!.properties.find(prop => prop.name === 'common');
        const interface2CommonProperty = interface2!.properties.find(prop => prop.name === 'common');
        
        expect(interface1CommonProperty).toBeDefined();
        expect(interface2CommonProperty).toBeDefined();
        expect(interface1CommonProperty!.type.kind).toBe('interface');
        expect(interface2CommonProperty!.type.kind).toBe('interface');
        expect((interface1CommonProperty!.type as any).name).toBe('CommonInterface');
        expect((interface2CommonProperty!.type as any).name).toBe('CommonInterface');
        
        // Verify that CommonInterface is not duplicated as separate interface
        const commonInterfaces = results.filter(item => item.name === 'CommonInterface');
        expect(commonInterfaces).toHaveLength(0); // 0 (Not included as separate interface)
      } finally {
        // Cleanup
        if (fs.existsSync(duplicateTestFile)) {
          fs.unlinkSync(duplicateTestFile);
        }
      }
    });

    it('should validate decorator parameter matching', () => {
      // Verify that targetDecorator parameter matches @decorator's first parameter
      const results = extractInterfaces(tempDir, [decoratorTestFile], 'native');
      
      expect(results).toBeDefined();
      expect(results).toHaveLength(2);
      
      // Verify each interface has native decorator
      results.forEach(result => {
        expect(result.name === 'NativeInterface' || result.name === 'NativeStdlibInterface').toBe(true);
      });
      
      // Verify that interfaces with different decorator names are not extracted
      expect(() => {
        extractInterfaces(tempDir, [decoratorTestFile], 'different');
      }).toThrow(`No interfaces found with decorator '@decorator different'`);
    });

    it('should throw error when target library parameter is missing', () => {
      // Verify that error occurs when targetLibrary is not specified
      expect(() => {
        extractInterfaces(tempDir, [decoratorTestFile], 'other');
              }).toThrow(`Interface 'OtherInterface' with @decorator other does not specify targetLibrary`);
    });

    it('should validate target library is required', () => {
      // Verify that targetLibrary is required for test
      const noLibraryTestFile = path.join(path.dirname(decoratorTestFile), 'no-library-test.ts');
      const noLibraryTestContent = `
/**
 * @decorator test
 */
export interface TestInterface {
  value: string;
}
`;
      
      fs.writeFileSync(noLibraryTestFile, noLibraryTestContent);
      
      try {
        expect(() => {
          extractInterfaces(tempDir, [noLibraryTestFile], 'test');
                  }).toThrow(`Interface 'TestInterface' with @decorator test does not specify targetLibrary`);
      } finally {
        // Cleanup
        if (fs.existsSync(noLibraryTestFile)) {
          fs.unlinkSync(noLibraryTestFile);
        }
      }
    });
  });

  it('should handle generic types correctly with new type system', () => {
    // Create a test file with generic types
    const genericTestFile = path.join(path.dirname(decoratorTestFile), 'generic-test.ts');
    const genericTestContent = `
/**
 * @decorator native test
 */
export interface GenericTestInterface {
  promiseData: Promise<string>;
  mapData: Map<string, number>;
  arrayData: Array<boolean>;
  customGeneric: CustomGeneric<number, string>;
}

interface CustomGeneric<T, U> {
  prop1: T;
  prop2: U;
}
`;
    
    fs.writeFileSync(genericTestFile, genericTestContent);
    
    try {
      const results = extractInterfaces(tempDir, [genericTestFile], 'native');
      
      expect(results).toBeDefined();
      expect(results).toHaveLength(1);
      
      const genericTestInterface = results.find(item => item.name === 'GenericTestInterface');
      expect(genericTestInterface).toBeDefined();
      
      // Check Promise<string> type
      const promiseProperty = genericTestInterface!.properties.find(prop => prop.name === 'promiseData');
      expect(promiseProperty).toBeDefined();
      expect(promiseProperty!.type.kind).toBe('type-reference');
      
      const mapDataProperty = genericTestInterface!.properties.find(prop => prop.name === 'mapData');
      expect(mapDataProperty).toBeDefined();
      expect(mapDataProperty!.type.kind).toBe('type-reference');
      
      const arrayDataProperty = genericTestInterface!.properties.find(prop => prop.name === 'arrayData');
      expect(arrayDataProperty).toBeDefined();
      expect(arrayDataProperty!.type.kind).toBe('array'); // Array<T> is handled specially by TypeScript compiler
      
      const customGenericProperty = genericTestInterface!.properties.find(prop => prop.name === 'customGeneric');
      expect(customGenericProperty).toBeDefined();
      expect(customGenericProperty!.type.kind).toBe('type-reference');
    } finally {
      if (fs.existsSync(genericTestFile)) {
        fs.unlinkSync(genericTestFile);
      }
    }
  });

  it('should track source location for open generic types correctly', () => {
    // Create a test file with generic types
    const genericTestFile = path.join(path.dirname(decoratorTestFile), 'generic-location-test.ts');
    const genericTestContent = `
/**
 * @decorator native test
 */
export interface GenericLocationTestInterface {
  promiseData: Promise<string>;
  mapData: Map<string, number>;
}
`;
    
    fs.writeFileSync(genericTestFile, genericTestContent);
    
    try {
      const results = extractInterfaces(tempDir, [genericTestFile], 'native');
      expect(results).toBeDefined();
      expect(results).toHaveLength(1);
      
      const genericTestInterface = results.find(item => item.name === 'GenericLocationTestInterface');
      expect(genericTestInterface).toBeDefined();
      
      // Get properties with type-reference types
      const genericProperties = genericTestInterface!.properties.filter(
        prop => prop.type.kind === 'type-reference'
      );
      
      expect(genericProperties.length).toBeGreaterThan(0);
      
      // Check that each referencedType has proper source location tracking
      genericProperties.forEach(prop => {
        if (prop.type.kind === 'type-reference') {
          const typeRef = prop.type as any;
          expect(typeRef.referencedType.sourceLocation).toBeDefined();
          expect(typeRef.referencedType.sourceLocation.fileName).toBeDefined();
          expect(typeRef.referencedType.sourceLocation.startLine).toBeGreaterThan(0);
          expect(typeRef.referencedType.sourceLocation.startColumn).toBeGreaterThanOrEqual(0);
        }
      });
    } finally {
      if (fs.existsSync(genericTestFile)) {
        fs.unlinkSync(genericTestFile);
      }
    }
  });

  it('should correctly separate type parameters from type arguments', () => {
    // Create a test file with generic types
    const genericTestFile = path.join(path.dirname(decoratorTestFile), 'param-arg-test.ts');
    const genericTestContent = `
/**
 * @decorator native test
 */
export interface GenericParamArgTestInterface {
  promiseData: Promise<string>;
  mapData: Map<string, number>;
}
`;
    
    fs.writeFileSync(genericTestFile, genericTestContent);
    
    try {
      const results = extractInterfaces(tempDir, [genericTestFile], 'native');
      expect(results).toBeDefined();
      expect(results).toHaveLength(1);
      
      const genericTestInterface = results.find(item => item.name === 'GenericParamArgTestInterface');
      expect(genericTestInterface).toBeDefined();
      
      // Check Promise<string> type
      const promiseProperty = genericTestInterface!.properties.find(prop => prop.name === 'promiseData');
      expect(promiseProperty).toBeDefined();
      expect(promiseProperty!.type.kind).toBe('type-reference');
      
      if (promiseProperty!.type.kind === 'type-reference') {
        const typeRef = promiseProperty!.type as any;
        
        // Check referenced type (should have type parameters if it's generic)
        expect(typeRef.referencedType.kind).toBe('interface');
        expect(typeRef.referencedType.name).toBe('Promise');
        
        // Check type arguments (instantiation)
        expect(typeRef.typeArguments).toBeDefined();
        expect(typeRef.typeArguments.length).toBe(1);
        expect(typeRef.typeArguments[0].kind).toBe('primitive');
        expect(typeRef.typeArguments[0].type).toBe('string');
      }
    } finally {
      if (fs.existsSync(genericTestFile)) {
        fs.unlinkSync(genericTestFile);
      }
    }
  });

  it('should construct type parameter names from recursive typeString values', () => {
    // Create a test file with generic types
    const genericTestFile = path.join(path.dirname(decoratorTestFile), 'typestring-test.ts');
    const genericTestContent = `
/**
 * @decorator native test
 */
export interface TypeStringTestInterface {
  mapData: Map<string, number>;
  nestedGeneric: Promise<Array<string>>;
}
`;
    
    fs.writeFileSync(genericTestFile, genericTestContent);
    
    try {
      const results = extractInterfaces(tempDir, [genericTestFile], 'native');
      expect(results).toBeDefined();
      expect(results).toHaveLength(1);
      
      const genericTestInterface = results.find(item => item.name === 'TypeStringTestInterface');
      expect(genericTestInterface).toBeDefined();
      
      // Check Map<string, number> type
      const mapDataProperty = genericTestInterface!.properties.find(prop => prop.name === 'mapData');
      expect(mapDataProperty).toBeDefined();
      expect(mapDataProperty!.type.kind).toBe('type-reference');
      
      if (mapDataProperty!.type.kind === 'type-reference') {
        const typeRef = mapDataProperty!.type as any;
        
        expect(typeRef.referencedType.name).toBe('Map');
        expect(typeRef.typeArguments).toBeDefined();
        expect(typeRef.typeArguments.length).toBe(2);
        
        // Check that the typeString is properly constructed
        expect(typeRef.typeString).toBe('Map<string, number>');
      }
    } finally {
      if (fs.existsSync(genericTestFile)) {
        fs.unlinkSync(genericTestFile);
      }
    }
  });

  it('should extract ptr<T> types correctly for native library functions', () => {
    // Create a test file with ptr<T> types
    const pointerTestFile = path.join(path.dirname(decoratorTestFile), 'pointer-test.ts');
    const pointerTestContent = `
    // Definition showing pointer type
interface ptr<T> {
}

/**
 * @decorator native libc
 */
export interface PointerTestInterface {
  malloc: (size: number) => ptr<void>;
  free: (p: ptr<void>) => void;
  createIntPtr: (value: number) => ptr<number>;
  readIntPtr: (ptr: ptr<number>) => number;
}
`;
    
    fs.writeFileSync(pointerTestFile, pointerTestContent);
    
    try {
      const results = extractInterfaces(tempDir, [pointerTestFile], 'native');
      
      expect(results).toBeDefined();
      expect(results).toHaveLength(1);
      
      const pointerInterface = results.find(item => item.name === 'PointerTestInterface');
      expect(pointerInterface).toBeDefined();
      expect(pointerInterface!.targetLibrary).toBe('libc');
      
      // Check malloc function return type
      const mallocProperty = pointerInterface!.properties.find(prop => prop.name === 'malloc');
      expect(mallocProperty).toBeDefined();
      
      if (mallocProperty!.type.kind === 'function') {
        const funcType = mallocProperty!.type as any;
        expect(funcType.returnType.kind).toBe('type-reference');
        
        if (funcType.returnType.kind === 'type-reference') {
          const returnType = funcType.returnType as any;
          expect(returnType.referencedType.kind).toBe('interface');
          expect(returnType.referencedType.name).toBe('ptr');
          expect(returnType.typeArguments).toHaveLength(1);
          expect(returnType.typeArguments[0].kind).toBe('primitive');
          expect(returnType.typeArguments[0].type).toBe('void');
          expect(returnType.typeString).toBe('ptr<void>');
        }
      }
      
      // Check free function parameter type
      const freeProperty = pointerInterface!.properties.find(prop => prop.name === 'free');
      expect(freeProperty).toBeDefined();
      
      if (freeProperty!.type.kind === 'function') {
        const funcType = freeProperty!.type as any;
        expect(funcType.parameters).toHaveLength(1);
        
        const paramType = funcType.parameters[0].type;
        expect(paramType.kind).toBe('type-reference');
        
        if (paramType.kind === 'type-reference') {
          expect(paramType.referencedType.kind).toBe('interface');
          expect(paramType.referencedType.name).toBe('ptr');
          expect(paramType.typeArguments).toHaveLength(1);
          expect(paramType.typeArguments[0].kind).toBe('primitive');
          expect(paramType.typeArguments[0].type).toBe('void');
          expect(paramType.typeString).toBe('ptr<void>');
        }
      }
    } finally {
      // Cleanup
      if (fs.existsSync(pointerTestFile)) {
        fs.unlinkSync(pointerTestFile);
      }
    }
  });

  it('should extract C numeric type interfaces correctly', () => {
    // Create a test file with C numeric type interfaces
    const numericTestFile = path.join(path.dirname(decoratorTestFile), 'numeric-test.ts');
    const numericTestContent = `
    // Definition of C numeric types
interface int32_t {
}

interface uint32_t {
}

interface float {
}

interface double {
}

/**
 * @decorator native libc
 */
export interface NumericTestInterface {
  puts: (s: string) => int32_t;
  atof: (str: string) => double;
  fabs: (x: double) => double;
  fabsf: (x: float) => float;
  abs: (x: int32_t) => int32_t;
  add_numbers: (a: number, b: number) => number;
}
`;
    
    fs.writeFileSync(numericTestFile, numericTestContent);
    
    try {
      const results = extractInterfaces(tempDir, [numericTestFile], 'native');
      
      expect(results).toBeDefined();
      expect(results).toHaveLength(1);
      
      const numericInterface = results.find(item => item.name === 'NumericTestInterface');
      expect(numericInterface).toBeDefined();
      expect(numericInterface!.targetLibrary).toBe('libc');
      
      // Check puts function - returns int32_t interface type
      const putsProperty = numericInterface!.properties.find(prop => prop.name === 'puts');
      expect(putsProperty).toBeDefined();
      expect(putsProperty!.type.kind).toBe('function');
      
      if (putsProperty!.type.kind === 'function') {
        const funcType = putsProperty!.type as any;
        expect(funcType.returnType.kind).toBe('interface');
        expect(funcType.returnType.name).toBe('int32_t');
      }
      
      // Check atof function - returns double interface type
      const atofProperty = numericInterface!.properties.find(prop => prop.name === 'atof');
      expect(atofProperty).toBeDefined();
      expect(atofProperty!.type.kind).toBe('function');
      
      if (atofProperty!.type.kind === 'function') {
        const funcType = atofProperty!.type as any;
        expect(funcType.returnType.kind).toBe('interface');
        expect(funcType.returnType.name).toBe('double');
      }
      
      // Check fabsf function - takes and returns float interface type
      const fabsfProperty = numericInterface!.properties.find(prop => prop.name === 'fabsf');
      expect(fabsfProperty).toBeDefined();
      expect(fabsfProperty!.type.kind).toBe('function');
      
      if (fabsfProperty!.type.kind === 'function') {
        const funcType = fabsfProperty!.type as any;
        expect(funcType.parameters).toHaveLength(1);
        expect(funcType.parameters[0].type.kind).toBe('interface');
        expect(funcType.parameters[0].type.name).toBe('float');
        expect(funcType.returnType.kind).toBe('interface');
        expect(funcType.returnType.name).toBe('float');
      }
      
      // Check add_numbers function - uses primitive number type (should become double)
      const addNumbersProperty = numericInterface!.properties.find(prop => prop.name === 'add_numbers');
      expect(addNumbersProperty).toBeDefined();
      expect(addNumbersProperty!.type.kind).toBe('function');
      
      if (addNumbersProperty!.type.kind === 'function') {
        const funcType = addNumbersProperty!.type as any;
        expect(funcType.parameters).toHaveLength(2);
        expect(funcType.parameters[0].type.kind).toBe('primitive');
        expect(funcType.parameters[0].type.type).toBe('number');
        expect(funcType.parameters[1].type.kind).toBe('primitive');
        expect(funcType.parameters[1].type.type).toBe('number');
        expect(funcType.returnType.kind).toBe('primitive');
        expect(funcType.returnType.type).toBe('number');
      }
      
    } finally {
      // Cleanup
      if (fs.existsSync(numericTestFile)) {
        fs.unlinkSync(numericTestFile);
      }
    }
  });

  it('should extract native-type decorated interfaces correctly', () => {
    // Create a test file with native-type decorator
    const nativeTypeTestFile = path.join(path.dirname(decoratorTestFile), 'native-type-test.ts');
    const nativeTypeTestContent = `
    // Definition of C numeric types using native-type decorator
/**
 * @decorator native-type
 */
interface int32_t {
}

/**
 * @decorator native-type uint32_t
 */
interface uint32_custom {
}

/**
 * @decorator native-type
 */
interface float {
}

/**
 * Interface for testing new native-type decorator functionality
 * @decorator native native-type-test
 */
export interface NativeTypeTests {
  test_int32: (x: int32_t) => int32_t;
  test_uint32: (x: uint32_custom) => uint32_custom;
  test_float: (x: float) => float;
}
`;
    
    fs.writeFileSync(nativeTypeTestFile, nativeTypeTestContent);
    
    try {
      const results = extractInterfaces(tempDir, [nativeTypeTestFile], 'native-type');
      
      expect(results).toBeDefined();
      expect(results).toHaveLength(3); // int32_t, uint32_custom, float
      
      // Check int32_t interface - should use interface name as nativeTypeName
      const int32Interface = results.find(item => item.name === 'int32_t');
      expect(int32Interface).toBeDefined();
      expect(int32Interface!.nativeTypeName).toBe('int32_t'); // Should use interface name as fallback
      expect(int32Interface!.targetLibrary).toBeUndefined(); // native-type decorator doesn't set targetLibrary
      
      // Check uint32_custom interface - should use provided nativeTypeName
      const uint32Interface = results.find(item => item.name === 'uint32_custom');
      expect(uint32Interface).toBeDefined();
      expect(uint32Interface!.nativeTypeName).toBe('uint32_t'); // Should use provided type name
      expect(uint32Interface!.targetLibrary).toBeUndefined(); // native-type decorator doesn't set targetLibrary
      
      // Check float interface - should use interface name as nativeTypeName
      const floatInterface = results.find(item => item.name === 'float');
      expect(floatInterface).toBeDefined();
      expect(floatInterface!.nativeTypeName).toBe('float'); // Should use interface name as fallback
      expect(floatInterface!.targetLibrary).toBeUndefined(); // native-type decorator doesn't set targetLibrary
      
    } finally {
      // Cleanup
      if (fs.existsSync(nativeTypeTestFile)) {
        fs.unlinkSync(nativeTypeTestFile);
      }
    }
  });

  it('should extract mixed native-type and native decorator interfaces correctly', () => {
    // Create a test file mixing both decorator types
    const mixedTestFile = path.join(path.dirname(decoratorTestFile), 'mixed-test.ts');
    const mixedTestContent = `
    // Mixed decorator test
/**
 * @decorator native-type
 */
interface int32_t {
}

/**
 * @decorator native-type size_t
 */
interface custom_size {
}

/**
 * Interface using native decorator
 * @decorator native mixed-lib
 */
export interface MixedInterface {
  test_func: (x: int32_t, size: custom_size) => int32_t;
}
`;
    
    fs.writeFileSync(mixedTestFile, mixedTestContent);
    
    try {
      // Test native-type extraction
      const nativeTypeResults = extractInterfaces(tempDir, [mixedTestFile], 'native-type');
      expect(nativeTypeResults).toBeDefined();
      expect(nativeTypeResults).toHaveLength(2); // int32_t, custom_size
      
      const int32Interface = nativeTypeResults.find(item => item.name === 'int32_t');
      expect(int32Interface).toBeDefined();
      expect(int32Interface!.nativeTypeName).toBe('int32_t');
      expect(int32Interface!.targetLibrary).toBeUndefined();
      
      const customSizeInterface = nativeTypeResults.find(item => item.name === 'custom_size');
      expect(customSizeInterface).toBeDefined();
      expect(customSizeInterface!.nativeTypeName).toBe('size_t');
      expect(customSizeInterface!.targetLibrary).toBeUndefined();
      
      // Test native decorator extraction
      const nativeResults = extractInterfaces(tempDir, [mixedTestFile], 'native');
      expect(nativeResults).toBeDefined();
      expect(nativeResults).toHaveLength(1); // MixedInterface only
      
      const mixedInterface = nativeResults.find(item => item.name === 'MixedInterface');
      expect(mixedInterface).toBeDefined();
      expect(mixedInterface!.targetLibrary).toBe('mixed-lib');
      expect(mixedInterface!.nativeTypeName).toBeUndefined(); // native decorator doesn't set nativeTypeName
      
    } finally {
      // Cleanup
      if (fs.existsSync(mixedTestFile)) {
        fs.unlinkSync(mixedTestFile);
      }
    }
  });

  it('should have consistent typeString across all TypeNode types', () => {
    // Create a test file with various types
    const testFile = path.join(path.dirname(decoratorTestFile), 'consistent-test.ts');
    const testContent = `
/**
 * @decorator native test
 */
export interface ConsistentTestInterface {
  primitiveData: string;
  genericData: Promise<string>;
  arrayData: Array<number>;
}
`;
    
    fs.writeFileSync(testFile, testContent);
    
    try {
      const results = extractInterfaces(tempDir, [testFile], 'native');
      
      const testInterface = results.find(item => item.name === 'ConsistentTestInterface');
      expect(testInterface).toBeDefined();
      
      // Check that all TypeNodes have typeString property (inherited from base TypeNode)
      expect(testInterface!.typeString).toBeDefined();
      expect(typeof testInterface!.typeString).toBe('string');
      
      // Check all properties of the interface
      testInterface!.properties.forEach(prop => {
        expect(prop.type.typeString).toBeDefined();
        expect(typeof prop.type.typeString).toBe('string');
        
        // For type-reference types, check that referencedType also has typeString
        if (prop.type.kind === 'type-reference') {
          const typeRef = prop.type as any;
          expect(typeRef.referencedType.typeString).toBeDefined();
          expect(typeof typeRef.referencedType.typeString).toBe('string');
          
          // Check that type arguments also have typeString
          if (typeRef.typeArguments) {
            typeRef.typeArguments.forEach((typeArg: any) => {
              expect(typeArg.typeString).toBeDefined();
              expect(typeof typeArg.typeString).toBe('string');
            });
          }
        }
      });
    } finally {
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }
    }
  });

  it('should extract ptr<T> types correctly for native library functions', () => {
    // Create a test file with ptr<T> types
    const pointerTestFile = path.join(path.dirname(decoratorTestFile), 'pointer-test.ts');
    const pointerTestContent = `
    // Definition showing pointer type
interface ptr<T> {
}

/**
 * @decorator native libc
 */
export interface PointerTestInterface {
  malloc: (size: number) => ptr<void>;
  free: (p: ptr<void>) => void;
  createIntPtr: (value: number) => ptr<number>;
  readIntPtr: (ptr: ptr<number>) => number;
}
`;
    
    fs.writeFileSync(pointerTestFile, pointerTestContent);
    
    try {
      const results = extractInterfaces(tempDir, [pointerTestFile], 'native');
      
      expect(results).toBeDefined();
      expect(results).toHaveLength(1);
      
      const pointerInterface = results.find(item => item.name === 'PointerTestInterface');
      expect(pointerInterface).toBeDefined();
      expect(pointerInterface!.targetLibrary).toBe('libc');
      
      // Check malloc function return type
      const mallocProperty = pointerInterface!.properties.find(prop => prop.name === 'malloc');
      expect(mallocProperty).toBeDefined();
      
      if (mallocProperty!.type.kind === 'function') {
        const funcType = mallocProperty!.type as any;
        expect(funcType.returnType.kind).toBe('type-reference');
        
        if (funcType.returnType.kind === 'type-reference') {
          const returnType = funcType.returnType as any;
          expect(returnType.referencedType.kind).toBe('interface');
          expect(returnType.referencedType.name).toBe('ptr');
          expect(returnType.typeArguments).toHaveLength(1);
          expect(returnType.typeArguments[0].kind).toBe('primitive');
          expect(returnType.typeArguments[0].type).toBe('void');
          expect(returnType.typeString).toBe('ptr<void>');
        }
      }
      
      // Check free function parameter type
      const freeProperty = pointerInterface!.properties.find(prop => prop.name === 'free');
      expect(freeProperty).toBeDefined();
      
      if (freeProperty!.type.kind === 'function') {
        const funcType = freeProperty!.type as any;
        expect(funcType.parameters).toHaveLength(1);
        
        const paramType = funcType.parameters[0].type;
        expect(paramType.kind).toBe('type-reference');
        
        if (paramType.kind === 'type-reference') {
          expect(paramType.referencedType.kind).toBe('interface');
          expect(paramType.referencedType.name).toBe('ptr');
          expect(paramType.typeArguments).toHaveLength(1);
          expect(paramType.typeArguments[0].kind).toBe('primitive');
          expect(paramType.typeArguments[0].type).toBe('void');
          expect(paramType.typeString).toBe('ptr<void>');
        }
      }
    } finally {
      // Cleanup
      if (fs.existsSync(pointerTestFile)) {
        fs.unlinkSync(pointerTestFile);
      }
    }
  });

  it('should extract C numeric type interfaces correctly', () => {
    // Create a test file with C numeric type interfaces
    const numericTestFile = path.join(path.dirname(decoratorTestFile), 'numeric-test.ts');
    const numericTestContent = `
    // Definition of C numeric types
interface int32_t {
}

interface uint32_t {
}

interface float {
}

interface double {
}

/**
 * @decorator native libc
 */
export interface NumericTestInterface {
  puts: (s: string) => int32_t;
  atof: (str: string) => double;
  fabs: (x: double) => double;
  fabsf: (x: float) => float;
  abs: (x: int32_t) => int32_t;
  add_numbers: (a: number, b: number) => number;
}
`;
    
    fs.writeFileSync(numericTestFile, numericTestContent);
    
    try {
      const results = extractInterfaces(tempDir, [numericTestFile], 'native');
      
      expect(results).toBeDefined();
      expect(results).toHaveLength(1);
      
      const numericInterface = results.find(item => item.name === 'NumericTestInterface');
      expect(numericInterface).toBeDefined();
      expect(numericInterface!.targetLibrary).toBe('libc');
      
      // Check puts function - returns int32_t interface type
      const putsProperty = numericInterface!.properties.find(prop => prop.name === 'puts');
      expect(putsProperty).toBeDefined();
      expect(putsProperty!.type.kind).toBe('function');
      
      if (putsProperty!.type.kind === 'function') {
        const funcType = putsProperty!.type as any;
        expect(funcType.returnType.kind).toBe('interface');
        expect(funcType.returnType.name).toBe('int32_t');
      }
      
      // Check atof function - returns double interface type
      const atofProperty = numericInterface!.properties.find(prop => prop.name === 'atof');
      expect(atofProperty).toBeDefined();
      expect(atofProperty!.type.kind).toBe('function');
      
      if (atofProperty!.type.kind === 'function') {
        const funcType = atofProperty!.type as any;
        expect(funcType.returnType.kind).toBe('interface');
        expect(funcType.returnType.name).toBe('double');
      }
      
      // Check fabsf function - takes and returns float interface type
      const fabsfProperty = numericInterface!.properties.find(prop => prop.name === 'fabsf');
      expect(fabsfProperty).toBeDefined();
      expect(fabsfProperty!.type.kind).toBe('function');
      
      if (fabsfProperty!.type.kind === 'function') {
        const funcType = fabsfProperty!.type as any;
        expect(funcType.parameters).toHaveLength(1);
        expect(funcType.parameters[0].type.kind).toBe('interface');
        expect(funcType.parameters[0].type.name).toBe('float');
        expect(funcType.returnType.kind).toBe('interface');
        expect(funcType.returnType.name).toBe('float');
      }
      
      // Check add_numbers function - uses primitive number type (should become double)
      const addNumbersProperty = numericInterface!.properties.find(prop => prop.name === 'add_numbers');
      expect(addNumbersProperty).toBeDefined();
      expect(addNumbersProperty!.type.kind).toBe('function');
      
      if (addNumbersProperty!.type.kind === 'function') {
        const funcType = addNumbersProperty!.type as any;
        expect(funcType.parameters).toHaveLength(2);
        expect(funcType.parameters[0].type.kind).toBe('primitive');
        expect(funcType.parameters[0].type.type).toBe('number');
        expect(funcType.parameters[1].type.kind).toBe('primitive');
        expect(funcType.parameters[1].type.type).toBe('number');
        expect(funcType.returnType.kind).toBe('primitive');
        expect(funcType.returnType.type).toBe('number');
      }
      
    } finally {
      // Cleanup
      if (fs.existsSync(numericTestFile)) {
        fs.unlinkSync(numericTestFile);
      }
    }
  });

  it('should extract native-type decorated interfaces correctly', () => {
    // Create a test file with native-type decorator
    const nativeTypeTestFile = path.join(path.dirname(decoratorTestFile), 'native-type-test.ts');
    const nativeTypeTestContent = `
    // Definition of C numeric types using native-type decorator
/**
 * @decorator native-type
 */
interface int32_t {
}

/**
 * @decorator native-type uint32_t
 */
interface uint32_custom {
}

/**
 * @decorator native-type
 */
interface float {
}

/**
 * Interface for testing new native-type decorator functionality
 * @decorator native native-type-test
 */
export interface NativeTypeTests {
  test_int32: (x: int32_t) => int32_t;
  test_uint32: (x: uint32_custom) => uint32_custom;
  test_float: (x: float) => float;
}
`;
    
    fs.writeFileSync(nativeTypeTestFile, nativeTypeTestContent);
    
    try {
      const results = extractInterfaces(tempDir, [nativeTypeTestFile], 'native-type');
      
      expect(results).toBeDefined();
      expect(results).toHaveLength(3); // int32_t, uint32_custom, float
      
      // Check int32_t interface - should use interface name as nativeTypeName
      const int32Interface = results.find(item => item.name === 'int32_t');
      expect(int32Interface).toBeDefined();
      expect(int32Interface!.nativeTypeName).toBe('int32_t'); // Should use interface name as fallback
      expect(int32Interface!.targetLibrary).toBeUndefined(); // native-type decorator doesn't set targetLibrary
      
      // Check uint32_custom interface - should use provided nativeTypeName
      const uint32Interface = results.find(item => item.name === 'uint32_custom');
      expect(uint32Interface).toBeDefined();
      expect(uint32Interface!.nativeTypeName).toBe('uint32_t'); // Should use provided type name
      expect(uint32Interface!.targetLibrary).toBeUndefined(); // native-type decorator doesn't set targetLibrary
      
      // Check float interface - should use interface name as nativeTypeName
      const floatInterface = results.find(item => item.name === 'float');
      expect(floatInterface).toBeDefined();
      expect(floatInterface!.nativeTypeName).toBe('float'); // Should use interface name as fallback
      expect(floatInterface!.targetLibrary).toBeUndefined(); // native-type decorator doesn't set targetLibrary
      
    } finally {
      // Cleanup
      if (fs.existsSync(nativeTypeTestFile)) {
        fs.unlinkSync(nativeTypeTestFile);
      }
    }
  });

  it('should extract mixed native-type and native decorator interfaces correctly', () => {
    // Create a test file mixing both decorator types
    const mixedTestFile = path.join(path.dirname(decoratorTestFile), 'mixed-test.ts');
    const mixedTestContent = `
    // Mixed decorator test
/**
 * @decorator native-type
 */
interface int32_t {
}

/**
 * @decorator native-type size_t
 */
interface custom_size {
}

/**
 * Interface using native decorator
 * @decorator native mixed-lib
 */
export interface MixedInterface {
  test_func: (x: int32_t, size: custom_size) => int32_t;
}
`;
    
    fs.writeFileSync(mixedTestFile, mixedTestContent);
    
    try {
      // Test native-type extraction
      const nativeTypeResults = extractInterfaces(tempDir, [mixedTestFile], 'native-type');
      expect(nativeTypeResults).toBeDefined();
      expect(nativeTypeResults).toHaveLength(2); // int32_t, custom_size
      
      const int32Interface = nativeTypeResults.find(item => item.name === 'int32_t');
      expect(int32Interface).toBeDefined();
      expect(int32Interface!.nativeTypeName).toBe('int32_t');
      expect(int32Interface!.targetLibrary).toBeUndefined();
      
      const customSizeInterface = nativeTypeResults.find(item => item.name === 'custom_size');
      expect(customSizeInterface).toBeDefined();
      expect(customSizeInterface!.nativeTypeName).toBe('size_t');
      expect(customSizeInterface!.targetLibrary).toBeUndefined();
      
      // Test native decorator extraction
      const nativeResults = extractInterfaces(tempDir, [mixedTestFile], 'native');
      expect(nativeResults).toBeDefined();
      expect(nativeResults).toHaveLength(1); // MixedInterface only
      
      const mixedInterface = nativeResults.find(item => item.name === 'MixedInterface');
      expect(mixedInterface).toBeDefined();
      expect(mixedInterface!.targetLibrary).toBe('mixed-lib');
      expect(mixedInterface!.nativeTypeName).toBeUndefined(); // native decorator doesn't set nativeTypeName
      
    } finally {
      // Cleanup
      if (fs.existsSync(mixedTestFile)) {
        fs.unlinkSync(mixedTestFile);
      }
    }
  });
});

describe('extractFunctionMethods function', () => {
  let tempDir: string;
  let testFunctionFile: string;
  let testClassFile: string;
  let testArrowFile: string;
  let tsConfigFile: string;
  
  // Test file content for function declarations
  const testFunctionContent = `
/**
 * @decorator expose mainProcess
 */
export function simpleFunction(param: string): Promise<number> {
  return Promise.resolve(42);
}

/**
 * @decorator expose customNamespace
 */
export function complexFunction(a: number, b: string, ...rest: any[]): Promise<void> {
  return Promise.resolve();
}

/**
 * No decorator function
 */
export function regularFunction(): void {
  return;
}

/**
 * @decorator other somearg
 */
export function otherFunction(): Promise<string> {
  return Promise.resolve('test');
}
`;

  // Test file content for class methods
  const testClassContent = `
export class TestService {
  /**
   * @decorator expose api
   */
  public async getData(id: number): Promise<string> {
    return 'data';
  }

  /**
   * @decorator expose api
   */
  public async saveData(data: string, options?: { validate: boolean }): Promise<void> {
    return;
  }

  /**
   * Regular method without decorator
   */
  public regularMethod(): void {
    return;
  }

  /**
   * @decorator other config
   */
  public configMethod(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

export class AnotherService {
  /**
   * @decorator expose system
   */
  public async systemCall(): Promise<number> {
    return 1;
  }
}
`;

  // Test file content for arrow functions
  const testArrowContent = `
/**
 * @decorator expose utils
 */
export const arrowFunction = (x: number, y: number): Promise<number> => {
  return Promise.resolve(x + y);
};

/**
 * @decorator expose helpers
 */
export const complexArrowFunction = (
  data: { name: string; value: number },
  callback: (result: boolean) => void
): Promise<string> => {
  return Promise.resolve('result');
};

/**
 * No decorator arrow function
 */
export const regularArrowFunction = (): void => {
  return;
};

/**
 * @decorator other test
 */
export const otherArrowFunction = (): Promise<any> => {
  return Promise.resolve();
};
`;

  const tsConfigContent = {
    compilerOptions: {
      target: "ES2020",
      module: "ESNext",
      moduleResolution: "bundler",
      strict: true,
      declaration: true,
      outDir: "./dist",
      rootDir: "./src"
    },
    include: ["src/**/*"],
    exclude: ["node_modules", "dist"]
  };

  beforeAll(async () => {
    // Create temporary directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'function-extractor-test-'));
    
    // Create src directory
    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    
    // Set test file paths
    testFunctionFile = path.join(srcDir, 'test-functions.ts');
    testClassFile = path.join(srcDir, 'test-classes.ts');
    testArrowFile = path.join(srcDir, 'test-arrows.ts');
    tsConfigFile = path.join(tempDir, 'tsconfig.json');
    
    // Create files
    fs.writeFileSync(testFunctionFile, testFunctionContent);
    fs.writeFileSync(testClassFile, testClassContent);
    fs.writeFileSync(testArrowFile, testArrowContent);
    fs.writeFileSync(tsConfigFile, JSON.stringify(tsConfigContent, null, 2));
  });

  afterAll(async () => {
    // Delete temporary directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should extract function declarations with decorator information', () => {
    const results = extractFunctionMethods(tempDir, [testFunctionFile]);
    
    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
    
    // Find function with expose decorator
    const exposeFunctions = results.filter(fn => fn.decoratorInfo?.decorator === 'expose');
    expect(exposeFunctions).toHaveLength(2);
    
    // Check simpleFunction
    const simpleFunction = exposeFunctions.find(fn => fn.name === 'simpleFunction');
    expect(simpleFunction).toBeDefined();
    expect(simpleFunction!.kind).toBe('function');
    expect(simpleFunction!.decoratorInfo?.decorator).toBe('expose');
    expect(simpleFunction!.decoratorInfo?.argument).toBe('mainProcess');
    expect(simpleFunction!.parameters).toHaveLength(1);
    expect(simpleFunction!.parameters[0].name).toBe('param');
    expect(simpleFunction!.parameters[0].type.kind).toBe('primitive');
    expect(simpleFunction!.parameters[0].type.typeString).toBe('string');
    expect(simpleFunction!.returnType.typeString).toBe('Promise<number>');
    
    // Check complexFunction
    const complexFunction = exposeFunctions.find(fn => fn.name === 'complexFunction');
    expect(complexFunction).toBeDefined();
    expect(complexFunction!.kind).toBe('function');
    expect(complexFunction!.decoratorInfo?.argument).toBe('customNamespace');
    expect(complexFunction!.parameters).toHaveLength(3);
    expect(complexFunction!.parameters[2].isRestParameter).toBe(true);
  });

  it('should extract class methods with decorator information', () => {
    const results = extractFunctionMethods(tempDir, [testClassFile]);
    
    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
    
    // Find methods with expose decorator
    const exposeMethods = results.filter(fn => fn.decoratorInfo?.decorator === 'expose');
    expect(exposeMethods).toHaveLength(3);
    
    // Check getData method
    const getDataMethod = exposeMethods.find(fn => fn.name === 'getData');
    expect(getDataMethod).toBeDefined();
    expect(getDataMethod!.kind).toBe('class-method');
    expect(getDataMethod!.className).toBe('TestService');
    expect(getDataMethod!.decoratorInfo?.decorator).toBe('expose');
    expect(getDataMethod!.decoratorInfo?.argument).toBe('api');
    expect(getDataMethod!.parameters).toHaveLength(1);
    expect(getDataMethod!.parameters[0].name).toBe('id');
    expect(getDataMethod!.parameters[0].type.typeString).toBe('number');
    expect(getDataMethod!.returnType.typeString).toBe('Promise<string>');
    
    // Check saveData method with optional parameter
    const saveDataMethod = exposeMethods.find(fn => fn.name === 'saveData');
    expect(saveDataMethod).toBeDefined();
    expect(saveDataMethod!.parameters).toHaveLength(2);
    expect(saveDataMethod!.parameters[1].name).toBe('options');
    
    // Check systemCall method from AnotherService
    const systemCallMethod = exposeMethods.find(fn => fn.name === 'systemCall');
    expect(systemCallMethod).toBeDefined();
    expect(systemCallMethod!.className).toBe('AnotherService');
    expect(systemCallMethod!.decoratorInfo?.argument).toBe('system');
  });

  it('should extract arrow functions with decorator information', () => {
    const results = extractFunctionMethods(tempDir, [testArrowFile]);
    
    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
    
    // Find arrow functions with expose decorator
    const exposeArrows = results.filter(fn => fn.decoratorInfo?.decorator === 'expose');
    expect(exposeArrows).toHaveLength(2);
    
    // Check arrowFunction
    const arrowFunction = exposeArrows.find(fn => fn.name === 'arrowFunction');
    expect(arrowFunction).toBeDefined();
    expect(arrowFunction!.kind).toBe('arrow-function');
    expect(arrowFunction!.decoratorInfo?.decorator).toBe('expose');
    expect(arrowFunction!.decoratorInfo?.argument).toBe('utils');
    expect(arrowFunction!.parameters).toHaveLength(2);
    expect(arrowFunction!.parameters[0].name).toBe('x');
    expect(arrowFunction!.parameters[1].name).toBe('y');
    expect(arrowFunction!.returnType.typeString).toBe('Promise<number>');
    
    // Check complexArrowFunction
    const complexArrowFunction = exposeArrows.find(fn => fn.name === 'complexArrowFunction');
    expect(complexArrowFunction).toBeDefined();
    expect(complexArrowFunction!.decoratorInfo?.argument).toBe('helpers');
    expect(complexArrowFunction!.parameters).toHaveLength(2);
    expect(complexArrowFunction!.parameters[0].name).toBe('data');
    expect(complexArrowFunction!.parameters[1].name).toBe('callback');
  });

  it('should extract all function types from multiple files', () => {
    const results = extractFunctionMethods(tempDir, [testFunctionFile, testClassFile, testArrowFile]);
    
    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
    
    // Count by kind
    const functionDeclarations = results.filter(fn => fn.kind === 'function');
    const classMethods = results.filter(fn => fn.kind === 'class-method');
    const arrowFunctions = results.filter(fn => fn.kind === 'arrow-function');
    
    expect(functionDeclarations.length).toBeGreaterThan(0);
    expect(classMethods.length).toBeGreaterThan(0);
    expect(arrowFunctions.length).toBeGreaterThan(0);
    
    // Check that all results have required properties
    results.forEach(fn => {
      expect(fn.name).toBeDefined();
      expect(fn.kind).toBeDefined();
      expect(fn.parameters).toBeDefined();
      expect(fn.returnType).toBeDefined();
      expect(fn.sourceLocation).toBeDefined();
      expect(fn.filePath).toBeDefined();
    });
  });

  it('should handle functions without decorators', () => {
    const results = extractFunctionMethods(tempDir, [testFunctionFile]);
    
    // Find functions without decorators
    const functionsWithoutDecorator = results.filter(fn => !fn.decoratorInfo);
    expect(functionsWithoutDecorator.length).toBeGreaterThan(0);
    
    const regularFunction = functionsWithoutDecorator.find(fn => fn.name === 'regularFunction');
    expect(regularFunction).toBeDefined();
    expect(regularFunction!.decoratorInfo).toBeUndefined();
  });

  it('should handle different decorator types', () => {
    const results = extractFunctionMethods(tempDir, [testFunctionFile, testClassFile, testArrowFile]);
    
    // Find functions with 'other' decorator
    const otherFunctions = results.filter(fn => fn.decoratorInfo?.decorator === 'other');
    expect(otherFunctions.length).toBeGreaterThan(0);
    
    // Check that they have decorator info but different decorator type
    otherFunctions.forEach(fn => {
      expect(fn.decoratorInfo?.decorator).toBe('other');
      expect(fn.decoratorInfo?.argument).toBeDefined();
    });
  });

  it('should provide accurate source location information', () => {
    const results = extractFunctionMethods(tempDir, [testFunctionFile]);
    
    expect(results.length).toBeGreaterThan(0);
    
    results.forEach(fn => {
      expect(fn.sourceLocation.fileName).toBe(testFunctionFile);
      expect(fn.sourceLocation.startLine).toBeGreaterThan(0);
      expect(fn.sourceLocation.startColumn).toBeGreaterThanOrEqual(0);
      expect(fn.sourceLocation.endLine).toBeGreaterThanOrEqual(fn.sourceLocation.startLine);
      expect(fn.filePath).toBe(testFunctionFile);
    });
  });

  it('should handle complex parameter types correctly', () => {
    const results = extractFunctionMethods(tempDir, [testArrowFile]);
    
    const complexArrowFunction = results.find(fn => fn.name === 'complexArrowFunction');
    expect(complexArrowFunction).toBeDefined();
    
    // Check complex object parameter - anonymous object types are classified as 'unknown' by TypeScript
    const dataParam = complexArrowFunction!.parameters[0];
    expect(dataParam.name).toBe('data');
    expect(dataParam.type.kind).toBe('unknown');
    expect(dataParam.type.typeString).toBe('{ name: string; value: number; }');
    
    // Check function parameter
    const callbackParam = complexArrowFunction!.parameters[1];
    expect(callbackParam.name).toBe('callback');
    expect(callbackParam.type.kind).toBe('function');
  });

  it('should throw error when tsconfig.json is not found', () => {
    const invalidPath = '/nonexistent/path';
    
    expect(() => {
      extractFunctionMethods(invalidPath, [testFunctionFile]);
    }).toThrow('tsconfig.json not found');
  });

  it('should throw error when no source file paths are provided', () => {
    expect(() => {
      extractFunctionMethods(tempDir, []);
    }).toThrow('Source file paths are not specified');
  });

  it('should handle non-existent source files gracefully', () => {
    const nonExistentFile = path.join(tempDir, 'nonexistent.ts');
    
    // Should not throw, but should warn and return empty results
    const results = extractFunctionMethods(tempDir, [nonExistentFile]);
    expect(results).toBeDefined();
    expect(results).toHaveLength(0);
  });
});
