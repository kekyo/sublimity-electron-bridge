import * as ts from 'typescript';
import * as path from 'path';
import { resolve } from 'path';

/**
 * Position information within source code
 */
export interface SourceLocation {
  /** File path */
  fileName: string;
  /** Start line number (1-based) */
  startLine: number;
  /** Start column number (0-based) */
  startColumn: number;
  /** End line number (1-based) */
  endLine: number;
  /** End column number (0-based) */
  endColumn: number;
}

/**
 * JSDoc decorator
 */
export interface JSDocDecorator {
  decorator: string;
  args: string[];
}

/**
 * Source code fragment
 */
export interface SourceCodeFragment {
  sourceLocation: SourceLocation;
}

/**
 * Base interface for type AST
 */
export interface TypeNode extends SourceCodeFragment {
  kind: 'primitive' | 'interface' | 'function' | 'array' | 'type-reference' | 'unknown';
  typeString: string;
}

/**
 * Primitive type node
 */
export interface PrimitiveTypeNode extends TypeNode {
  kind: 'primitive';
  type: 'string' | 'number' | 'boolean' | 'null' | 'undefined' | 'void' | 'any' | 'bigint' | 'symbol' | 'buffer';
}

/**
 * Interface property information
 */
export interface PropertyNode {
  name: string;
  type: TypeAST;
  isOptional: boolean;
}

/**
 * Interface type node
 */
export interface InterfaceTypeNode extends TypeNode {
  kind: 'interface';
  name: string;
  properties: PropertyNode[];
  targetLibrary?: string;
  typeParameters?: TypeAST[];
  jsdocDecorator?: JSDocDecorator;
}

/**
 * Type reference node (for generic type instantiation)
 */
export interface TypeReferenceTypeNode extends TypeNode {
  kind: 'type-reference';
  referencedType: TypeAST;
  typeArguments?: TypeAST[];
}

/**
 * Function parameter information
 */
export interface FunctionParameterNode {
  name: string;
  type: TypeAST;
  isRestParameter: boolean;
}

/**
 * Function type node
 */
export interface FunctionTypeNode extends TypeNode {
  kind: 'function';
  parameters: FunctionParameterNode[];
  returnType: TypeAST;
}

/**
 * Array type node
 */
export interface ArrayTypeNode extends TypeNode {
  kind: 'array';
  elementType: TypeAST;
}

/**
 * Unknown type node
 */
export interface UnknownTypeNode extends TypeNode {
  kind: 'unknown';
}

/**
 * Type AST
 */
export type TypeAST = PrimitiveTypeNode | InterfaceTypeNode | TypeReferenceTypeNode | FunctionTypeNode | ArrayTypeNode | UnknownTypeNode;

/**
 * Function information for AST
 */
export interface FunctionInfo extends SourceCodeFragment {
  kind: 'class-method' | 'function' | 'arrow-function';
  name: string;
  declaredType?: TypeAST;
  parameters: FunctionParameterNode[];
  returnType: TypeAST;
  jsdocDecorator?: JSDocDecorator;
}

///////////////////////////////////////////////////////////////////////////

/**
 * Extract position information from TypeScript Node
 * @param node TypeScript Node
 * @param fallbackFileName Fallback file name
 * @returns SourceLocation
 */
const getSourceLocation = (node: ts.Node | undefined, fallbackFileName: string): SourceLocation => {
  if (!node) {
    return {
      fileName: fallbackFileName,
      startLine: 1,
      startColumn: 0,
      endLine: 1,
      endColumn: 0
    };
  }

  const sourceFile = node.getSourceFile();
  const fileName = sourceFile?.fileName || fallbackFileName;
  
  const start = node.getStart();
  const end = node.getEnd();
  
  if (sourceFile) {
    const startPos = sourceFile.getLineAndCharacterOfPosition(start);
    const endPos = sourceFile.getLineAndCharacterOfPosition(end);
    
    return {
      fileName,
      startLine: startPos.line + 1, // Convert to 1-based
      startColumn: startPos.character,
      endLine: endPos.line + 1, // Convert to 1-based
      endColumn: endPos.character
    };
  }
  
  return {
    fileName,
    startLine: 1,
    startColumn: 0,
    endLine: 1,
    endColumn: 0
  };
};

