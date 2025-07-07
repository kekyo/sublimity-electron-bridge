import * as ts from 'typescript';
import { Logger, ExposedMethod } from './types';

/**
 * Check if a string is camelCase
 * @param str - The string to check
 * @returns Whether the string is camelCase
 */
export const isCamelCase = (str: string): boolean => {
  return /^[a-z][a-zA-Z0-9]*$/.test(str);
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
 * Process the JSDoc tag for the exposed method
 * @param logger - The logger to use
 * @param node - The node to process
 * @param sourceFile - The source file AST
 * @param filePath - The path to the source file
 * @param methodName - The name of the method
 * @param defaultNamespace - The default namespace for the exposed methods
 * @param className - The name of the class
 * @returns The namespace of the exposed method
 */
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

/**
 * Check if a type node is a Promise type
 * @param typeNode - The type node to check
 * @returns Whether the type node is a Promise type
 */
const isPromiseType = (typeNode: ts.TypeNode): boolean => {
  if (ts.isTypeReferenceNode(typeNode)) {
    const typeName = typeNode.typeName;
    if (ts.isIdentifier(typeName) && typeName.text === 'Promise') {
      return true;
    }
  }
  return false;
}; 

/////////////////////////////////////////////////////////////////////////////////////////

/**
 * Extract the exposed methods from a source file using TS AST visitor
 * @param logger - The logger to use
 * @param sourceFile - The source file AST to extract the methods from
 * @param filePath - The path to the source file
 * @param defaultNamespace - The default namespace for the exposed methods
 * @returns The exposed methods
 */
export const extractExposedMethods = (
  logger: Logger, sourceFile: ts.SourceFile, filePath: string, defaultNamespace: string): ExposedMethod[] => {
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
