import * as ts from 'typescript';
import { resolve, dirname, relative } from 'path';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { ElectronBridgeOptions, ElectronBridgeGenerator, ExposedMethod } from './types';
import { extractExposedMethods, toPascalCase } from './visitor';
import { createConsoleLogger } from '.';

/**
 * Group methods by namespace
 * @param methods - The methods to group
 * @returns The grouped methods
 * @remarks This function groups methods by their namespace. It is made to ensure deterministic order of the methods.
 */
const groupMethodsByNamespace = (methods: ExposedMethod[]): Map<string, ExposedMethod[]> => {
  const groups = new Map<string, ExposedMethod[]>();

  // Group methods by namespace
  for (const method of methods) {
    let methods = groups.get(method.namespace);
    if (!methods) {
      methods = [];
      groups.set(method.namespace, methods);
    }
    methods.push(method);
  }

  // Sort methods by name to ensure deterministic order
  for (const methods of groups.values()) {
    methods.sort((a, b) => a.methodName.localeCompare(b.methodName));
  }

  // Sort groups by name to ensure deterministic order
  return new Map([...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])));
};

/////////////////////////////////////////////////////////////////////////////////////////

/**
 * Generate the main handlers
 * @param namespaceGroups - The grouped methods
 * @param baseDir - The base directory
 * @param outputDir - The output directory
 * @param channelPrefix - Channel prefix
 * @returns The generated code
 * @remarks This function generates the main handlers for the exposed methods.
 */
const generateMainHandlers = (
  namespaceGroups: Map<string, ExposedMethod[]>,
  baseDir: string | undefined,
  outputDir: string,
  channelPrefix: string): string => {

  const imports = new Set<string>();
  const singletonInstances = new Set<string>();
  const handlers: string[] = [];
  
  // Generate imports and collect unique class names
  for (const methods of namespaceGroups.values()) {
    for (const method of methods) {
      if (method.className) {
        let importPath = method.filePath.replace(/\.ts$/, '').replace(/\\/g, '/');
        
        // Convert to relative path if baseDir are provided
        if (baseDir) {
          const methodFileAbsPath = resolve(baseDir, method.filePath);
          importPath = relative(outputDir, methodFileAbsPath).replace(/\.ts$/, '').replace(/\\/g, '/');
          // Ensure relative path starts with ./ if it doesn't start with ../
          if (!importPath.startsWith('.')) {
            importPath = './' + importPath;
          }
        }
        
        imports.add(`import { ${method.className} } from '${importPath}';`);
        singletonInstances.add(method.className);
      }
    }
  }

  // Generate singleton instance declarations
  const instanceDeclarations: string[] = [];
  for (const className of Array.from(singletonInstances).sort()) {
    const instanceVar = `${className.toLowerCase()}Instance`;
    instanceDeclarations.push(`const ${instanceVar} = new ${className}();`);
  }

  for (const [namespace, methods] of namespaceGroups.entries()) {
    for (const method of methods) {
      if (method.className) {
        const instanceVar = `${method.className.toLowerCase()}Instance`;
        const channelName = `${channelPrefix}:${namespace}:${method.methodName}`;
        const params = method.parameters.map(p => p.name).join(', ');
        const args = method.parameters.length > 0 ? `, ${params}` : '';

        handlers.push(`ipcMain.handle('${channelName}', (_${args}) => ${instanceVar}.${method.methodName}(${params}));`);
      } else {
        // Standalone function
        const channelName = `${channelPrefix}:${namespace}:${method.methodName}`;
        const params = method.parameters.map(p => p.name).join(', ');
        const args = method.parameters.length > 0 ? `, ${params}` : '';

        let importPath = method.filePath.replace(/\.ts$/, '').replace(/\\/g, '/');

        // Convert to relative path if baseDir are provided
        if (baseDir) {
          const methodFileAbsPath = resolve(baseDir, method.filePath);
          importPath = relative(outputDir, methodFileAbsPath).replace(/\.ts$/, '').replace(/\\/g, '/');
          // Ensure relative path starts with ./ if it doesn't start with ../
          if (!importPath.startsWith('.')) {
            importPath = './' + importPath;
          }
        }

        imports.add(`import { ${method.methodName} } from '${importPath}';`);
        handlers.push(`ipcMain.handle('${channelName}', (_${args}) => ${method.methodName}(${params}));`);
      }
    }
  }

  return [
    "// This is auto-generated main process handler by sublimity-electron-bridge.",
    "// Do not edit manually this file.",
    '',
    "import { ipcMain } from 'electron';",
    ...Array.from(imports).sort(),
    '',
    '// Create singleton instances',
    ...instanceDeclarations,
    '',
    '// Register IPC handlers',
    ...handlers,
    ''
  ].join('\n');
};

