import * as ts from 'typescript';
import { resolve, dirname, basename, join, relative } from 'path';
import { writeFileSync, mkdirSync, existsSync, renameSync } from 'fs';
import { randomUUID } from 'crypto';

/**
 * Logger interface
 */
export interface Logger {
  /**
   * Log an info message
   * @param msg - The message to log
   */
  readonly info: (msg: string) => void;
  /**
   * Log a warning message
   * @param msg - The message to log
   */
  readonly warn: (msg: string) => void;
  /**
   * Log an error message
   * @param msg - The message to log
   */
  readonly error: (msg: string) => void;
}

/**
 * Electron bridge options
 */
export interface ElectronBridgeOptions {
  /**
   * The output directories for the generated files
   */
  outputDirs?: {
    /**
     * The output directory for the main process
     * @remarks Default: 'main/generated'
     */
    main?: string
    /**
     * The output directory for the preload process
     * @remarks Default: 'preload/generated'
     */
    preload?: string
  };
  /**
   * The file name for the type definitions
   * @remarks Default: 'src/generated/electron-api.d.ts'
   */
  typeDefinitionsFile?: string;
  /**
   * The default namespace for the exposed methods
   * @remarks Default: 'electronAPI'
   */
  defaultNamespace?: string;
  /**
   * The logger to use for the generator
   * @remarks Default: Use the console logger
   */
  logger?: Logger;
  /**
   * The base directory for the project.
   * @remarks It is used to generate relative paths for the generated files.
   */
  baseDir?: string;
}

/**
 * Exposed method interface
 */
export interface ExposedMethod {
  /**
   * The class name of the method
   */
  readonly className?: string
  /**
   * The method name
   */
  readonly methodName: string
  /**
   * The namespace of the method
   */
  readonly namespace: string
  /**
   * The parameters of the method
   */
  readonly parameters: { name: string; type: string }[]
  /**
   * The return type of the method
   */
  readonly returnType: string
  /**
   * The file path of the method
   */
  readonly filePath: string
}

/**
 * Electron bridge generator interface
 */
export interface ElectronBridgeGenerator {
  /**
   * Analyze a file and extract the exposed methods
   * @param filePath - The path to the file to analyze
   * @param code - The code of the file to analyze
   * @returns The exposed methods
   */
  readonly analyzeFile: (filePath: string, code: string) => ExposedMethod[];
  /**
   * Generate the files for the exposed methods
   * @param methods - The exposed methods
   */
  readonly generateFiles: (methods: ExposedMethod[]) => void;
}

///////////////////////////////////////////////////////////////////////

export const isCamelCase = (str: string): boolean => {
  return /^[a-z][a-zA-Z0-9]*$/.test(str);
};

export const toPascalCase = (str: string): string => {
  return str.charAt(0).toUpperCase() + str.slice(1);
};

