import * as ts from 'typescript'
import { resolve } from 'path'
import { writeFileSync, mkdirSync, existsSync } from 'fs'

export interface ElectronBridgeOptions {
  outputDirs?: {
    main?: string
    preload?: string
  }
  typeDefinitionsFile?: string
  defaultNamespace?: string
}

interface ExposedMethod {
  className?: string
  methodName: string
  namespace: string
  parameters: { name: string; type: string }[]
  returnType: string
  filePath: string
}

interface NamespaceGroup {
  [namespace: string]: ExposedMethod[]
}

function isCamelCase(str: string): boolean {
  return /^[a-z][a-zA-Z0-9]*$/.test(str)
}

function toPascalCase(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

function extractExposedMethods(sourceFile: ts.SourceFile, filePath: string): ExposedMethod[] {
  const methods: ExposedMethod[] = []
  
  function visit(node: ts.Node) {
    // Handle class methods
    if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.text
      
      node.members.forEach(member => {
        if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
          const exposedMethod = processJSDocTag(member, sourceFile, filePath, (member.name as ts.Identifier).text, className)
          if (exposedMethod) {
            const parameters = member.parameters.map(param => ({
              name: (param.name as ts.Identifier).text,
              type: param.type ? sourceFile.text.substring(param.type.pos, param.type.end).trim() : 'any'
            }))
            
            const returnType = member.type ? sourceFile.text.substring(member.type.pos, member.type.end).trim() : 'Promise<any>'
            
            // Check if method returns Promise
            if (member.type && !isPromiseType(member.type)) {
              throw new Error(`@decorator expose method must return Promise: ${className}.${(member.name as ts.Identifier).text} in ${filePath}:${ts.getLineAndCharacterOfPosition(sourceFile, member.pos).line + 1}`)
            }
            
            methods.push({
              className,
              methodName: (member.name as ts.Identifier).text,
              namespace: exposedMethod.namespace,
              parameters,
              returnType,
              filePath
            })
          }
        }
      })
    }
    
    // Handle function declarations
    if (ts.isFunctionDeclaration(node) && node.name) {
      const exposedMethod = processJSDocTag(node, sourceFile, filePath, node.name.text)
      if (exposedMethod) {
        const parameters = node.parameters.map(param => ({
          name: (param.name as ts.Identifier).text,
          type: param.type ? sourceFile.text.substring(param.type.pos, param.type.end).trim() : 'any'
        }))
        
        const returnType = node.type ? sourceFile.text.substring(node.type.pos, node.type.end).trim() : 'Promise<any>'
        
        // Check if function returns Promise
        if (node.type && !isPromiseType(node.type)) {
          throw new Error(`@decorator expose function must return Promise: ${node.name.text} in ${filePath}:${ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1}`)
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
          
          const exposedMethod = processJSDocTag(node, sourceFile, filePath, declaration.name.text)
          if (exposedMethod) {
            const arrowFunc = declaration.initializer
            const parameters = arrowFunc.parameters.map(param => ({
              name: (param.name as ts.Identifier).text,
              type: param.type ? sourceFile.text.substring(param.type.pos, param.type.end).trim() : 'any'
            }))
            
            const returnType = arrowFunc.type ? sourceFile.text.substring(arrowFunc.type.pos, arrowFunc.type.end).trim() : 'Promise<any>'
            
            // Check if arrow function returns Promise
            if (arrowFunc.type && !isPromiseType(arrowFunc.type)) {
              throw new Error(`@decorator expose function must return Promise: ${declaration.name.text} in ${filePath}:${ts.getLineAndCharacterOfPosition(sourceFile, declaration.pos).line + 1}`)
            }
            
            methods.push({
              methodName: declaration.name.text,
              namespace: exposedMethod.namespace,
              parameters,
              returnType,
              filePath
            })
          }
        }
      })
    }
    
    ts.forEachChild(node, visit)
  }
  
  visit(sourceFile)
  return methods
}

