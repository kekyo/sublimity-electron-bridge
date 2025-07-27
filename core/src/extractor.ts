// sublimity-electron-bridge - Sublimity electron IPC bridge
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/sublimity-electron-bridge/

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
  kind: 'primitive' | 'interface' | 'object' | 'enum' | 'enum-value' | 'function' | 'array' | 'type-reference' | 'type-alias' | 'generic-parameter' | 'or' | 'and' | 'unknown';
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
 * Naming member base node
 */
export interface NamingMemberNode extends SourceCodeFragment {
  name: string;
  type: TypeAST;
  isOptional: boolean;
  memberString: string;
}

/**
 * Interface property information
 */
export interface PropertyNode extends NamingMemberNode {
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
 * (Anonymous) Object type node
 */
export interface ObjectTypeNode extends TypeNode {
  kind: 'object';
  properties: PropertyNode[];
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
 * Enum type node
 */
export interface EnumTypeNode extends TypeNode {
  kind: 'enum';
  name: string;
  values: EnumValueNode[];
}

/**
 * Enum value node
 */
export interface EnumValueNode extends TypeNode {
  kind: 'enum-value';
  name: string;
  value: string | number | bigint;
  underlyingType: EnumTypeNode;
}

/**
 * Function parameter information
 */
export interface FunctionParameterNode extends NamingMemberNode {
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
 * Operator expression abstract node
 */
export interface OperatorExpression extends TypeNode {
  args: TypeAST[];
}

/**
 * Type OR expression node
 */
export interface OrTypeNode extends OperatorExpression {
  kind: 'or';
}

/**
 * Type AND expression node
 */
export interface AndTypeNode extends OperatorExpression {
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
  PrimitiveTypeNode | InterfaceTypeNode | ObjectTypeNode | TypeReferenceTypeNode | TypeAliasNode |
  EnumTypeNode | EnumValueNode |
  FunctionTypeNode | ArrayTypeNode | GenericParameterTypeNode |
  OrTypeNode | AndTypeNode | UnknownTypeNode;

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
 * Extract decorator value from JSDoc comment
 * @param node TypeScript Node
 * @returns JSDocDecorator object (undefined if not found)
 */
const extractJSDocDecorator = (node: ts.Node): JSDocDecorator | undefined => {
  // Get JSDoc comment
  const jsDocTags = ts.getJSDocTags(node);
  console.log(`extractJSDocDecorator: node kind=${ts.SyntaxKind[node.kind]}, tags=${jsDocTags.length}`);
  
  for (const tag of jsDocTags) {
    console.log(`extractJSDocDecorator: tag="${tag.tagName.escapedText}", comment="${tag.comment}"`);
    if (tag.tagName.escapedText === 'decorator') {
      // Get @decorator tag value
      if (tag.comment) {
        const comment = typeof tag.comment === 'string' ? tag.comment : tag.comment.map(c => c.text).join('');
        console.log(`extractJSDocDecorator: decorator comment="${comment}"`);
        // Get parameters separated by whitespace
        const params = comment.
          trim().
          split(/\s+/).
          map(param => param.trim()).
          filter(param => param.length > 0);
        if (params.length > 0) {
          const decorator = params[0];
          const args = params.slice(1);
          console.log(`extractJSDocDecorator: found decorator="${decorator}", args=${JSON.stringify(args)}`);
          return { decorator, args };
        }
      }
    }
  }
  console.log(`extractJSDocDecorator: no decorator found`);
  return undefined;
};

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
const getSourceLocationFromNode = (node: ts.Node | undefined): SourceLocation | undefined => {
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

/**
 * Get source location from TypeScript type
 * @param type TypeScript type
 * @returns SourceLocation
 */
const getSourceLocationFromType = (type: ts.Type): SourceLocation | undefined => {
  return getSourceLocationFromNode(
    type.aliasSymbol?.declarations?.at(0) ??
    type.symbol?.declarations?.at(0));
};

/**
 * Get type parameters from signature
 * @param signature Signature
 * @param checker TypeChecker
 * @param currentLocation Current location
 * @param visitedTypes Visited types
 * @returns Type parameters
 */
const getParametersFromSignature =
  (signature: ts.Signature, checker: ts.TypeChecker, currentLocation: SourceLocation | undefined, visitedTypes: Map<ts.Type, TypeAST>): FunctionParameterNode[] => {
  return signature.parameters.map(param => {
    const name = param.getName();
    const paramType = checker.getTypeOfSymbolAtLocation(param, param.valueDeclaration!);
    const paramLocation = getSourceLocationFromType(paramType) ?? currentLocation;

    // Determine special attributes
    const declaration = param.valueDeclaration as ts.ParameterDeclaration;
    const isRestParameter = !!(declaration && declaration.dotDotDotToken);
    const isOptional = !!(declaration && declaration.questionToken);

    const functionParameterNode: FunctionParameterNode = {
      name,
      type: convertTypeToAST(paramType, checker, paramLocation, visitedTypes),
      isRestParameter,
      isOptional,
      memberString: `${name}${isOptional ? '?' : ''}${isRestParameter ? '...' : ''}`,
      sourceLocation: paramLocation
    };
    return functionParameterNode;
  });
};

/**
 * Get properties from TypeScript type
 * @param type TypeScript type
 * @param checker TypeChecker
 * @param currentLocation Current location
 * @param visitedTypes Visited types
 * @returns Properties
 */
const getPropertiesFromType =
  (type: ts.Type, checker: ts.TypeChecker, currentLocation: SourceLocation | undefined, visitedTypes: Map<ts.Type, TypeAST>): PropertyNode[] => {
  return checker.getPropertiesOfType(type).map(prop => {
    const name = prop.getName();
    const propType = checker.getTypeOfSymbolAtLocation(prop, prop.valueDeclaration!);
    const propLocation = getSourceLocationFromType(propType) ?? currentLocation;

    // Determine special attributes
    const declaration = prop.valueDeclaration as ts.PropertyDeclaration;
    const isOptional = !!(declaration && declaration.questionToken);

    const propertyNode: PropertyNode = {
      name,
      type: convertTypeToAST(propType, checker, propLocation, visitedTypes),
      isOptional,
      memberString: `${name}${isOptional ? '?' : ''}`,
      sourceLocation: propLocation
    };
    return propertyNode;
  });
};

/**
 * Set primitive type to TypeAST
 * @param typeAST TypeAST
 * @param type Primitive type
 * @param currentLocation Source location
 * @returns TypeAST
 */
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
 * Convert PseudoBigInt to bigint
 * @param pseudo PseudoBigInt
 * @returns bigint
 */
const pseudoBigIntToBigInt = (pseudo: ts.PseudoBigInt): bigint => {
  const str = pseudo.negative ? '-' + pseudo.base10Value : pseudo.base10Value;
  return BigInt(str);
};

///////////////////////////////////////////////////////////////////////////

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
  const currentLocation = getSourceLocationFromType(type) ?? parentLocation;

  // Handle type alias
  if (type.aliasSymbol) {
    const typeArguments = type.aliasTypeArguments?.map(arg => {
      const typeArgumentLocation = getSourceLocationFromType(type) ?? currentLocation;
      return convertTypeToAST(arg, checker, typeArgumentLocation, visitedTypes);
    });

    // Is enum type?
    if (type.flags == (ts.TypeFlags.EnumLiteral | ts.TypeFlags.Union)) {
      const values = (type as ts.UnionType).types.map(enumValueType => {
        const valueLocation = getSourceLocationFromType(enumValueType) ?? currentLocation;
        return convertTypeToAST(enumValueType, checker, valueLocation, visitedTypes) as EnumValueNode;
      });

      const enumTypeNode = typeAST as EnumTypeNode;
      enumTypeNode.kind = 'enum';
      enumTypeNode.name = type.aliasSymbol.escapedName ?? typeString;
      enumTypeNode.values = values;
      enumTypeNode.typeString = typeString;
      enumTypeNode.sourceLocation = currentLocation;
      return enumTypeNode;
    // Type alias
    } else {
      const typeAliasNode = typeAST as TypeAliasNode;
      typeAliasNode.kind = 'type-alias';
      typeAliasNode.name = type.aliasSymbol.escapedName ?? typeString;
      typeAliasNode.typeArguments = typeArguments;
      typeAliasNode.typeString = typeString;
      typeAliasNode.sourceLocation = currentLocation;
      return typeAliasNode;
    }
  }

  // Determine primitive types
  if (type.flags & ts.TypeFlags.String) {
    return setPrimitiveType(typeAST, 'string', undefined);
  }
  if (type.flags & ts.TypeFlags.Number) {
    return setPrimitiveType(typeAST, 'number', undefined);
  }
  if (type.flags & ts.TypeFlags.Boolean) {
    return setPrimitiveType(typeAST, 'boolean', undefined);
  }
  if (type.flags & ts.TypeFlags.Null) {
    return setPrimitiveType(typeAST, 'null', undefined);
  }
  if (type.flags & ts.TypeFlags.Undefined) {
    return setPrimitiveType(typeAST, 'undefined', undefined);
  }
  if (type.flags & ts.TypeFlags.Void) {
    return setPrimitiveType(typeAST, 'void', undefined);
  }
  if (type.flags & ts.TypeFlags.Any) {
    return setPrimitiveType(typeAST, 'any', undefined);
  }
  if (type.flags & ts.TypeFlags.BigInt) {
    return setPrimitiveType(typeAST, 'bigint', undefined);
  }
  if (type.flags & ts.TypeFlags.ESSymbol) {
    return setPrimitiveType(typeAST, 'symbol', undefined);
  }

  // Determine array types
  if (checker.isArrayType(type)) {
    const typeArguments = checker.getTypeArguments(type as ts.TypeReference);
    const elementType = typeArguments && typeArguments.length > 0 ? typeArguments[0] : checker.getAnyType();
    const elementTypeLocation = getSourceLocationFromType(elementType) ?? currentLocation;

    const arrayTypeNode = typeAST as ArrayTypeNode;
    arrayTypeNode.kind = 'array';
    arrayTypeNode.elementType = convertTypeToAST(elementType, checker, elementTypeLocation, visitedTypes);
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
              const paramLocation = getSourceLocationFromType(paramType) ?? currentLocation;

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
        originalTypeParameters = typeArgs.map((typeArg, index) => {
          const typeArgLocation = getSourceLocationFromType(typeArg) ?? currentLocation;
          return {
            kind: 'unknown' as const,
            typeString: `T${index}`,
            sourceLocation: typeArgLocation
          };
        });

        // Generate the referenced type string using the typeString from the created TypeNodes
        const typeParamNames = originalTypeParameters.map(tp => tp.typeString).join(', ');
        referencedTypeString = `${baseName}<${typeParamNames}>`;
      }

      // Convert type arguments for the type reference
      const typeArguments = typeArgs.map(typeArg => {
        const typeArgLocation = getSourceLocationFromType(typeArg) ?? currentLocation;
        return convertTypeToAST(
          typeArg,
          checker,
          typeArgLocation,
          visitedTypes);
      });

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
    const parameters = getParametersFromSignature(signature, checker, currentLocation, visitedTypes);
    const returnType = checker.getReturnTypeOfSignature(signature);
    const returnTypeLocation = getSourceLocationFromType(returnType) ?? currentLocation;

    const functionTypeNode = typeAST as FunctionTypeNode;
    functionTypeNode.kind = 'function';
    functionTypeNode.parameters = parameters;
    functionTypeNode.returnType = convertTypeToAST(returnType, checker, returnTypeLocation, visitedTypes);
    functionTypeNode.typeString = typeString;
    functionTypeNode.sourceLocation = currentLocation;
    return functionTypeNode;
  }

