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
 * Electron IPC bridge generator options
 */
export interface ElectronBridgeOptions {
  /**
   * The output file path for the main process handlers
   * @remarks Default: 'src/main/generated/seb_main.ts'
   */
  mainProcessHandlerFile?: string;
  /**
   * The output file path for the preload handlers
   * @remarks Default: 'src/preload/generated/seb_preload.ts'
   */
  preloadHandlerFile?: string;
  /**
   * The file name for the type definitions
   * @remarks Default: 'src/renderer/src/generated/seb_types.ts'
   */
  typeDefinitionsFile?: string;
  /**
   * The default namespace for the exposed methods
   * @remarks Default: 'mainProcess'
   */
  defaultNamespace?: string;
  /**
   * The logger to use for the generator
   * @remarks Default: Use the console logger
   */
  logger?: Logger;
  /**
   * The base directory for the project.
   * Processor requires `./tsconfig.json` when validate exact type informations.
   * @remarks It is used to generate relative paths for the generated files.
   */
  baseDir?: string;
  /**
   * Channel prefix.
   * @remarks Default: 'seb'
   */
  channelPrefix?: string;
}

/**
 * Base type information interface
 */
export interface BaseTypeInfo {
  /**
   * The name of the type
   */
  readonly name: string;
  /**
   * The file path where the type is defined
   */
  readonly filePath?: string;
}

/**
 * Simple type node (primitives, interfaces, type aliases, etc.)
 */
export interface SimpleTypeInfo extends BaseTypeInfo {
  readonly kind: 'simple';
}

/**
 * Array type node
 */
export interface ArrayTypeInfo extends BaseTypeInfo {
  readonly kind: 'array';
  /**
   * Element type of the array
   */
  readonly elementType: TypeInfo;
}

/**
 * Generic type node with type arguments
 */
export interface GenericTypeInfo extends BaseTypeInfo {
  readonly kind: 'generic';
  /**
   * Type arguments for the generic type
   */
  readonly typeArguments: TypeInfo[];
}

/**
 * Other complex type node
 */
export interface OtherTypeInfo extends BaseTypeInfo {
  readonly kind: 'other';
}

/**
 * Union type for all type information
 */
export type TypeInfo = SimpleTypeInfo | ArrayTypeInfo | GenericTypeInfo | OtherTypeInfo;

/**
 * Exposed method interface
 */
export interface ExposedMethod {
  /**
   * The declared type of the method
   */
  readonly declaredType?: TypeInfo
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
  readonly parameters: { name: string; type: TypeInfo }[]
  /**
   * The return type of the method
   */
  readonly returnType: TypeInfo
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
  readonly analyzeFile: (filePath: string, code: string) => Promise<ExposedMethod[]>;
  /**
   * Generate the files for the exposed methods
   * @param methods - The exposed methods
   */
  readonly generateFiles: (methods: ExposedMethod[]) => Promise<void>;
}
