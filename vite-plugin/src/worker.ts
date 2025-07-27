// sublimity-electron-bridge - Sublimity electron IPC bridge
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/sublimity-electron-bridge/

import { parentPort, workerData } from 'worker_threads';
import { promises as fs } from 'fs';
import { createElectronBridgeGenerator } from 'sublimity-electron-bridge-core';

if (!parentPort) {
  throw new Error('parentPort is not available');
}

const logger = {
  debug: (message: string) => parentPort!.postMessage({ type: 'debug', message }),
  info: (message: string) => parentPort!.postMessage({ type: 'info', message }),
  warn: (message: string) => parentPort!.postMessage({ type: 'warn', message }),
  error: (message: string) => parentPort!.postMessage({ type: 'error', message }),
};

const generator = createElectronBridgeGenerator({
  mainProcessHandlerFile: workerData.options.mainProcessHandlerFile,
  preloadHandlerFile: workerData.options.preloadHandlerFile,
  typeDefinitionsFile: workerData.options.typeDefinitionsFile,
  defaultNamespace: workerData.options.defaultNamespace,
  baseDir: workerData.options.baseDir,
  tsConfig: workerData.options.tsConfig,
  logger: logger
});

async function processBatch() {
  // Check file existence
  const validFiles: string[] = [];
  for (const filePath of workerData.filePaths) {
    try {
      await fs.access(filePath);
      validFiles.push(filePath);
    } catch (error) {
      logger.warn(`Processing error for ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
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
}

processBatch().catch(error => {
  logger.error(`Worker error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
