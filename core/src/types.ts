import { FunctionInfo } from "./extractor";

/**
 * Logger interface
 */
export interface Logger {
  /**
   * Log an debug message
   * @param msg - The message to log
   */
  readonly debug: (msg: string) => void;
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
   * The logger to use for the generator
   * @remarks Default: Use the console logger
   */
  logger?: Logger;
  /**
   * The base directory for the project.
   * @remarks It is used to generate relative paths for the generated files.
   */
  baseDir: string;
  /**
   * The TypeScript configuration object or path to the tsconfig.json file
   * @remarks Default: Use the default TypeScript configuration file from `tsconfig.json` file.
   */
  tsConfig?: any | string;
  /**
   * The default namespace for the exposed methods
   * @remarks Default: 'mainProcess'
   */
  defaultNamespace?: string;
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
}

/**
 * Electron bridge generator interface
 */
export interface ElectronBridgeGenerator {
  /**
   * Analyze multiple files and extract exposed functions using the new extractor
   * @param filePaths - Array of file paths to analyze
   * @returns The exposed functions
   */
  readonly analyzeFiles: (filePaths: string[]) => Promise<FunctionInfo[]>;
  /**
   * Generate the files for the exposed functions
   * @param functions - The exposed functions
   */
  readonly generateFiles: (functions: FunctionInfo[]) => Promise<void>;
}
