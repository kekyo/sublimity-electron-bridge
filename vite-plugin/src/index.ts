// sublimity-electron-bridge - Sublimity electron IPC bridge
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/sublimity-electron-bridge/

import type { Plugin } from 'vite';
import { createElectronBridgeGenerator, createConsoleLogger, type ElectronBridgeOptions, type Logger } from 'sublimity-electron-bridge-core';
import { Worker } from 'worker_threads';
import { promises as fs } from 'fs';
import { glob } from 'glob';
import { createRequire } from 'module';
import { createDeferred, Deferred, createAsyncLock } from 'async-primitives';
import { join, resolve } from 'path';
import { git_commit_hash, version } from './generated/packageMetadata';

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

const getTargetDirResolved = (baseDir: string | undefined, targetDir: string | undefined) => {
  const td = targetDir ?? 'src/main/expose/';
  return baseDir ? resolve(baseDir, td) : resolve(td);
};

const getTargetFilePattern = (baseDir: string | undefined, targetDir: string | undefined) => {
  return join(getTargetDirResolved(baseDir, targetDir), '**/*.ts');
};

const collectSourceFiles = async (
  logger: Logger,
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
    logger.error(`collectSourceFiles error: pattern=${targetFilePattern}, cwd=${baseDir}, error=${error}`);
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
  logger.info(`analyzeFiles returned ${allMethods.length} methods`);
  
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
          baseDir: options.baseDir,
          tsConfig: options.tsConfig
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

  logger.info(`Start Sublimity Electron IPC bridge Vite plugin [${version}-${git_commit_hash}]`);

  try {
    // 1. Collect source files from directories
    const sourceFiles = await collectSourceFiles(logger, baseDir, options);
    
    logger.info(`Collected ${sourceFiles.length} source files: ${JSON.stringify(sourceFiles)}`);

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

  const __processAllFiles = (logger: Logger, baseDir: string, processingPrefix: string): Promise<void> => {
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

  const locker = createAsyncLock();
  const processAllFiles = async (logger: Logger, baseDir: string, processingPrefix: string) => {
    const l = await locker.lock();
    try {
      await __processAllFiles(logger, baseDir, processingPrefix);
    } finally {
      l.release();
    }
  };

  let _logger = createConsoleLogger();
  let _baseDir: string | undefined;
  let _processingCount = 0;

  return {
    name: 'sublimity-electron-bridge',
    apply: 'build',
    configResolved: async config => {
      // Capture base directory from Vite config
      const baseDir = config?.root ?? _baseDir;
      _baseDir = baseDir;
      // Capture logger from Vite config
      const logger = {
        debug: config?.logger?.info ?? config?.customLogger?.info ?? _logger.debug,
        info: config?.logger?.info ?? config?.customLogger?.info ?? _logger.info,
        warn: config?.logger?.warn ?? config?.customLogger?.warn ?? _logger.warn,
        error: config?.logger?.error ?? config?.customLogger?.error ?? _logger.error,
      };
      _logger = logger;
      const logPrefix = `seb-vite:configResolved:${_processingCount++}`;

      // Check if sublimity-rpc is installed
      try {
        const require = createRequire(import.meta.url);
        require.resolve('sublimity-rpc');
      } catch (error) {
        logger.warn(`[${logPrefix}] sublimity-rpc is not installed.`);
        logger.warn(`[${logPrefix}] Please install it manually: npm install sublimity-rpc`);
        logger.warn(`[${logPrefix}] The generated code requires sublimity-rpc to function properly.`);
      }
      // Process all files
      logger.info(`[${logPrefix}]: Start: baseDir=${baseDir ?? "(undefined)"}`);
      try {
        if (baseDir) {
          await processAllFiles(logger, baseDir, logPrefix);
        }
      } finally {
        logger.info(`[${logPrefix}]: Exit: baseDir=${baseDir ?? "(undefined)"}`);
      }
    },
    buildStart: async () => {
      const baseDir = _baseDir;
      const logger = _logger;
      // Process all files
      const logPrefix = `seb-vite:buildStart:${_processingCount++}`;
      logger.info(`[${logPrefix}]: Start: baseDir=${baseDir ?? "(undefined)"}`);
      try {
        if (baseDir) {
          await processAllFiles(logger, baseDir, logPrefix);
        }
      } finally {
        logger.info(`[${logPrefix}]: Exit: baseDir=${baseDir ?? "(undefined)"}`);
      }
    }
  };
};
