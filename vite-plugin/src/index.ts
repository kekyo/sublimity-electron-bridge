import type { Plugin } from 'vite';
import { createElectronBridgeGenerator, createConsoleLogger, type ElectronBridgeOptions, type Logger } from '../../core/src/index.ts';
import { Worker } from 'worker_threads';
import { promises as fs } from 'fs';
import { glob } from 'glob';
import { createRequire } from 'module';
import { createDeferred, Deferred } from 'async-primitives';
import { FSWatcher, watch } from 'chokidar';

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
   * @remarks Default: 'src/main/expose/*.ts'
   */
  sourceFiles?: string[];
}

///////////////////////////////////////////////////////////////////////

// Version is injected at build time by Vite
declare const __VERSION__: string;

const collectSourceFiles = async (
  baseDir: string | undefined,
   options: SublimityElectronBridgeVitePluginOptions): Promise<string[]> => {
  const pattern = options.sourceFiles ??
    'src/main/expose/**/*.ts';   // Default pattern
  const ignore = [
    '**/node_modules/**', '**/dist/**', '**/*.d.ts',
    ...(options.mainProcessHandlerFile ? [options.mainProcessHandlerFile] : []),
    ...(options.preloadHandlerFile ? [options.preloadHandlerFile] : []),
    ...(options.typeDefinitionsFile ? [options.typeDefinitionsFile] : [])
  ];
  try {
    const files = await glob(pattern, { 
      ignore,
      cwd: baseDir,
      absolute: true
    });
    return files;
  } catch (error) {
    return [];
  }
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
  generator.generateFiles(allMethods);
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
        case 'info': logger.info(message); break;
        case 'warn': logger.warn(message); break;
        default: logger.error(message); break;
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
    // 1. Collect source files from directories
    const sourceFiles = await collectSourceFiles(baseDir, options);

    // Convert to ElectronBridgeOptions with baseDir from Vite
    const bridgeOptions: ElectronBridgeOptions = {
      mainProcessHandlerFile: options.mainProcessHandlerFile,
      preloadHandlerFile: options.preloadHandlerFile,
      typeDefinitionsFile: options.typeDefinitionsFile,
      defaultNamespace: options.defaultNamespace,
      logger,
      baseDir
    };

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
    if (!baseDir) {
      return;
    }

    const targetSourceFiles = await collectSourceFiles(baseDir, options);

    logger.info(`[seb-vite:watch:${processingCount++}]: Start watching: ${baseDir}, ${options}, files=${targetSourceFiles.length}`);

    watcher = watch(baseDir, {
      persistent: true,
      awaitWriteFinish: true,
      interval: 100
    });
    watcher.on('all', async (event, filePath) => {
      const pc = processingCount++;
      switch (event) {
        case 'add':
        case 'change':
        case 'unlink': {
          if (targetSourceFiles.includes(filePath)) {
            logger.info(`[seb-vite:watch:${pc}]: Detected: ${event}: ${filePath}`);
            await processAllFiles(logger, baseDir, `seb-vite:watch:${pc}`);
          } else {
            logger.info(`[seb-vite:watch:${pc}]: Ignored: ${event}: ${filePath}`);
          }
        }
        default: {
          logger.info(`[seb-vite:watch:${pc}]: Ignored: ${event}: ${filePath}`);
        }
      }
    });
  };

  const stopFileWatching = async () => {
    if (watcher) {
      watcher.close();
      watcher = undefined;
 
      logger.info(`[seb-vite:watch:${processingCount++}]: Stopped watching`);
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