function processJSDocTag(node: ts.Node, sourceFile: ts.SourceFile, filePath: string, methodName: string, className?: string): { namespace: string } | null {
  const jsDocTags = ts.getJSDocTags(node)
  
  for (const tag of jsDocTags) {
    if (tag.tagName && tag.tagName.text === 'decorator' && tag.comment) {
      const comment = typeof tag.comment === 'string' ? tag.comment : tag.comment.map(c => c.text || '').join('')
      const match = comment.match(/^expose\s+(\w+)$/)
      
      if (match) {
        const namespace = match[1]
        if (!isCamelCase(namespace)) {
          const location = className ? `${className}.${methodName}` : methodName
          throw new Error(`@decorator expose argument must be camelCase: "${namespace}" in ${location} at ${filePath}:${ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1}`)
        }
        return { namespace }
      } else if (comment === 'expose') {
        // Default namespace when no argument provided
        return { namespace: 'electronAPI' }
      }
    }
  }
  
  return null
}

function isPromiseType(typeNode: ts.TypeNode): boolean {
  if (ts.isTypeReferenceNode(typeNode)) {
    const typeName = typeNode.typeName
    if (ts.isIdentifier(typeName) && typeName.text === 'Promise') {
      return true
    }
  }
  return false
}

function groupMethodsByNamespace(methods: ExposedMethod[]): NamespaceGroup {
  const groups: NamespaceGroup = {}
  
  for (const method of methods) {
    if (!groups[method.namespace]) {
      groups[method.namespace] = []
    }
    groups[method.namespace].push(method)
  }
  
  return groups
}

function generateMainHandlers(namespaceGroups: NamespaceGroup): string {
  const imports = new Set<string>()
  const singletonInstances = new Set<string>()
  const handlers: string[] = []
  
  // Generate imports and collect unique class names
  for (const methods of Object.values(namespaceGroups)) {
    for (const method of methods) {
      if (method.className) {
        const importPath = method.filePath.replace(/\.ts$/, '').replace(/\\/g, '/')
        imports.add(`import { ${method.className} } from '${importPath}'`)
        singletonInstances.add(method.className)
      }
    }
  }
  
  // Generate singleton instance declarations
  const instanceDeclarations: string[] = []
  for (const className of Array.from(singletonInstances)) {
    const instanceVar = `${className.toLowerCase()}Instance`
    instanceDeclarations.push(`const ${instanceVar} = new ${className}()`)
  }
  
  // Generate handler registrations
  for (const [namespace, methods] of Object.entries(namespaceGroups)) {
    for (const method of methods) {
      if (method.className) {
        const instanceVar = `${method.className.toLowerCase()}Instance`
        const channelName = `api:${namespace}:${method.methodName}`
        const params = method.parameters.map(p => p.name).join(', ')
        const args = method.parameters.length > 0 ? `, ${params}` : ''
        
        handlers.push(`ipcMain.handle('${channelName}', (event${args}) => ${instanceVar}.${method.methodName}(${params}))`)
      } else {
        // Standalone function
        const channelName = `api:${namespace}:${method.methodName}`
        const params = method.parameters.map(p => p.name).join(', ')
        const args = method.parameters.length > 0 ? `, ${params}` : ''
        
        const importPath = method.filePath.replace(/\.ts$/, '').replace(/\\/g, '/')
        imports.add(`import { ${method.methodName} } from '${importPath}'`)
        handlers.push(`ipcMain.handle('${channelName}', (event${args}) => ${method.methodName}(${params}))`)
      }
    }
  }
  
  return [
    "import { ipcMain } from 'electron'",
    ...Array.from(imports),
    '',
    '// Create singleton instances',
    ...instanceDeclarations,
    '',
    '// Register IPC handlers',
    ...handlers
  ].join('\n')
}