export const extractExposedMethods = (logger: Logger, sourceFile: ts.SourceFile, filePath: string, defaultNamespace: string = 'electronAPI'): ExposedMethod[] => {
  const methods: ExposedMethod[] = [];
  
  const visit = (node: ts.Node) => {
    // Handle class methods
    if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.text;
      
      node.members.forEach(member => {
        if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
          const exposedMethod = processJSDocTag(
            logger, member, sourceFile, filePath, (member.name as ts.Identifier).text, defaultNamespace, className);
          if (exposedMethod) {
            const parameters = member.parameters.map(param => ({
              name: (param.name as ts.Identifier).text,
              type: param.type ?
                sourceFile.text.substring(param.type.pos, param.type.end).trim() :
                'any'
            }));
            
            const returnType = member.type ?
              sourceFile.text.substring(member.type.pos, member.type.end).trim() :
              'Promise<any>';
            
            // Check if method returns Promise
            if (member.type && !isPromiseType(member.type)) {
              logger.warn(`[electron-bridge] Warning: @decorator expose method should return Promise: ${className}.${(member.name as ts.Identifier).text} in ${filePath}:${ts.getLineAndCharacterOfPosition(sourceFile, member.pos).line + 1}`)
              return // Skip this method
            };
            
            methods.push({
              className,
              methodName: (member.name as ts.Identifier).text,
              namespace: exposedMethod.namespace,
              parameters,
              returnType,
              filePath
            });
          }
        }
      });
    }
    
    // Handle function declarations
    if (ts.isFunctionDeclaration(node) && node.name) {
      const exposedMethod = processJSDocTag(logger, node, sourceFile, filePath, node.name.text, defaultNamespace);
      if (exposedMethod) {
        const parameters = node.parameters.map(param => ({
          name: (param.name as ts.Identifier).text,
          type: param.type ?
            sourceFile.text.substring(param.type.pos, param.type.end).trim() :
            'any'
        }));
        
        const returnType = node.type ?
          sourceFile.text.substring(node.type.pos, node.type.end).trim() :
          'Promise<any>';
        
        // Check if function returns Promise
        if (node.type && !isPromiseType(node.type)) {
          logger.warn(`[electron-bridge] Warning: @decorator expose function should return Promise: ${node.name.text} in ${filePath}:${ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1}`);
          return; // Skip this function
        }
        
        methods.push({
          methodName: node.name.text,
          namespace: exposedMethod.namespace,
          parameters,
          returnType,
          filePath
        })
      }
    }
    
    // Handle variable declarations with arrow functions
    if (ts.isVariableStatement(node)) {
      node.declarationList.declarations.forEach(declaration => {
        if (ts.isVariableDeclaration(declaration) && 
            declaration.name && ts.isIdentifier(declaration.name) &&
            declaration.initializer && ts.isArrowFunction(declaration.initializer)) {
          
          const exposedMethod = processJSDocTag(
            logger, node, sourceFile, filePath, declaration.name.text, defaultNamespace);
          if (exposedMethod) {
            const arrowFunc = declaration.initializer;
            const parameters = arrowFunc.parameters.map(param => ({
              name: (param.name as ts.Identifier).text,
              type: param.type ?
                sourceFile.text.substring(param.type.pos, param.type.end).trim() :
                'any'
            }));
            
            const returnType = arrowFunc.type ?
              sourceFile.text.substring(arrowFunc.type.pos, arrowFunc.type.end).trim() :
              'Promise<any>';
            
            // Check if arrow function returns Promise
            if (arrowFunc.type && !isPromiseType(arrowFunc.type)) {
              logger.warn(`[electron-bridge] Warning: @decorator expose function should return Promise: ${declaration.name.text} in ${filePath}:${ts.getLineAndCharacterOfPosition(sourceFile, declaration.pos).line + 1}`);
              return; // Skip this function;
            }
            
            methods.push({
              methodName: declaration.name.text,
              namespace: exposedMethod.namespace,
              parameters,
              returnType,
              filePath
            });
          }
        }
      });
    }
    
    ts.forEachChild(node, visit);
  }
  
  visit(sourceFile);
  return methods;
};

const processJSDocTag =
  (logger: Logger, node: ts.Node, sourceFile: ts.SourceFile, filePath: string, methodName: string, defaultNamespace: string, className?: string):
  { namespace: string } | null => {
  const jsDocTags = ts.getJSDocTags(node);
  
  for (const tag of jsDocTags) {
    if (tag.tagName && tag.tagName.text === 'decorator' && tag.comment) {
      const comment = typeof tag.comment === 'string' ? tag.comment : tag.comment.map(c => c.text || '').join('');
      const match = comment.match(/^expose\s+(\w+)$/);
      
      if (match) {
        const namespace = match[1];
        if (!isCamelCase(namespace)) {
          const location = className ? `${className}.${methodName}` : methodName;
          logger.warn(`[electron-bridge] Warning: @decorator expose argument should be camelCase: "${namespace}" in ${location} at ${filePath}:${ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1}`);
          return null; // Skip this method
        }
        return { namespace };
      } else if (comment === 'expose') {
        // Default namespace when no argument provided
        return { namespace: defaultNamespace };
      }
    }
  }
  
  return null;
};

const isPromiseType = (typeNode: ts.TypeNode): boolean => {
  if (ts.isTypeReferenceNode(typeNode)) {
    const typeName = typeNode.typeName;
    if (ts.isIdentifier(typeName) && typeName.text === 'Promise') {
      return true;
    }
  }
  return false;
};

