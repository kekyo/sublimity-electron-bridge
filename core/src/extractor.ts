import * as ts from 'typescript';
import * as path from 'path';

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
 * Base interface for type AST
 */
export interface TypeNode {
  kind: 'primitive' | 'interface' | 'function' | 'array' | 'type-reference' | 'unknown';
  typeString: string;
  sourceLocation: SourceLocation;
}

/**
 * Primitive type node
 */
export interface PrimitiveTypeNode extends TypeNode {
  kind: 'primitive';
  type: 'string' | 'number' | 'boolean' | 'null' | 'undefined' | 'void' | 'any' | 'bigint' | 'symbol' | 'buffer';
}

/**
 * Interface type node
 */
export interface InterfaceTypeNode extends TypeNode {
  kind: 'interface';
  name: string;
  properties: InterfaceProperty[];
  targetLibrary?: string;
  nativeTypeName?: string;
  typeParameters?: TypeNode[];
}

/**
 * Type reference node (for generic type instantiation)
 */
export interface TypeReferenceTypeNode extends TypeNode {
  kind: 'type-reference';
  referencedType: TypeNode;
  typeArguments?: TypeNode[];
}

/**
 * Function type node
 */
export interface FunctionTypeNode extends TypeNode {
  kind: 'function';
  parameters: FunctionParameter[];
  returnType: TypeNode;
}

/**
 * Array type node
 */
export interface ArrayTypeNode extends TypeNode {
  kind: 'array';
  elementType: TypeNode;
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
 * Function parameter information
 */
export interface FunctionParameter {
  name: string;
  type: TypeAST;
  isRestParameter: boolean;
}

/**
 * Interface property information
 */
export interface InterfaceProperty {
  name: string;
  type: TypeAST;
  isOptional: boolean;
}

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
      let nativeTypeName: string | undefined = undefined;
      let targetLibrary: string | undefined = undefined;
      
      if (symbol && symbol.declarations && symbol.declarations.length > 0) {
        const declaration = symbol.declarations[0];
        const decoratorInfo = extractJSDocDecorator(declaration);
        if (decoratorInfo) {
          nativeTypeName = decoratorInfo.nativeTypeName;
          targetLibrary = decoratorInfo.targetLibrary;
        }
      }
      
