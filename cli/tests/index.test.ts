import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { mkdtempSync, existsSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('CLI Integration Tests', () => {
  let tempDir: string;
  let testSourceDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cli-test-'));
    testSourceDir = join(tempDir, 'src');
    mkdirSync(testSourceDir, { recursive: true });

    // Create tsconfig.json for the new extractor
    writeFileSync(join(tempDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: "ES2020",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        declaration: true,
        outDir: "./dist",
        rootDir: "./src"
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
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  const runCLI = (args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
    return new Promise((resolve) => {
      const cliPath = join(__dirname, '../dist/cli.js');
      const child = spawn('node', [cliPath, ...args], {
        cwd: tempDir,
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

  it('should generate correct bridge files from TypeScript sources', async () => {
    const result = await runCLI(['generate', 'src/UserService.ts', 'src/system.ts']);
    
    expect(result.exitCode).toBe(0);

    // Verify main IPC handlers file
    const mainHandlersPath = join(tempDir, 'src/main/generated/seb_main.ts');
    expect(existsSync(mainHandlersPath)).toBe(true);
    
    const mainHandlers = readFileSync(mainHandlersPath, 'utf-8');
    const expectedMainHandlers = `// This is auto-generated main process handler by sublimity-electron-bridge.
// Do not edit manually this file.

import { ipcMain } from 'electron';
import { createSublimityRpcController } from 'sublimity-rpc';
import { UserService } from '../../UserService';
import { getSystemInfo } from '../../system';
import { getUptime } from '../../system';

// Create singleton instances
const userserviceInstance = new UserService();

// Create RPC controller
const controller = createSublimityRpcController({
  onSendMessage: message => {
    // Send message to preload process
    global.mainWindow.webContents.send("rpc-message", message);
  }
});

// Handle messages from preload process
ipcMain.on("rpc-message", (_, message) => {
  controller.insertMessage(message);
});

// Register RPC functions
controller.register('mainProcess:getCurrentUser', () => userserviceInstance.getCurrentUser());
controller.register('mainProcess:getUptime', () => getUptime());
controller.register('systemAPI:getSystemInfo', () => getSystemInfo());
controller.register('userAPI:getUser', (id) => userserviceInstance.getUser(id));
`;
    
    expect(mainHandlers).toBe(expectedMainHandlers);

    // Verify preload bridge file
    const preloadBridgePath = join(tempDir, 'src/preload/generated/seb_preload.ts');
    expect(existsSync(preloadBridgePath)).toBe(true);
    
    const preloadBridge = readFileSync(preloadBridgePath, 'utf-8');
    const expectedPreloadBridge = `// This is auto-generated preloader by sublimity-electron-bridge.
// Do not edit manually this file.

import { contextBridge, ipcRenderer } from 'electron';
import { createSublimityRpcController } from 'sublimity-rpc';

import type { Promise } from '../../../../../home/kouji/Projects/sublimity-electron-bridge/node_modules/typescript/lib/lib.es2015.promise.d';
import type { SystemInfo } from '../../system';
import type { User } from '../../UserService';

// Create RPC controller
const controller = createSublimityRpcController({
  onSendMessage: message => {
    // Send message to main process
    ipcRenderer.send("rpc-message", message);
  }
});

// Handle messages from main process
ipcRenderer.on("rpc-message", (_, message) => {
  controller.insertMessage(message);
});

contextBridge.exposeInMainWorld('mainProcess', {
  getCurrentUser: () => controller.invoke('mainProcess:getCurrentUser'),
  getUptime: () => controller.invoke('mainProcess:getUptime')
});
contextBridge.exposeInMainWorld('systemAPI', {
  getSystemInfo: () => controller.invoke('systemAPI:getSystemInfo')
});
contextBridge.exposeInMainWorld('userAPI', {
  getUser: (id: number) => controller.invoke('userAPI:getUser', id)
});
`;
    
    expect(preloadBridge).toBe(expectedPreloadBridge);

    // Verify type definitions file
    const typeDefsPath = join(tempDir, 'src/renderer/src/generated/seb_types.ts');
    expect(existsSync(typeDefsPath)).toBe(true);
    
    const typeDefs = readFileSync(typeDefsPath, 'utf-8');
    const expectedTypeDefs = `// This is auto-generated type definitions by sublimity-electron-bridge.
// Do not edit manually this file.

import type { Promise } from '../../../../../home/kouji/Projects/sublimity-electron-bridge/node_modules/typescript/lib/lib.es2015.promise.d';
import type { SystemInfo } from '../../../system';
import type { User } from '../../../UserService';

interface MainProcess {
  getCurrentUser(): Promise<User | null>;
  getUptime(): Promise<number>;
}
interface SystemAPI {
  getSystemInfo(): Promise<SystemInfo>;
}
interface UserAPI {
  getUser(id: number): Promise<User>;
}

declare global {
  interface Window {
    mainProcess: MainProcess;
    systemAPI: SystemAPI;
    userAPI: UserAPI;
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
      '--baseDir', tempDir,
      '--main', 'custom-main/ipc-handlers.ts',
      '--preload', 'custom-preload/bridge.ts',
      '--types', 'custom-types/api.d.ts'
    ]);

    expect(result.exitCode).toBe(0);

    // Verify files exist in custom locations
    expect(existsSync(join(tempDir, 'custom-main/ipc-handlers.ts'))).toBe(true);
    expect(existsSync(join(tempDir, 'custom-preload/bridge.ts'))).toBe(true);
    expect(existsSync(join(tempDir, 'custom-types/api.d.ts'))).toBe(true);

    // Verify content is correct
    const mainHandlers = readFileSync(join(tempDir, 'custom-main/ipc-handlers.ts'), 'utf-8');
    const expectedMainHandlers = `// This is auto-generated main process handler by sublimity-electron-bridge.
// Do not edit manually this file.

import { ipcMain } from 'electron';
import { createSublimityRpcController } from 'sublimity-rpc';
import { UserService } from '../src/UserService';
import { getSystemInfo } from '../src/system';
import { getUptime } from '../src/system';

// Create singleton instances
const userserviceInstance = new UserService();

// Create RPC controller
const controller = createSublimityRpcController({
  onSendMessage: message => {
    // Send message to preload process
    global.mainWindow.webContents.send("rpc-message", message);
  }
});

// Handle messages from preload process
ipcMain.on("rpc-message", (_, message) => {
  controller.insertMessage(message);
});

// Register RPC functions
controller.register('mainProcess:getCurrentUser', () => userserviceInstance.getCurrentUser());
controller.register('mainProcess:getUptime', () => getUptime());
controller.register('systemAPI:getSystemInfo', () => getSystemInfo());
controller.register('userAPI:getUser', (id) => userserviceInstance.getUser(id));
`;
    
    expect(mainHandlers).toBe(expectedMainHandlers);
  });

  it('should handle empty input pattern gracefully', async () => {
    const result = await runCLI(['generate', 'src/NonExistentFile.ts']);
    
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toMatch(/Error accessing.*NonExistentFile\.ts/);
    expect(result.stderr).toMatch(/No valid files found to analyze/);
  });

  it('should use custom default namespace', async () => {
    const result = await runCLI([
      'generate',
      'src/UserService.ts', 'src/system.ts',
      '--namespace', 'customAPI'
    ]);
    
    expect(result.exitCode).toBe(0);

    const mainHandlers = readFileSync(join(tempDir, 'src/main/generated/seb_main.ts'), 'utf-8');
    const expectedMainHandlers = `// This is auto-generated main process handler by sublimity-electron-bridge.
// Do not edit manually this file.

import { ipcMain } from 'electron';
import { createSublimityRpcController } from 'sublimity-rpc';
import { UserService } from '../../UserService';
import { getSystemInfo } from '../../system';
import { getUptime } from '../../system';

// Create singleton instances
const userserviceInstance = new UserService();

// Create RPC controller
const controller = createSublimityRpcController({
  onSendMessage: message => {
    // Send message to preload process
    global.mainWindow.webContents.send("rpc-message", message);
  }
});

// Handle messages from preload process
ipcMain.on("rpc-message", (_, message) => {
  controller.insertMessage(message);
});

// Register RPC functions
controller.register('customAPI:getCurrentUser', () => userserviceInstance.getCurrentUser());
controller.register('customAPI:getUptime', () => getUptime());
controller.register('systemAPI:getSystemInfo', () => getSystemInfo());
controller.register('userAPI:getUser', (id) => userserviceInstance.getUser(id));
`;
    
    expect(mainHandlers).toBe(expectedMainHandlers);

    const typeDefs = readFileSync(join(tempDir, 'src/renderer/src/generated/seb_types.ts'), 'utf-8');
    const expectedTypeDefs = `// This is auto-generated type definitions by sublimity-electron-bridge.
// Do not edit manually this file.

import type { Promise } from '../../../../../home/kouji/Projects/sublimity-electron-bridge/node_modules/typescript/lib/lib.es2015.promise.d';
import type { SystemInfo } from '../../../system';
import type { User } from '../../../UserService';

interface CustomAPI {
  getCurrentUser(): Promise<User | null>;
  getUptime(): Promise<number>;
}
interface SystemAPI {
  getSystemInfo(): Promise<SystemInfo>;
}
interface UserAPI {
  getUser(id: number): Promise<User>;
}

declare global {
  interface Window {
    customAPI: CustomAPI;
    systemAPI: SystemAPI;
    userAPI: UserAPI;
  }
}

export {}
`;
    
    expect(typeDefs).toBe(expectedTypeDefs);
  });
});
