import * as ts from 'typescript';
import { resolve, dirname, basename, join, relative } from 'path';
import { writeFileSync, mkdirSync, existsSync, renameSync } from 'fs';
import { randomUUID } from 'crypto';
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
 * @returns The generated code
 * @remarks This function generates the main handlers for the exposed methods.
 */
const generateMainHandlers = (
  namespaceGroups: Map<string, ExposedMethod[]>,
  baseDir: string | undefined, outputDir: string): string => {

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
        const channelName = `api:${namespace}:${method.methodName}`;
        const params = method.parameters.map(p => p.name).join(', ');
        const args = method.parameters.length > 0 ? `, ${params}` : '';

        handlers.push(`ipcMain.handle('${channelName}', (_${args}) => ${instanceVar}.${method.methodName}(${params}));`);
      } else {
        // Standalone function
        const channelName = `api:${namespace}:${method.methodName}`;
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
 * @returns The generated code
 * @remarks This function generates the preload bridge for the exposed methods.
 */
const generatePreloadBridge = (
  namespaceGroups: Map<string, ExposedMethod[]>): string => {
  const bridges: string[] = [];
  
  for (const [namespace, methods] of namespaceGroups.entries()) {
    const methodsCode = methods.map(method => {
      const params = method.parameters.map(p => `${p.name}: ${p.type}`).join(', ');
      const args = method.parameters.map(p => p.name).join(', ');
      const channelName = `api:${namespace}:${method.methodName}`;
      
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

/**
 * Generate the type definitions
 * @param namespaceGroups - The grouped methods
 * @returns The generated code
 * @remarks This function generates the type definitions for the exposed methods.
 */
const generateTypeDefinitions = (
  namespaceGroups: Map<string, ExposedMethod[]>): string => {
  const interfaces: string[] = [];
  const windowProperties: string[] = [];
  
  for (const [namespace, methods] of namespaceGroups.entries()) {
    const typeName = toPascalCase(namespace);

    const methodsCode = methods.map(method => {
      const params = method.parameters.map(p => `${p.name}: ${p.type}`).join(', ');
      return `  ${method.methodName}(${params}): ${method.returnType};`;
    }).join('\n');
    
    interfaces.push(`interface ${typeName} {\n${methodsCode}\n}`);
    windowProperties.push(`    ${namespace}: ${typeName};`);
  }
  
  return [
    "// This is auto-generated type definitions by sublimity-electron-bridge.",
    "// Do not edit manually this file.",
    '',
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
  ].join('\n');
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

/**
 * Atomic write a file
 * @param filePath - The path to the file
 * @param content - The content to write to the file
 * @remarks This function writes a file atomically.
 */
const atomicWriteFileSync = (filePath: string, content: string): void => {
  const dir = dirname(filePath);
  const base = basename(filePath);
  const tempFile = join(dir, `.${base}.${randomUUID()}.tmp`);

  try {
    ensureDirectoryExists(dir);
    writeFileSync(tempFile, content, 'utf8');
    renameSync(tempFile, filePath);
  } catch (error) {
    // Clean up temp file if it exists
    try {
      if (existsSync(tempFile)) {
        require('fs').unlinkSync(tempFile);
      }
    } catch {}
    throw error;
  }
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
  if (preloadHandlerFile && normalizedPath.includes(preloadHandlerFile.replace(/\\/g, '/'))) {
    return true;
  }
  
  // Check if file is the type definitions file
  if (typeDefinitionsFile && normalizedPath.includes(typeDefinitionsFile.replace(/\\/g, '/'))) {
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
    mainProcessHandlerFile: options.mainProcessHandlerFile || 'src/main/generated/seb_main.ts',
    preloadHandlerFile: options.preloadHandlerFile || 'src/preload/generated/seb_preload.ts',
    typeDefinitionsFile: options.typeDefinitionsFile || 'src/renderer/src/generated/seb_types.ts',
    defaultNamespace: options.defaultNamespace || 'mainProcess',
    logger: options.logger ?? createConsoleLogger(),
    baseDir: options.baseDir || process.cwd()
  };

  /**
   * Analyze a file and extract the exposed methods
   * @param filePath - The path to the file to analyze
   * @param code - The code of the file to analyze
   * @returns The exposed methods
   */
  const analyzeFile = (filePath: string, code: string): ExposedMethod[] => {
    // Skip generated files to avoid analysis loops
    if (isGeneratedFile(filePath, _options.mainProcessHandlerFile, _options.preloadHandlerFile, _options.typeDefinitionsFile)) {
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
    if (methods.length === 0) {
      return;
    }

    // Sort methods by namespace to ensure deterministic order
    const namespaceGroups = groupMethodsByNamespace(methods);

    // Resolve file paths relative to baseDir
    const resolveOutputPath = (filePath: string): string => {
      return resolve(_options.baseDir!, filePath);
    };

    // Generate main handlers
    const mainFilePath = resolveOutputPath(_options.mainProcessHandlerFile);
    const mainHandlersCode = generateMainHandlers(namespaceGroups, _options.baseDir, dirname(mainFilePath));
    atomicWriteFileSync(mainFilePath, mainHandlersCode);

    // Generate preload bridge
    const preloadFilePath = resolveOutputPath(_options.preloadHandlerFile);
    const preloadBridgeCode = generatePreloadBridge(namespaceGroups);
    atomicWriteFileSync(preloadFilePath, preloadBridgeCode);

    // Generate type definitions
    const typeDefsFilePath = resolveOutputPath(_options.typeDefinitionsFile!);
    const typeDefsCode = generateTypeDefinitions(namespaceGroups);
    atomicWriteFileSync(typeDefsFilePath, typeDefsCode);

    _options.logger.info(`[sublimity-electron-bridge] Generated files:`);
    _options.logger.info(`  - ${mainFilePath}`);
    _options.logger.info(`  - ${preloadFilePath}`);
    _options.logger.info(`  - ${typeDefsFilePath}`);
    _options.logger.info(`  - Found ${methods.length} exposed methods in ${Object.keys(namespaceGroups).length} namespaces`);
  }

  // Returns the generator
  return {
    analyzeFile,
    generateFiles
  };
};