  // Determine anonymous types
  if (type.flags & ts.TypeFlags.Object && (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Anonymous) {
    const objectType = type as ts.ObjectType;

    // Is this anonymous function type?
    const signature = objectType.getCallSignatures()[0];
    if (signature) {
      const parameters = getParametersFromSignature(signature, checker, currentLocation, visitedTypes);
      const returnType = checker.getReturnTypeOfSignature(signature);
      const returnTypeLocation = getSourceLocationFromType(returnType) ?? currentLocation;

      const functionTypeNode = typeAST as FunctionTypeNode;
      functionTypeNode.kind = 'function';
      functionTypeNode.parameters = parameters;
      functionTypeNode.returnType = convertTypeToAST(returnType, checker, returnTypeLocation, visitedTypes);
      functionTypeNode.typeString = typeString;
      functionTypeNode.sourceLocation = currentLocation;
      return functionTypeNode;
    // Anonymous object type
    } else {
      const properties = getPropertiesFromType(objectType, checker, currentLocation, visitedTypes);

      const objectTypeNode = typeAST as ObjectTypeNode;
      objectTypeNode.kind = 'object';
      objectTypeNode.properties = properties;
      objectTypeNode.typeString = checker.typeToString(type);
      objectTypeNode.sourceLocation = currentLocation;
      return objectTypeNode;
    }
  }

  // Determine interface types
  if (type.symbol && (type.symbol.flags & ts.SymbolFlags.Interface)) {
    const interfaceType = type as ts.InterfaceType;
    const name = interfaceType.symbol.getName();
    const properties = getPropertiesFromType(interfaceType, checker, currentLocation, visitedTypes);

    const interfaceTypeNode = typeAST as InterfaceTypeNode;
    interfaceTypeNode.kind = 'interface';
    interfaceTypeNode.name = name;
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

    // Convert types to TypeAST
    const args = unionType.types.map(type => {
      const typeLocation = getSourceLocationFromType(type) ?? currentLocation;
      return convertTypeToAST(type, checker, typeLocation, visitedTypes);
    });

    // HACK: Typescript treats each value of an Enum type as a OR (Union) type.
    // So check if all values of an Enum type are included in `args`.
    // If all values of an Enum type are included in `args`, simply replace the Enum type itself.

    // Extract enum-value groups by underlyingType from args
    const enumValueInArgsGroups = new Map<EnumTypeNode, EnumValueNode[]>();
    for (const arg of args) {
      if (arg.kind == 'enum-value') {
        const enumValue = arg as EnumValueNode;
        const enumType = enumValue.underlyingType;
        let enumValuesInArgs = enumValueInArgsGroups.get(enumType);
        if (!enumValuesInArgs) {
          enumValuesInArgs = [];
          enumValueInArgsGroups.set(enumType, enumValuesInArgs);
        }
        enumValuesInArgs.push(enumValue);
      }
    }

    // Check if all enumValues of each enumType are included in args
    for (const enumType of enumValueInArgsGroups.keys()) {
      const enumValuesInArgs = enumValueInArgsGroups.get(enumType)!;
      // If all enumValues of enumType are included in args
      if (enumType.values.every(enumValue => enumValuesInArgs.some(arg => arg.name == enumValue.name))) {
        // Remove enumValuesInArgs from args
        enumValuesInArgs.forEach(enumValueInArgs => {
          args.splice(args.indexOf(enumValueInArgs), 1);
        });
        // Add enumType to args
        args.push(enumType);
      }
    }

    // If there is only one type in args, return it
    if (args.length === 1) {
      return args[0];
    // If there are multiple types in args, return an OrTypeNode
    } else {
      const OrTypeNode = typeAST as OrTypeNode;
      OrTypeNode.kind = 'or';
      OrTypeNode.args = args;
      OrTypeNode.typeString = checker.typeToString(type);
      OrTypeNode.sourceLocation = currentLocation;
      return OrTypeNode;
    }
  }
 
  // Determine type AND expression
  if (type.flags & ts.TypeFlags.Intersection) {
    const intersectionType = type as ts.IntersectionType;

    const args = intersectionType.types.map(type => {
      const typeLocation = getSourceLocationFromType(type) ?? currentLocation;
      return convertTypeToAST(type, checker, typeLocation, visitedTypes);
    });

    const AndTypeNode = typeAST as AndTypeNode;
    AndTypeNode.kind = 'and';
    AndTypeNode.args = args;
    AndTypeNode.typeString = checker.typeToString(type);
    AndTypeNode.sourceLocation = currentLocation;
    return AndTypeNode;
  }

  // Determine enum value types
  if (type.flags & ts.TypeFlags.EnumLiteral) {
    const enumType = type as ts.LiteralType;
    const name = enumType.symbol.getName();
    const value = typeof enumType.value === 'string' || typeof enumType.value === 'number' ?
      (enumType.value as string | number) :
      pseudoBigIntToBigInt(enumType.value);
    const enumDeclaration = (enumType.symbol.valueDeclaration ?? enumType.symbol.declarations?.[0])?.parent!;
    const enumUnderlyingType = checker.getTypeAtLocation(enumDeclaration);
    const enumUnderlyingTypeLocation = getSourceLocationFromType(enumUnderlyingType) ?? currentLocation;
    const underlyingType = convertTypeToAST(
      enumUnderlyingType, checker, enumUnderlyingTypeLocation, visitedTypes) as EnumTypeNode;

    const enumValueNode = typeAST as EnumValueNode;
    enumValueNode.kind = 'enum-value';
    enumValueNode.name = name;
    enumValueNode.value = value;
    enumValueNode.underlyingType = underlyingType;
    enumValueNode.typeString = checker.typeToString(type);
    enumValueNode.sourceLocation = currentLocation;
    return enumValueNode;
  }
 
  // Other types are treated as unknown types
  const unknownTypeNode = typeAST as UnknownTypeNode;
  unknownTypeNode.kind = 'unknown';
  unknownTypeNode.typeString = typeString;
  unknownTypeNode.sourceLocation = currentLocation;
  return unknownTypeNode;
};

///////////////////////////////////////////////////////////////////////////

/**
 * Extract functions from source code at specified paths
 * @param tsConfig tsconfig.json object
 * @param baseDir Base directory for resolving relative paths
 * @param sourceFilePaths Array of source code paths
 * @returns Array of extracted function information with complete AST data
 */
export const extractFunctions = (tsConfig: any, baseDir: string, sourceFilePaths: string[]): FunctionInfo[] => {
  console.log(`extractFunctions: tsConfig=${tsConfig ? 'provided' : 'null'}, baseDir=${baseDir}, sourceFilePaths=${JSON.stringify(sourceFilePaths)}`);
  
  // Parse tsconfig
  const parsedConfig = ts.parseJsonConfigFileContent(
    tsConfig,
    ts.sys,
    baseDir
  );
  console.log(`extractFunctions: parsed config, fileNames=${parsedConfig.fileNames.length}, options=${JSON.stringify(parsedConfig.options.target)}`);

  // Generate Program for entire project (including all files)
  const allFiles = [...new Set([...parsedConfig.fileNames, ...sourceFilePaths])];
  console.log(`extractFunctions: creating program with ${allFiles.length} files`);
  const program = ts.createProgram({
    rootNames: allFiles,
    options: parsedConfig.options,
  });

  const checker = program.getTypeChecker();
  const result: FunctionInfo[] = [];
  const visitedTypes = new Map<ts.Type, TypeAST>();

  // Process each file
  for (const sourceFilePath of sourceFilePaths) {
    console.log(`extractFunctions: processing ${sourceFilePath}`);
    const sourceFile = program.getSourceFile(sourceFilePath);
    if (!sourceFile) {
      console.warn(`File not found: ${sourceFilePath}`);
      continue;
    }

    const currentLocation = getSourceLocationFromNode(sourceFile);

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
              sourceLocation: getSourceLocationFromNode(member) ?? currentLocation
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
          sourceLocation: getSourceLocationFromNode(node) ?? currentLocation
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
              sourceLocation: getSourceLocationFromNode(declaration) ?? currentLocation
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
 * @param tsConfig tsconfig.json file path or object. (default: search and read tsconfig.json file)
 * @returns TypeScript configuration object
 */
export const loadTsConfig = (tsConfig: string | any | undefined, baseDir: string): any => {
  console.log(`loadTsConfig: tsConfig=${typeof tsConfig}, baseDir=${baseDir}`);
  if (!tsConfig || typeof tsConfig === 'string') {
    const tsConfigPath = tsConfig ? resolve(baseDir, tsConfig) : baseDir;
    console.log(`loadTsConfig: searching for tsconfig.json in ${tsConfigPath}`);
    const configPath = ts.findConfigFile(tsConfigPath, ts.sys.fileExists, "tsconfig.json");
    if (!configPath) {
      console.error(`loadTsConfig: tsconfig.json not found in ${tsConfigPath}`);
      throw new Error(`tsconfig.json not found in ${tsConfigPath}`);
    }
    console.log(`loadTsConfig: found tsconfig.json at ${configPath}`);
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (!configFile.config) {
      console.error(`loadTsConfig: Failed to load TypeScript configuration from ${configPath}: ${configFile.error}`);
      throw new Error(`Failed to load TypeScript configuration from ${configPath}: ${configFile.error}`);
    }
    console.log(`loadTsConfig: successfully loaded tsconfig`);
    return configFile.config;
  }
  console.log(`loadTsConfig: using provided tsconfig object`);
  return tsConfig;
};