/**
 * Generate the preload bridge
 * @param namespaceGroups - The grouped methods
 * @param channelPrefix - Channel prefix
 * @returns The generated code
 * @remarks This function generates the preload bridge for the exposed methods.
 */
const generatePreloadBridge = (
  namespaceGroups: Map<string, ExposedMethod[]>,
  channelPrefix: string): string => {
  const bridges: string[] = [];
  
  for (const [namespace, methods] of namespaceGroups.entries()) {
    const methodsCode = methods.map(method => {
      const params = method.parameters.map(p => `${p.name}: ${p.type}`).join(', ');
      const args = method.parameters.map(p => p.name).join(', ');
      const channelName = `${channelPrefix}:${namespace}:${method.methodName}`;
      
      return `  ${method.methodName}: (${params}) => ipcRenderer.invoke('${channelName}'${args ? `, ${args}` : ''})`;
    }).join(',\n');
    
    bridges.push(`contextBridge.exposeInMainWorld('${namespace}', {\n${methodsCode}\n});`);
  }
  
  return [
    "// This is auto-generated preloader by sublimity-electron-bridge.",
    "// Do not edit manually this file.",
    '',
    "import { contextBridge, ipcRenderer } from 'electron';",
    '',
    ...bridges,
    ''
  ].join('\n');
};

const primitiveTypes = [
  'string', 'number', 'boolean', 'void', 'any', 'unknown', 'never',
  'undefined', 'null', 'object', 'bigint', 'symbol',
  // Built-in JavaScript types
  'Date', 'RegExp', 'Error', 'Array', 'Object', 'Function', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'Promise', 'ArrayBuffer', 'DataView', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray',
  'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array',
  'BigInt64Array', 'BigUint64Array',
  // TypeScript utility types
  'Record', 'Partial', 'Required', 'Pick', 'Omit', 'Exclude', 'Extract', 'NonNullable',
  'ReturnType', 'InstanceType', 'ThisParameterType', 'OmitThisParameter', 'ThisType'
];
  
/**
 * Check if a type is a primitive type that doesn't need import
 * @param type - The type to check
 * @returns Whether the type is primitive
 */
const isPrimitiveType = (type: string): boolean => {
  // Check for Promise<primitive> patterns
  if (type.startsWith('Promise<') && type.endsWith('>')) {
    const innerType = type.slice(8, -1).trim();
    return isPrimitiveType(innerType);
  }
  
  // Check for array patterns
  if (type.endsWith('[]')) {
    const arrayType = type.slice(0, -2).trim();
    return isPrimitiveType(arrayType);
  }
  
  // Check for union types with only primitives
  if (type.includes('|')) {
    const unionTypes = type.split('|').map(t => t.trim());
    return unionTypes.every(t => isPrimitiveType(t));
  }
  
  // Remove generic type parameters and array notation for analysis
  const cleanType = type.replace(/\[.*?\]/g, '').replace(/<.*?>/g, '').trim();
  
  // Check if it's a primitive type
  if (primitiveTypes.includes(cleanType)) {
    return true;
  }
  
  return false;
};

/**
 * Extract custom types from a type string
 * @param type - The type string to analyze
 * @returns Array of custom type names
 */
const extractCustomTypes = (type: string): string[] => {
  const customTypes: Set<string> = new Set();
  
  // Skip if primitive type
  if (isPrimitiveType(type)) {
    return [];
  }
  
  // Handle Promise<Type> patterns
  if (type.startsWith('Promise<') && type.endsWith('>')) {
    const innerType = type.slice(8, -1).trim();
    return extractCustomTypes(innerType);
  }
  
  // Handle array patterns
  if (type.endsWith('[]')) {
    const arrayType = type.slice(0, -2).trim();
    return extractCustomTypes(arrayType);
  }
  
  // Handle union types
  if (type.includes('|')) {
    const unionTypes = type.split('|').map(t => t.trim());
    unionTypes.forEach(t => {
      extractCustomTypes(t).forEach(customType => customTypes.add(customType));
    });
    return Array.from(customTypes);
  }
  
  // Handle generic types (e.g., Array<Type>, Map<Key, Value>)
  const genericMatch = type.match(/^([A-Za-z_][A-Za-z0-9_]*)<(.+)>$/);
  if (genericMatch) {
    const [, mainType, typeParams] = genericMatch;
    
    // Add main type if not primitive
    if (!isPrimitiveType(mainType)) {
      customTypes.add(mainType);
    }
    
    // Parse type parameters
    const params = typeParams.split(',').map(p => p.trim());
    params.forEach(param => {
      extractCustomTypes(param).forEach(customType => customTypes.add(customType));
    });
    
    return Array.from(customTypes);
  }
  
  // Simple type name
  const typeMatch = type.match(/^[A-Za-z_][A-Za-z0-9_]*$/);
  if (typeMatch && !isPrimitiveType(type)) {
    customTypes.add(type);
  }
  
  return Array.from(customTypes);
};

