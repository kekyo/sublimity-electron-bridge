import * as ts from 'typescript';
import { join, resolve } from 'path';
import { existsSync, readFileSync } from 'fs';

/**
 * Position information within source code
 */
export interface SourceLocation {
  /** File path */
  fileName: string;
  /** Package name if available */
  packageName: string | undefined;
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
  sourceLocation: SourceLocation | undefined;
}

/**
 * Base interface for type AST
 */
export interface TypeNode extends SourceCodeFragment {
  kind: 'primitive' | 'interface' | 'function' | 'array' | 'type-reference' | 'type-alias' | 'generic-parameter' | 'or' | 'and' | 'unknown';
  typeString: string;
}

/**
 * Primitive type node
 */
export interface PrimitiveTypeNode extends TypeNode {
  kind: 'primitive';
  type: 'string' | 'number' | 'boolean' | 'null' | 'undefined' | 'void' | 'any' | 'bigint' | 'symbol';
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
 * Generic parameter type node
 */
export interface GenericParameterTypeNode extends TypeNode {
  kind: 'generic-parameter';
  name: string;
}

/**
 * Type alias node
 */
export interface TypeAliasNode extends TypeNode {
  kind: 'type-alias';
  name: string;
  typeArguments?: TypeAST[];
}

/**
 * Binary expression abstract node
 */
export interface BinaryExpression extends TypeNode {
  left: TypeAST;
  right: TypeAST;
}

/**
 * Type OR expression node
 */
export interface TypeOrExpressionNode extends BinaryExpression {
  kind: 'or';
}

/**
 * Type AND expression node
 */
export interface TypeAndExpressionNode extends BinaryExpression {
  kind: 'and';
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
export type TypeAST =
  PrimitiveTypeNode | InterfaceTypeNode | TypeReferenceTypeNode | TypeAliasNode |
  FunctionTypeNode | ArrayTypeNode | GenericParameterTypeNode |
  TypeOrExpressionNode | TypeAndExpressionNode | UnknownTypeNode;

///////////////////////////////////////////////////////////////////////////

/**
 * Function information for AST
 */
export interface FunctionInfo extends SourceCodeFragment {
  kind: 'class-method' | 'function' | 'arrow-function';
  name: string;
  declaredType?: TypeAST;
  type: FunctionTypeNode;
  jsdocDecorator?: JSDocDecorator;
}

///////////////////////////////////////////////////////////////////////////

/**
 * Get package name from the path.
 * @param path Path to the package.
 * @returns Package name.
 */
const getPackageNameFromPath = (path: string): string | undefined => {
  // If path point to 'node_modules' directory:
  let moduleName: string | undefined;
  const parts = path.split('/');
  const indexOfNodeModuleDir = parts.indexOf('node_modules');
  // Read module's package.json file name.
  if (indexOfNodeModuleDir !== -1) {
    // '/foo/node_modules/bar/package.json'
    const packageJsonPath = join(parts.slice(0, indexOfNodeModuleDir + 1 + 1).join('/'), 'package.json');
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
        moduleName = packageJson.name;
      } catch {
        // Ignore error.
      }
    }
    // Fallback to the directory name.
    if (!moduleName) {
      moduleName = parts.at(indexOfNodeModuleDir + 1);
    }
  }
  return moduleName;
};

/**
 * Extract location information from TypeScript Node
 * @param node TypeScript Node
 * @returns SourceLocation
 */
const getSourceLocation = (node: ts.Node | undefined): SourceLocation | undefined => {
  if (!node) {
    return undefined;
  }

  const sourceFile = node.getSourceFile();
  const fileName = sourceFile.fileName;

  // Get module name from the source file.
  // When not available, try to get it from 'node_modules' directory.
  const packageName = sourceFile.moduleName ?? getPackageNameFromPath(fileName);

  // When source file is available
  if (sourceFile) {
    const start = node.getStart();
    const end = node.getEnd();
    const startPos = sourceFile.getLineAndCharacterOfPosition(start);
    const endPos = sourceFile.getLineAndCharacterOfPosition(end);
    
    // Return exact information
    return {
      fileName,
      packageName,
      startLine: startPos.line + 1, // Convert to 1-based
      startColumn: startPos.character,
      endLine: endPos.line + 1, // Convert to 1-based
      endColumn: endPos.character
    };
  }
  
  return {
    fileName,
    packageName,
    startLine: 1,
    startColumn: 0,
    endLine: 1,
    endColumn: 0
  };
};

