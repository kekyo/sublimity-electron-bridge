import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createElectronBridgeGenerator } from '../src/generator';
import { createConsoleLogger } from '../src/logger';

describe('generator with empty functions', () => {
  let testDir: string;
  let generator: ReturnType<typeof createElectronBridgeGenerator>;

  beforeEach(async () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    testDir = join(tmpdir(), 'seb-test', 'core', 'generator-empty', timestamp);
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

    // Write test file WITHOUT any exposed functions
    await writeFile(join(testDir, 'src', 'no-exposed-functions.ts'), `
// This file has no exposed functions
export function regularFunction(value: string): string {
  return \`Regular: \${value}\`;
}

export class RegularService {
  process(data: string): string {
    return data.toUpperCase();
  }
}
`);

    generator = createElectronBridgeGenerator({
      logger: createConsoleLogger('generator-empty-test'),
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

  it('should generate valid files even with 0 exposed functions', async () => {
    const functions = await generator.analyzeFiles([
      join(testDir, 'src', 'no-exposed-functions.ts')
    ]);

    expect(functions).toHaveLength(0);
    
    await generator.generateFiles(functions);
    
    // Verify all files are generated with exact content
    const mainContent = await readFile(join(testDir, 'main/handlers.ts'), 'utf-8');
    const preloadContent = await readFile(join(testDir, 'preload/bridge.ts'), 'utf-8');
    const rendererContent = await readFile(join(testDir, 'renderer/bridge.ts'), 'utf-8');
    const typeContent = await readFile(join(testDir, 'types/api.d.ts'), 'utf-8');
    
    // Expected main handler content with no functions
    const expectedMainContent = `// This is auto-generated main process handler by sublimity-electron-bridge.
// Do not edit manually this file.

import { app, BrowserWindow, ipcMain } from 'electron';
import { createSublimityRpcController, SublimityRpcController, SublimityRpcMessage } from 'sublimity-rpc';

// Create singleton instances

// Store controllers for each window
const controllers = new Map<number, SublimityRpcController>();

// Setup RPC for each window
const setupWindowRPC = (window: BrowserWindow) => {
  const webContentsId = window.webContents.id;

  // Create RPC controller for this window
  const controller = createSublimityRpcController({
    onSendMessage: (message: SublimityRpcMessage) => {
      // Send message to this specific window
      if (!window.isDestroyed()) {
        window.webContents.send("rpc-message", message);
      }
    }
  });

  // Store controller
  controllers.set(webContentsId, controller);

  // Register RPC functions

  // Cleanup when window is closed
  window.on("closed", () => {
    controllers.delete(webContentsId);
  });
}

// Setup existing windows
app.on("ready", () => {
  BrowserWindow.getAllWindows().forEach(setupWindowRPC);
});

// Setup new windows
app.on("browser-window-created", (_, window) => {
  setupWindowRPC(window);
});

// Handle messages from preload process with Synchronous RPC mode
ipcMain.handle("rpc-message", async (event, message: SublimityRpcMessage): Promise<SublimityRpcMessage> => {
  const controller = controllers.get(event.sender.id);
  if (controller) {
    const response = await controller.insertMessageWaitable(message);
    return response;
  }
  throw new Error(\`Controller not found for webContents \${event.sender.id}\`);
});

// Legacy support: If global.mainWindow exists, set it up
if (typeof global !== "undefined" && global.mainWindow) {
  setupWindowRPC(global.mainWindow);
}
`;

    expect(mainContent).toBe(expectedMainContent);
    
    // Expected preload bridge content (unchanged for empty functions)
    const expectedPreloadContent = `// This is auto-generated preloader by sublimity-electron-bridge.
// Do not edit manually this file.

import { contextBridge, ipcRenderer } from 'electron';
import { SublimityRpcMessage } from 'sublimity-rpc';

// Expose RPC message bridge to renderer process
contextBridge.exposeInMainWorld("__sublimityBridge", {
  // Register listener for messages from main process
  onMessage: (callback: (message: SublimityRpcMessage) => void) => {
    ipcRenderer.on("rpc-message", (_, message) => callback(message));
  },
  // Send message to main process and get response synchronously
  sendMessage: async (message: SublimityRpcMessage): Promise<SublimityRpcMessage> => {
    return await ipcRenderer.invoke("rpc-message", message);
  }
});
`;

    expect(preloadContent).toBe(expectedPreloadContent);
    
    // Expected renderer bridge content with no functions
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
`;

    expect(rendererContent).toBe(expectedRendererContent);
    
    // Expected type definitions content with no functions
    const expectedTypeContent = `// This is auto-generated type definitions by sublimity-electron-bridge.
// Do not edit manually this file.

declare global {
  interface Window {
  }
}

export {}
`;

    expect(typeContent).toBe(expectedTypeContent);
  });

});