/**
 * Generate import statements for custom types
 * @param namespaceGroups - The grouped methods
 * @param baseDir - The base directory
 * @param outputDir - The output directory for type definitions
 * @returns The import statements
 */
const generateTypeImports = (
  namespaceGroups: Map<string, ExposedMethod[]>,
  baseDir: string | undefined,
  outputDir: string): string[] => {
  const imports = new Set<string>();
  const typeToFilePath = new Map<string, string>();
  
  // Collect all custom types and their file paths
  for (const methods of namespaceGroups.values()) {
    for (const method of methods) {
      // Extract types from parameters
      method.parameters.forEach(param => {
        const customTypes = extractCustomTypes(param.type);
        customTypes.forEach(type => {
          typeToFilePath.set(type, method.filePath);
        });
      });
      
      // Extract types from return type
      const returnTypes = extractCustomTypes(method.returnType);
      returnTypes.forEach(type => {
        typeToFilePath.set(type, method.filePath);
      });
    }
  }
  
  // Generate import statements
  const fileToTypes = new Map<string, string[]>();
  
  for (const [type, filePath] of typeToFilePath.entries()) {
    if (!fileToTypes.has(filePath)) {
      fileToTypes.set(filePath, []);
    }
    fileToTypes.get(filePath)!.push(type);
  }
  
  for (const [filePath, types] of fileToTypes.entries()) {
    // Remove duplicates
    const uniqueTypes = [...new Set(types)];
    
    let importPath = filePath.replace(/\.ts$/, '').replace(/\\/g, '/');
    
    // Convert to relative path if baseDir is provided
    if (baseDir) {
      const methodFileAbsPath = resolve(baseDir, filePath);
      importPath = relative(outputDir, methodFileAbsPath).replace(/\.ts$/, '').replace(/\\/g, '/');
      // Ensure relative path starts with ./ if it doesn't start with ../
      if (!importPath.startsWith('.')) {
        importPath = './' + importPath;
      }
    }
    
    imports.add(`import type { ${uniqueTypes.join(', ')} } from '${importPath}';`);
  }
  
  return Array.from(imports).sort();
};

/**
 * Generate the type definitions
 * @param namespaceGroups - The grouped methods
 * @param baseDir - The base directory
 * @param outputDir - The output directory for type definitions
 * @returns The generated code
 * @remarks This function generates the type definitions for the exposed methods.
 */
const generateTypeDefinitions = (
  namespaceGroups: Map<string, ExposedMethod[]>,
  baseDir: string | undefined,
  outputDir: string): string => {
  const interfaces: string[] = [];
  const windowProperties: string[] = [];
  
  // Generate type imports
  const typeImports = generateTypeImports(namespaceGroups, baseDir, outputDir);
  
  for (const [namespace, methods] of namespaceGroups.entries()) {
    const typeName = toPascalCase(namespace);

    const methodsCode = methods.map(method => {
      const params = method.parameters.map(p => `${p.name}: ${p.type}`).join(', ');
      return `  ${method.methodName}(${params}): ${method.returnType};`;
    }).join('\n');
    
    interfaces.push(`interface ${typeName} {\n${methodsCode}\n}`);
    windowProperties.push(`    ${namespace}: ${typeName};`);
  }
  
  const result = [
    "// This is auto-generated type definitions by sublimity-electron-bridge.",
    "// Do not edit manually this file.",
    '',
    ...typeImports,
    typeImports.length > 0 ? '' : null,
    ...interfaces,
    '',
    'declare global {',
    '  interface Window {',
    ...windowProperties,
    '  }',
    '}',
    '',
    'export {}',
    ''
  ].filter(line => line !== null).join('\n');
  
  return result;
};

/////////////////////////////////////////////////////////////////////////////////////////

/**
 * Ensure a directory exists
 * @param dirPath - The path to the directory
 * @remarks This function ensures a directory exists.
 */
const ensureDirectoryExists = (dirPath: string): void => {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
};

const safeWriteFileSync = (filePath: string, content: string) => {
  if (existsSync(filePath)) {
    try {
      const existingContent = readFileSync(filePath, 'utf8');
      if (existingContent === content) {
        return false;
      }
    } catch (error) {
      // If we can't read the file, proceed with writing
    }
  }

  const dir = dirname(filePath);

  ensureDirectoryExists(dir);
  writeFileSync(filePath, content, 'utf8');

  return true;
};

/**
 * Check if a file is generated
 * @param filePath - The path to the file
 * @param mainProcessHandlerFile - The main process handler file
 * @param preloadHandlerFile - The preload handler file
 * @param typeDefinitionsFile - The type definitions file
 * @returns Whether the file is generated
 */
