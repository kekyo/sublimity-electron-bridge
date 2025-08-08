import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { existsSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import dayjs from 'dayjs';

describe('CLI Integration Tests', () => {
  const testOutputBaseDir = join(tmpdir(), 'seb-test/cli/cli', dayjs().format('YYYYMMDD_HHmmssSSS'));
  let testOutputDir: string;
  let testSourceDir: string;

  beforeEach(fn => {
    // Create unique temporary directory for each test
    testOutputDir = join(testOutputBaseDir, fn.task.name);
    mkdirSync(testOutputDir, { recursive: true });
    console.info(`Test output directory: ${testOutputDir}`);

    testSourceDir = join(testOutputDir, 'src');
    mkdirSync(testSourceDir, { recursive: true });

    // Create tsconfig.json for the new extractor
    writeFileSync(join(testOutputDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        lib: ["ES2022"],
        module: "ESNext",
        moduleResolution: "node",
        resolveJsonModule: true,
        allowImportingTsExtensions: true,
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        declaration: true,
        declarationMap: true,
        outDir: "./dist",
        rootDir: "./src",
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        forceConsistentCasingInFileNames: true
      },
      include: ["src/**/*"],
      exclude: ["node_modules", "dist"]
    }, null, 2));

    // Create test TypeScript source files
    writeFileSync(join(testSourceDir, 'UserService.ts'), `
export class UserService {
  /**
   * @decorator expose userAPI
   */
  async getUser(id: number): Promise<User> {
    return { id, name: "Test User" } as User
  }

  /**
   * @decorator expose
   */
  async getCurrentUser(): Promise<User | null> {
    return null
  }
}

interface User {
  id: number
  name: string
}
`);

    writeFileSync(join(testSourceDir, 'system.ts'), `
/**
 * @decorator expose systemAPI
 */
export async function getSystemInfo(): Promise<SystemInfo> {
  return {
    platform: process.platform,
    version: process.version
  }
}

/**
 * @decorator expose
 */
export async function getUptime(): Promise<number> {
  return process.uptime()
}

interface SystemInfo {
  platform: string
  version: string
}
`)
  });

  afterEach(() => {
    if (existsSync(testOutputDir)) {
      rmSync(testOutputDir, { recursive: true, force: true });
    }
  });

  const runCLI = (args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
    return new Promise((resolve) => {
      const cliPath = join(__dirname, '../dist/cli.js');
      const child = spawn('node', [cliPath, ...args], {
        cwd: testOutputDir,
        env: { ...process.env }
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        resolve({ stdout, stderr, exitCode: code || 0 });
      });
    });
  }

  const expectCLISuccess = (result: { stdout: string; stderr: string; exitCode: number }, expectStderr: boolean = false) => {
    if (result.exitCode !== 0) {
      const errorMessage = [
        `CLI command failed with exit code ${result.exitCode}`,
        `STDOUT: ${result.stdout}`,
        `STDERR: ${result.stderr}`
      ].join('\n');
      throw new Error(errorMessage);
    }
    expect(result.exitCode).toBe(0);
    if (!expectStderr) {
      expect(result.stderr).toBe('');
    }
  };

  it('should generate correct bridge files from TypeScript sources', async () => {
    const result = await runCLI(['generate', 'src/UserService.ts', 'src/system.ts']);

    expectCLISuccess(result);

    // Verify main IPC handlers file
    const mainHandlersPath = join(testOutputDir, 'src/main/generated/seb_main.ts');
    expect(existsSync(mainHandlersPath)).toBe(true);

    const mainHandlers = readFileSync(mainHandlersPath, 'utf-8');
    const expectedMainHandlers = `// This is auto-generated main process handler by sublimity-electron-bridge.
// Do not edit manually this file.

import { app, BrowserWindow, ipcMain } from 'electron';
import { createSublimityRpcController, SublimityRpcController, SublimityRpcMessage } from 'sublimity-rpc';
import { getSystemInfo, getUptime } from '../../system';
import { UserService } from '../../UserService';

// Create singleton instances
const __UserServiceInstance = new UserService();

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

  // Handle messages from preload process
  ipcMain.on("rpc-message", (_, message: SublimityRpcMessage) => {
    controller.insertMessage(message);
  });

  // Store controller
  controllers.set(webContentsId, controller);

  // Register RPC functions
  controller.register('mainProcess:getUptime', getUptime);
  controller.register('systemAPI:getSystemInfo', getSystemInfo);
  controller.register('userAPI:getUser', __UserServiceInstance.getUser);
  controller.register('userService:getCurrentUser', __UserServiceInstance.getCurrentUser);

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
ipcMain.handle("rpc-invoke", async (event, message: SublimityRpcMessage): Promise<SublimityRpcMessage> => {
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

    expect(mainHandlers).toBe(expectedMainHandlers);

    // Verify preload bridge file
    const preloadBridgePath = join(testOutputDir, 'src/preload/generated/seb_preload.ts');
    expect(existsSync(preloadBridgePath)).toBe(true);

    const preloadBridge = readFileSync(preloadBridgePath, 'utf-8');
    const expectedPreloadBridge = `// This is auto-generated preloader by sublimity-electron-bridge.
// Do not edit manually this file.

import { contextBridge, ipcRenderer } from 'electron';
import { createSublimityRpcController, SublimityRpcMessage } from 'sublimity-rpc';
import type { SystemInfo } from '../../system';
import type { User } from '../../UserService';

// Create RPC controller with Synchronous RPC mode
const controller = createSublimityRpcController({
  onSendMessage: async (message: SublimityRpcMessage): Promise<SublimityRpcMessage> => {
    // Send message to main process and get response synchronously
    const response = await ipcRenderer.invoke("rpc-invoke", message);
    return response;
  }
});

// Handle messages from main process
ipcRenderer.on("rpc-message", (_, message: SublimityRpcMessage) => {
  controller.insertMessage(message);
});

// Expose RPC functions to renderer process
contextBridge.exposeInMainWorld('mainProcess', {
  getUptime: () => controller.invoke<number>('mainProcess:getUptime')
});
contextBridge.exposeInMainWorld('systemAPI', {
  getSystemInfo: () => controller.invoke<SystemInfo>('systemAPI:getSystemInfo')
});
contextBridge.exposeInMainWorld('userAPI', {
  getUser: (id: number) => controller.invoke<User>('userAPI:getUser', id)
});
contextBridge.exposeInMainWorld('userService', {
  getCurrentUser: () => controller.invoke<User | null>('userService:getCurrentUser')
});
`;

    expect(preloadBridge).toBe(expectedPreloadBridge);

    // Verify type definitions file
    const typeDefsPath = join(testOutputDir, 'src/renderer/src/generated/seb_types.ts');
    expect(existsSync(typeDefsPath)).toBe(true);

    const typeDefs = readFileSync(typeDefsPath, 'utf-8');
    const expectedTypeDefs = `// This is auto-generated type definitions by sublimity-electron-bridge.
// Do not edit manually this file.

import type { SystemInfo } from '../../../system';
import type { User } from '../../../UserService';

export interface __mainProcessType {
  readonly getUptime: () => Promise<number>;
}
export interface __systemAPIType {
  readonly getSystemInfo: () => Promise<SystemInfo>;
}
export interface __userAPIType {
  readonly getUser: (id: number) => Promise<User>;
}
export interface __userServiceType {
  readonly getCurrentUser: () => Promise<User | null>;
}

declare global {
  interface Window {
    readonly mainProcess: __mainProcessType;
    readonly systemAPI: __systemAPIType;
    readonly userAPI: __userAPIType;
    readonly userService: __userServiceType;
  }
}

export {}
`;

    expect(typeDefs).toBe(expectedTypeDefs);
  })

  it('should use custom output directories when specified', async () => {
    const result = await runCLI([
      'generate',
      'src/UserService.ts', 'src/system.ts',
      '--baseDir', testOutputDir,
      '--main', 'custom-main/ipc-handlers.ts',
      '--preload', 'custom-preload/bridge.ts',
      '--types', 'custom-types/api.d.ts'
    ]);

    expectCLISuccess(result);

    // Verify files exist in custom locations
    expect(existsSync(join(testOutputDir, 'custom-main/ipc-handlers.ts'))).toBe(true);
    expect(existsSync(join(testOutputDir, 'custom-preload/bridge.ts'))).toBe(true);
    expect(existsSync(join(testOutputDir, 'custom-types/api.d.ts'))).toBe(true);

    // Verify content is correct
    const mainHandlers = readFileSync(join(testOutputDir, 'custom-main/ipc-handlers.ts'), 'utf-8');
    const expectedMainHandlers = `// This is auto-generated main process handler by sublimity-electron-bridge.
// Do not edit manually this file.

import { app, BrowserWindow, ipcMain } from 'electron';
import { createSublimityRpcController, SublimityRpcController, SublimityRpcMessage } from 'sublimity-rpc';
import { getSystemInfo, getUptime } from '../src/system';
import { UserService } from '../src/UserService';

// Create singleton instances
const __UserServiceInstance = new UserService();

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

  // Handle messages from preload process
  ipcMain.on("rpc-message", (_, message: SublimityRpcMessage) => {
    controller.insertMessage(message);
  });

  // Store controller
  controllers.set(webContentsId, controller);

  // Register RPC functions
  controller.register('mainProcess:getUptime', getUptime);
  controller.register('systemAPI:getSystemInfo', getSystemInfo);
  controller.register('userAPI:getUser', __UserServiceInstance.getUser);
  controller.register('userService:getCurrentUser', __UserServiceInstance.getCurrentUser);

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
ipcMain.handle("rpc-invoke", async (event, message: SublimityRpcMessage): Promise<SublimityRpcMessage> => {
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

    expect(mainHandlers).toBe(expectedMainHandlers);
  });

  it('should handle empty input pattern gracefully', async () => {
    const result = await runCLI(['generate', 'src/NonExistentFile.ts']);

    expectCLISuccess(result, true);
    expect(result.stderr).toMatch(/Error accessing.*NonExistentFile\.ts/);
    expect(result.stderr).toMatch(/No valid files found to analyze/);
  });

  it('should use custom default namespace', async () => {
    const result = await runCLI([
      'generate',
      'src/UserService.ts', 'src/system.ts',
      '--namespace', 'customAPI'
    ]);

    expectCLISuccess(result);

    const mainHandlers = readFileSync(join(testOutputDir, 'src/main/generated/seb_main.ts'), 'utf-8');
    const expectedMainHandlers = `// This is auto-generated main process handler by sublimity-electron-bridge.
// Do not edit manually this file.

import { app, BrowserWindow, ipcMain } from 'electron';
import { createSublimityRpcController, SublimityRpcController, SublimityRpcMessage } from 'sublimity-rpc';
import { getSystemInfo, getUptime } from '../../system';
import { UserService } from '../../UserService';

// Create singleton instances
const __UserServiceInstance = new UserService();

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

  // Handle messages from preload process
  ipcMain.on("rpc-message", (_, message: SublimityRpcMessage) => {
    controller.insertMessage(message);
  });

  // Store controller
  controllers.set(webContentsId, controller);

  // Register RPC functions
  controller.register('customAPI:getUptime', getUptime);
  controller.register('systemAPI:getSystemInfo', getSystemInfo);
  controller.register('userAPI:getUser', __UserServiceInstance.getUser);
  controller.register('userService:getCurrentUser', __UserServiceInstance.getCurrentUser);

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
ipcMain.handle("rpc-invoke", async (event, message: SublimityRpcMessage): Promise<SublimityRpcMessage> => {
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

    expect(mainHandlers).toBe(expectedMainHandlers);

    const typeDefs = readFileSync(join(testOutputDir, 'src/renderer/src/generated/seb_types.ts'), 'utf-8');
    const expectedTypeDefs = `// This is auto-generated type definitions by sublimity-electron-bridge.
// Do not edit manually this file.

import type { SystemInfo } from '../../../system';
import type { User } from '../../../UserService';

export interface __customAPIType {
  readonly getUptime: () => Promise<number>;
}
export interface __systemAPIType {
  readonly getSystemInfo: () => Promise<SystemInfo>;
}
export interface __userAPIType {
  readonly getUser: (id: number) => Promise<User>;
}
export interface __userServiceType {
  readonly getCurrentUser: () => Promise<User | null>;
}

declare global {
  interface Window {
    readonly customAPI: __customAPIType;
    readonly systemAPI: __systemAPIType;
    readonly userAPI: __userAPIType;
    readonly userService: __userServiceType;
  }
}

export {}
`;
    
    expect(typeDefs).toBe(expectedTypeDefs);
  });
});
