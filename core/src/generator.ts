// sublimity-electron-bridge - Sublimity electron IPC bridge
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/sublimity-electron-bridge/

import { resolve, dirname, relative, isAbsolute } from 'path';
import { access, mkdir, readFile, writeFile } from 'fs/promises';
import { ElectronBridgeOptions, ElectronBridgeGenerator, Logger } from './types';
import { extractFunctions, FunctionInfo, loadTsConfig, SourceCodeFragment, TypeAST } from './extractor';
import { createConsoleLogger } from './logger';

/**
 * Check if a string is camelCase
 * @param str - The string to check
 * @returns Whether the string is camelCase
 */
export const isCamelCase = (str: string): boolean => {
  return /^[a-z][a-zA-Z0-9]*$/.test(str);
};

/**
 * Convert a string to camelCase
 * @param str - The string to convert
 * @returns The camelCase string
 */
export const toCamelCase = (str: string): string => {
  return str.charAt(0).toLowerCase() + str.slice(1);
};

/**
 * Convert a string to PascalCase
 * @param str - The string to convert
 * @returns The PascalCase string
 */
export const toPascalCase = (str: string): string => {
  return str.charAt(0).toUpperCase() + str.slice(1);
};

/////////////////////////////////////////////////////////////////////////////////////////

/**
 * Get the Electron IPC namespace from the function info
 * @param functionInfo - The function info
 * @param defaultNamespace - The default namespace
 * @returns The Electron IPC namespace
 */
const getIpcNamespace = (functionInfo: FunctionInfo, defaultNamespace: string): string => {
  // JSDoc decorator namespace argument
  let ipcNamespace = functionInfo.jsdocDecorator?.args.at(0);
  if (ipcNamespace) {
    return ipcNamespace;
  }
  // When the function is declared with a type, use the type name as the namespace
  ipcNamespace = functionInfo.declaredType?.typeString;
  if (ipcNamespace) {
    return toCamelCase(ipcNamespace);
  }
  // Fallback to the default namespace
  return defaultNamespace;
};

/**
 * Group and sortfunctions by namespace
 * @param functions - The functions to group
 * @param defaultNamespace - The default namespace
 * @returns The grouped functions
 * @remarks This function groups functions by their namespace. It is made to ensure deterministic order of the functions.
 */
const groupFunctionsByNamespace = (functions: FunctionInfo[], defaultNamespace: string): Map<string, FunctionInfo[]> => {
  const groups = new Map<string, FunctionInfo[]>();

  // Group functions by ElectronIPC namespace
  for (const func of functions) {
    const ipcNamespace = getIpcNamespace(func, defaultNamespace);
    let functions = groups.get(ipcNamespace);
    if (!functions) {
      functions = [];
      groups.set(ipcNamespace, functions);
    }
    functions.push(func);
  }

  // Sort functions by name to ensure deterministic order
  for (const functions of groups.values()) {
    functions.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Sort groups by name to ensure deterministic order
  return new Map([...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])));
};

/////////////////////////////////////////////////////////////////////////////////////////

/**
 * Calculate proper import path from TypeScript API file paths
 * @param node - The node to calculate the import path for
 * @param outputDir - Output directory absolute path
 * @param baseDir - Base directory for resolving relative paths (optional)
 * @returns Proper relative import path
 */
const calculateImportPath = (node: SourceCodeFragment, outputDir: string, baseDir: string | undefined): string | undefined => {

  if (!node.sourceLocation) {
    return undefined;
  }
    
  // When package name is available
  if (node.sourceLocation.packageName) {
    // Ignore import path if the source file is primitive and/or inside of TypeScript runtime library types.
    // 'lib.d.ts'
    // 'lib.es2022.d.ts'
    // 'lib.foo.bar.d.ts'
    // ...
    if (node.sourceLocation.packageName === 'typescript' &&
      node.sourceLocation.fileName.match(/lib\.([\w\.])*d\.ts$/)) {
      return undefined;
    }
    // Use it as the import path
    return node.sourceLocation.packageName;
  }

  let absoluteSourcePath: string;

  // Handle relative vs absolute paths
  if (baseDir && !isAbsolute(node.sourceLocation.fileName)) {
    // If baseDir is provided and sourceFilePath is relative, resolve it relative to baseDir
    absoluteSourcePath = resolve(baseDir, node.sourceLocation.fileName);
  } else {
    // Otherwise, resolve it as is
    absoluteSourcePath = resolve(node.sourceLocation.fileName);
  }

  const normalizedOutputDir = resolve(outputDir);

  // Calculate relative path
  let importPath = relative(normalizedOutputDir, absoluteSourcePath);

  // Remove .ts extension
  importPath = importPath.replace(/\.ts$/, '');
  
  // Normalize path separators
  importPath = importPath.replace(/\\/g, '/');
  
  // Ensure relative path format
  if (!importPath.startsWith('.')) {
    importPath = './' + importPath;
  }
  
  return importPath;
};