      const referencedType: InterfaceTypeNode = {
        kind: 'interface',
        name: baseName,
        properties: [],
        typeString: referencedTypeString,
        sourceLocation: referencedTypeSourceLocation,
        typeParameters: originalTypeParameters.length > 0 ? originalTypeParameters : undefined,
        nativeTypeName,
        targetLibrary
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
 * Extract decorator value from JSDoc comment (for function methods)
 * @param node TypeScript Node
 * @returns {decorator: string, argument?: string} object (undefined if not found)
 */
const extractJSDocDecoratorForFunction = (node: ts.Node): {decorator: string, argument?: string} | undefined => {
  // Get JSDoc comment
  const jsDocTags = ts.getJSDocTags(node);
  
  for (const tag of jsDocTags) {
    if (tag.tagName.escapedText === 'decorator') {
      // Get @decorator tag value
      if (tag.comment) {
        const comment = typeof tag.comment === 'string' ? tag.comment : tag.comment.map(c => c.text).join('');
        // Get parameters separated by whitespace
        const params = comment.trim().split(/\s+/).filter(param => param.length > 0);
        if (params.length > 0) {
          const decorator = params[0];
          const argument = params.length > 1 ? params.slice(1).join(' ') : undefined;
          return { decorator, argument };
        }
      }
    }
  }
  
  return undefined;
};

/**
 * Extract decorator value from JSDoc comment (for interfaces)
 * @param node TypeScript Node
 * @returns {decorator: string, targetLibrary?: string, nativeTypeName?: string} object (null if not found)
 */
const extractJSDocDecorator = (node: ts.Node): {decorator: string, targetLibrary?: string, nativeTypeName?: string} | null => {
  // Get JSDoc comment
  const jsDocTags = ts.getJSDocTags(node);
  
  for (const tag of jsDocTags) {
    if (tag.tagName.escapedText === 'decorator') {
      // Get @decorator tag value
      if (tag.comment) {
        const comment = typeof tag.comment === 'string' ? tag.comment : tag.comment.map(c => c.text).join('');
        // Get parameters separated by whitespace
        const params = comment.trim().split(/\s+/).filter(param => param.length > 0);
        if (params.length > 0) {
          const decorator = params[0];
          
          if (decorator === 'native-type') {
            // Handle @decorator native-type [typename] format
            const nativeTypeName = params.length > 1 ? params[1] : undefined;
            return { decorator, nativeTypeName };
          } else {
            // Handle existing format @decorator xxx yyy
            const targetLibrary = params.length > 1 ? params[1] : undefined;
            return { decorator, targetLibrary };
          }
        }
      }
    }
  }
  
  return null;
};

/**
 * Extract interface definitions from source code at specified paths
 * @param tsConfigPath Path to tsconfig.json
 * @param sourceFilePaths Array of source code paths
 * @param targetDecorator Target decorator name (required)
 * @returns Array of extracted interface information (flattened from all files)
 */
export const extractInterfaces = (tsConfigPath: string, sourceFilePaths: string[], targetDecorator: string): InterfaceTypeNode[] => {
  // Input validation
  if (!sourceFilePaths || sourceFilePaths.length === 0) {
    throw new Error('Source file paths are not specified');
  }

  if (!targetDecorator || targetDecorator.trim().length === 0) {
    throw new Error('targetDecorator is not specified');
  }

  // Find tsconfig.json path
  const configPath = ts.findConfigFile(tsConfigPath, ts.sys.fileExists, "tsconfig.json");
  if (!configPath) {
    throw new Error("tsconfig.json not found");
  }

  // Read and parse tsconfig.json
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(configPath)
  );

  // Generate Program for entire project (including all files)
  const allFiles = [...new Set([...parsedConfig.fileNames, ...sourceFilePaths])];
  const program = ts.createProgram({
    rootNames: allFiles,
    options: parsedConfig.options,
  });

  const checker = program.getTypeChecker();
  const result: InterfaceTypeNode[] = [];

  // Process each file
  for (const sourceFilePath of sourceFilePaths) {
    const sourceFile = program.getSourceFile(sourceFilePath);
    if (!sourceFile) {
      console.warn(`File not found: ${sourceFilePath}`);
      continue;
    }

    // Get all interface declarations in the file
    const interfaceDeclarations = sourceFile.statements.filter(
      (statement) => ts.isInterfaceDeclaration(statement)
    ) as ts.InterfaceDeclaration[];

    // Process each interface
    for (const interfaceDeclaration of interfaceDeclarations) {
      // Decorator filtering (required)
      const decoratorInfo = extractJSDocDecorator(interfaceDeclaration);
      if (!decoratorInfo || decoratorInfo.decorator !== targetDecorator) {
        continue; // Skip if conditions are not met
      }

      // Handle native-type decorator
      if (decoratorInfo.decorator === 'native-type') {
        try {
          // AST conversion only when conditions are met (heavy processing)
          const type = checker.getTypeAtLocation(interfaceDeclaration);
          const interfaceAST = convertTypeToAST(type, checker, sourceFilePath) as InterfaceTypeNode;
          
          // Set nativeTypeName (use provided name or interface name as fallback)
          interfaceAST.nativeTypeName = decoratorInfo.nativeTypeName || interfaceAST.name;
          
          result.push(interfaceAST);
        } catch (error) {
          console.warn(`Interface processing error: ${interfaceDeclaration.name?.getText()}`, error);
          continue;
        }
      } else {
        // Handle existing decorator format
        // targetLibrary is required
        if (!decoratorInfo.targetLibrary) {
          const interfaceName = interfaceDeclaration.name?.getText() || 'Unknown';
          throw new Error(`Interface '${interfaceName}' with @decorator ${targetDecorator} does not specify targetLibrary`);
        }

        try {
          // AST conversion only when conditions are met (heavy processing)
          const type = checker.getTypeAtLocation(interfaceDeclaration);
          const interfaceAST = convertTypeToAST(type, checker, sourceFilePath) as InterfaceTypeNode;
          
          // Set targetLibrary
          interfaceAST.targetLibrary = decoratorInfo.targetLibrary;
          
          result.push(interfaceAST);
        } catch (error) {
          console.warn(`Interface processing error: ${interfaceDeclaration.name?.getText()}`, error);
          continue;
        }
      }
    }
  }

  // Validate result
  if (result.length === 0) {
    throw new Error(`No interfaces found with decorator '@decorator ${targetDecorator}'`);
  }

  return result;
};

/**
 * Function method information for AST
 */
export interface FunctionMethodInfo {
  kind: 'class-method' | 'function' | 'arrow-function';
  name: string;
  className?: string;
  parameters: FunctionParameter[];
  returnType: TypeAST;
  decoratorInfo?: {decorator: string, argument?: string};
  sourceLocation: SourceLocation;
  filePath: string;
}

/**
 * Extract function methods from source code at specified paths
 * @param tsConfigPath Path to tsconfig.json
 * @param sourceFilePaths Array of source code paths
 * @returns Array of extracted function method information with complete AST data
 */
export const extractFunctionMethods = (tsConfigPath: string, sourceFilePaths: string[]): FunctionMethodInfo[] => {
  // Input validation
  if (!sourceFilePaths || sourceFilePaths.length === 0) {
    throw new Error('Source file paths are not specified');
  }

  // Find tsconfig.json path
  const configPath = ts.findConfigFile(tsConfigPath, ts.sys.fileExists, "tsconfig.json");
  if (!configPath) {
    throw new Error("tsconfig.json not found");
  }

  // Read and parse tsconfig.json
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(configPath)
  );

  // Generate Program for entire project (including all files)
  const allFiles = [...new Set([...parsedConfig.fileNames, ...sourceFilePaths])];
  const program = ts.createProgram({
    rootNames: allFiles,
    options: parsedConfig.options,
  });

  const checker = program.getTypeChecker();
  const result: FunctionMethodInfo[] = [];

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
        const className = node.name.text;
        
        node.members.forEach(member => {
          if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
            const methodName = member.name.text;
            const decoratorInfo = extractJSDocDecoratorForFunction(member);
            
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
              className,
              parameters,
              returnType,
              decoratorInfo,
              sourceLocation: getSourceLocation(member, sourceFilePath),
              filePath: sourceFilePath
            });
          }
        });
      }
      
      // Handle function declarations
      if (ts.isFunctionDeclaration(node) && node.name) {
        const functionName = node.name.text;
        const decoratorInfo = extractJSDocDecoratorForFunction(node);
        
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
          decoratorInfo,
          sourceLocation: getSourceLocation(node, sourceFilePath),
          filePath: sourceFilePath
        });
      }
      
      // Handle variable declarations with arrow functions
      if (ts.isVariableStatement(node)) {
        node.declarationList.declarations.forEach(declaration => {
          if (ts.isVariableDeclaration(declaration) && 
              declaration.name && ts.isIdentifier(declaration.name) &&
              declaration.initializer && ts.isArrowFunction(declaration.initializer)) {
            
            const functionName = declaration.name.text;
            const decoratorInfo = extractJSDocDecoratorForFunction(node);
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
              decoratorInfo,
              sourceLocation: getSourceLocation(declaration, sourceFilePath),
              filePath: sourceFilePath
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