/**
 * Convert TypeScript type to TypeAST
 * @param type TypeScript type
 * @param checker TypeChecker
 * @param currentSourceFile Path of currently processed source file
 * @param visitedInterfaces Track visited interfaces to avoid circular references
 * @returns TypeAST
 */
const convertTypeToAST = (type: ts.Type, checker: ts.TypeChecker, currentSourceFile: string, visitedInterfaces: Set<string> = new Set()): TypeAST => {
  const typeString = checker.typeToString(type);
  
  // Use position information from usage location for primitive types
  const currentFileLocation = getSourceLocation(undefined, currentSourceFile);
  
  // Check for Buffer type first (it's a specific global interface)
  if (typeString === 'Buffer' || typeString.startsWith('Buffer<')) {
    return { kind: 'primitive', type: 'buffer', typeString, sourceLocation: currentFileLocation };
  }
  
  // Determine primitive types
  if (type.flags & ts.TypeFlags.String) {
    return { kind: 'primitive', type: 'string', typeString, sourceLocation: currentFileLocation };
  }
  if (type.flags & ts.TypeFlags.Number) {
    return { kind: 'primitive', type: 'number', typeString, sourceLocation: currentFileLocation };
  }
  if (type.flags & ts.TypeFlags.Boolean) {
    return { kind: 'primitive', type: 'boolean', typeString, sourceLocation: currentFileLocation };
  }
  if (type.flags & ts.TypeFlags.Null) {
    return { kind: 'primitive', type: 'null', typeString, sourceLocation: currentFileLocation };
  }
  if (type.flags & ts.TypeFlags.Undefined) {
    return { kind: 'primitive', type: 'undefined', typeString, sourceLocation: currentFileLocation };
  }
  if (type.flags & ts.TypeFlags.Void) {
    return { kind: 'primitive', type: 'void', typeString, sourceLocation: currentFileLocation };
  }
  if (type.flags & ts.TypeFlags.Any) {
    return { kind: 'primitive', type: 'any', typeString, sourceLocation: currentFileLocation };
  }
  if (type.flags & ts.TypeFlags.BigInt) {
    return { kind: 'primitive', type: 'bigint', typeString, sourceLocation: currentFileLocation };
  }
  if (type.flags & ts.TypeFlags.ESSymbol) {
    return { kind: 'primitive', type: 'symbol', typeString, sourceLocation: currentFileLocation };
  }
  
  // Determine array types
  if (checker.isArrayType(type)) {
    const typeArguments = checker.getTypeArguments(type as ts.TypeReference);
    const elementType = typeArguments && typeArguments.length > 0 ? typeArguments[0] : checker.getAnyType();
    return {
      kind: 'array',
      elementType: convertTypeToAST(elementType, checker, currentSourceFile, visitedInterfaces),
      typeString,
      sourceLocation: currentFileLocation
    };
  }
  
  // Determine generic types (TypeReference with type arguments)
  if (type.flags & ts.TypeFlags.Object && (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference) {
    const typeRef = type as ts.TypeReference;
    const typeArgs = checker.getTypeArguments(typeRef);
    
    if (typeArgs && typeArgs.length > 0) {
      // Get base type name
      const symbol = type.symbol || type.aliasSymbol;
      const baseName = symbol ? symbol.getName() : 'Unknown';
      
      // Get type definition location
      const typeDefinitionFile = symbol?.valueDeclaration?.getSourceFile()?.fileName || symbol?.declarations?.[0]?.getSourceFile()?.fileName || currentSourceFile;
      const referencedTypeSourceLocation = getSourceLocation(symbol?.valueDeclaration || symbol?.declarations?.[0], typeDefinitionFile);
      
      // Get the original type parameters from the generic type definition
      let originalTypeParameters: TypeAST[] = [];
      let referencedTypeString = baseName;
      
      if (symbol && symbol.declarations && symbol.declarations.length > 0) {
        const declaration = symbol.declarations[0];
        
        // Handle different types of generic declarations
        if (ts.isInterfaceDeclaration(declaration) || ts.isTypeAliasDeclaration(declaration) || ts.isClassDeclaration(declaration)) {
          if (declaration.typeParameters) {
            // Get the original type parameters (T, U, K, V, etc.)
            originalTypeParameters = declaration.typeParameters.map(typeParam => {
              const paramType = checker.getTypeAtLocation(typeParam);
              return convertTypeToAST(paramType, checker, typeDefinitionFile, new Set(visitedInterfaces));
            });
            
            // Generate the referenced type string using the typeString from recursively generated TypeNodes
            const typeParamNames = originalTypeParameters.map(tp => tp.typeString).join(', ');
            referencedTypeString = `${baseName}<${typeParamNames}>`;
          }
        }
      }
      
      // If we couldn't get type parameters from the declaration, fall back to unknown type parameters
      if (originalTypeParameters.length === 0) {
        // Create unknown type parameters based on the number of type arguments
        originalTypeParameters = typeArgs.map((_, index) => ({
          kind: 'unknown' as const,
          typeString: `T${index}`,
          sourceLocation: referencedTypeSourceLocation
        }));
        
        // Generate the referenced type string using the typeString from the created TypeNodes
        const typeParamNames = originalTypeParameters.map(tp => tp.typeString).join(', ');
        referencedTypeString = `${baseName}<${typeParamNames}>`;
      }
      
      // Convert type arguments for the type reference
      const typeArguments = typeArgs.map(arg => 
        convertTypeToAST(arg, checker, currentSourceFile, visitedInterfaces)
      );
      
      // Create the referenced interface type (may have type parameters if it's a generic interface)
      // Also extract nativeTypeName if available
      let jsdocDecorator: JSDocDecorator | undefined;
      if (symbol && symbol.declarations && symbol.declarations.length > 0) {
        const declaration = symbol.declarations[0];
        jsdocDecorator = extractJSDocDecorator(declaration);
      }
      
      const referencedType: InterfaceTypeNode = {
        kind: 'interface',
        name: baseName,
        properties: [],
        typeString: referencedTypeString,
        sourceLocation: referencedTypeSourceLocation,
        typeParameters: originalTypeParameters.length > 0 ? originalTypeParameters : undefined,
        jsdocDecorator
      };
      
      return {
        kind: 'type-reference',
        referencedType,
        typeArguments,
        typeString,
        sourceLocation: currentFileLocation
      };
    }
  }
  
  // Determine function types
  const signatures = checker.getSignaturesOfType(type, ts.SignatureKind.Call);
  if (signatures.length > 0) {
    const signature = signatures[0];
    const parameters = signature.getParameters().map(param => {
      const paramType = checker.getTypeOfSymbolAtLocation(param, param.valueDeclaration!);
      
      // Determine rest parameters
      const declaration = param.valueDeclaration as ts.ParameterDeclaration;
      const isRestParameter = !!(declaration && declaration.dotDotDotToken);
      
      return {
        name: param.getName(),
        type: convertTypeToAST(paramType, checker, currentSourceFile, new Set(visitedInterfaces)),
        isRestParameter
      };
    });
    
    const returnType = checker.getReturnTypeOfSignature(signature);
    
    return {
      kind: 'function',
      parameters,
      returnType: convertTypeToAST(returnType, checker, currentSourceFile, new Set(visitedInterfaces)),
      typeString,
      sourceLocation: currentFileLocation
    };
  }
  
  // Determine interface types
  if (type.symbol && (type.symbol.flags & ts.SymbolFlags.Interface)) {
    const interfaceName = type.symbol.getName();
    
    // Get type definition location
    const typeSourceFile = type.symbol.valueDeclaration?.getSourceFile()?.fileName || currentSourceFile;
    
    // Check for circular references
    if (visitedInterfaces.has(interfaceName)) {
      return {
        kind: 'interface',
        name: interfaceName,
        properties: [], // Empty property array for circular references
        typeString: checker.typeToString(type),
        sourceLocation: getSourceLocation(type.symbol?.valueDeclaration, typeSourceFile)
      };
    }
    
    visitedInterfaces.add(interfaceName);
    
    const properties = checker.getPropertiesOfType(type).map(prop => {
      const propType = checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration!);
      const isOptional = (prop.getFlags() & ts.SymbolFlags.Optional) !== 0;
      
      return {
        name: prop.getName(),
        type: convertTypeToAST(propType, checker, currentSourceFile, new Set(visitedInterfaces)),
        isOptional
      };
    });
    
    visitedInterfaces.delete(interfaceName);
    
    return {
      kind: 'interface',
      name: interfaceName,
      properties,
      typeString: checker.typeToString(type),
      sourceLocation: getSourceLocation(type.symbol?.valueDeclaration, typeSourceFile)
    };
  }
  
  // Other types are treated as unknown types
  return {
    kind: 'unknown',
    typeString,
    sourceLocation: currentFileLocation
  };
};