/**
 * Set the import path map
 * @param name - The name to set
 * @param node - The node to set
 * @param outputDir - The output directory
 * @param baseDir - The base directory
 * @param importPathMap - The import path map
 */
const setImportPathMap = (name: string, node: TypeAST, outputDir: string, baseDir: string | undefined, importPathMap: Map<string, Set<string>>) => {
  const path = calculateImportPath(node, outputDir, baseDir);
  if (path) {
    // Add the path to the import path map
    let memberNames = importPathMap.get(path);
    if (!memberNames) {
      memberNames = new Set<string>();
      importPathMap.set(path, memberNames);
    }
    memberNames.add(name);
  }
}

/**
 * Traverse the type AST and get the import path maps
 * @param node - The node to traverse
 * @param outputDir - The output directory
 * @param baseDir - The base directory
 * @param importTypePathMap - The import type path map
 */
const traverseAndGetImportPathMaps = (
  node: TypeAST, outputDir: string, baseDir: string | undefined,
  visitedNodes: Set<TypeAST>,
  importTypePathMap: Map<string, Set<string>>) => {

  // When the node is already visited, skip it
  if (visitedNodes.has(node)) {
    return;
  }
  visitedNodes.add(node);

  switch (node.kind) {
    // Type reference
    case 'type-reference': {
      traverseAndGetImportPathMaps(node.referencedType, outputDir, baseDir, visitedNodes, importTypePathMap);
      // Traverse type arguments when available
      if (node.typeArguments) {
        for (const typeArgument of node.typeArguments) {
          traverseAndGetImportPathMaps(typeArgument, outputDir, baseDir, visitedNodes, importTypePathMap);
        }
      }
      break;
    }
    // Type alias
    case 'type-alias': {
      setImportPathMap(node.name, node, outputDir, baseDir, importTypePathMap);
      // Traverse type arguments when available
      if (node.typeArguments) {
        for (const typeArgument of node.typeArguments) {
          setImportPathMap(typeArgument.typeString, typeArgument, outputDir, baseDir, importTypePathMap);
        }
      }
      break;
    }
    // Enum
    case 'enum': {
      setImportPathMap(node.name, node, outputDir, baseDir, importTypePathMap);
      break;
    }
    // Enum value
    case 'enum-value': {
      traverseAndGetImportPathMaps(node.underlyingType, outputDir, baseDir, visitedNodes, importTypePathMap);
      break;
    }
    // Array
    case 'array': {
      traverseAndGetImportPathMaps(node.elementType, outputDir, baseDir, visitedNodes, importTypePathMap);
      break;
    }
    // Interface
    case 'interface': {
      setImportPathMap(node.name, node, outputDir, baseDir, importTypePathMap);
      // Traverse type parameters when available
      if (node.typeParameters) {
        for (const typeParameter of node.typeParameters) {
          traverseAndGetImportPathMaps(typeParameter, outputDir, baseDir, visitedNodes, importTypePathMap);
        }
      }
      break;
    }
    // (Anonymous) Object
    case 'object': {
      // Traverse properties
      for (const property of node.properties) {
        traverseAndGetImportPathMaps(property.type, outputDir, baseDir, visitedNodes, importTypePathMap);
      }
      break;
    }
    // Function
    case 'function': {
      // Traverse return type
      traverseAndGetImportPathMaps(node.returnType, outputDir, baseDir, visitedNodes, importTypePathMap);
      // Traverse parameters
      for (const param of node.parameters) {
        traverseAndGetImportPathMaps(param.type, outputDir, baseDir, visitedNodes, importTypePathMap);
      }
      break;
    }
    // Type OR expression
    case 'or': {
      for (const arg of node.args) {
        traverseAndGetImportPathMaps(arg, outputDir, baseDir, visitedNodes, importTypePathMap);
      }
      break;
    }
    // Type AND expression
    case 'and': {
      for (const arg of node.args) {
        traverseAndGetImportPathMaps(arg, outputDir, baseDir, visitedNodes, importTypePathMap);
      }
      break;
    }
    // Unknown types
    case 'unknown': {
      setImportPathMap(node.typeString, node, outputDir, baseDir, importTypePathMap);
      break;
    }

    // Ignore other types.
  }
};

