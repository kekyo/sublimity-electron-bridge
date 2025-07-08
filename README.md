# Sublimity Electron IPC Bridge

An automated code generation tool for Electron applications that eliminates the need for manual IPC (Inter-Process Communication) setup between the main process and renderer process. 

## Status

[![Project Status: WIP – Initial development is in progress, but there has not yet been a stable, usable release suitable for the public.](https://www.repostatus.org/badges/latest/wip.svg)](https://www.repostatus.org/#wip)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

|Package|Link|
|:----|:----|
|npm CLI|[![npm CLI](https://badge.fury.io/js/sublimity-electron-bridge-cli.svg)](https://www.npmjs.com/package/sublimity-electron-bridge-cli)|
|npm Vite plugin|[![npm vite-plugin](https://badge.fury.io/js/sublimity-electron-bridge-vite.svg)](https://www.npmjs.com/package/sublimity-electron-bridge-vite)|

-----

## Overview

Are you writing a lot of glue code by hand in your Electron application that calls functions implemented in the main process from the render process? Are you fed up? This tool may be useful for you.

Sublimity Electron IPC Bridge automates setting up IPC communication with only JSDoc annotation.

This tool analyzes TypeScript source code and automatically generates the necessary IPC handlers, preload bridge scripts, and type definitions.

### Short example

We want to expose main process function to render process, add JSDoc `@decorator expose`:

```typescript
/**
 * Get system information in Electron main process.
 * "Decorator" makes to expose this function to render process automatically.
 * @decorator expose fileAPI
 */
export async function getSystemInfo(): Promise<SystemInfo> {
  return {
    platform: process.platform,
    version: process.version,
    arch: process.arch
  }
}
```

Then it is generated automatically preloader function and type-safe interface,
and we can access it from render proces naturally:

```typescript
// Renderer process with full type safety
const systemInfo = await window.fileAPI.getSystemInfo();
console.log(`Running on ${systemInfo.platform}`);
```

Using this tool, the following source code will be automatically generated:

```
project/
├── src/main/generated/
│   └── seb_main.ts          # IPC event handlers
├── src/preload/generated/
│   └── seb_preload.ts       # Context bridge implementation
└── src/renderer/src/generated/
    └── seb_types.d.ts       # TypeScript type definitions
```

These directories and files are default location.
For more information, see below section.

-----

## Installation and Usage

Choose between CLI tool or Vite plugin based on your development workflow:

### CLI Tool

Install the CLI package globally or use it with npx:

```bash
npm install -g sublimity-electron-bridge-cli
```

#### Basic Usage

```bash
# Generate bridge code for specific TypeScript files
seb generate src/services/FileService.ts src/utils/system.ts

# Specify custom output directories
seb generate src/services/FileService.ts \
  --main src/main/seb_main.ts \
  --preload src/preload/seb_preload.ts

# Custom type definitions location
seb generate src/services/FileService.ts \
  --types src/renderer/src/seb_types.d.ts
```

#### CLI Options

```bash
seb generate <files...>

Options:
  -b, --baseDir <path>   Project base directory path (default: Current directory)
  -m, --main <file>      Main process output file (default: "src/main/generated/seb_main.ts")
  -p, --preload <file>   Preload script output file (default: "src/preload/generated/seb_preload.ts") 
  -t, --types <file>     Type definitions output file (default: "src/renderer/src/generated/seb_types.d.ts")
  -n, --namespace <name> Default namespace (default: "mainProcess")
  -h, --help             Display help information
```

### Vite Plugin

Install the Vite plugin for automatic generation during development builds:

```bash
npm install --save-dev sublimity-electron-bridge-vite
```

#### Configuration

Add the plugin to your `vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import { sublimityElectronBridge } from 'sublimity-electron-bridge-vite';

export default defineConfig({
  plugins: [
    sublimityElectronBridge()   // The plugin
  ]
});
```

Or you use with electron-vite `electron.vite.config.ts`:

```typescript
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { sublimityElectronBridge } from 'sublimity-electron-bridge-vite';

export default defineConfig({
  main: {   // NOTE: We have to place the plugin into `main` process.
    plugins: [
      externalizeDepsPlugin(),
      sublimityElectronBridge()   // The plugin
    ]
  }
});
```

#### Options

```typescript
interface SublimityElectronBridgeOptions {
  mainProcessHandlerFile?: string;   // Default: "src/main/generated/seb_main.ts"
  preloadHandlerFile?: string;       // Default: "src/preload/generated/seb_preload.ts"
  typeDefinitionsFile?: string;      // Default: "src/renderer/src/generated/seb_types.d.ts"
  defaultNamespace?: string;         // Default: "mainProcess"
  enableWorker?: boolean;            // Default: true - Enable worker thread processing
  sourceFiles?: string[];            // Default: "src/main/**/*.ts"
}
```

For example:

```typescript
export default defineConfig({
  plugins: [
    sublimityElectronBridge({
      typeDefinitionsFile: "src/renderer/src/types.d.ts",   // Type definition in renderer
      defaultNamespace: "main"                              // Place into: `window.main.foobar()`
    });
  ]
});
```

-----

## Code Example

The JSDoc decorator is specified by `@decorator expose`.
You can also specify the name of the object to be placed as an optional argument `@decorator expose <namespace>`.
Default namespace is `mainProcess` when does not override optional parameter.

### Prepare import auto-generated code

In `src/main/index.ts`:

```typescript
// Will be automatic hooking by this import:
import 'generated/seb_main.ts';

// (Remains main process code fragemnts...)
```

In `src/preload/index.ts`:

```typescript
// Will be automatic hooking by this import:
import 'generated/seb_preload.ts';

// (Remains preload code fragemnts...)
```

In `src/renderer/src/main.ts`:

```typescript
// Will be import type declarations:
import 'generated/seb_types.d.ts';

// (Remains renderer code fragemnts...)
```

### The expose decorators

Main process class example in: `main/services/FileService.ts`:

```typescript
export class FileService {
  /**
   * "window.fileAPI.readFile(path: string) => Promise<string>"
   * @decorator expose fileAPI
   */
  async readFile(path: string): Promise<string> {
    const fs = await import('fs/promises');
    return fs.readFile(path, 'utf-8');
  }

  /**
   * "window.fileAPI.writeFile(path: string, content: string): Promise<void>"
   * @decorator expose fileAPI
   */
  async writeFile(path: string, content: string): Promise<void> {
    const fs = await import('fs/promises');
    await fs.writeFile(path, content, 'utf-8');
  }
}
```

Main process function example in: `main/services/utils.ts`:

```typescript
/**
 * "window.systemAPI.getSystemInfo(): Promise<SystemInfo>"
 * @decorator expose systemAPI
 */
export async function getSystemInfo(): Promise<SystemInfo> {
  return {
    platform: process.platform,
    version: process.version,
    arch: process.arch
  };
}

/**
 * "window.utilsAPI.processData(data: string): Promise<string>"
 * @decorator expose utilsAPI
 */
export const processData = async (data: string): Promise<string> => {
  return data.toUpperCase();
};
```

### Usage in renderer process

```typescript
import 'generated/seb_types.d.ts';

// Renderer process with full type safety
const content = await window.fileAPI.readFile('/path/to/file.txt');
await window.fileAPI.writeFile('/path/to/output.txt', content);

const systemInfo = await window.systemAPI.getSystemInfo();
console.log(`Running on ${systemInfo.platform}`);
```

### Misc

- **Namespace arguments** must be in camelCase format.
- **Methods and functions** must return `Promise<T>` types.
- **Invalid naming** will result in build-time errors in Vite plugin.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Repository

Source code and documentation: [https://github.com/kekyo/sublimity-electron-bridge](https://github.com/kekyo/sublimity-electron-bridge)