const groupMethodsByNamespace = (methods: ExposedMethod[]): Map<string, ExposedMethod[]> => {
  const groups = new Map<string, ExposedMethod[]>();

  for (const method of methods) {
    let methods = groups.get(method.namespace);
    if (!methods) {
      methods = [];
      groups.set(method.namespace, methods);
    }
    methods.push(method);
  }

  for (const methods of groups.values()) {
    methods.sort((a, b) => a.methodName.localeCompare(b.methodName));
  }

  return new Map([...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])));
};

const generateMainHandlers = (
  namespaceGroups: Map<string, ExposedMethod[]>,
  baseDir?: string, outputDir?: string): string => {

  const imports = new Set<string>();
  const singletonInstances = new Set<string>();
  const handlers: string[] = [];
  
  // Generate imports and collect unique class names
  for (const methods of namespaceGroups.values()) {
    for (const method of methods) {
      if (method.className) {
        let importPath = method.filePath.replace(/\.ts$/, '').replace(/\\/g, '/');
        
        // Convert to relative path if baseDir and outputDir are provided
        if (baseDir && outputDir) {
          const outputFilePath = resolve(outputDir, 'ipc-handlers.ts');
          const methodFileAbsPath = resolve(baseDir, method.filePath);
          importPath = relative(dirname(outputFilePath), methodFileAbsPath).replace(/\.ts$/, '').replace(/\\/g, '/');
          // Ensure relative path starts with ./ if it doesn't start with ../
          if (!importPath.startsWith('.')) {
            importPath = './' + importPath;
          }
        }
        
        imports.add(`import { ${method.className} } from '${importPath}'`);
        singletonInstances.add(method.className);
      }
    }
  }

  // Generate singleton instance declarations
  const instanceDeclarations: string[] = [];
  for (const className of Array.from(singletonInstances).sort()) {
    const instanceVar = `${className.toLowerCase()}Instance`;
    instanceDeclarations.push(`const ${instanceVar} = new ${className}()`);
  }

  for (const [namespace, methods] of namespaceGroups.entries()) {
    for (const method of methods) {
      if (method.className) {
        const instanceVar = `${method.className.toLowerCase()}Instance`;
        const channelName = `api:${namespace}:${method.methodName}`;
        const params = method.parameters.map(p => p.name).join(', ');
        const args = method.parameters.length > 0 ? `, ${params}` : '';
        
        handlers.push(`ipcMain.handle('${channelName}', (event${args}) => ${instanceVar}.${method.methodName}(${params}))`);
      } else {
        // Standalone function
        const channelName = `api:${namespace}:${method.methodName}`;
        const params = method.parameters.map(p => p.name).join(', ');
        const args = method.parameters.length > 0 ? `, ${params}` : '';
        
        let importPath = method.filePath.replace(/\.ts$/, '').replace(/\\/g, '/');
        
        // Convert to relative path if baseDir and outputDir are provided
        if (baseDir && outputDir) {
          const outputFilePath = resolve(outputDir, 'ipc-handlers.ts');
          const methodFileAbsPath = resolve(baseDir, method.filePath);
          importPath = relative(dirname(outputFilePath), methodFileAbsPath).replace(/\.ts$/, '').replace(/\\/g, '/');
          // Ensure relative path starts with ./ if it doesn't start with ../
          if (!importPath.startsWith('.')) {
            importPath = './' + importPath;
          }
        }
        
        imports.add(`import { ${method.methodName} } from '${importPath}'`);
        handlers.push(`ipcMain.handle('${channelName}', (event${args}) => ${method.methodName}(${params}))`);
      }
    }
  }

  return [
    "import { ipcMain } from 'electron'",
    ...Array.from(imports).sort(),
    '',
    '// Create singleton instances',
    ...instanceDeclarations,
    '',
    '// Register IPC handlers',
    ...handlers
  ].join('\n');
};

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
    
    bridges.push(`contextBridge.exposeInMainWorld('${namespace}', {\n${methodsCode}\n})`);
  }
  
  return [
    "import { contextBridge, ipcRenderer } from 'electron'",
    '',
    ...bridges
  ].join('\n');
};