/**
 * Import descriptor
 * @remarks This is a descriptor for a single import statement.
 */
interface ImportDescriptor {
  /**
   * Whether the import is a type import
   */
  readonly isType: boolean;
  /**
   * The path to the import
   */
  readonly path: string;
  /**
   * The member names to import
   */
  readonly memberNames: string[];
}

/**
 * Convert the import path map to the import descriptor list
 * @param importPathMap - The import path map
 * @param isType - Whether the import is a type import
 * @returns The import descriptor list
 */
const toImportDescriptorList = (importPathMap: Map<string, Set<string>>, isType: boolean) => {
  return Array.from(importPathMap.entries()).
    // Filter out import paths that do not have any member names
    filter(([_, memberNames]) => memberNames.size >= 1).
    // Sort member names to ensure deterministic order
    map(([path, memberNames]) => {
      const importDescriptor: ImportDescriptor = {
        isType,
        path,
        memberNames: Array.from(memberNames).sort()
      };
      return importDescriptor;
    }).
    // Sort import paths to ensure deterministic order
    sort((a, b) => a.path.localeCompare(b.path));
};

/**
 * Get the import descriptor list for the given namespace groups
 * @param namespaceGroups - The grouped methods
 * @param outputDir - The output directory
 * @param baseDir - Base directory for resolving relative paths
 * @param includeFunctionAndExceptChildren - Whether to include function names and except children types
 * @param includeDeclaredType - Whether to include declared type names
 * @returns The import descriptor list, sorted to ensure deterministic order
 */
const getImportDescriptorList = (
  namespaceGroups: Map<string, FunctionInfo[]>, outputDir: string, baseDir: string | undefined,
  includeFunctionAndExceptChildren: boolean, includeDeclaredType: boolean):
  [imports: ImportDescriptor[], importTypes: ImportDescriptor[]] => {

  const importPathMap = new Map<string, Set<string>>();
  const importTypePathMap = new Map<string, Set<string>>();
  const visitedNodes = new Set<TypeAST>();

  for (const functions of namespaceGroups.values()) {
    for (const functionInfo of functions) {
      const path = calculateImportPath(functionInfo, outputDir, baseDir);
      if (path) {
        // Add the path to the import path map
        let memberNames = importPathMap.get(path);
        if (!memberNames) {
          memberNames = new Set<string>();
          importPathMap.set(path, memberNames);
        }

        if (!includeFunctionAndExceptChildren) {
          traverseAndGetImportPathMaps(
            functionInfo.type, outputDir, baseDir, visitedNodes, importTypePathMap);
        }

        switch (functionInfo.kind) {
          // Add the function name to the import path map
          // `import { functionName } from 'path';`
          case 'function': {
            if (includeFunctionAndExceptChildren) {
              memberNames.add(functionInfo.name);
            }
            break;
          }
          // Add the class name to the import path map
          // `import { ClassName } from 'path';`
          case 'class-method': {
            if (includeDeclaredType) {
              traverseAndGetImportPathMaps(
                functionInfo.declaredType!, outputDir, baseDir, visitedNodes, importPathMap);
            }
            break;
          }
          // Add the function name to the import path map
          // `import { functionName } from 'path';`
          case 'arrow-function':
            if (includeFunctionAndExceptChildren) {
              memberNames.add(functionInfo.name);
            }
            break;
        }
      }
    }
  }

  return [
    toImportDescriptorList(importPathMap, false),
    toImportDescriptorList(importTypePathMap, true)
  ];
};

/**
 * Singleton instance descriptor
 * @remarks This is a descriptor for a single singleton instance.
 */
