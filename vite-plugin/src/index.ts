import type { Plugin } from 'vite';
import { createElectronBridgeGenerator, createConsoleLogger, type ElectronBridgeOptions, type Logger } from '../../core/src/index.ts';
import { Worker } from 'worker_threads';
import { promises as fs } from 'fs';
import { glob } from 'glob';
import { createRequire } from 'module';
import { createDeferred, Deferred } from 'async-primitives';
import chokidar, { FSWatcher, watch } from 'chokidar';

///////////////////////////////////////////////////////////////////////

// Version is injected at build time by Vite
declare const __VERSION__: string;

const collectSourceFiles = async (options: ElectronBridgeOptions): Promise<string[]> => {
  // Default source patterns
  const defaultPatterns = [
    'src/main/**/*.ts'
  ];

  const allFiles: string[] = [];
  for (const pattern of defaultPatterns) {
    try {
      const files = await glob(pattern, { 
        ignore: [
          '**/node_modules/**',
          ...(options.mainProcessHandlerFile ? [options.mainProcessHandlerFile] : []),
          ...(options.preloadHandlerFile ? [options.preloadHandlerFile] : []),
          ...(options.typeDefinitionsFile ? [options.typeDefinitionsFile] : [])
        ],
        cwd: options.baseDir
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
      logger.warn(`Analysis error for ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
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
          mainProcessHandlerFile: options.mainProcessHandlerFile,
          preloadHandlerFile: options.preloadHandlerFile,
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
      logger.warn(`Generation error: ${error instanceof Error ? error.message : String(error)}`)
    });
    worker.on('exit', code => {
      if (code != 0) {
        logger.warn(`Generation error: aborted worker: ${code}`)
      }
      resolve();
    });
  });
};

const processAllFilesCore = async (
  logger: Logger, baseDir: string | undefined, options: SublimityElectronBridgeVitePluginOptions): Promise<void> => {

  logger.info(`Start Sublimity Electron IPC bridge Vite plugin [${__VERSION__}]`);

  try {
    // Convert to ElectronBridgeOptions with baseDir from Vite
    const bridgeOptions: ElectronBridgeOptions = {
      mainProcessHandlerFile: options.mainProcessHandlerFile,
      preloadHandlerFile: options.preloadHandlerFile,
      typeDefinitionsFile: options.typeDefinitionsFile,
      defaultNamespace: options.defaultNamespace,
      logger,
      baseDir
    };

    // 1. Collect source files from directories
    const sourceFiles = options.sourceFiles ??
      await collectSourceFiles(bridgeOptions);
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
    logger.warn(`Error in processAllFilesCore: ${error instanceof Error ? error.message : String(error)}`);
  }
};

///////////////////////////////////////////////////////////////////////

/**
 * Sublimity Electron Bridge Vite plugin options
 */
export interface SublimityElectronBridgeVitePluginOptions {
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
   * Whether to enable the worker for processing files (Default: true)
   */
  enableWorker?: boolean;
  /**
   * Source files to analyze
   * @remarks Default: 'src/main/*.ts'
   */
  sourceFiles?: string[];
}

interface DemandArgs {
  logger: Logger;
  baseDir: string | undefined;
  processingPrefix: string;
}

/**
 * Sublimity Electron Bridge Vite plugin
 * @param options - The options for the plugin
 * @returns The plugin
 */
export const sublimityElectronBridge = (options: SublimityElectronBridgeVitePluginOptions = {}): Plugin => {
  let demandDeferred: Deferred<void> | undefined;
  let demandArgs: DemandArgs | undefined;
  let runningDeferred: Deferred<void> | undefined;

  const processAllFiles = (logger: Logger, baseDir: string | undefined, processingPrefix: string): Promise<void> => {
    if (demandDeferred) {
      demandDeferred.resolve();
      demandDeferred = undefined;
    }
    if (runningDeferred) {
      demandDeferred = createDeferred<void>();
      demandArgs = { logger, baseDir, processingPrefix };
      return demandDeferred.promise;
    }

    const rd = createDeferred<void>();
    runningDeferred = rd;

    const run = async ({ logger, baseDir, processingPrefix }: DemandArgs) => {
      try {
        // Insert processing count before logger message
        const processingLogger = {
          info: (msg: string) => logger.info(`[${processingPrefix}]: ${msg}`),
          warn: (msg: string) => logger.warn(`[${processingPrefix}]: ${msg}`),
          error: (msg: string) => logger.error(`[${processingPrefix}]: ${msg}`)
        };

        await processAllFilesCore(processingLogger, baseDir, options);
      } catch (error: any) {
        const rd = runningDeferred!;
        runningDeferred = demandDeferred;
        const das = demandArgs;
        demandDeferred = undefined;
        demandArgs = undefined;
        if (runningDeferred) {
          void run(das!);
        }
        rd.reject(error);
        return;
      }
      const rd = runningDeferred!;
      runningDeferred = demandDeferred;
      const das = demandArgs;
      demandDeferred = undefined;
      demandArgs = undefined;
      if (runningDeferred) {
        void run(das!);
      }
      rd.resolve();
    };
  
    void run({ logger, baseDir, processingPrefix });
  
    return rd.promise;
  }

  let logger = createConsoleLogger();
  let baseDir: string | undefined;
  let processingCount = 0;
  let watcher: FSWatcher | undefined;

  const startFileWatching = async () => {
    if (watcher) {
      watcher.close();
    }

    const filePaths = await collectSourceFiles(options);

    watcher = watch(filePaths, {
      persistent: true,
      ignoreInitial: true
    });

    watcher.on('change', async filePath => {
      if (filePath && baseDir) {
        await processAllFiles(logger, baseDir, `seb-vite:filechange:${processingCount++}`);
      }
    });
  };

  const stopFileWatching = async () => {
    if (watcher) {
      watcher.close();
      watcher = undefined;
    }
  };

  return {
    name: 'sublimity-electron-bridge',
    config: config => {
      // Get base directory from Vite config
      baseDir = config?.root ?? baseDir;
      logger = {
        info: config?.customLogger?.info ?? logger.info,
        warn: config?.customLogger?.warn ?? logger.warn,
        error: config?.customLogger?.error ?? logger.error,
      };
    },
    configResolved: async config => {
      // Get base directory from Vite config
      baseDir = config?.root ?? baseDir;
      logger = {
        info: config?.logger?.info ?? logger.info,
        warn: config?.logger?.warn ?? logger.warn,
        error: config?.logger?.error ?? logger.error,
      };
      await stopFileWatching();
      await processAllFiles(logger, baseDir, `seb-vite:configResolved:${processingCount++}`);
      await startFileWatching();
    },
    buildStart: () => stopFileWatching(),
    buildEnd: () => startFileWatching(),
  };
};
