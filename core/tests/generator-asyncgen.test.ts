import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createElectronBridgeGenerator } from '../src/generator';
import { createConsoleLogger } from '../src/logger';

describe('async generator support', () => {
  let testDir: string;
  let generator: ReturnType<typeof createElectronBridgeGenerator>;

  beforeEach(async () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    testDir = join(tmpdir(), 'seb-test', 'core', 'async-generator', timestamp);
    await mkdir(testDir, { recursive: true });

    // Create test files
    await writeFile(join(testDir, 'tsconfig.json'), JSON.stringify({
      "compilerOptions": {
        "target": "ES2022",
        "module": "ESNext",
        "lib": ["ES2022"],
        "strict": true,
        "esModuleInterop": true,
        "skipLibCheck": true,
        "forceConsistentCasingInFileNames": true
      }
    }, null, 2));

    await mkdir(join(testDir, 'src'), { recursive: true });

    // Write test file with async generator functions
    await writeFile(join(testDir, 'src', 'generator-functions.ts'), `
/**
 * Stream data items
 * @decorator expose
 */
export async function* streamData(count: number): AsyncGenerator<string> {
  for (let i = 0; i < count; i++) {
    yield \`Data item \${i}\`;
  }
}

/**
 * Stream numbers
 * @decorator expose dataStream
 */
export async function* streamNumbers(max: number): AsyncGenerator<number> {
  for (let i = 0; i <= max; i++) {
    yield i;
  }
}

/**
 * Normal async function for comparison
 * @decorator expose
 */
export async function normalAsync(value: string): Promise<string> {
  return \`Processed: \${value}\`;
}

/**
 * Class with async generator method
 */
export class DataService {
  /**
   * Stream records from database
   * @decorator expose
   */
  async *streamRecords(query: string): AsyncGenerator<Record<string, any>> {
    // Simulated database streaming
    for (let i = 0; i < 3; i++) {
      yield { id: i, query, timestamp: Date.now() };
    }
  }
}
`);

    generator = createElectronBridgeGenerator({
      logger: createConsoleLogger('generator-asyncgen-test'),
      baseDir: testDir,
      tsConfig: 'tsconfig.json',
      mainProcessHandlerFile: 'main/handlers.ts',
      preloadHandlerFile: 'preload/bridge.ts',
      rendererHandlerFile: 'renderer/bridge.ts',
      typeDefinitionsFile: 'types/api.d.ts'
    });
  });

  afterEach(async () => {
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it('should detect and handle async generator functions', async () => {
    const functions = await generator.analyzeFiles([
      join(testDir, 'src', 'generator-functions.ts')
    ]);

    expect(functions).toHaveLength(4);
    
    const streamData = functions.find(f => f.name === 'streamData');
    expect(streamData).toBeDefined();
    expect(streamData?.type.returnType.kind).toBe('type-reference');
    if (streamData?.type.returnType.kind === 'type-reference') {
      expect(streamData.type.returnType.referencedType.kind).toBe('interface');
      if (streamData.type.returnType.referencedType.kind === 'interface') {
        expect(streamData.type.returnType.referencedType.name).toBe('AsyncGenerator');
      }
    }
  });

  it('should generate correct main handler with registerGenerator', async () => {
    const functions = await generator.analyzeFiles([
      join(testDir, 'src', 'generator-functions.ts')
    ]);
    
    await generator.generateFiles(functions);
    
    const mainContent = await readFile(join(testDir, 'main/handlers.ts'), 'utf-8');
    
    // Check for registerGenerator usage for async generators
    expect(mainContent).toContain("controller.registerGenerator('mainProcess:streamData', streamData);");
    expect(mainContent).toContain("controller.registerGenerator('dataStream:streamNumbers', streamNumbers);");
    expect(mainContent).toContain("controller.registerGenerator('dataService:streamRecords', __DataServiceInstance.streamRecords);");
    
    // Check for regular register for normal async function
    expect(mainContent).toContain("controller.register('mainProcess:normalAsync', normalAsync);");
  });

  it('should generate correct renderer bridge with iterate and invoke methods', async () => {
    const functions = await generator.analyzeFiles([
      join(testDir, 'src', 'generator-functions.ts')
    ]);
    
    await generator.generateFiles(functions);
    
    // Read renderer file content
    const rendererFile = join(testDir, 'renderer/bridge.ts');
    const rendererContent = readFileSync(rendererFile, 'utf8');
    
    // Expected renderer content with proper structure for async generators
    const expectedRendererContent = `// This is auto-generated renderer bridge by sublimity-electron-bridge.
// Do not edit manually this file.

import { createSublimityRpcController, SublimityRpcMessage } from 'sublimity-rpc';

// Get the bridge from preloader
const bridge = (window as any).__sublimityBridge;

// Create RPC controller in renderer process
const controller = createSublimityRpcController({
  onSendMessage: async (message: SublimityRpcMessage): Promise<SublimityRpcMessage> => {
    return await bridge.sendMessage(message);
  }
});

// Handle messages from main process
bridge.onMessage((message: SublimityRpcMessage) => {
  controller.insertMessage(message);
});

// Expose RPC functions to window object
(window as any).dataService = {
  streamRecords: (query: string) => controller.iterate<Record<string, any>>('dataService:streamRecords', query)
};
(window as any).dataStream = {
  streamNumbers: (max: number) => controller.iterate<number>('dataStream:streamNumbers', max)
};
(window as any).mainProcess = {
  normalAsync: (value: string) => controller.invoke<string>('mainProcess:normalAsync', value),
  streamData: (count: number) => controller.iterate<string>('mainProcess:streamData', count)
};
`;
    
    // Content validation
    expect(rendererContent).toBe(expectedRendererContent);
  });

  it('should generate correct preload bridge with simple format', async () => {
    const functions = await generator.analyzeFiles([
      join(testDir, 'src', 'generator-functions.ts')
    ]);
    
    await generator.generateFiles(functions);
    
    const preloadContent = await readFile(join(testDir, 'preload/bridge.ts'), 'utf-8');
    
    // Check that the preload contains the simple bridge format
    expect(preloadContent).toContain('// This is auto-generated preloader by sublimity-electron-bridge.');
    expect(preloadContent).toContain('// Do not edit manually this file.');
    expect(preloadContent).toContain("import { contextBridge, ipcRenderer } from 'electron';");
    expect(preloadContent).toContain("import { SublimityRpcMessage } from 'sublimity-rpc';");
    expect(preloadContent).toContain('contextBridge.exposeInMainWorld("__sublimityBridge", {');
    expect(preloadContent).toContain('onMessage: (callback: (message: SublimityRpcMessage) => void) => {');
    expect(preloadContent).toContain('ipcRenderer.on("rpc-message", (_, message) => callback(message));');
    expect(preloadContent).toContain('sendMessage: async (message: SublimityRpcMessage): Promise<SublimityRpcMessage> => {');
    expect(preloadContent).toContain('return await ipcRenderer.invoke("rpc-message", message);');
    
    // Ensure it does not contain the old controller format
    expect(preloadContent).not.toContain('controller.iterate');
    expect(preloadContent).not.toContain('controller.invoke');
  });

  it('should generate correct type definitions for async generators', async () => {
    const functions = await generator.analyzeFiles([
      join(testDir, 'src', 'generator-functions.ts')
    ]);
    
    await generator.generateFiles(functions);
    
    const typeContent = await readFile(join(testDir, 'types/api.d.ts'), 'utf-8');
    
    // Check that AsyncGenerator return types are normalized for sublimity-rpc compatibility
    expect(typeContent).toContain("readonly streamData: (count: number) => AsyncGenerator<string, void, unknown>");
    expect(typeContent).toContain("readonly streamNumbers: (max: number) => AsyncGenerator<number, void, unknown>");
    expect(typeContent).toContain("readonly streamRecords: (query: string) => AsyncGenerator<Record<string, any>, void, unknown>");
    
    // Check normal async function type
    expect(typeContent).toContain("readonly normalAsync: (value: string) => Promise<string>");
  });
});