/**
 * Extract decorator value from JSDoc comment
 * @param node TypeScript Node
 * @returns {decorator: string, argument?: string} object (undefined if not found)
 */
const extractJSDocDecorator = (node: ts.Node): JSDocDecorator | undefined => {
  // Get JSDoc comment
  const jsDocTags = ts.getJSDocTags(node);
  
  for (const tag of jsDocTags) {
    if (tag.tagName.escapedText === 'decorator') {
      // Get @decorator tag value
      if (tag.comment) {
        const comment = typeof tag.comment === 'string' ? tag.comment : tag.comment.map(c => c.text).join('');
        // Get parameters separated by whitespace
        const params = comment.
          trim().
          split(/\s+/).
          map(param => param.trim()).
          filter(param => param.length > 0);
        if (params.length > 0) {
          const decorator = params[0];
          const args = params.slice(1);
          return { decorator, args };
        }
      }
    }
  }
  
  return undefined;
};

/**
 * Extract functions from source code at specified paths
 * @param tsConfig tsconfig.json object
 * @param baseDir Base directory for resolving relative paths
 * @param sourceFilePaths Array of source code paths
 * @returns Array of extracted function information with complete AST data
 */
export const extractFunctions = (tsConfig: any, baseDir: string, sourceFilePaths: string[]): FunctionInfo[] => {
  // Parse tsconfig
  const parsedConfig = ts.parseJsonConfigFileContent(
    tsConfig,
    ts.sys,
    baseDir || process.cwd()
  );

  // Generate Program for entire project (including all files)
  const allFiles = [...new Set([...parsedConfig.fileNames, ...sourceFilePaths])];
  const program = ts.createProgram({
    rootNames: allFiles,
    options: parsedConfig.options,
  });

  const checker = program.getTypeChecker();
  const result: FunctionInfo[] = [];

  // Process each file
  for (const sourceFilePath of sourceFilePaths) {
    const sourceFile = program.getSourceFile(sourceFilePath);
    if (!sourceFile) {
      console.warn(`File not found: ${sourceFilePath}`);
      continue;
    }

    // Visit all nodes in the source file
    const visit = (node: ts.Node): void => {
      // Handle class methods
      if (ts.isClassDeclaration(node) && node.name) {
        const declaredType = convertTypeToAST(checker.getTypeAtLocation(node), checker, sourceFilePath);
        
        node.members.forEach(member => {
          if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
            const methodName = member.name.text;
            const jsdocDecorator = extractJSDocDecorator(member);
            
            // Extract parameter types using AST
            const parameters = member.parameters.map(param => {
              const paramType = checker.getTypeAtLocation(param);
              const isRestParameter = !!(param.dotDotDotToken);
              return {
                name: (param.name as ts.Identifier).text,
                type: convertTypeToAST(paramType, checker, sourceFilePath),
                isRestParameter
              };
            });

            // Extract return type using AST
            const returnType = member.type ? 
              convertTypeToAST(checker.getTypeAtLocation(member.type), checker, sourceFilePath) :
              convertTypeToAST(checker.getReturnTypeOfSignature(checker.getSignatureFromDeclaration(member)!), checker, sourceFilePath);

            result.push({
              kind: 'class-method',
              name: methodName,
              declaredType: declaredType,
              parameters,
              returnType,
              jsdocDecorator,
              sourceLocation: getSourceLocation(member, sourceFilePath)
            });
          }
        });
      }

      // Handle function declarations
      if (ts.isFunctionDeclaration(node) && node.name) {
        const functionName = node.name.text;
        const jsdocDecorator = extractJSDocDecorator(node);

        // Extract parameter types using AST
        const parameters = node.parameters.map(param => {
          const paramType = checker.getTypeAtLocation(param);
          const isRestParameter = !!(param.dotDotDotToken);
          return {
            name: (param.name as ts.Identifier).text,
            type: convertTypeToAST(paramType, checker, sourceFilePath),
            isRestParameter
          };
        });

        // Extract return type using AST
        const returnType = node.type ? 
          convertTypeToAST(checker.getTypeAtLocation(node.type), checker, sourceFilePath) :
          convertTypeToAST(checker.getReturnTypeOfSignature(checker.getSignatureFromDeclaration(node)!), checker, sourceFilePath);

        result.push({
          kind: 'function',
          name: functionName,
          parameters,
          returnType,
          jsdocDecorator,
          sourceLocation: getSourceLocation(node, sourceFilePath)
        });
      }

      // Handle variable declarations with arrow functions
      if (ts.isVariableStatement(node)) {
        node.declarationList.declarations.forEach(declaration => {
          if (ts.isVariableDeclaration(declaration) && 
              declaration.name && ts.isIdentifier(declaration.name) &&
              declaration.initializer && ts.isArrowFunction(declaration.initializer)) {
            
            const functionName = declaration.name.text;
            const jsdocDecorator = extractJSDocDecorator(node);
            const arrowFunc = declaration.initializer;
            
            // Extract parameter types using AST
            const parameters = arrowFunc.parameters.map(param => {
              const paramType = checker.getTypeAtLocation(param);
              const isRestParameter = !!(param.dotDotDotToken);
              return {
                name: (param.name as ts.Identifier).text,
                type: convertTypeToAST(paramType, checker, sourceFilePath),
                isRestParameter
              };
            });

            // Extract return type using AST
            const returnType = arrowFunc.type ? 
              convertTypeToAST(checker.getTypeAtLocation(arrowFunc.type), checker, sourceFilePath) :
              convertTypeToAST(checker.getReturnTypeOfSignature(checker.getSignatureFromDeclaration(arrowFunc)!), checker, sourceFilePath);
            
            result.push({
              kind: 'arrow-function',
              name: functionName,
              parameters,
              returnType,
              jsdocDecorator,
              sourceLocation: getSourceLocation(declaration, sourceFilePath)
            });
          }
        });
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return result;
};

/**
 * Load the TypeScript configuration object from a file or from an object
 * @param tsConfigPath Path to the tsconfig.json file
 * @returns TypeScript configuration object
 */
export const loadTsConfig = (tsConfig: string | any, baseDir: string): any => {
  if (typeof tsConfig === 'string') {
    const tsConfigPath = resolve(baseDir, tsConfig);
    const configPath = ts.findConfigFile(tsConfigPath, ts.sys.fileExists, "tsconfig.json");
    if (!configPath) {
      throw new Error(`tsconfig.json not found in ${tsConfigPath}`);
    }
    const configFile = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
    if (!configFile.config) {
      throw new Error(`Failed to load TypeScript configuration from ${tsConfigPath}: ${configFile.error}`);
    }
    return configFile.config;
  }
  return tsConfig;
};