interface SingletonInstanceDescriptor {
  /**
   * The type name
   */
  readonly typeName: string;
  /**
   * The instance name
   */
  readonly instanceName: string;
}

/**
 * Get the singleton instance names for the given namespace groups
 * @param namespaceGroups - The grouped methods
 * @returns The singleton instance names, sorted to ensure deterministic order
 */
const getSingletonInstanceDescriptorList = (namespaceGroups: Map<string, FunctionInfo[]>): SingletonInstanceDescriptor[] => {
  const singletonInstanceNames = new Map<string, string>();

  for (const functions of namespaceGroups.values()) {
    for (const functionInfo of functions) {
      const declaredType = functionInfo.declaredType;
      if (declaredType) {
        // When the function is declared with a type, we need to create a singleton instance
        const singletonInstanceName = `__${declaredType.typeString}Instance`;
        singletonInstanceNames.set(declaredType.typeString, singletonInstanceName);
      }
    }
  }

  // Sort singleton instance names to ensure deterministic order
  return Array.from(singletonInstanceNames.entries()).
    map(([typeName, singletonInstanceName]) => ({
      typeName,
      instanceName: singletonInstanceName
    })).
    sort((a, b) => a.typeName.localeCompare(b.typeName));
};

/**
 * Registration descriptor
 * @remarks This is a descriptor for a single registration.
 */
interface RegistrationDescriptor {
  /**
   * The function ID
   */
  readonly functionId: string;
  /**
   * The function name
   * @remarks This is the name of the function to register. Dot-separated member name when the function is declared with a type.
   */
  readonly functionName: string;
}

/**
 * Get the registration descriptor list for the given namespace groups
 * @param namespaceGroups - The grouped methods
 * @returns The registration descriptor list, sorted to ensure deterministic order
 */
const getRegistrationDescriptorList = (namespaceGroups: Map<string, FunctionInfo[]>): RegistrationDescriptor[] => {
  const registrationDescriptors: RegistrationDescriptor[] = [];

  for (const [ipcNamespace, functions] of namespaceGroups.entries()) {
    for (const functionInfo of functions) {
      const declaredType = functionInfo.declaredType;
      if (declaredType) {
        // When the function is declared with a type, we need to register the function as a member of the singleton instance
        const singletonInstanceName = `__${declaredType.typeString}Instance`;
        registrationDescriptors.push({
          functionId: `${ipcNamespace}:${functionInfo.name}`,
          functionName: `${singletonInstanceName}.${functionInfo.name}`
        });
      } else {
        // When the function is not declared with a type, we need to register the function as a standalone function
        registrationDescriptors.push({
          functionId: `${ipcNamespace}:${functionInfo.name}`,
          functionName: functionInfo.name
        });
      }
    }
  }

  // Sort registration descriptors to ensure deterministic order
  return registrationDescriptors.sort((a, b) => a.functionId.localeCompare(b.functionId));
};

/**
 * Generate the main handlers
 * @param namespaceGroups - The grouped methods
 * @param outputDir - The output directory
 * @param baseDir - Base directory for resolving relative paths
 * @returns The generated code
 * @remarks This function generates the main handlers for the exposed methods.
 */
