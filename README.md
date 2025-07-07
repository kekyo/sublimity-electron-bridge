# Sublimity Electron IPC Bridge

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

|Package|Link|
|:----|:----|
|npm CLI|[![npm CLI](https://badge.fury.io/js/sublimity-electron-bridge-cli.svg)](https://www.npmjs.com/package/sublimity-electron-bridge-cli)|
|npm Vite plugin|[![npm vite-plugin](https://badge.fury.io/js/sublimity-electron-bridge-vite.svg)](https://www.npmjs.com/package/sublimity-electron-bridge-vite)|

An automated code generation tool for Electron applications that eliminates the need for manual IPC (Inter-Process Communication) setup between the main process and renderer process. This tool analyzes TypeScript source code using the TypeScript Compiler API and automatically generates the necessary IPC handlers, preload bridge scripts, and type definitions.

## Overview

Sublimity Electron IPC Bridge targets Electron applications built with TypeScript. It automates the traditionally manual and error-prone process of setting up IPC communication by:

- **Analyzing** TypeScript source code for methods marked with `@decorator expose` JSDoc tags
- **Generating** main process IPC handlers automatically
- **Creating** preload bridge scripts for secure communication
- **Providing** complete TypeScript type definitions for the renderer process

The tool supports class methods, standalone functions, and arrow functions with variable binding, with automatic validation of camelCase naming conventions and Promise return types.

### Generated Output Structure

Using this tool, the following source code will be automatically generated:

```
project/
├── main/generated/
│   └── ipc-handlers.ts          # IPC event handlers
├── preload/generated/
│   └── bridge.ts                # Context bridge implementation
└── src/generated/
    └── electron-api.d.ts        # TypeScript type definitions
```

For more information, see below section.

## Target Audience

This tool is designed for:

- **Electron developers** using TypeScript who want to streamline IPC setup
- **Development teams** seeking to reduce boilerplate code and potential IPC-related bugs
- **Projects** requiring type-safe communication between Electron processes
- **Applications** that need organized namespace-based API exposure to the renderer

## Requirements

- **Node.js** 14 or higher
- **TypeScript** 5.0 or higher
- **Electron** application with preload scripts enabled

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
seb generate src/services/FileService.ts --main main/generated --preload preload/generated

# Custom type definitions location
seb generate src/services/FileService.ts --types types/electron-api.d.ts
```

#### CLI Options

```bash
seb generate <files...>

Options:
  -m, --main <dir>      Main process output directory (default: "main/generated")
  -p, --preload <dir>   Preload script output directory (default: "preload/generated") 
  -t, --types <file>    Type definitions output file (default: "src/generated/electron-api.d.ts")
  -n, --namespace <name> Default namespace (default: "electronAPI")
  -h, --help           Display help information
```

### Vite Plugin

Install the Vite plugin for automatic generation during development builds:

```bash
npm install --save-dev sublimity-electron-bridge-vite
```

#### Configuration

Add the plugin to your `vite.config.ts`:

```typescript
import { defineConfig } from 'vite'
import { sublimityElectronBridge } from 'sublimity-electron-bridge-vite'

export default defineConfig({
  plugins: [
    sublimityElectronBridge({
      outputDirs: {
        main: 'main/generated',
        preload: 'preload/generated'
      },
      typeDefinitionsFile: 'src/generated/electron-api.d.ts',
      defaultNamespace: 'electronAPI'
    })
  ]
})
```

#### Plugin Options

```typescript
interface SublimityElectronBridgeOptions {
  outputDirs?: {
    main?: string      // Default: "main/generated"
    preload?: string   // Default: "preload/generated"
  }
  typeDefinitionsFile?: string  // Default: "src/generated/electron-api.d.ts"
  defaultNamespace?: string     // Default: "electronAPI"
  enableWorker?: boolean        // Default: false - Enable worker thread processing
}
```

-----

## Code Example

### Source Code with Decorators

```typescript
// main/services/FileService.ts
export class FileService {
  /**
   * @decorator expose fileAPI
   */
  async readFile(path: string): Promise<string> {
    const fs = await import('fs/promises')
    return fs.readFile(path, 'utf-8')
  }

  /**
   * @decorator expose fileAPI
   */
  async writeFile(path: string, content: string): Promise<void> {
    const fs = await import('fs/promises')
    await fs.writeFile(path, content, 'utf-8')
  }
}

// main/utils/system.ts
/**
 * @decorator expose systemAPI
 */
export async function getSystemInfo(): Promise<SystemInfo> {
  return {
    platform: process.platform,
    version: process.version,
    arch: process.arch
  }
}

// main/utils/helpers.ts
/**
 * @decorator expose utilsAPI
 */
export const processData = async (data: string): Promise<string> => {
  return data.toUpperCase()
}
```

### Generated Files

The tool automatically generates:

1. **Main Process Handlers** (`main/generated/ipc-handlers.ts`)
2. **Preload Bridge** (`preload/generated/bridge.ts`)
3. **Type Definitions** (`src/generated/electron-api.d.ts`)

### Usage in Renderer Process

```typescript
// Renderer process with full type safety
const content = await window.fileAPI.readFile('/path/to/file.txt')
await window.fileAPI.writeFile('/path/to/output.txt', content)

const systemInfo = await window.systemAPI.getSystemInfo()
console.log(`Running on ${systemInfo.platform}`)
```

## JSDoc Syntax

### Class Method Decoration

```typescript
class ServiceClass {
  /**
   * @decorator expose customAPI
   */
  async methodName(): Promise<ReturnType> { /* ... */ }

  /**
   * @decorator expose
   */
  async anotherMethod(): Promise<ReturnType> { /* ... */ }
}
```

### Function Decoration

```typescript
/**
 * @decorator expose utilsAPI
 */
async function utilityFunction(): Promise<ReturnType> { /* ... */ }
```

### Arrow Function Decoration

```typescript
/**
 * @decorator expose utilsAPI
 */
const utilityFunction = async (): Promise<ReturnType> => {
  /* ... */
}

/**
 * @decorator expose customAPI
 */
export const processData = async (data: string): Promise<string> => {
  return data.toUpperCase()
}
```

### Validation Rules

- **Namespace arguments** must be in camelCase format
- **Methods and functions** must return `Promise<T>` types
- **Invalid naming** will result in build-time errors

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Repository

Source code and documentation: [https://github.com/kekyo/sublimity-electron-bridge](https://github.com/kekyo/sublimity-electron-bridge)
