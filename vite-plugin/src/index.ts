import type { Plugin } from 'vite'
import { createElectronBridgeGenerator, createConsoleLogger, type ElectronBridgeOptions, Logger } from 'sublimity-electron-bridge-core'
import { Worker } from 'worker_threads'
import { join } from 'path'
import { promises as fs } from 'fs'
import { glob } from 'glob'

///////////////////////////////////////////////////////////////////////

const collectSourceFiles = async (options: SublimityElectronBridgeOptions): Promise<string[]> => {
  // Default source patterns
  const defaultPatterns = [
    'src/**/*.ts',
    'src/**/*.tsx',
    'lib/**/*.ts', 
    'lib/**/*.tsx'
  ];
  
  // Get source patterns from options (for future extension)
  const patterns = (options as any).sourcePatterns || defaultPatterns;
  
  const allFiles: string[] = [];
  
  for (const pattern of patterns) {
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

const processBatchDirectly = async (logger: Logger, options: SublimityElectronBridgeOptions, filePaths: string[]): Promise<void> => {
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

const processBatchOnWorker = (logger: Logger, options: SublimityElectronBridgeOptions, filePaths: string[]): Promise<void> => {
  return new Promise(resolve => {
    const worker = new Worker(join(__dirname, 'worker.js'), {
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
export interface SublimityElectronBridgeVitePluginOptions extends ElectronBridgeOptions {
  /**
   * Whether to enable the worker for processing files (Default: true)
   */
  enableWorker?: boolean;
}

/**
 * Sublimity Electron Bridge Vite plugin
 * @param options - The options for the plugin
 * @returns The plugin
 */
export const sublimityElectronBridge = (options: SublimityElectronBridgeVitePluginOptions = {}): Plugin => {
  const logger = options.logger ?? createConsoleLogger();

  const processAllFiles = async (): Promise<void> => {
    try {
      // 1. Collect source files from directories
      const sourceFiles = await collectSourceFiles(options);
      
      if (sourceFiles.length === 0) {
        return;
      }
      
      // 2. Process all files in batch
      if (options.enableWorker ?? true) {
        await processBatchOnWorker(logger, options, sourceFiles);
      } else {
        await processBatchDirectly(logger, options, sourceFiles);
      }
    } catch (error) {
      logger.warn(`[electron-bridge] Error in processAllFiles: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return {
    name: 'sublimity-electron-bridge',
    buildStart: () => {
      // Process all files at build start
      return processAllFiles();
    },
    handleHotUpdate: async ctx => {
      // Re-process all files on hot update
      await processAllFiles();
      return [];
    }
  };
};