const generateMainHandlers = (
  namespaceGroups: Map<string, FunctionInfo[]>,
  outputDir: string,
  baseDir: string | undefined): string => {

  // Generate import declarations
  const [importDescriptors, importTypeDescriptors] = getImportDescriptorList(
    namespaceGroups, outputDir, baseDir, true, true);
  const importTypeDeclarations = importTypeDescriptors.map(
    ({ path, memberNames }) => `import type { ${memberNames.join(', ')} } from '${path}';`);
  const importDeclarations = importDescriptors.map(
    ({ path, memberNames }) => `import { ${memberNames.join(', ')} } from '${path}';`);
  
  // Generate singleton instance declarations
  const singletonInstanceDescriptors = getSingletonInstanceDescriptorList(namespaceGroups);
  const signletonInstanceDeclarations = singletonInstanceDescriptors.map(
    ({ typeName, instanceName }) => `const ${instanceName} = new ${typeName}();`);

  // Generate registrations
  const registrationDescriptors = getRegistrationDescriptorList(namespaceGroups); 
  const registrations = registrationDescriptors.map(
    ({ functionId, functionName }) => `controller.register('${functionId}', ${functionName});`);

  const mainBodyLines = [
    "// This is auto-generated main process handler by sublimity-electron-bridge.",
    "// Do not edit manually this file.",
    '',
    "import { app, BrowserWindow, ipcMain } from 'electron';",
    "import { createSublimityRpcController, SublimityRpcController, SublimityRpcMessage } from 'sublimity-rpc';",
    ...importTypeDeclarations,
    ...importDeclarations,
    '',
    '// Create singleton instances',
    ...signletonInstanceDeclarations,
    '',
    '// Store controllers for each window',
    'const controllers = new Map<number, SublimityRpcController>();',
    '',
    '// Setup RPC for each window',
    'const setupWindowRPC = (window: BrowserWindow) => {',
    '  const webContentsId = window.webContents.id;',
    '',
    '  // Create RPC controller for this window',
    '  const controller = createSublimityRpcController({',
    '    onSendMessage: (message: SublimityRpcMessage) => {',
    '      // Send message to this specific window',
    '      if (!window.isDestroyed()) {',
    '        window.webContents.send("rpc-message", message);',
    '      }',
    '    }',
    '  });',
    '',
    '  // Handle messages from preload process',
    '  ipcMain.on("rpc-message", (_, message: SublimityRpcMessage) => {',
    '    controller.insertMessage(message);',
    '  });',
    '',
    '  // Store controller',
    '  controllers.set(webContentsId, controller);',
    '',
    '  // Register RPC functions',
    ...registrations.map(reg => `  ${reg}`),
    '',
    '  // Cleanup when window is closed',
    '  window.on("closed", () => {',
    '    controllers.delete(webContentsId);',
    '  });',
    '}',
    '',
    '// Setup existing windows',
    'app.on("ready", () => {',
    '  BrowserWindow.getAllWindows().forEach(setupWindowRPC);',
    '});',
    '',
    '// Setup new windows',
    'app.on("browser-window-created", (_, window) => {',
    '  setupWindowRPC(window);',
    '});',
    '',
    '// Handle messages from preload process with Synchronous RPC mode',
    'ipcMain.handle("rpc-invoke", async (event, message: SublimityRpcMessage): Promise<SublimityRpcMessage> => {',
    '  const controller = controllers.get(event.sender.id);',
    '  if (controller) {',
    '    const response = await controller.insertMessageWaitable(message);',
    '    return response;',
    '  }',
    '  throw new Error(`Controller not found for webContents ${event.sender.id}`);',
    '});',
    '',
    '// Legacy support: If global.mainWindow exists, set it up',
    'if (typeof global !== "undefined" && global.mainWindow) {',
    '  setupWindowRPC(global.mainWindow);',
    '}',
    ''
  ].filter(line => line !== null);

  return mainBodyLines.join('\n');
};

/////////////////////////////////////////////////////////////////////////////////////////

/**
 * Preload bridge descriptor
 * @remarks This is a descriptor for a single preload bridge.
 */
interface PreloadBridgeDescriptor {
  /**
   * Electron IPC namespace
   */
  readonly ipcNamespace: string;
  /**
   * The functions
   */
  readonly functions: FunctionInfo[];
}

/**
 * Get the preload bridge descriptor list for the given namespace groups
 * @param namespaceGroups - The grouped methods
 * @returns The preload bridge descriptor list, sorted to ensure deterministic order
 */
const getPreloadBridgeDescriptorList = (namespaceGroups: Map<string, FunctionInfo[]>): PreloadBridgeDescriptor[] => {
  return Array.from(namespaceGroups.entries()).map(([ipcNamespace, functions]) => ({
    ipcNamespace,
    functions: functions.sort((a, b) => a.name.localeCompare(b.name))
  })).
  sort((a, b) => a.ipcNamespace.localeCompare(b.ipcNamespace));
};

/**
 * Generate the preload bridge
 * @param namespaceGroups - The grouped methods
 * @param outputDir - The output directory
 * @param baseDir - Base directory for resolving relative paths
 * @returns The generated code
 * @remarks This function generates the preload bridge for the exposed methods.
 */