const setPrimitiveType = (
  typeAST: TypeAST,
  type: 'string' | 'number' | 'boolean' | 'null' | 'undefined' | 'void' | 'any' | 'bigint' | 'symbol',
  currentLocation: SourceLocation | undefined) => {
  const primitiveTypeNode = typeAST as PrimitiveTypeNode;
  primitiveTypeNode.kind = 'primitive';
  primitiveTypeNode.type = type;
  primitiveTypeNode.typeString = type;
  primitiveTypeNode.sourceLocation = currentLocation;
  return primitiveTypeNode;
};

/**
 * Convert TypeScript type to TypeAST
 * @param type TypeScript type
 * @param checker TypeChecker
 * @param parentLocation Parent processed location
 * @param visitedTypes Track visited interfaces to avoid circular references
 * @returns TypeAST
 */
const convertTypeToAST = (
  type: ts.Type,
  checker: ts.TypeChecker,
  parentLocation: SourceLocation | undefined,
  visitedTypes: Map<ts.Type, TypeAST>): TypeAST => {

  // Check if the type has already been visited
  let typeAST = visitedTypes.get(type);
  if (typeAST) {
    // Return the cached typeAST
    return typeAST;
  }

  // Preallocate the typeAST
  typeAST = { } as TypeAST;
  visitedTypes.set(type, typeAST);

  //------------------------------------------------

  const typeString = checker.typeToString(type);

  // Get source location from the type, or use the parent location if not available
  const currentLocation = getSourceLocation(
    type.aliasSymbol?.declarations?.at(0) ??
    type.symbol?.declarations?.at(0)) ??
    parentLocation;

  // Handle type alias
  if (type.aliasSymbol) {
    const typeArguments = type.aliasTypeArguments?.map(arg =>
      convertTypeToAST(arg, checker, currentLocation, visitedTypes));

    const typeAliasNode = typeAST as TypeAliasNode;
    typeAliasNode.kind = 'type-alias';
    typeAliasNode.name = typeString;
    typeAliasNode.typeArguments = typeArguments;
    typeAliasNode.typeString = typeString;
    typeAliasNode.sourceLocation = currentLocation;
    return typeAliasNode;
  }

  // Determine primitive types
  if (type.flags & ts.TypeFlags.String) {
    return setPrimitiveType(typeAST, 'string', currentLocation);
  }
  if (type.flags & ts.TypeFlags.Number) {
    return setPrimitiveType(typeAST, 'number', currentLocation);
  }
  if (type.flags & ts.TypeFlags.Boolean) {
    return setPrimitiveType(typeAST, 'boolean', currentLocation);
  }
  if (type.flags & ts.TypeFlags.Null) {
    return setPrimitiveType(typeAST, 'null', currentLocation);
  }
  if (type.flags & ts.TypeFlags.Undefined) {
    return setPrimitiveType(typeAST, 'undefined', currentLocation);
  }
  if (type.flags & ts.TypeFlags.Void) {
    return setPrimitiveType(typeAST, 'void', currentLocation);
  }
  if (type.flags & ts.TypeFlags.Any) {
    return setPrimitiveType(typeAST, 'any', currentLocation);
  }
  if (type.flags & ts.TypeFlags.BigInt) {
    return setPrimitiveType(typeAST, 'bigint', currentLocation);
  }
  if (type.flags & ts.TypeFlags.ESSymbol) {
    return setPrimitiveType(typeAST, 'symbol', currentLocation);
  }

  // Determine array types
  if (checker.isArrayType(type)) {
    const typeArguments = checker.getTypeArguments(type as ts.TypeReference);
    const elementType = typeArguments && typeArguments.length > 0 ? typeArguments[0] : checker.getAnyType();

    const arrayTypeNode = typeAST as ArrayTypeNode;
    arrayTypeNode.kind = 'array';
    arrayTypeNode.elementType = convertTypeToAST(elementType, checker, currentLocation, visitedTypes);
    arrayTypeNode.typeString = typeString;
    arrayTypeNode.sourceLocation = currentLocation;
    return arrayTypeNode;
  }

  // Determine generic types (TypeReference with type arguments)
  if (type.flags & ts.TypeFlags.Object && (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference) {
    const typeRef = type as ts.TypeReference;
    const typeArgs = checker.getTypeArguments(typeRef);

    if (typeArgs && typeArgs.length > 0) {
      // Get base type name
      const symbol = type.symbol || type.aliasSymbol;
      const baseName = symbol ? symbol.getName() : 'Unknown';

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
              const paramLocation = getSourceLocation(typeParam) ?? currentLocation;

              return convertTypeToAST(paramType, checker, paramLocation, visitedTypes);
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
        originalTypeParameters = typeArgs.map((typeArg, index) => ({
          kind: 'unknown' as const,
          typeString: `T${index}`,
          sourceLocation: getSourceLocation(
            typeArg.aliasSymbol?.declarations?.at(0) ??
            typeArg.symbol?.declarations?.at(0)) ?? currentLocation
        }));

        // Generate the referenced type string using the typeString from the created TypeNodes
        const typeParamNames = originalTypeParameters.map(tp => tp.typeString).join(', ');
        referencedTypeString = `${baseName}<${typeParamNames}>`;
      }

      // Convert type arguments for the type reference
      const typeArguments = typeArgs.map(typeArg => 
        convertTypeToAST(
          typeArg,
          checker,
          getSourceLocation(
            typeArg.aliasSymbol?.declarations?.at(0) ??
            typeArg.symbol?.declarations?.at(0)) ?? currentLocation,
          visitedTypes)
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
        sourceLocation: currentLocation,
        typeParameters: originalTypeParameters.length > 0 ? originalTypeParameters : undefined,
        jsdocDecorator
      };

      const typeReferenceTypeNode = typeAST as TypeReferenceTypeNode;
      typeReferenceTypeNode.kind = 'type-reference';
      typeReferenceTypeNode.referencedType = referencedType;
      typeReferenceTypeNode.typeArguments = typeArguments;
      typeReferenceTypeNode.typeString = typeString;
      typeReferenceTypeNode.sourceLocation = currentLocation;
      return typeReferenceTypeNode;
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

      const functionParameterNode: FunctionParameterNode = {
        name: param.getName(),
        type: convertTypeToAST(paramType, checker, currentLocation, visitedTypes),
        isRestParameter
      };
      return functionParameterNode;
    });

    const returnType = checker.getReturnTypeOfSignature(signature);

    const functionTypeNode = typeAST as FunctionTypeNode;
    functionTypeNode.kind = 'function';
    functionTypeNode.parameters = parameters;
    functionTypeNode.returnType = convertTypeToAST(returnType, checker, currentLocation, visitedTypes);
    functionTypeNode.typeString = typeString;
    functionTypeNode.sourceLocation = currentLocation;
  }

  // Determine anonymous function types
  if (type.flags & ts.TypeFlags.Object && (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Anonymous) {
    const signature = (type as ts.ObjectType).getCallSignatures()[0];
    if (!signature) {
      console.log(type);
    }
    const parameters = signature.getParameters().map(param => {
      const paramType = checker.getTypeOfSymbolAtLocation(param, param.valueDeclaration!);

      // Determine rest parameters
      const declaration = param.valueDeclaration as ts.ParameterDeclaration;
      const isRestParameter = !!(declaration && declaration.dotDotDotToken);

      const functionParameterNode: FunctionParameterNode = {
        name: param.getName(),
        type: convertTypeToAST(paramType, checker, currentLocation, visitedTypes),
        isRestParameter
      };
      return functionParameterNode;
    });

    const returnType = checker.getReturnTypeOfSignature(signature);

    const functionTypeNode = typeAST as FunctionTypeNode;
    functionTypeNode.kind = 'function';
    functionTypeNode.parameters = parameters;
    functionTypeNode.returnType = convertTypeToAST(returnType, checker, currentLocation, visitedTypes);
    functionTypeNode.typeString = typeString;
    functionTypeNode.sourceLocation = currentLocation;
    return functionTypeNode;
  }

  // Determine interface types
  if (type.symbol && (type.symbol.flags & ts.SymbolFlags.Interface)) {
    const interfaceName = type.symbol.getName();
    
    const properties = checker.getPropertiesOfType(type).map(prop => {
      const propType = checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration!);
      const isOptional = (prop.getFlags() & ts.SymbolFlags.Optional) !== 0;
      const propLocation = getSourceLocation(prop?.declarations?.at(0)) ?? currentLocation;

      const propertyNode: PropertyNode = {
        name: prop.getName(),
        type: convertTypeToAST(propType, checker, propLocation, visitedTypes),
        isOptional
      };
      return propertyNode;
    });

    const interfaceTypeNode = typeAST as InterfaceTypeNode;
    interfaceTypeNode.kind = 'interface';
    interfaceTypeNode.name = interfaceName;
    interfaceTypeNode.properties = properties;
    interfaceTypeNode.typeString = checker.typeToString(type);
    interfaceTypeNode.sourceLocation = currentLocation;
    return interfaceTypeNode;
  }

  // Determine generic parameter types
  if (type.flags & ts.TypeFlags.TypeParameter) {
    const typeParameter = type as ts.TypeParameter;
    const genericParameterTypeNode = typeAST as GenericParameterTypeNode;
    genericParameterTypeNode.kind = 'generic-parameter';
    genericParameterTypeNode.name = typeParameter.symbol.getName();
    genericParameterTypeNode.typeString = checker.typeToString(type);
    genericParameterTypeNode.sourceLocation = currentLocation;
    return genericParameterTypeNode;
  }

  // Determine type OR expression
  if (type.flags & ts.TypeFlags.Union) {
    const unionType = type as ts.UnionType;
    const typeOrExpressionNode = typeAST as TypeOrExpressionNode;
    typeOrExpressionNode.kind = 'or';
    typeOrExpressionNode.left = convertTypeToAST(unionType.types[0], checker, currentLocation, visitedTypes);
    typeOrExpressionNode.right = convertTypeToAST(unionType.types[1], checker, currentLocation, visitedTypes);
    typeOrExpressionNode.typeString = checker.typeToString(type);
    typeOrExpressionNode.sourceLocation = currentLocation;
    return typeOrExpressionNode;
  }
 
  // Determine type AND expression
  if (type.flags & ts.TypeFlags.Intersection) {
    const intersectionType = type as ts.IntersectionType;
    const typeAndExpressionNode = typeAST as TypeAndExpressionNode;
    typeAndExpressionNode.kind = 'and';
    typeAndExpressionNode.left = convertTypeToAST(intersectionType.types[0], checker, currentLocation, visitedTypes);
    typeAndExpressionNode.right = convertTypeToAST(intersectionType.types[1], checker, currentLocation, visitedTypes);
    typeAndExpressionNode.typeString = checker.typeToString(type);
    typeAndExpressionNode.sourceLocation = currentLocation;
    return typeAndExpressionNode;
  }
 
  // Other types are treated as unknown types
  const unknownTypeNode = typeAST as UnknownTypeNode;
  unknownTypeNode.kind = 'unknown';
  unknownTypeNode.typeString = typeString;
  unknownTypeNode.sourceLocation = currentLocation;
  return unknownTypeNode;
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
    baseDir
  );

  // Generate Program for entire project (including all files)
  const allFiles = [...new Set([...parsedConfig.fileNames, ...sourceFilePaths])];
  const program = ts.createProgram({
    rootNames: allFiles,
    options: parsedConfig.options,
  });

  const checker = program.getTypeChecker();
  const result: FunctionInfo[] = [];
  const visitedTypes = new Map<ts.Type, TypeAST>();

  // Process each file
  for (const sourceFilePath of sourceFilePaths) {
    const sourceFile = program.getSourceFile(sourceFilePath);
    if (!sourceFile) {
      console.warn(`File not found: ${sourceFilePath}`);
      continue;
    }

    const currentLocation = getSourceLocation(sourceFile);

    // Visit all nodes in the source file
    const visit = (node: ts.Node): void => {
      // Handle class methods
      if (ts.isClassDeclaration(node) && node.name) {
        const declaredType = convertTypeToAST(
          checker.getTypeAtLocation(node), checker, currentLocation, visitedTypes);
        
        node.members.forEach(member => {
          if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
            const methodName = member.name.text;
            const jsdocDecorator = extractJSDocDecorator(member);
            
            const functionType = convertTypeToAST(
              checker.getTypeAtLocation(member), checker, currentLocation, visitedTypes) as FunctionTypeNode;

            result.push({
              kind: 'class-method',
              name: methodName,
              declaredType: declaredType,
              type: functionType,
              jsdocDecorator,
              sourceLocation: getSourceLocation(member) ?? currentLocation
            });
          }
        });
      }

      // Handle function declarations
      if (ts.isFunctionDeclaration(node) && node.name) {
        const functionName = node.name.text;
        const jsdocDecorator = extractJSDocDecorator(node);

        const functionType = convertTypeToAST(
          checker.getTypeAtLocation(node), checker, currentLocation, visitedTypes) as FunctionTypeNode;

        result.push({
          kind: 'function',
          name: functionName,
          type: functionType,
          jsdocDecorator,
          sourceLocation: getSourceLocation(node) ?? currentLocation
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

            const functionType = convertTypeToAST(
              checker.getTypeAtLocation(arrowFunc), checker, currentLocation, visitedTypes) as FunctionTypeNode;
            
            result.push({
              kind: 'arrow-function',
              name: functionName,
              type: functionType,
              jsdocDecorator,
              sourceLocation: getSourceLocation(declaration) ?? currentLocation
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
