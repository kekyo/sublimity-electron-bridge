import { describe, it, expect, beforeEach } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, writeFileSync } from 'fs';
import dayjs from 'dayjs';
import { extractFunctions, loadTsConfig } from '../src/extractor';
import { createConsoleLogger } from '../src/logger';

describe('extractFunctions function', () => {
  const testOutputBaseDir = join(tmpdir(), 'seb-test/core/extractor', dayjs().format('YYYYMMDD_HHmmssSSS'));
  const logger = createConsoleLogger('extractor-test');
  let testOutputDir: string;
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

  beforeEach(fn => {
    // Create unique temporary directory for each test
    testOutputDir = join(testOutputBaseDir, fn.task.name);
    mkdirSync(testOutputDir, { recursive: true });
    console.info(`Test output directory: ${testOutputDir}`);

    // Create src directory
    const srcDir = join(testOutputDir, 'src');
    mkdirSync(srcDir, { recursive: true });
    
    // Set test file paths
    testFunctionFile = join(srcDir, 'test-functions.ts');
    testClassFile = join(srcDir, 'test-classes.ts');
    testArrowFile = join(srcDir, 'test-arrows.ts');
    tsConfigFile = join(testOutputDir, 'tsconfig.json');
    
    // Create files
    writeFileSync(testFunctionFile, testFunctionContent);
    writeFileSync(testClassFile, testClassContent);
    writeFileSync(testArrowFile, testArrowContent);
    writeFileSync(tsConfigFile, JSON.stringify(tsConfigContent, null, 2));
  });

  it('should extract function declarations with decorator information', () => {
    const tsConfig = loadTsConfig(tsConfigFile, testOutputDir, logger);
    const results = extractFunctions(tsConfig, testOutputDir, [testFunctionFile], logger);
    
    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
    
    // Find function with expose decorator
    const exposeFunctions = results.filter(fn => fn.jsdocDecorator?.decorator === 'expose');
    expect(exposeFunctions).toHaveLength(2);
    
    // Check simpleFunction
    const simpleFunction = exposeFunctions.find(fn => fn.name === 'simpleFunction');
    expect(simpleFunction).toBeDefined();
    expect(simpleFunction!.kind).toBe('function');
    expect(simpleFunction!.jsdocDecorator?.decorator).toBe('expose');
    expect(simpleFunction!.jsdocDecorator?.args[0]).toBe('mainProcess');
    expect(simpleFunction!.type.parameters).toHaveLength(1);
    expect(simpleFunction!.type.parameters[0].name).toBe('param');
    expect(simpleFunction!.type.parameters[0].type.kind).toBe('primitive');
    expect(simpleFunction!.type.parameters[0].type.typeString).toBe('string');
    expect(simpleFunction!.type.returnType.typeString).toBe('Promise<number>');
    
    // Check complexFunction
    const complexFunction = exposeFunctions.find(fn => fn.name === 'complexFunction');
    expect(complexFunction).toBeDefined();
    expect(complexFunction!.kind).toBe('function');
    expect(complexFunction!.jsdocDecorator?.args[0]).toBe('customNamespace');
    expect(complexFunction!.type.parameters).toHaveLength(3);
    expect(complexFunction!.type.parameters[2].isRestParameter).toBe(true);
  });

  it('should extract class methods with decorator information', () => {
    const tsConfig = loadTsConfig(tsConfigFile, testOutputDir, logger);
    const results = extractFunctions(tsConfig, testOutputDir, [testClassFile], logger);
    
    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
    
    // Find methods with expose decorator
    const exposeMethods = results.filter(fn => fn.jsdocDecorator?.decorator === 'expose');
    expect(exposeMethods).toHaveLength(3);
    
    // Check getData method
    const getDataMethod = exposeMethods.find(fn => fn.name === 'getData');
    expect(getDataMethod).toBeDefined();
    expect(getDataMethod!.kind).toBe('class-method');
    expect(getDataMethod!.declaredType?.typeString).toBe('TestService');
    expect(getDataMethod!.jsdocDecorator?.decorator).toBe('expose');
    expect(getDataMethod!.jsdocDecorator?.args[0]).toBe('api');
    expect(getDataMethod!.type.parameters).toHaveLength(1);
    expect(getDataMethod!.type.parameters[0].name).toBe('id');
    expect(getDataMethod!.type.parameters[0].type.typeString).toBe('number');
    expect(getDataMethod!.type.returnType.typeString).toBe('Promise<string>');
    
    // Check saveData method with optional parameter
    const saveDataMethod = exposeMethods.find(fn => fn.name === 'saveData');
    expect(saveDataMethod).toBeDefined();
    expect(saveDataMethod!.type.parameters).toHaveLength(2);
    expect(saveDataMethod!.type.parameters[1].name).toBe('options');
    
    // Check systemCall method from AnotherService
    const systemCallMethod = exposeMethods.find(fn => fn.name === 'systemCall');
    expect(systemCallMethod).toBeDefined();
    expect(systemCallMethod!.declaredType?.typeString).toBe('AnotherService');
    expect(systemCallMethod!.jsdocDecorator?.args[0]).toBe('system');
  });

  it('should extract arrow functions with decorator information', () => {
    const tsConfig = loadTsConfig(tsConfigFile, testOutputDir, logger);
    const results = extractFunctions(tsConfig, testOutputDir, [testArrowFile], logger);
    
    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
    
    // Find arrow functions with expose decorator
    const exposeArrows = results.filter(fn => fn.jsdocDecorator?.decorator === 'expose');
    expect(exposeArrows).toHaveLength(2);
    
    // Check arrowFunction
    const arrowFunction = exposeArrows.find(fn => fn.name === 'arrowFunction');
    expect(arrowFunction).toBeDefined();
    expect(arrowFunction!.kind).toBe('arrow-function');
    expect(arrowFunction!.jsdocDecorator?.decorator).toBe('expose');
    expect(arrowFunction!.jsdocDecorator?.args[0]).toBe('utils');
    expect(arrowFunction!.type.parameters).toHaveLength(2);
    expect(arrowFunction!.type.parameters[0].name).toBe('x');
    expect(arrowFunction!.type.parameters[1].name).toBe('y');
    expect(arrowFunction!.type.returnType.typeString).toBe('Promise<number>');
    
    // Check complexArrowFunction
    const complexArrowFunction = exposeArrows.find(fn => fn.name === 'complexArrowFunction');
    expect(complexArrowFunction).toBeDefined();
    expect(complexArrowFunction!.jsdocDecorator?.args[0]).toBe('helpers');
    expect(complexArrowFunction!.type.parameters).toHaveLength(2);
    expect(complexArrowFunction!.type.parameters[0].name).toBe('data');
    expect(complexArrowFunction!.type.parameters[1].name).toBe('callback');
  });

  it('should extract all function types from multiple files', () => {
    const tsConfig = loadTsConfig(tsConfigFile, testOutputDir, logger);
    const results = extractFunctions(tsConfig, testOutputDir, [testFunctionFile, testClassFile, testArrowFile], logger);
    
    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
    
    // Count by kind
    const functionDeclarations = results.filter(fn => fn.kind === 'function');
    const classMethods = results.filter(fn => fn.kind === 'class-method');
    const arrowFunctions = results.filter(fn => fn.kind === 'arrow-function');

    // Retreived functions
    expect(functionDeclarations.map(f => f.name).sort()).toEqual(['complexFunction', 'otherFunction', 'regularFunction', 'simpleFunction']);
    expect(classMethods.map(f => f.name).sort()).toEqual(['configMethod', 'getData', 'regularMethod', 'saveData', 'systemCall']);
    expect(arrowFunctions.map(f => f.name).sort()).toEqual(['arrowFunction', 'complexArrowFunction', 'otherArrowFunction', 'regularArrowFunction']);
  });

  it('should handle functions without decorators', () => {
    const tsConfig = loadTsConfig(tsConfigFile, testOutputDir, logger);
    const results = extractFunctions(tsConfig, testOutputDir, [testFunctionFile], logger);
    
    // Find functions without decorators
    const functionsWithoutDecorator = results.filter(fn => !fn.jsdocDecorator);
    expect(functionsWithoutDecorator.length).toBe(1);
    expect(functionsWithoutDecorator.map(f => f.name).sort()).toEqual(['regularFunction']);
  });

  it('should handle different decorator types', () => {
    const tsConfig = loadTsConfig(tsConfigFile, testOutputDir, logger);
    const results = extractFunctions(tsConfig, testOutputDir, [testFunctionFile, testClassFile, testArrowFile], logger);
    
    // Find functions with 'other' decorator
    const otherFunctions = results.filter(fn => fn.jsdocDecorator?.decorator === 'other');
    expect(otherFunctions.map(f => f.name).sort()).toEqual(['configMethod', 'otherArrowFunction', 'otherFunction']);
    
    // Check that they have decorator info but different decorator type
    otherFunctions.forEach(fn => {
      expect(fn.jsdocDecorator?.decorator).toBe('other');
      expect(fn.jsdocDecorator?.args[0]).toBeDefined();
    });
  });

  it('should provide accurate source location information', () => {
    const tsConfig = loadTsConfig(tsConfigFile, testOutputDir, logger);
    const results = extractFunctions(tsConfig, testOutputDir, [testFunctionFile], logger);
    
    expect(results.length).toBeGreaterThan(0);
    
    results.forEach(fn => {
      expect(fn.sourceLocation?.fileName).toBe(testFunctionFile);
      expect(fn.sourceLocation?.startLine).toBeGreaterThan(0);
      expect(fn.sourceLocation?.startColumn).toBeGreaterThanOrEqual(0);
      expect(fn.sourceLocation?.endLine).toBeGreaterThanOrEqual(fn.sourceLocation?.startLine ?? 0);
    });
  });

  it('should handle complex parameter types correctly', () => {
    const tsConfig = loadTsConfig(tsConfigFile, testOutputDir, logger);
    const results = extractFunctions(tsConfig, testOutputDir, [testArrowFile], logger);
    
    const complexArrowFunction = results.find(fn => fn.name === 'complexArrowFunction');
    expect(complexArrowFunction).toBeDefined();
    
    // Check complex object parameter - anonymous object types are classified as 'object' by TypeScript
    const dataParam = complexArrowFunction!.type.parameters[0];
    expect(dataParam.name).toBe('data');
    expect(dataParam.type.kind).toBe('object');
    expect(dataParam.type.typeString).toBe('{ name: string; value: number; }');

    // Check function parameter
    const callbackParam = complexArrowFunction!.type.parameters[1];
    expect(callbackParam.name).toBe('callback');
    expect(callbackParam.type.kind).toBe('function');
  });

  it('should throw error when tsconfig.json is not found', () => {
    const invalidPath = '/nonexistent/path/tsconfig.json';
    
    expect(() => {
      loadTsConfig(invalidPath, testOutputDir, logger);
    }).toThrow('tsconfig.json not found');
  });

  it('should returns nothing when no source file paths are provided', () => {
    const tsConfig = loadTsConfig(tsConfigFile, testOutputDir, logger);
    const functions = extractFunctions(tsConfig, testOutputDir, [], logger);
    expect(functions.length).toBe(0);
  });

  it('should handle non-existent source files gracefully', () => {
    const nonExistentFile = join(testOutputDir, 'nonexistent.ts');
    const tsConfig = loadTsConfig(tsConfigFile, testOutputDir, logger);
    
    // Should not throw, but should warn and return empty results
    const results = extractFunctions(tsConfig, testOutputDir, [nonExistentFile], logger);
    expect(results).toBeDefined();
    expect(results).toHaveLength(0);
  });
});