const generatePreloadBridge = (
  namespaceGroups: Map<string, FunctionInfo[]>,
  outputDir: string,
  baseDir: string | undefined): string => {

  // Generate import declarations
  const [_, importTypeDescriptors] = getImportDescriptorList(
    namespaceGroups, outputDir, baseDir, false, false);
  const importTypeDeclarations = importTypeDescriptors.map(
    ({ path, memberNames }) => `import type { ${memberNames.join(', ')} } from '${path}';`);

  // Generate preload bridge declarations
  const preloadBridgeDescriptors = getPreloadBridgeDescriptorList(namespaceGroups);
  const preloadBridgeDeclarations = preloadBridgeDescriptors.map(({ ipcNamespace, functions }) => {
    const functionsCode = functions.map(functionInfo => {
      const args = functionInfo.type.parameters.map(p => p.name).join(', ');
      const params = `(${functionInfo.type.parameters.map(p => `${p.name}: ${p.type.typeString}`).join(', ')})`;
      const functionId = `${ipcNamespace}:${functionInfo.name}`;
      const returnType = functionInfo.type.returnType;
      const unwrappedReturnType = // Unwrap Promise<T> generic parameter
        (returnType.kind === 'type-reference' &&
         returnType.referencedType.kind === 'interface' &&
         returnType.referencedType.name === 'Promise') ?
          (returnType.typeArguments?.at(0) ?? returnType) : returnType;
      return `  ${functionInfo.name}: ${params} => controller.invoke<${unwrappedReturnType.typeString}>('${functionId}'${functionInfo.type.parameters.length >= 1 ? `, ${args}` : ''})`;
    }).join(',\n');
    return `contextBridge.exposeInMainWorld('${ipcNamespace}', {\n${functionsCode}\n});`;
  });

  const preloadBodyLines = [
    "// This is auto-generated preloader by sublimity-electron-bridge.",
    "// Do not edit manually this file.",
    '',
    "import { contextBridge, ipcRenderer } from 'electron';",
    "import { createSublimityRpcController, SublimityRpcMessage } from 'sublimity-rpc';",
    ...importTypeDeclarations,
    '',
    '// Create RPC controller with Synchronous RPC mode',
    'const controller = createSublimityRpcController({',
    '  onSendMessage: async (message: SublimityRpcMessage): Promise<SublimityRpcMessage> => {',
    '    // Send message to main process and get response synchronously',
    '    const response = await ipcRenderer.invoke("rpc-invoke", message);',
    '    return response;',
    '  }',
    '});',
    '',
    '// Handle messages from main process',
    'ipcRenderer.on("rpc-message", (_, message: SublimityRpcMessage) => {',
    '  controller.insertMessage(message);',
    '});',
    '',
    '// Expose RPC functions to renderer process',
    ...preloadBridgeDeclarations,
    ''
  ].filter(line => line !== null);

  return preloadBodyLines.join('\n');
};

/////////////////////////////////////////////////////////////////////////////////////////

/**
 * Renderer type descriptor
 * @remarks This is a descriptor for a single renderer type.
 */
interface RendererTypeDescriptor {
  /**
   * The Electron IPC namespace
   */
  readonly ipcNamespace: string;
  /**
   * The interface type name
   */
  readonly typeName: string;
  /**
   * The functions
   */
  readonly functions: FunctionInfo[];
}

/**
 * Get renderer type descriptor list for the given namespace groups
 * @param namespaceGroups - The grouped methods
 * @returns The renderer type descriptor list, sorted to ensure deterministic order
 */
const getRendererTypeDescriptorList = (namespaceGroups: Map<string, FunctionInfo[]>): RendererTypeDescriptor[] => {
  return Array.from(namespaceGroups.entries()).
    map(([ipcNamespace, functions]) => ({
      ipcNamespace,
      typeName: `__${ipcNamespace}Type`,
      functions: functions.sort((a, b) => a.name.localeCompare(b.name))
    })).
    sort((a, b) => a.ipcNamespace.localeCompare(b.ipcNamespace));
};

/**
 * Generate the type definitions
 * @param namespaceGroups - The grouped methods
 * @param outputDir - The output directory for type definitions
 * @param baseDir - Base directory for resolving relative paths
 * @returns The generated code
 * @remarks This function generates the type definitions for the exposed methods.
 */
