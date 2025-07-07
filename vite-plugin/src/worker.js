const { parentPort, workerData } = require('worker_threads')
const fs = require('fs').promises

if (!parentPort) {
  throw new Error('parentPort is not available');
}

const coreModule = require('sublimity-electron-bridge-core');
const createElectronBridgeGenerator = coreModule.createElectronBridgeGenerator;

const logger = {
  info: (message) => parentPort.postMessage({ type: 'info', message }),
  warn: (message) => parentPort.postMessage({ type: 'warn', message }),
  error: (message) => parentPort.postMessage({ type: 'error', message }),
};

const generator = createElectronBridgeGenerator({
  outputDirs: workerData.options.outputDirs,
  typeDefinitionsFile: workerData.options.typeDefinitionsFile,
  defaultNamespace: workerData.options.defaultNamespace,
  baseDir: workerData.options.baseDir,
  logger: logger
});

async function processBatch() {
  // Read and analyze all files in parallel
  const analysisPromises = workerData.filePaths.map(async (filePath) => {
    try {
      await fs.access(filePath); // Check file existence
      const code = await fs.readFile(filePath, 'utf-8');
      const methods = generator.analyzeFile(filePath, code);
      return methods;
    } catch (error) {
      logger.warn(`Processing error for ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  });

  const methodArrays = await Promise.all(analysisPromises);
  const allMethods = methodArrays.flat();
  
  // Generate files once
  if (allMethods.length > 0) {
    generator.generateFiles(allMethods);
  }
}

processBatch().catch(error => {
  logger.error(`Worker error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
