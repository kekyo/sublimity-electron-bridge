# Sublimity Electron Bridge

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm version](https://badge.fury.io/js/sublimity-electron-bridge-cli.svg)](https://www.npmjs.com/package/sublimity-electron-bridge-cli)
[![npm version](https://badge.fury.io/js/sublimity-electron-bridge-vite.svg)](https://www.npmjs.com/package/sublimity-electron-bridge-vite)

An automated code generation tool for Electron applications that eliminates the need for manual IPC (Inter-Process Communication) setup between the main process and renderer process. This tool analyzes TypeScript source code using the TypeScript Compiler API and automatically generates the necessary IPC handlers, preload bridge scripts, and type definitions.

## Overview

Sublimity Electron Bridge targets Electron applications built with TypeScript. It automates the traditionally manual and error-prone process of setting up IPC communication by:

- **Analyzing** TypeScript source code for methods decorated with `@ExposeToRenderer`
- **Generating** main process IPC handlers automatically
- **Creating** preload bridge scripts for secure communication
- **Providing** complete TypeScript type definitions for the renderer process

The tool supports both class methods and standalone functions, with automatic validation of camelCase naming conventions and Promise return types.

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
# Generate bridge code for all TypeScript files in src/
seb src/**/*.ts

# Specify custom output directories
seb src/**/*.ts --main-dir main/generated --preload-dir preload/generated

# Custom type definitions location
seb src/**/*.ts --types-file types/electron-api.d.ts
```

#### CLI Options

```bash
seb [options] <files...>

Options:
  --main-dir <dir>      Output directory for main process handlers (default: "main/generated")
  --preload-dir <dir>   Output directory for preload bridge scripts (default: "preload/generated")
  --types-file <file>   Output file for TypeScript type definitions (default: "src/generated/electron-api.d.ts")
  --namespace <name>    Default namespace for methods without explicit namespace (default: "electronAPI")
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
}
```

-----

## Code Example

### Source Code with Decorators

```typescript
// main/services/FileService.ts
export class FileService {
  @ExposeToRenderer("fileAPI")
  async readFile(path: string): Promise<string> {
    const fs = await import('fs/promises')
    return fs.readFile(path, 'utf-8')
  }

  @ExposeToRenderer("fileAPI")
  async writeFile(path: string, content: string): Promise<void> {
    const fs = await import('fs/promises')
    await fs.writeFile(path, content, 'utf-8')
  }
}

// main/utils/system.ts
@ExposeToRenderer("systemAPI")
export async function getSystemInfo(): Promise<SystemInfo> {
  return {
    platform: process.platform,
    version: process.version,
    arch: process.arch
  }
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

## Decorator Syntax

### Method Decoration

```typescript
class ServiceClass {
  @ExposeToRenderer("customAPI")  // Custom namespace
  async methodName(): Promise<ReturnType> { /* ... */ }

  @ExposeToRenderer()            // Uses default namespace
  async anotherMethod(): Promise<ReturnType> { /* ... */ }
}
```

### Function Decoration

```typescript
@ExposeToRenderer("utilsAPI")
async function utilityFunction(): Promise<ReturnType> { /* ... */ }
```

### Validation Rules

- **Namespace arguments** must be in camelCase format
- **Methods and functions** must return Promise types
- **Invalid naming** will result in build-time errors

## Limitations

### Arrow Functions with Variable Binding

The tool **does not detect** arrow functions assigned to variables, as TypeScript decorators cannot be applied to variable declarations. This is a limitation of the TypeScript language specification, not the tool itself.

**Not Supported (TypeScript Compilation Error):**

```typescript
// This will cause a TypeScript compilation error
@ExposeToRenderer("utilsAPI")
const getSystemInfo = async (): Promise<SystemInfo> => {
  return { /* ... */ }
}

// This will also cause a compilation error
@ExposeToRenderer("utilsAPI")
export const getSystemInfo = async (): Promise<SystemInfo> => {
  return { /* ... */ }
}
```

**Use These Alternatives Instead:**

```typescript
// Function declaration - Fully supported
@ExposeToRenderer("utilsAPI")
export async function getSystemInfo(): Promise<SystemInfo> {
  return { /* ... */ }
}

// Class method - Fully supported
export class Utils {
  @ExposeToRenderer("utilsAPI")
  async getSystemInfo(): Promise<SystemInfo> {
    return { /* ... */ }
  }
}
```

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Repository

Source code and documentation: [https://github.com/kekyo/sublimity-electron-bridge](https://github.com/kekyo/sublimity-electron-bridge)