const generateTypeDefinitions = (
  namespaceGroups: Map<string, FunctionInfo[]>,
  outputDir: string,
  baseDir: string | undefined): string => {
  
  // Generate import declarations
  const [importDescriptors, importTypeDescriptors] = getImportDescriptorList(
    namespaceGroups, outputDir, baseDir, false, false);
  const importTypeDeclarations = importTypeDescriptors.map(
    ({ path, memberNames }) => `import type { ${memberNames.join(', ')} } from '${path}';`);
  const importDeclarations = importDescriptors.map(
    ({ path, memberNames }) => `import { ${memberNames.join(', ')} } from '${path}';`);

  // Generate renderer type declarations
  const rendererTypeDescriptors = getRendererTypeDescriptorList(namespaceGroups);
  const rendererTypeDeclarations = rendererTypeDescriptors.map(({ typeName, functions }) => {
    const functionsCode = functions.map(functionInfo => {
      const params = functionInfo.type.parameters.map(p => `${p.memberString}: ${p.type.typeString}`).join(', ');
      return `  readonly ${functionInfo.name}: (${params}) => ${functionInfo.type.returnType.typeString};`;   // Functions in interface
    }).join('\n');
    return `export interface ${typeName} {\n${functionsCode}\n}`;
  });

  // Generate window properties
  const windowProperties = rendererTypeDescriptors.map(({ ipcNamespace, typeName }) => {
    return `    readonly ${ipcNamespace}: ${typeName};`;   // Properties in window object
  });

  const typeDefsBodyLines = [
    "// This is auto-generated type definitions by sublimity-electron-bridge.",
    "// Do not edit manually this file.",
    (importDeclarations.length >= 1 || importTypeDeclarations.length >= 1) ? '' : null,
    ...importTypeDeclarations,
    ...importDeclarations,
    (rendererTypeDeclarations.length >= 1) ? '' : null,
    ...rendererTypeDeclarations,
    '',
    'declare global {',
    '  interface Window {',
    ...windowProperties,
    '  }',
    '}',
    '',
    'export {}',
    ''
  ].filter(line => line !== null);
  
  return typeDefsBodyLines.join('\n');
};

/////////////////////////////////////////////////////////////////////////////////////////

/**
 * Extract exposed functions using the new extractor
 * @param tsConfig - tsconfig.json object
 * @param baseDir - Base directory for resolving relative paths
 * @param sourceFilePaths - Array of source file paths
 * @returns Array of ExposedFunction
 */
const extractExposedFunctionsFromExtractor = (
  tsConfig: any, baseDir: string, sourceFilePaths: string[], logger: Logger): FunctionInfo[] => {
  logger.debug(`extractExposedFunctionsFromExtractor: tsConfig=${tsConfig ? JSON.stringify(Object.keys(tsConfig)) : 'null'}`);
  logger.debug(`extractExposedFunctionsFromExtractor: baseDir=${baseDir}`);
  logger.debug(`extractExposedFunctionsFromExtractor: sourceFilePaths=${JSON.stringify(sourceFilePaths)}`);
  
  const functionInfos = extractFunctions(tsConfig, baseDir, sourceFilePaths, logger);
  logger.debug(`extractFunctions returned ${functionInfos.length} functions`);
  functionInfos.forEach((fi, i) => {
    logger.debug(`Function ${i}: name=${fi.name}, kind=${fi.kind}, decorator=${fi.jsdocDecorator?.decorator}, args=${JSON.stringify(fi.jsdocDecorator?.args)}`);
  });
  
  const exposed = functionInfos.filter(functionInfo => functionInfo.jsdocDecorator?.decorator === 'expose');
  logger.debug(`Found ${exposed.length} exposed functions`);
  
  return exposed;
};

/**
 * Ensure a directory exists
 * @param dirPath - The path to the directory
 * @remarks This function ensures a directory exists.
 */
const ensureDirectoryExists = async (dirPath: string): Promise<void> => {
  try {
    await access(dirPath);
  } catch {
    await mkdir(dirPath, { recursive: true });
  }
};

/**
 * Safe write a file
 * @param filePath - The path to the file
 * @param content - The content to write
 * @returns Whether the file was written
 */
