import { describe, it, expect, beforeEach } from 'vitest';
import { createElectronBridgeGenerator } from './index';
import { rmSync, existsSync, readFileSync, mkdirSync, mkdtempSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

describe('generateFiles', () => {
  const testOutputDir = mkdtempSync(join(tmpdir(), 'cli-test-'));
  
  beforeEach(() => {
    // Clean up test output directory
    if (existsSync(testOutputDir)) {
      rmSync(testOutputDir, { recursive: true, force: true });
    }
    // Ensure test output directory exists
    if (!existsSync(testOutputDir)) {
      mkdirSync(testOutputDir, { recursive: true });
    }
  });

  it('should generate all three output files', async () => {
    const mainFile = join(testOutputDir, 'main', 'ipc-handlers.ts');
    const preloadFile = join(testOutputDir, 'preload', 'bridge.ts');
    const typeDefFile = join(testOutputDir, 'types', 'electron-api.d.ts');
    
    const generator = createElectronBridgeGenerator({
      mainProcessHandlerFile: mainFile,
      preloadHandlerFile: preloadFile,
      typeDefinitionsFile: typeDefFile
    });
    
    const methods = [
      {
        declaredType: { name: 'FileService' },
        methodName: 'readFile',
        namespace: 'fileAPI',
        parameters: [{ name: 'path', type: { name: 'string' } }],
        returnType: { name: 'Promise<string>' },
        filePath: 'src/services/FileService.ts'
      }
    ];
    
    await generator.generateFiles(methods);
    
    // Check that all files are created
    expect(existsSync(mainFile)).toBe(true);
    expect(existsSync(preloadFile)).toBe(true);
    expect(existsSync(typeDefFile)).toBe(true);
  });

  it('should generate correct main handlers content', async () => {
    const mainFile = join(testOutputDir, 'main-handlers', 'ipc-handlers.ts');
    const preloadFile = join(testOutputDir, 'preload-handlers', 'bridge.ts');
    const typeDefFile = join(testOutputDir, 'main-handlers-types.d.ts');
    
    const generator = createElectronBridgeGenerator({
      mainProcessHandlerFile: mainFile,
      preloadHandlerFile: preloadFile,
      typeDefinitionsFile: typeDefFile,
      baseDir: testOutputDir
    });
    
    const methods = [
      {
        declaredType: { name: 'FileService' },
        methodName: 'readFile',
        namespace: 'fileAPI',
        parameters: [{ name: 'path', type: { name: 'string' } }],
        returnType: { name: 'Promise<string>' },
        filePath: 'src/services/FileService.ts'
      },
      {
        methodName: 'getVersion',
        namespace: 'systemAPI',
        parameters: [],
        returnType: { name: 'Promise<string>' },
        filePath: 'src/utils/version.ts'
      }
    ];
    
    await generator.generateFiles(methods);
    
    const mainContent = readFileSync(mainFile, 'utf8');
    
    const expectedMainContent = `// This is auto-generated main process handler by sublimity-electron-bridge.
// Do not edit manually this file.

import { ipcMain } from 'electron';
import { FileService } from '../src/services/FileService';
import { getVersion } from '../src/utils/version';

// Create singleton instances
const fileserviceInstance = new FileService();

// Register IPC handlers
ipcMain.handle('seb:fileAPI:readFile', (_, path) => fileserviceInstance.readFile(path));
ipcMain.handle('seb:systemAPI:getVersion', (_) => getVersion());
`;
    
    expect(mainContent).toBe(expectedMainContent);
  });

  it('should generate correct preload bridge content', async () => {
    const mainFile = join(testOutputDir, 'main-bridge', 'ipc-handlers.ts');
    const preloadFile = join(testOutputDir, 'preload-bridge', 'bridge.ts');
    const typeDefFile = join(testOutputDir, 'preload-bridge-types.d.ts');
    
    const generator = createElectronBridgeGenerator({
      mainProcessHandlerFile: mainFile,
      preloadHandlerFile: preloadFile,
      typeDefinitionsFile: typeDefFile
    });
    
    const methods = [
      {
        declaredType: { name: 'FileService' },
        methodName: 'readFile',
        namespace: 'fileAPI',
        parameters: [{ name: 'path', type: { name: 'string' } }],
        returnType: { name: 'Promise<string>' },
        filePath: 'src/services/FileService.ts'
      },
      {
        methodName: 'getVersion',
        namespace: 'systemAPI',
        parameters: [],
        returnType: { name: 'Promise<string>' },
        filePath: 'src/utils/version.ts'
      }
    ];
    
    await generator.generateFiles(methods);
    
    const preloadContent = readFileSync(preloadFile, 'utf8');
    
    const expectedPreloadContent = `// This is auto-generated preloader by sublimity-electron-bridge.
// Do not edit manually this file.

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('fileAPI', {
  readFile: (path: string) => ipcRenderer.invoke('seb:fileAPI:readFile', path)
});
contextBridge.exposeInMainWorld('systemAPI', {
  getVersion: () => ipcRenderer.invoke('seb:systemAPI:getVersion')
});
`;
    
    expect(preloadContent).toBe(expectedPreloadContent);
  });

  it('should generate correct type definitions content', async () => {
    const mainFile = join(testOutputDir, 'main-types', 'ipc-handlers.ts');
    const preloadFile = join(testOutputDir, 'preload-types', 'bridge.ts');
    const typeDefFile = join(testOutputDir, 'electron-api.d.ts');
    
    const generator = createElectronBridgeGenerator({
      mainProcessHandlerFile: mainFile,
      preloadHandlerFile: preloadFile,
      typeDefinitionsFile: typeDefFile
    });
    
    const methods = [
      {
        declaredType: { name: 'FileService' },
        methodName: 'readFile',
        namespace: 'fileAPI',
        parameters: [{ name: 'path', type: { name: 'string' } }],
        returnType: { name: 'Promise<string>' },
        filePath: 'src/services/FileService.ts'
      },
      {
        methodName: 'writeFile',
        namespace: 'fileAPI',
        parameters: [
          { name: 'path', type: { name: 'string' } },
          { name: 'content', type: { name: 'string' } }
        ],
        returnType: { name: 'Promise<void>' },
        filePath: 'src/services/FileService.ts'
      }
    ];
    
    await generator.generateFiles(methods);
    
    const typeContent = readFileSync(typeDefFile, 'utf8');
    
    const expectedTypeContent = `// This is auto-generated type definitions by sublimity-electron-bridge.
// Do not edit manually this file.

interface FileAPI {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}

declare global {
  interface Window {
    fileAPI: FileAPI;
  }
}

export {}
`;
    
    expect(typeContent).toBe(expectedTypeContent);
  });

  it('should handle relative paths when baseDir is specified', async () => {
    const mainFile = join(testOutputDir, 'main-relative', 'ipc-handlers.ts');
    const preloadFile = join(testOutputDir, 'preload-relative', 'bridge.ts');
    const typeDefFile = join(testOutputDir, 'relative-types.d.ts');
    const baseDir = testOutputDir;
    
    const generator = createElectronBridgeGenerator({
      mainProcessHandlerFile: mainFile,
      preloadHandlerFile: preloadFile,
      typeDefinitionsFile: typeDefFile,
      baseDir: baseDir
    });
    
    const methods = [
      {
        declaredType: { name: 'FileService' },
        methodName: 'readFile',
        namespace: 'fileAPI',
        parameters: [{ name: 'path', type: { name: 'string' } }],
        returnType: { name: 'Promise<string>' },
        filePath: 'src/services/FileService.ts'
      }
    ];
    
    await generator.generateFiles(methods);
    
    const mainContent = readFileSync(mainFile, 'utf8');
    
    // Should use relative path, not absolute path
    expect(mainContent).toContain("import { FileService } from '../src/services/FileService'");
    expect(mainContent).not.toContain(resolve(baseDir, 'src/services/FileService'));
  });

  it('should handle empty methods array', async () => {
    const mainFile = join(testOutputDir, 'empty-main', 'ipc-handlers.ts');
    const preloadFile = join(testOutputDir, 'empty-preload', 'bridge.ts');
    const typeDefFile = join(testOutputDir, 'empty-types.d.ts');
    
    const generator = createElectronBridgeGenerator({
      mainProcessHandlerFile: mainFile,
      preloadHandlerFile: preloadFile,
      typeDefinitionsFile: typeDefFile
    });
    
    // Should not create files when no methods provided
    await expect(generator.generateFiles([])).resolves.not.toThrow();

    const mainContent = readFileSync(mainFile, 'utf8');
    expect(mainContent).toBe(`// This is auto-generated main process handler by sublimity-electron-bridge.
// Do not edit manually this file.

import { ipcMain } from 'electron';

// Create singleton instances

// Register IPC handlers
`);

    const preloadContent = readFileSync(preloadFile, 'utf8');
    expect(preloadContent).toBe(`// This is auto-generated preloader by sublimity-electron-bridge.
// Do not edit manually this file.

import { contextBridge, ipcRenderer } from 'electron';

`);

    const typeDefContent = readFileSync(typeDefFile, 'utf8');
    expect(typeDefContent).toBe(`// This is auto-generated type definitions by sublimity-electron-bridge.
// Do not edit manually this file.


declare global {
  interface Window {
  }
}

export {}
`);
  });

  it('should handle multiple namespaces correctly', async () => {
    const mainFile = join(testOutputDir, 'multi-namespace', 'ipc-handlers.ts');
    const preloadFile = join(testOutputDir, 'multi-preload', 'bridge.ts');
    const typeDefFile = join(testOutputDir, 'multi-types.d.ts');
    
    const generator = createElectronBridgeGenerator({
      mainProcessHandlerFile: mainFile,
      preloadHandlerFile: preloadFile,
      typeDefinitionsFile: typeDefFile
    });
    
    const methods = [
      {
        declaredType: { name: 'FileService' },
        methodName: 'readFile',
        namespace: 'fileAPI',
        parameters: [{ name: 'path', type: { name: 'string' } }],
        returnType: { name: 'Promise<string>' },
        filePath: 'src/services/FileService.ts'
      },
      {
        methodName: 'getVersion',
        namespace: 'systemAPI',
        parameters: [],
        returnType: { name: 'Promise<string>' },
        filePath: 'src/utils/version.ts'
      },
      {
        declaredType: { name: 'DatabaseService' },
        methodName: 'query',
        namespace: 'dbAPI',
        parameters: [{ name: 'sql', type: { name: 'string' } }],
        returnType: { name: 'Promise<any[]>' },
        filePath: 'src/services/DatabaseService.ts'
      }
    ];
    
    await generator.generateFiles(methods);
    
    const preloadContent = readFileSync(preloadFile, 'utf8');
    
    // Should have all three namespaces
    expect(preloadContent).toContain("contextBridge.exposeInMainWorld('fileAPI'");
    expect(preloadContent).toContain("contextBridge.exposeInMainWorld('systemAPI'");
    expect(preloadContent).toContain("contextBridge.exposeInMainWorld('dbAPI'");
  });

  it('should deduplicate identical class imports', async () => {
    const mainFile = join(testOutputDir, 'dedupe-main', 'ipc-handlers.ts');
    const preloadFile = join(testOutputDir, 'dedupe-preload', 'bridge.ts');
    const typeDefFile = join(testOutputDir, 'dedupe-types.d.ts');
    
    const generator = createElectronBridgeGenerator({
      mainProcessHandlerFile: mainFile,
      preloadHandlerFile: preloadFile,
      typeDefinitionsFile: typeDefFile
    });
    
    const methods = [
      {
        declaredType: { name: 'FileService' },
        methodName: 'readFile',
        namespace: 'fileAPI',
        parameters: [{ name: 'path', type: { name: 'string' } }],
        returnType: { name: 'Promise<string>' },
        filePath: 'src/services/FileService.ts'
      },
      {
        declaredType: { name: 'FileService' },
        methodName: 'writeFile',
        namespace: 'fileAPI',
        parameters: [{ name: 'path', type: { name: 'string' } }, { name: 'content', type: { name: 'string' } }],
        returnType: { name: 'Promise<void>' },
        filePath: 'src/services/FileService.ts'
      }
    ];
    
    await generator.generateFiles(methods);
    
    const mainContent = readFileSync(mainFile, 'utf8');
    
    // Should only have one import statement for FileService
    const importMatches = mainContent.match(/import { FileService } from/g);
    expect(importMatches).toHaveLength(1);
    
    // Should only have one singleton instance
    const instanceMatches = mainContent.match(/const fileserviceInstance = new FileService\(\)/g);
    expect(instanceMatches).toHaveLength(1);
  });

  it('should generate files with complex namespace combinations', async () => {
    const mainFile = join(testOutputDir, 'complex-main', 'ipc-handlers.ts');
    const preloadFile = join(testOutputDir, 'complex-preload', 'bridge.ts');
    const typeDefFile = join(testOutputDir, 'complex-types.d.ts');
    
    const generator = createElectronBridgeGenerator({
      mainProcessHandlerFile: mainFile,
      preloadHandlerFile: preloadFile,
      typeDefinitionsFile: typeDefFile,
      baseDir: testOutputDir
    });
    
    const methods = [
      {
        declaredType: { name: 'FileService' },
        methodName: 'readFile',
        namespace: 'fileAPI',
        parameters: [{ name: 'path', type: { name: 'string' } }],
        returnType: { name: 'Promise<string>' },
        filePath: 'src/services/FileService.ts'
      },
      {
        declaredType: { name: 'FileService' },
        methodName: 'writeFile',
        namespace: 'fileAPI',
        parameters: [{ name: 'path', type: { name: 'string' } }, { name: 'content', type: { name: 'string' } }],
        returnType: { name: 'Promise<void>' },
        filePath: 'src/services/FileService.ts'
      },
      {
        methodName: 'getVersion',
        namespace: 'systemAPI',
        parameters: [],
        returnType: { name: 'Promise<string>' },
        filePath: 'src/utils/system.ts'
      },
      {
        methodName: 'formatDate',
        namespace: 'utilsAPI',
        parameters: [{ name: 'date', type: { name: 'Date' } }],
        returnType: { name: 'Promise<string>' },
        filePath: 'src/utils/format.ts'
      }
    ];
    
    await generator.generateFiles(methods);
    
    // Test main handlers
    const mainContent = readFileSync(mainFile, 'utf8');
    const expectedMainContent = `// This is auto-generated main process handler by sublimity-electron-bridge.
// Do not edit manually this file.

import { ipcMain } from 'electron';
import { FileService } from '../src/services/FileService';
import { formatDate } from '../src/utils/format';
import { getVersion } from '../src/utils/system';

// Create singleton instances
const fileserviceInstance = new FileService();

// Register IPC handlers
ipcMain.handle('seb:fileAPI:readFile', (_, path) => fileserviceInstance.readFile(path));
ipcMain.handle('seb:fileAPI:writeFile', (_, path, content) => fileserviceInstance.writeFile(path, content));
ipcMain.handle('seb:systemAPI:getVersion', (_) => getVersion());
ipcMain.handle('seb:utilsAPI:formatDate', (_, date) => formatDate(date));
`;
    
    expect(mainContent).toBe(expectedMainContent);
    
    // Test preload bridge
    const preloadContent = readFileSync(preloadFile, 'utf8');
    const expectedPreloadContent = `// This is auto-generated preloader by sublimity-electron-bridge.
// Do not edit manually this file.

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('fileAPI', {
  readFile: (path: string) => ipcRenderer.invoke('seb:fileAPI:readFile', path),
  writeFile: (path: string, content: string) => ipcRenderer.invoke('seb:fileAPI:writeFile', path, content)
});
contextBridge.exposeInMainWorld('systemAPI', {
  getVersion: () => ipcRenderer.invoke('seb:systemAPI:getVersion')
});
contextBridge.exposeInMainWorld('utilsAPI', {
  formatDate: (date: Date) => ipcRenderer.invoke('seb:utilsAPI:formatDate', date)
});
`;
    
    expect(preloadContent).toBe(expectedPreloadContent);
    
    // Test type definitions
    const typeContent = readFileSync(typeDefFile, 'utf8');
    const expectedTypeContent = `// This is auto-generated type definitions by sublimity-electron-bridge.
// Do not edit manually this file.

interface FileAPI {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}
interface SystemAPI {
  getVersion(): Promise<string>;
}
interface UtilsAPI {
  formatDate(date: Date): Promise<string>;
}

declare global {
  interface Window {
    fileAPI: FileAPI;
    systemAPI: SystemAPI;
    utilsAPI: UtilsAPI;
  }
}

export {}
`;
    
    expect(typeContent).toBe(expectedTypeContent);
  });
});