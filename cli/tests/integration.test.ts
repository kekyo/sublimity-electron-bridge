import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { existsSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import dayjs from 'dayjs';

describe('CLI Integration Tests with Build Verification', () => {
  const testOutputBaseDir = join(tmpdir(), 'seb-test/cli/cli', dayjs().format('YYYYMMDD_HHmmssSSS'));
  let testOutputDir: string;
  let testSourceDir: string;

  beforeEach(async fn => {
     // Create unique temporary directory for each test
    testOutputDir = join(testOutputBaseDir, fn.task.name);
    mkdirSync(testOutputDir, { recursive: true });
    console.info(`Test output directory: ${testOutputDir}`);

    testSourceDir = join(testOutputDir, 'src');
    mkdirSync(testSourceDir, { recursive: true });

    // Create package.json with necessary dependencies
    writeFileSync(join(testOutputDir, 'package.json'), JSON.stringify({
      name: "test-project",
      version: "1.0.0",
      scripts: {
        build: "tsc --noEmit"
      },
      dependencies: {
        "electron": "^32.0.0",
        "sublimity-rpc": "^0.2.1"
      },
      devDependencies: {
        "typescript": "^5.8.3",
        "@types/node": "^24.0.10"
      }
    }, null, 2));

    // Install dependencies using npm (same as real users would do)
    const installResult = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
      const child = spawn('npm', ['install'], {
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

    // If npm install fails, the test should reflect that reality
    if (installResult.exitCode !== 0) {
      throw new Error(`npm install failed as it would for real users:\n${installResult.stderr}`);
    }

    // Create tsconfig.json for TypeScript compilation
    writeFileSync(join(testOutputDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: "ES2020",
        module: "ESNext",
        moduleResolution: "node",
        strict: true,
        noImplicitAny: false,
        declaration: true,
        outDir: "./dist",
        rootDir: "./src",
        skipLibCheck: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        forceConsistentCasingInFileNames: true,
        noEmit: true
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
    return { id, name: "Test User" } as User;
  }

  /**
   * @decorator expose
   */
  async getCurrentUser(): Promise<User | null> {
    return null;
  }
}

export interface User {
  id: number;
  name: string;
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
  };
}

/**
 * @decorator expose
 */
export async function getUptime(): Promise<number> {
  return process.uptime();
}

export interface SystemInfo {
  platform: string;
  version: string;
}
`);

    // Create necessary directories for generated files
    mkdirSync(join(testOutputDir, 'src/main/generated'), { recursive: true });
    mkdirSync(join(testOutputDir, 'src/preload/generated'), { recursive: true });
    mkdirSync(join(testOutputDir, 'src/renderer/src/generated'), { recursive: true });

    // Create a minimal main window type definition for global.mainWindow
    writeFileSync(join(testOutputDir, 'src/global.d.ts'), `
import { BrowserWindow } from 'electron';

declare global {
  var mainWindow: BrowserWindow;
  var global: typeof globalThis;
}
`);
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
  };

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

  const runTypeScriptBuild = (): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
    return new Promise((resolve) => {
      // Use the global TypeScript installation from the parent project
      const tscPath = join(__dirname, '../../node_modules/.bin/tsc');
      const child = spawn(tscPath, ['--noEmit'], {
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
  };

  it('should generate bridge files and verify they compile successfully', async () => {
    // Step 1: Generate bridge files using CLI
    const generateResult = await runCLI(['generate', 'src/UserService.ts', 'src/system.ts']);

    expectCLISuccess(generateResult);

    // Step 2: Verify generated files exist
    const mainHandlersPath = join(testOutputDir, 'src/main/generated/seb_main.ts');
    const preloadBridgePath = join(testOutputDir, 'src/preload/generated/seb_preload.ts');
    const typeDefsPath = join(testOutputDir, 'src/renderer/src/generated/seb_types.ts');

    expect(existsSync(mainHandlersPath)).toBe(true);
    expect(existsSync(preloadBridgePath)).toBe(true);
    expect(existsSync(typeDefsPath)).toBe(true);

    // Step 3: Verify generated files contain expected content
    const mainHandlers = readFileSync(mainHandlersPath, 'utf-8');
    const preloadBridge = readFileSync(preloadBridgePath, 'utf-8');
    const typeDefs = readFileSync(typeDefsPath, 'utf-8');

    // Check that generated files contain expected imports and function calls
    expect(mainHandlers).toContain('import { app, BrowserWindow, ipcMain } from \'electron\'');
    expect(mainHandlers).toContain('import { createSublimityRpcController, SublimityRpcController, SublimityRpcMessage } from \'sublimity-rpc\'');
    expect(mainHandlers).toContain('import { UserService } from \'../../UserService\'');
    expect(mainHandlers).toContain('import { getSystemInfo, getUptime } from \'../../system\'');
    expect(mainHandlers).toContain('controller.register(\'userAPI:getUser\'');
    expect(mainHandlers).toContain('controller.register(\'systemAPI:getSystemInfo\'');

    expect(preloadBridge).toContain('import { contextBridge, ipcRenderer } from \'electron\'');
    expect(preloadBridge).toContain('import { createSublimityRpcController, SublimityRpcMessage } from \'sublimity-rpc\'');
    expect(preloadBridge).toContain('contextBridge.exposeInMainWorld(\'userAPI\'');
    expect(preloadBridge).toContain('contextBridge.exposeInMainWorld(\'systemAPI\'');

    expect(typeDefs).toContain('import type { SystemInfo } from \'../../../system\'');
    expect(typeDefs).toContain('import type { User } from \'../../../UserService\'');
    expect(typeDefs).toContain('__userAPIType');
    expect(typeDefs).toContain('__systemAPIType');
    expect(typeDefs).toContain('declare global');

    // Step 4: Verify TypeScript compilation succeeds
    const buildResult = await runTypeScriptBuild();

    expectCLISuccess(buildResult);

    // If there are any TypeScript errors, they should be displayed in stderr
    if (buildResult.stderr && buildResult.stderr.includes('error TS')) {
      throw new Error(`TypeScript compilation failed:\n${buildResult.stderr}`);
    }
  });

  it('should generate bridge files with custom paths and verify compilation', async () => {
    // Step 1: Generate bridge files with custom paths
    const generateResult = await runCLI([
      'generate',
      'src/UserService.ts', 'src/system.ts',
      '--baseDir', testOutputDir,
      '--main', 'custom-main/handlers.ts',
      '--preload', 'custom-preload/bridge.ts',
      '--types', 'custom-types/api.d.ts'
    ]);

    expectCLISuccess(generateResult);

    // Step 2: Verify files exist in custom locations
    const mainHandlersPath = join(testOutputDir, 'custom-main/handlers.ts');
    const preloadBridgePath = join(testOutputDir, 'custom-preload/bridge.ts');
    const typeDefsPath = join(testOutputDir, 'custom-types/api.d.ts');

    expect(existsSync(mainHandlersPath)).toBe(true);
    expect(existsSync(preloadBridgePath)).toBe(true);
    expect(existsSync(typeDefsPath)).toBe(true);

    // Step 3: Update tsconfig.json to include custom paths
    const updatedTsConfig = JSON.parse(readFileSync(join(testOutputDir, 'tsconfig.json'), 'utf-8'));
    updatedTsConfig.include = [...updatedTsConfig.include, 'custom-main/**/*', 'custom-preload/**/*', 'custom-types/**/*'];
    // Remove rootDir restriction since we're using custom paths outside src/
    delete updatedTsConfig.compilerOptions.rootDir;
    writeFileSync(join(testOutputDir, 'tsconfig.json'), JSON.stringify(updatedTsConfig, null, 2));

    // Step 4: Verify generated files have correct import paths
    const mainHandlers = readFileSync(mainHandlersPath, 'utf-8');
    expect(mainHandlers).toContain('import { UserService } from \'../src/UserService\'');
    expect(mainHandlers).toContain('import { getSystemInfo, getUptime } from \'../src/system\'');

    const typeDefs = readFileSync(typeDefsPath, 'utf-8');
    expect(typeDefs).toContain('import type { SystemInfo } from \'../src/system\'');
    expect(typeDefs).toContain('import type { User } from \'../src/UserService\'');

    // Step 5: Verify TypeScript compilation succeeds with custom paths
    const buildResult = await runTypeScriptBuild();

    expectCLISuccess(buildResult);

    if (buildResult.stderr && buildResult.stderr.includes('error TS')) {
      throw new Error(`TypeScript compilation failed with custom paths:\n${buildResult.stderr}`);
    }
  });

  it('should handle namespace customization and verify compilation', async () => {
    // Step 1: Generate bridge files with custom namespace
    const generateResult = await runCLI([
      'generate',
      'src/UserService.ts', 'src/system.ts',
      '--namespace', 'customAPI'
    ]);

    expectCLISuccess(generateResult);

    // Step 2: Verify generated files contain custom namespace
    const mainHandlersPath = join(testOutputDir, 'src/main/generated/seb_main.ts');
    const typeDefsPath = join(testOutputDir, 'src/renderer/src/generated/seb_types.ts');

    const mainHandlers = readFileSync(mainHandlersPath, 'utf-8');
    const typeDefs = readFileSync(typeDefsPath, 'utf-8');

    expect(mainHandlers).toContain('controller.register(\'userService:getCurrentUser\'');
    expect(mainHandlers).toContain('controller.register(\'customAPI:getUptime\'');

    expect(typeDefs).toContain('__customAPIType');
    expect(typeDefs).toContain('customAPI: __customAPIType');

    // Step 3: Verify TypeScript compilation succeeds with custom namespace
    const buildResult = await runTypeScriptBuild();

    expectCLISuccess(buildResult);

    if (buildResult.stderr && buildResult.stderr.includes('error TS')) {
      throw new Error(`TypeScript compilation failed with custom namespace:\n${buildResult.stderr}`);
    }
  });
});