const writeFileWhenChanged = async (filePath: string, content: string): Promise<boolean> => {
  try {
    // Check if the file exists and is the same as the content
    const existingContent = await readFile(filePath, 'utf8');
    if (existingContent === content) {
      // Do nothing (Any watchers will not be notified)
      return false;
    }
  } catch (error) {
    // If we can't read the file, proceed with writing
  }

  // Ensure the directory exists
  const dir = dirname(filePath);
  await ensureDirectoryExists(dir);

  // Write the file
  await writeFile(filePath, content, 'utf8');

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
  (options?: ElectronBridgeOptions) : ElectronBridgeGenerator => {

  // Makes default values for the options
  const {
    logger = createConsoleLogger(),
    baseDir,
    tsConfig,
    defaultNamespace = 'mainProcess',
    mainProcessHandlerFile = 'src/main/generated/seb_main.ts',
    preloadHandlerFile = 'src/preload/generated/seb_preload.ts',
    typeDefinitionsFile = 'src/renderer/src/generated/seb_types.ts',
  } = options ?? { };

  /**
   * Analyze multiple files and extract exposed methods using the new extractor
   * @param filePaths - Array of file paths to analyze
   * @returns The exposed methods
   */
  const analyzeFiles = async (filePaths: string[]): Promise<FunctionInfo[]> => {
    logger.debug(`analyzeFiles: received ${filePaths.length} files`);
    logger.debug(`analyzeFiles: baseDir=${baseDir}, tsConfig=${typeof tsConfig}`);

    // Load the TypeScript configuration object
    const tsConfigObj = loadTsConfig(tsConfig, baseDir!, logger);
    logger.debug(`analyzeFiles: loaded tsConfig: ${tsConfigObj ? 'success' : 'failed'}`);

    // Filter out generated files
    const filteredFiles = filePaths.filter(filePath => 
      !isGeneratedFile(
        filePath,
        mainProcessHandlerFile,
        preloadHandlerFile,
        typeDefinitionsFile)
    );
    logger.debug(`analyzeFiles: filtered to ${filteredFiles.length} files`);

    if (filteredFiles.length === 0) {
      logger.warn(`analyzeFiles: no files to analyze after filtering`);
      return [];
    }

    const result = extractExposedFunctionsFromExtractor(tsConfigObj, baseDir!, filteredFiles, logger);
    logger.debug(`analyzeFiles: extracted ${result.length} exposed functions`);
    return result;
  };

  /**
   * Generate the files for the exposed functions
   * @param functions - The exposed functions
   */
  const generateFiles = async (functions: FunctionInfo[]): Promise<void> => {
    // Sort methods by namespace to ensure deterministic order
    const namespaceGroups = groupFunctionsByNamespace(functions, defaultNamespace);

    // Generate main handlers
    const mainFilePath = resolve(baseDir!, mainProcessHandlerFile);
    const mainHandlersCode = generateMainHandlers(namespaceGroups, dirname(mainFilePath), baseDir);

    // Generate preload bridge
    const preloadFilePath = resolve(baseDir!, preloadHandlerFile);
    const preloadBridgeCode = generatePreloadBridge(namespaceGroups, dirname(preloadFilePath), baseDir);

    // Generate type definitions
    const typeDefsFilePath = resolve(baseDir!, typeDefinitionsFile);
    const typeDefsCode = generateTypeDefinitions(namespaceGroups, dirname(typeDefsFilePath), baseDir);

    // Write the files
    const results = await Promise.all([
      writeFileWhenChanged(mainFilePath, mainHandlersCode),
      writeFileWhenChanged(preloadFilePath, preloadBridgeCode),
      writeFileWhenChanged(typeDefsFilePath, typeDefsCode)
    ]);

    // Log the summary
    if (functions.length > 0) {
      logger.info(`Found ${functions.length} exposed functions in ${namespaceGroups.size} namespaces`);
    } else {
      logger.info(`No exposed functions found.`);
    }
    const updateCount = results.filter(result => result).length;
    if (updateCount > 0) {
      logger.info(`Updated files:`);
      if (results[0]) logger.info(`  - ${mainFilePath}`);
      if (results[1]) logger.info(`  - ${preloadFilePath}`);
      if (results[2]) logger.info(`  - ${typeDefsFilePath}`);
    } else {
      logger.info(`Any files unchanged.`);
    }
  };

  // Returns the generator
  return {
    analyzeFiles,
    generateFiles
  };
};
