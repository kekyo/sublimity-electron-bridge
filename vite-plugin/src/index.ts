import type { Plugin } from 'vite';
import { createElectronBridgeGenerator, createConsoleLogger, type ElectronBridgeOptions, type Logger } from '../../core/src/index.ts';
import { Worker } from 'worker_threads';
import { promises as fs } from 'fs';
import { glob } from 'glob';
import { createRequire } from 'module';

///////////////////////////////////////////////////////////////////////

const collectSourceFiles = async (options: ElectronBridgeOptions & { sourceFiles?: string[] }): Promise<string[]> => {
  // If sourceFiles are explicitly provided, use them
  if (options.sourceFiles) {
    return options.sourceFiles;
  }

  // Default source patterns
  const defaultPatterns = [
    'src/**/*.ts',
    'src/**/*.tsx',
    'lib/**/*.ts', 
    'lib/**/*.tsx'
  ];
  
  const allFiles: string[] = [];
  
  for (const pattern of defaultPatterns) {
    try {
      const files = await glob(pattern, { 
        ignore: ['**/node_modules/**', '**/dist/**', '**/*.d.ts'],
        absolute: true
      });
      allFiles.push(...files);
    } catch (error) {
      // Ignore pattern matching errors and continue
    }
  }
  
  // Remove duplicates
  return [...new Set(allFiles)];
};

const processBatchDirectly = async (logger: Logger, options: ElectronBridgeOptions, filePaths: string[]): Promise<void> => {
  const generator = createElectronBridgeGenerator(options);
  
  // Read and analyze all files in parallel
  const analysisPromises = filePaths.map(async (filePath) => {
    try {
      await fs.access(filePath); // Check file existence
      const code = await fs.readFile(filePath, 'utf-8');
      const methods = generator.analyzeFile(filePath, code);
      return methods;
    } catch (error) {
      logger.warn(`[electron-bridge] Analysis error for ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  });

  const methodArrays = await Promise.all(analysisPromises);
  const allMethods = methodArrays.flat();
  
  // Generate files once
  if (allMethods.length > 0) {
    generator.generateFiles(allMethods);
  }
};

const processBatchOnWorker = (logger: Logger, options: ElectronBridgeOptions, filePaths: string[]): Promise<void> => {
  return new Promise(resolve => {
    // Use createRequire to resolve the worker module (worker.ts --> worker.js) universally.
    // In "package.json":
    // "exports": {
    //   "./worker": "./dist/worker.js"
    // },
    // require.resolve() will resolve by the package.json "exports" declaration.
    const require = createRequire(import.meta.url);
    const workerPath = require.resolve('sublimity-electron-bridge-vite/worker');
    const worker = new Worker(workerPath, {
      workerData: {
        options: {
          outputDirs: options.outputDirs,
          typeDefinitionsFile: options.typeDefinitionsFile,
          defaultNamespace: options.defaultNamespace,
          baseDir: options.baseDir
        },
        filePaths
      },
    });

    worker.on('message', ({type, message}) => {
      switch (type) {
        case 'info': logger.info(message);
        case 'warn': logger.warn(message);
        default: logger.error(message);
      }
    });
    worker.on('error', error => {
      logger.warn(`[electron-bridge] Generation error: ${error instanceof Error ? error.message : String(error)}`)
    });
    worker.on('exit', code => {
      if (code != 0) {
        logger.warn(`[electron-bridge] Generation error: aborted worker: ${code}`)
      }
      resolve();
    });
  });
};

///////////////////////////////////////////////////////////////////////

/**
 * Sublimity Electron Bridge Vite plugin options
 */
export interface SublimityElectronBridgeVitePluginOptions {
  /**
   * The output directories for the generated files
   */
  outputDirs?: {
    /**
     * The output directory for the main process
     * @remarks Default: 'src/main/generated'
     */
    main?: string
    /**
     * The output directory for the preload process
     * @remarks Default: 'src/preload/generated'
     */
    preload?: string
  };
  /**
   * The file name for the type definitions
   * @remarks Default: 'src/generated/electron-api.d.ts'
   */
  typeDefinitionsFile?: string;
  /**
   * The default namespace for the exposed methods
   * @remarks Default: 'electronAPI'
   */
  defaultNamespace?: string;
  /**
   * Whether to enable the worker for processing files (Default: true)
   */
  enableWorker?: boolean;
  /**
   * Source files to analyze (Default: auto-discovery with patterns)
   */
  sourceFiles?: string[];
}

/**
 * Sublimity Electron Bridge Vite plugin
 * @param options - The options for the plugin
 * @returns The plugin
 */
export const sublimityElectronBridge = (options: SublimityElectronBridgeVitePluginOptions = {}): Plugin => {
  const logger = createConsoleLogger();

  const processAllFiles = async (baseDir: string): Promise<void> => {
    try {
      // Convert to ElectronBridgeOptions with baseDir from Vite
      const bridgeOptions: ElectronBridgeOptions & { sourceFiles?: string[] } = {
        outputDirs: options.outputDirs,
        typeDefinitionsFile: options.typeDefinitionsFile,
        defaultNamespace: options.defaultNamespace,
        logger,
        baseDir,
        sourceFiles: options.sourceFiles
      };

      // 1. Collect source files from directories
      const sourceFiles = await collectSourceFiles(bridgeOptions);
      
      if (sourceFiles.length === 0) {
        return;
      }
      
      // 2. Process all files in batch
      if (options.enableWorker ?? true) {
        await processBatchOnWorker(logger, bridgeOptions, sourceFiles);
      } else {
        await processBatchDirectly(logger, bridgeOptions, sourceFiles);
      }
    } catch (error) {
      logger.warn(`[electron-bridge] Error in processAllFiles: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  let baseDir = process.cwd();
  
  return {
    name: 'sublimity-electron-bridge',
    configResolved(config) {
      // Get base directory from Vite config
      baseDir = config.root || process.cwd();
    },
    buildStart: () => {
      // Process all files at build start
      return processAllFiles(baseDir);
    },
    handleHotUpdate: async () => {
      // Re-process all files on hot update
      await processAllFiles(baseDir);
      return [];
    }
  };
};
