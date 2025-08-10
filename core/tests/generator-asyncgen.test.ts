import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElectronBridgeGenerator } from '../src/generator';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
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

  it('should generate correct preload bridge with iterate', async () => {
    const functions = await generator.analyzeFiles([
      join(testDir, 'src', 'generator-functions.ts')
    ]);
    
    await generator.generateFiles(functions);
    
    const preloadContent = await readFile(join(testDir, 'preload/bridge.ts'), 'utf-8');
    
    // Check for iterate usage for async generators
    expect(preloadContent).toContain("streamData: (count: number) => controller.iterate<string>('mainProcess:streamData', count)");
    expect(preloadContent).toContain("streamNumbers: (max: number) => controller.iterate<number>('dataStream:streamNumbers', max)");
    expect(preloadContent).toContain("streamRecords: (query: string) => controller.iterate<Record<string, any>>('dataService:streamRecords', query)");
    
    // Check for invoke usage for normal async function
    expect(preloadContent).toContain("normalAsync: (value: string) => controller.invoke<string>('mainProcess:normalAsync', value)");
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