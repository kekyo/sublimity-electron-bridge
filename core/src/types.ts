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
