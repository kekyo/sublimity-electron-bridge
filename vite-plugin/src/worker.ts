import { parentPort, workerData } from 'worker_threads';
import { promises as fs } from 'fs';
import { createElectronBridgeGenerator } from '../../core/src/index.ts';

if (!parentPort) {
  throw new Error('parentPort is not available');
}

const logger = {
  trace: (message: string) => parentPort!.postMessage({ type: 'trace', message }),
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
  channelPrefix: workerData.options.channelPrefix,
  logger: logger
});

async function processBatch() {
  // Read and analyze all files in parallel
  const analysisPromises = workerData.filePaths.map(async (filePath: string) => {
    try {
      await fs.access(filePath); // Check file existence
      const code = await fs.readFile(filePath, 'utf-8');
      const methods = await generator.analyzeFile(filePath, code);
      return methods;
    } catch (error) {
      logger.warn(`Processing error for ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  });

  const methodArrays = await Promise.all(analysisPromises);
  const allMethods = methodArrays.flat();
  
  // Generate files once
  await generator.generateFiles(allMethods);
}

processBatch().catch(error => {
  logger.error(`Worker error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
