import type { Plugin } from 'vite';
import { createElectronBridgeGenerator, createConsoleLogger, type ElectronBridgeOptions, type Logger } from 'sublimity-electron-bridge-core';
import { Worker } from 'worker_threads';
import { promises as fs } from 'fs';
import { glob } from 'glob';
import { createRequire } from 'module';
import { createDeferred, Deferred } from 'async-primitives';
import { FSWatcher, watch } from 'chokidar';
import { join, resolve } from 'path';

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
   * Target directory to analyze
   * @remarks Default: 'src/main/expose/'
   */
  targetDir?: string;
}

///////////////////////////////////////////////////////////////////////

// Version is injected at build time by Vite
declare const __VERSION__: string;

const getTargetDirResolved = (baseDir: string | undefined, targetDir: string | undefined) => {
  const td = targetDir ?? 'src/main/expose/';
  return baseDir ? resolve(baseDir, td) : resolve(td);
};

const getTargetFilePattern = (baseDir: string | undefined, targetDir: string | undefined) => {
  return join(getTargetDirResolved(baseDir, targetDir), '**/*.ts');
};

const collectSourceFiles = async (
  baseDir: string | undefined,
   options: SublimityElectronBridgeVitePluginOptions): Promise<string[]> => {
  const targetFilePattern = getTargetFilePattern(baseDir, options.targetDir);
  const ignore = [
    '**/node_modules/**', '**/dist/**', '**/*.d.ts',
    ...(options.mainProcessHandlerFile ? [options.mainProcessHandlerFile] : []),
    ...(options.preloadHandlerFile ? [options.preloadHandlerFile] : []),
    ...(options.typeDefinitionsFile ? [options.typeDefinitionsFile] : [])
  ];
  try {
    const files = await glob(targetFilePattern, { 
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
  
  // Check file existence
  const validFiles: string[] = [];
  for (const filePath of filePaths) {
    try {
      await fs.access(filePath);
      validFiles.push(filePath);
    } catch (error) {
      logger.warn(`Analysis error for ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (validFiles.length === 0) {
    logger.warn('No valid files found to analyze');
    return;
  }

  // Use the new analyzeFiles method for better performance and accuracy
  const allMethods = await generator.analyzeFiles(validFiles);
  
  // Generate files once
  await generator.generateFiles(allMethods);
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
  logger: Logger, baseDir: string, options: SublimityElectronBridgeVitePluginOptions): Promise<void> => {

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
  baseDir: string;
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

  const processAllFiles = (logger: Logger, baseDir: string, processingPrefix: string): Promise<void> => {
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
          debug: (msg: string) => logger.debug(`[${processingPrefix}]: ${msg}`),
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

    const watchTargetDir = getTargetDirResolved(baseDir, options.targetDir);

    logger.info(`[seb-vite:watch:${processingCount++}]: Start watching: ${watchTargetDir}`);

    watcher = watch(watchTargetDir, {
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
          logger.info(`[seb-vite:watch:${pc}]: Detected: ${event}: ${filePath}`);
          await processAllFiles(logger, baseDir!, `seb-vite:watch:${pc}`);
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
        debug: config?.customLogger?.info ?? logger.debug,
        info: config?.customLogger?.info ?? logger.info,
        warn: config?.customLogger?.warn ?? logger.warn,
        error: config?.customLogger?.error ?? logger.error,
      };
    },
    configResolved: async config => {
      // Get base directory from Vite config
      baseDir = config?.root ?? baseDir;
      logger = {
        debug: config?.logger?.info ?? config?.customLogger?.info ?? logger.debug,
        info: config?.logger?.info ?? config?.customLogger?.info ?? logger.info,
        warn: config?.logger?.warn ?? config?.customLogger?.warn ?? logger.warn,
        error: config?.logger?.error ?? config?.customLogger?.error ?? logger.error,
      };
      await stopFileWatching();
      await processAllFiles(logger, baseDir, `seb-vite:configResolved:${processingCount++}`);
      await startFileWatching();
    },
    buildStart: () => stopFileWatching(),
    buildEnd: () => startFileWatching(),
  };
};
