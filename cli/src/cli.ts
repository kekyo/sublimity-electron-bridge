#!/usr/bin/env node

import { Command } from 'commander';
import { createElectronBridgeGenerator, createConsoleLogger } from '../../core/src/index.ts';
import { promises as fs } from 'fs';

// Version is injected at build time by Vite
declare const __VERSION__: string;

// Create the program
const program = new Command();

// Add the name and version
program
  .name('seb')
  .version(__VERSION__)
  .description(`Sublimity Electron IPC bridge code from TypeScript decorators ${__VERSION__}`)
  .addHelpText('after', `
Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
Repository: https://github.com/kekyo/sublimity-electron-bridge
License: MIT
`);

// Add the generate command
program
  .command('generate')
  .description('Generate bridge files from TypeScript source files')
  .argument('<files...>', 'TypeScript source files to analyze')
  .option('-b, --baseDir <path>', 'Project base directory path')
  .option('-m, --main <file>', 'Main process output file', 'src/main/generated/seb_main.ts')
  .option('-p, --preload <file>', 'Preload script output file', 'src/preload/generated/seb_preload.ts')
  .option('-t, --types <file>', 'Type definitions output file', 'src/renderer/src/generated/seb_types.ts')
  .option('-n, --namespace <name>', 'Default namespace', 'mainProcess')
  .action(async (files, options) => {
    try {
      // Check if no files are specified
      if (files.length === 0) {
        console.warn('No files specified to analyze');
        return;
      }

      console.log(`Found ${files.length} files to analyze...`);

      // Create the generator
      const generator = createElectronBridgeGenerator({
        mainProcessHandlerFile: options.main,
        preloadHandlerFile: options.preload,
        typeDefinitionsFile: options.types,
        defaultNamespace: options.namespace,
        logger: createConsoleLogger(),
        baseDir: options.baseDir
      });

      // Read and analyze all files in parallel
      const analysisPromises = files.map(async (file: string) => {
        try {
          await fs.access(file); // Check file existence
          const content = await fs.readFile(file, 'utf8');
          const methods = generator.analyzeFile(file, content);
          return methods;
        } catch (error) {
          console.error(`Error analyzing ${file}:`, error instanceof Error ? error.message : error);
          return [];
        }
      });

      const methodArrays = await Promise.all(analysisPromises);
      const allMethods = methodArrays.flat();

      // Generate bridge files
      generator.generateFiles(allMethods);

    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Parse the arguments
program.parse();
