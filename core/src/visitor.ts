import * as ts from 'typescript';
import { Logger, ExposedMethod, TypeInfo, SimpleTypeInfo, ArrayTypeInfo, GenericTypeInfo, OtherTypeInfo } from './types';

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
 * @param declaredType - The name of the declared type/class
 * @returns The namespace of the exposed method
 */
const processJSDocTag =
  (logger: Logger, node: ts.Node, sourceFile: ts.SourceFile, filePath: string, methodName: string, defaultNamespace: string, declaredType?: string):
  { namespace: string } | null => {
  const jsDocTags = ts.getJSDocTags(node);
  
  for (const tag of jsDocTags) {
    if (tag.tagName && tag.tagName.text === 'decorator' && tag.comment) {
      const comment = typeof tag.comment === 'string' ? tag.comment : tag.comment.map(c => c.text || '').join('');
      const match = comment.match(/^expose\s+(\w+)$/);
      
      if (match) {
        const namespace = match[1];
        if (!isCamelCase(namespace)) {
          const location = declaredType ? `${declaredType}.${methodName}` : methodName;
          logger.warn(`Warning: @decorator expose argument should be camelCase: "${namespace}" in ${location} at ${filePath}:${ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1}`);
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
 * @param typeChecker - The TypeScript type checker
 * @returns The exposed methods
 */
export const extractExposedMethods = async (
  logger: Logger, sourceFile: ts.SourceFile, filePath: string, defaultNamespace: string, typeChecker?: ts.TypeChecker): Promise<ExposedMethod[]> => {
  const methods: ExposedMethod[] = [];
  
  /**
   * Check if a type is a primitive type
   */
  const isPrimitiveType = (typeName: string): boolean => {
    const primitives = new Set([
      'string', 'number', 'boolean', 'void', 'any', 'unknown', 'never',
      'undefined', 'null', 'object', 'bigint', 'symbol'
    ]);
    return primitives.has(typeName);
  };

  /**
   * Get type information using TypeScript type checker
   * @param node - The type node to analyze
   * @returns TypeInfo with detailed AST structure
   */
  const getTypeInfo = (node: ts.TypeNode | undefined): TypeInfo => {
    if (!node) {
      return { name: 'any', kind: 'simple' } as SimpleTypeInfo;
    }
    
    if (!typeChecker) {
      // Fallback to text-based extraction if type checker is not available
      return parseTypeNodeFallback(node);
    }
    
    try {
      return parseTypeNodeWithChecker(node);
    } catch (error) {
      // Fallback to text-based extraction if type checker fails
      return parseTypeNodeFallback(node);
    }
  };

  /**
   * Parse type node using TypeScript type checker
   */
  const parseTypeNodeWithChecker = (node: ts.TypeNode): TypeInfo => {
    if (!typeChecker) {
      // Should not happen since this function is only called when typeChecker exists
      return parseTypeNodeFallback(node);
    }
    // Handle array types: T[]
    if (ts.isArrayTypeNode(node)) {
      // Get the element type with its own filePath
      const elementType = getTypeInfo(node.elementType);
      
      // Array type itself doesn't have a specific definition location (it's built-in)
      const arrayType = typeChecker.getTypeAtLocation(node);
      const arrayTypeName = typeChecker.typeToString(arrayType);
      
      return {
        name: arrayTypeName,
        kind: 'array',
        elementType,
        // Array type itself doesn't have filePath since it's a built-in construct
        filePath: undefined
      } as ArrayTypeInfo;
    }
    
    // Handle generic types: Promise<T>, Map<K, V>, etc.
    if (ts.isTypeReferenceNode(node)) {
      const type = typeChecker.getTypeAtLocation(node);
      
      // Get the base type name and its filePath
      const baseTypeName = ts.isIdentifier(node.typeName) 
        ? node.typeName.text 
        : typeChecker.typeToString(typeChecker.getTypeAtLocation(node.typeName));
      
      // Get filePath for the generic type itself (e.g., Promise, Map)
      let genericTypeFilePath: string | undefined;
      const genericTypeSymbol = typeChecker.getSymbolAtLocation(node.typeName);
      if (genericTypeSymbol && genericTypeSymbol.valueDeclaration && !isPrimitiveType(baseTypeName)) {
        genericTypeFilePath = genericTypeSymbol.valueDeclaration.getSourceFile().fileName;
      }
      
      // If it has type arguments, it's a generic type
      if (node.typeArguments && node.typeArguments.length > 0) {
        // Recursively get type information for each type argument
        const typeArguments = node.typeArguments.map(arg => getTypeInfo(arg));
        
        return {
          name: baseTypeName,
          filePath: genericTypeFilePath,
          kind: 'generic',
          typeArguments
        } as GenericTypeInfo;
      }
      
      // Simple type reference without type arguments
      return {
        name: baseTypeName,
        filePath: genericTypeFilePath,
        kind: 'simple'
      } as SimpleTypeInfo;
    }
    
    // Handle simple types (primitives, identifiers)
    if (ts.isTypeNode(node)) {
      const type = typeChecker.getTypeAtLocation(node);
      const typeName = typeChecker.typeToString(type);
      
      let filePath: string | undefined;
      const typeSymbol = type.getSymbol();
      if (typeSymbol && typeSymbol.valueDeclaration && !isPrimitiveType(typeName)) {
        filePath = typeSymbol.valueDeclaration.getSourceFile().fileName;
      }
      
      return {
        name: typeName,
        filePath,
        kind: 'simple'
      } as SimpleTypeInfo;
    }
    
    // Other complex types
    const type = typeChecker.getTypeAtLocation(node);
    const typeName = typeChecker.typeToString(type);
    
    return {
      name: typeName,
      kind: 'other'
    } as OtherTypeInfo;
  };

  /**
   * Parse type node without type checker (fallback)
   */
  const parseTypeNodeFallback = (node: ts.TypeNode): TypeInfo => {
    const typeText = sourceFile.text.substring(node.pos, node.end).trim();
    
    // Handle array types: T[]
    if (ts.isArrayTypeNode(node)) {
      const elementType = getTypeInfo(node.elementType);
      return {
        name: typeText,
        kind: 'array',
        elementType,
        filePath: undefined // Array type itself doesn't have filePath in fallback mode
      } as ArrayTypeInfo;
    }
    
    // Handle generic types: Promise<T>, Map<K, V>, etc.
    if (ts.isTypeReferenceNode(node)) {
      const baseTypeName = ts.isIdentifier(node.typeName) 
        ? node.typeName.text 
        : sourceFile.text.substring(node.typeName.pos, node.typeName.end).trim();
      
      if (node.typeArguments && node.typeArguments.length > 0) {
        const typeArguments = node.typeArguments.map(arg => getTypeInfo(arg));
        
        return {
          name: baseTypeName,
          kind: 'generic',
          typeArguments,
          filePath: undefined // No filePath resolution in fallback mode
        } as GenericTypeInfo;
      }
      
      return {
        name: baseTypeName,
        kind: 'simple',
        filePath: undefined // No filePath resolution in fallback mode
      } as SimpleTypeInfo;
    }
    
    // Simple types
    return {
      name: typeText,
      kind: 'simple',
      filePath: undefined // No filePath resolution in fallback mode
    } as SimpleTypeInfo;
  };
  
  /**
   * Get declared type information from class declaration
   * @param classDecl - The class declaration node
   * @returns TypeInfo for the class type
   */
  const getDeclaredTypeInfo = (classDecl: ts.ClassDeclaration): TypeInfo => {
    const className = classDecl.name?.text || 'Unknown';
    
    // Check if class has type parameters (generic class)
    if (classDecl.typeParameters && classDecl.typeParameters.length > 0) {
      // For generic classes, we need to analyze the type parameters
      // Type parameters in class declarations are constraints, not concrete types
      // We'll treat them as simple type names since they represent type variables
      const typeArguments = classDecl.typeParameters.map(typeParam => {
        // If type parameter has a constraint, analyze it recursively
        if (typeParam.constraint) {
          return getTypeInfo(typeParam.constraint);
        }
        // Otherwise, it's just a type parameter name
        return {
          name: typeParam.name.text,
          kind: 'simple'
        } as SimpleTypeInfo;
      });
      
      return {
        name: className,
        kind: 'generic',
        typeArguments
      } as GenericTypeInfo;
    }
    
    // Simple class without type parameters
    return {
      name: className,
      kind: 'simple'
    } as SimpleTypeInfo;
  };

  /**
   * Get parameter type information
   * @param param - The parameter node
   * @returns TypeInfo with name and filePath
   */
  const getParameterTypeInfo = (param: ts.ParameterDeclaration): TypeInfo => {
    if (param.type) {
      return getTypeInfo(param.type);
    }
    
    if (!typeChecker) {
      return { name: 'any', kind: 'simple' } as SimpleTypeInfo;
    }
    
    try {
      // Try to infer type from the parameter symbol
      const paramSymbol = typeChecker.getSymbolAtLocation(param.name);
      if (paramSymbol) {
        const paramType = typeChecker.getTypeOfSymbolAtLocation(paramSymbol, param);
        const typeName = typeChecker.typeToString(paramType);
        return { name: typeName, kind: 'simple' } as SimpleTypeInfo;
      }
    } catch (error) {
      // Fallback to 'any' if type checker fails
    }
    
    return { name: 'any', kind: 'simple' } as SimpleTypeInfo;
  };

  const visit = (node: ts.Node) => {
    // Handle class methods
    if (ts.isClassDeclaration(node) && node.name) {
      const declaredTypeName = node.name.text;
      const declaredTypeInfo = getDeclaredTypeInfo(node);
      
      node.members.forEach(member => {
        if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
          const exposedMethod = processJSDocTag(
            logger, member, sourceFile, filePath, (member.name as ts.Identifier).text, defaultNamespace, declaredTypeName);
          if (exposedMethod) {
            const parameters = member.parameters.map(param => ({
              name: (param.name as ts.Identifier).text,
              type: getParameterTypeInfo(param)
            }));
            
            const returnType: TypeInfo = member.type ? getTypeInfo(member.type) : {
              name: 'Promise',
              kind: 'generic',
              typeArguments: [{ name: 'any', kind: 'simple' } as SimpleTypeInfo]
            } as GenericTypeInfo;
            
            // Check if method returns Promise
            if (member.type && !isPromiseType(member.type)) {
              logger.warn(`Warning: @decorator expose method should return Promise: ${declaredTypeName}.${(member.name as ts.Identifier).text} in ${filePath}:${ts.getLineAndCharacterOfPosition(sourceFile, member.pos).line + 1}`)
              return // Skip this method
            };
            
            methods.push({
              declaredType: declaredTypeInfo,
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
          type: getParameterTypeInfo(param)
        }));

        const returnType: TypeInfo = node.type ? getTypeInfo(node.type) : {
              name: 'Promise',
              kind: 'generic',
              typeArguments: [{ name: 'any', kind: 'simple' } as SimpleTypeInfo]
            } as GenericTypeInfo;

        // Check if function returns Promise
        if (node.type && !isPromiseType(node.type)) {
          logger.warn(`Warning: @decorator expose function should return Promise: ${node.name.text} in ${filePath}:${ts.getLineAndCharacterOfPosition(sourceFile, node.pos).line + 1}`);
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
              type: getParameterTypeInfo(param)
            }));
            
            const returnType: TypeInfo = arrowFunc.type ? getTypeInfo(arrowFunc.type) : {
              name: 'Promise',
              kind: 'generic',
              typeArguments: [{ name: 'any', kind: 'simple' } as SimpleTypeInfo]
            } as GenericTypeInfo;
            
            // Check if arrow function returns Promise
            if (arrowFunc.type && !isPromiseType(arrowFunc.type)) {
              logger.warn(`Warning: @decorator expose function should return Promise: ${declaration.name.text} in ${filePath}:${ts.getLineAndCharacterOfPosition(sourceFile, declaration.pos).line + 1}`);
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