function generatePreloadBridge(namespaceGroups: NamespaceGroup): string {
  const bridges: string[] = []
  
  for (const [namespace, methods] of Object.entries(namespaceGroups)) {
    const methodsCode = methods.map(method => {
      const params = method.parameters.map(p => `${p.name}: ${p.type}`).join(', ')
      const args = method.parameters.map(p => p.name).join(', ')
      const channelName = `api:${namespace}:${method.methodName}`
      
      return `  ${method.methodName}: (${params}) => ipcRenderer.invoke('${channelName}'${args ? `, ${args}` : ''})`
    }).join(',\n')
    
    bridges.push(`contextBridge.exposeInMainWorld('${namespace}', {\n${methodsCode}\n})`)
  }
  
  return [
    "import { contextBridge, ipcRenderer } from 'electron'",
    '',
    ...bridges
  ].join('\n')
}

function generateTypeDefinitions(namespaceGroups: NamespaceGroup): string {
  const interfaces: string[] = []
  const windowProperties: string[] = []
  
  for (const [namespace, methods] of Object.entries(namespaceGroups)) {
    const typeName = toPascalCase(namespace)
    
    const methodsCode = methods.map(method => {
      const params = method.parameters.map(p => `${p.name}: ${p.type}`).join(', ')
      return `  ${method.methodName}(${params}): ${method.returnType}`
    }).join('\n')
    
    interfaces.push(`interface ${typeName} {\n${methodsCode}\n}`)
    windowProperties.push(`  ${namespace}: ${typeName}`)
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
  ].join('\n')
}

function ensureDirectoryExists(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true })
  }
}

export class ElectronBridgeGenerator {
  private options: ElectronBridgeOptions
  
  constructor(options: ElectronBridgeOptions = {}) {
    this.options = {
      outputDirs: {
        main: options.outputDirs?.main || 'main/generated',
        preload: options.outputDirs?.preload || 'preload/generated'
      },
      typeDefinitionsFile: options.typeDefinitionsFile || 'src/generated/electron-api.d.ts',
      defaultNamespace: options.defaultNamespace || 'electronAPI'
    }
  }

  analyzeFile(filePath: string, code: string): ExposedMethod[] {
    const sourceFile = ts.createSourceFile(
      filePath,
      code,
      ts.ScriptTarget.Latest,
      true
    )

    return extractExposedMethods(sourceFile, filePath)
  }

  generateFiles(methods: ExposedMethod[]): void {
    if (methods.length === 0) {
      return
    }

    const namespaceGroups = groupMethodsByNamespace(methods)

    // Generate main handlers
    const mainHandlersCode = generateMainHandlers(namespaceGroups)
    ensureDirectoryExists(this.options.outputDirs!.main!)
    writeFileSync(resolve(this.options.outputDirs!.main!, 'ipc-handlers.ts'), mainHandlersCode)

    // Generate preload bridge
    const preloadBridgeCode = generatePreloadBridge(namespaceGroups)
    ensureDirectoryExists(this.options.outputDirs!.preload!)
    writeFileSync(resolve(this.options.outputDirs!.preload!, 'bridge.ts'), preloadBridgeCode)

    // Generate type definitions
    const typeDefsCode = generateTypeDefinitions(namespaceGroups)
    const typeDefsDir = this.options.typeDefinitionsFile!.substring(0, this.options.typeDefinitionsFile!.lastIndexOf('/'))
    ensureDirectoryExists(typeDefsDir)
    writeFileSync(this.options.typeDefinitionsFile!, typeDefsCode)

    console.log(`[electron-bridge] Generated files:`)
    console.log(`  - ${resolve(this.options.outputDirs!.main!, 'ipc-handlers.ts')}`)
    console.log(`  - ${resolve(this.options.outputDirs!.preload!, 'bridge.ts')}`)
    console.log(`  - ${this.options.typeDefinitionsFile}`)
    console.log(`  - Found ${methods.length} exposed methods in ${Object.keys(namespaceGroups).length} namespaces`)
  }
}

// Export utility functions for external use
export {
  extractExposedMethods,
  groupMethodsByNamespace,
  generateMainHandlers,
  generatePreloadBridge,
  generateTypeDefinitions,
  isCamelCase,
  toPascalCase
}