const generateTypeDefinitions = (
  namespaceGroups: Map<string, ExposedMethod[]>): string => {
  const interfaces: string[] = [];
  const windowProperties: string[] = [];
  
  for (const [namespace, methods] of namespaceGroups.entries()) {
    const typeName = toPascalCase(namespace);

    const methodsCode = methods.map(method => {
      const params = method.parameters.map(p => `${p.name}: ${p.type}`).join(', ');
      return `  ${method.methodName}(${params}): ${method.returnType}`;
    }).join('\n');
    
    interfaces.push(`interface ${typeName} {\n${methodsCode}\n}`);
    windowProperties.push(`    ${namespace}: ${typeName}`);
  }
  
  return [
    ...interfaces,
    '',
    'declare global {',
    '  interface Window {',
    ...windowProperties,
    '  }',
    '}',
    '',
    'export {}'
  ].join('\n');
};

const ensureDirectoryExists = (dirPath: string): void => {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
};

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

const isGeneratedFile = (filePath: string, outputDirs: { main?: string; preload?: string }, typeDefinitionsFile?: string): boolean => {
  const normalizedPath = filePath.replace(/\\/g, '/');
  
  // Check if file is in main output directory
  if (outputDirs.main && normalizedPath.includes(outputDirs.main.replace(/\\/g, '/'))) {
    return true;
  }
  
  // Check if file is in preload output directory
  if (outputDirs.preload && normalizedPath.includes(outputDirs.preload.replace(/\\/g, '/'))) {
    return true;
  }
  
  // Check if file is the type definitions file
  if (typeDefinitionsFile && normalizedPath.includes(typeDefinitionsFile.replace(/\\/g, '/'))) {
    return true;
  }
  
  return false;
};

/**
 * Create a console logger
 * @returns The logger
 */
export const createConsoleLogger = () : Logger => {
  return {
    info: console.info,
    warn: console.warn,
    error: console.error
  };
};

/**
 * Create an electron bridge generator
 * @param options - The options for the generator
 * @returns The generator
 */
export const createElectronBridgeGenerator =
  (options: ElectronBridgeOptions = {}) : ElectronBridgeGenerator => {

  const _options = {
    outputDirs: {
      main: options.outputDirs?.main || 'main/generated',
      preload: options.outputDirs?.preload || 'preload/generated'
    },
    typeDefinitionsFile: options.typeDefinitionsFile || 'src/generated/electron-api.d.ts',
    defaultNamespace: options.defaultNamespace || 'electronAPI',
    logger: options.logger || createConsoleLogger(),
    baseDir: options.baseDir
  };

  /**
   * Analyze a file and extract the exposed methods
   * @param filePath - The path to the file to analyze
   * @param code - The code of the file to analyze
   * @returns The exposed methods
   */
  const analyzeFile = (filePath: string, code: string): ExposedMethod[] => {
    // Skip generated files to avoid analysis loops
    if (isGeneratedFile(filePath, _options.outputDirs, _options.typeDefinitionsFile)) {
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

    // Generate main handlers
    const mainHandlersCode = generateMainHandlers(namespaceGroups, _options.baseDir, _options.outputDirs.main);
    const mainFilePath = resolve(_options.outputDirs!.main!, 'ipc-handlers.ts');
    atomicWriteFileSync(mainFilePath, mainHandlersCode);

    // Generate preload bridge
    const preloadBridgeCode = generatePreloadBridge(namespaceGroups);
    const preloadFilePath = resolve(_options.outputDirs!.preload!, 'bridge.ts');
    atomicWriteFileSync(preloadFilePath, preloadBridgeCode);

    // Generate type definitions
    const typeDefsCode = generateTypeDefinitions(namespaceGroups);
    atomicWriteFileSync(_options.typeDefinitionsFile!, typeDefsCode);

    _options.logger.info(`[electron-bridge] Generated files:`);
    _options.logger.info(`  - ${mainFilePath}`);
    _options.logger.info(`  - ${preloadFilePath}`);
    _options.logger.info(`  - ${_options.typeDefinitionsFile}`);
    _options.logger.info(`  - Found ${methods.length} exposed methods in ${Object.keys(namespaceGroups).length} namespaces`);
  }

  return {
    analyzeFile,
    generateFiles
  };
};