const isGeneratedFile = (filePath: string, mainProcessHandlerFile?: string, preloadHandlerFile?: string, typeDefinitionsFile?: string): boolean => {
  const normalizedPath = filePath.replace(/\\/g, '/');

  // Check if file is the main process handler file
  if (mainProcessHandlerFile && normalizedPath.includes(mainProcessHandlerFile.replace(/\\/g, '/'))) {
    return true;
  }

  // Check if file is the preload handler file
  if (preloadHandlerFile &&
    normalizedPath.includes(preloadHandlerFile.replace(/\\/g, '/'))) {
    return true;
  }

  // Check if file is the type definitions file
  if (typeDefinitionsFile &&
    normalizedPath.includes(typeDefinitionsFile.replace(/\\/g, '/'))) {
    return true;
  }

  return false;
};

/**
 * Create an electron bridge generator
 * @param options - The options for the generator
 * @returns The generator
 */
export const createElectronBridgeGenerator =
  (options: ElectronBridgeOptions = {}) : ElectronBridgeGenerator => {

  // Makes default values for the options
  const _options = {
    mainProcessHandlerFile: options.mainProcessHandlerFile ?? 'src/main/generated/seb_main.ts',
    preloadHandlerFile: options.preloadHandlerFile ?? 'src/preload/generated/seb_preload.ts',
    typeDefinitionsFile: options.typeDefinitionsFile ?? 'src/renderer/src/generated/seb_types.ts',
    defaultNamespace: options.defaultNamespace ?? 'mainProcess',
    logger: options.logger ?? createConsoleLogger(),
    baseDir: options.baseDir ?? process.cwd(),
    channelPrefix: options.channelPrefix ?? "seb"
  };

  /**
   * Analyze a file and extract the exposed methods
   * @param filePath - The path to the file to analyze
   * @param code - The code of the file to analyze
   * @returns The exposed methods
   */
  const analyzeFile = (filePath: string, code: string): ExposedMethod[] => {
    // Skip generated files to avoid analysis loops
    if (isGeneratedFile(
      filePath,
      _options.mainProcessHandlerFile,
      _options.preloadHandlerFile,
      _options.typeDefinitionsFile)) {
      return [];
    }

    const sourceFile = ts.createSourceFile(
      filePath,
      code,
      ts.ScriptTarget.Latest,
      true
    );

    return extractExposedMethods(_options.logger, sourceFile, filePath, _options.defaultNamespace);
  };

  /**
   * Generate the files for the exposed methods
   * @param methods - The exposed methods
   */
  const generateFiles = (methods: ExposedMethod[]): void => {
    // Sort methods by namespace to ensure deterministic order
    const namespaceGroups = groupMethodsByNamespace(methods);

    // Resolve file paths relative to baseDir
    const resolveOutputPath = (filePath: string): string => {
      return resolve(_options.baseDir!, filePath);
    };

    // Generate main handlers
    const mainFilePath = resolveOutputPath(
      _options.mainProcessHandlerFile);
    const mainHandlersCode = generateMainHandlers(
      namespaceGroups, _options.baseDir, dirname(mainFilePath), _options.channelPrefix);
    const wroteMainHandlers = safeWriteFileSync(
      mainFilePath, mainHandlersCode);

    // Generate preload bridge
    const preloadFilePath = resolveOutputPath(
      _options.preloadHandlerFile);
    const preloadBridgeCode = generatePreloadBridge(
      namespaceGroups, _options.channelPrefix);
    const wrotePreloadHandlers = safeWriteFileSync(
      preloadFilePath, preloadBridgeCode);

    // Generate type definitions
    const typeDefsFilePath = resolveOutputPath(
      _options.typeDefinitionsFile!);
    const typeDefsCode = generateTypeDefinitions(
      namespaceGroups, _options.baseDir, dirname(typeDefsFilePath));
    const wroteTypeDefs = safeWriteFileSync(
      typeDefsFilePath, typeDefsCode);

    if (wroteMainHandlers || wrotePreloadHandlers || wroteTypeDefs) {
      _options.logger.info(`Generated files:`);
      if (wroteMainHandlers) _options.logger.info(`  - ${mainFilePath}`);
      if (wrotePreloadHandlers) _options.logger.info(`  - ${preloadFilePath}`);
      if (typeDefsFilePath) _options.logger.info(`  - ${typeDefsFilePath}`);
      _options.logger.info(`  - Found ${methods.length} exposed methods in ${Object.keys(namespaceGroups).length} namespaces`);
    } else {
      _options.logger.info(`Could not found any expose methods`);
    }
  }

  // Returns the generator
  return {
    analyzeFile,
    generateFiles
  };
};
