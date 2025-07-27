#!/usr/bin/env node

// sublimity-electron-bridge - Sublimity electron IPC bridge CLI
// Copyright (c) Kouji Matsui (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/sublimity-electron-bridge/

import { Command } from 'commander';
import { createElectronBridgeGenerator, createConsoleLogger } from 'sublimity-electron-bridge-core';
import { promises as fs } from 'fs';
import { author, git_commit_hash, license, repository_url, version } from './generated/packageMetadata.ts';

// Create the program
const program = new Command();

// Add the name and version
program
  .name('seb')
  .version(version)
  .description(`Sublimity Electron IPC bridge CLI [${version},${git_commit_hash}]`)
  .addHelpText('after', `
Copyright (c) ${author}
Repository: ${repository_url}
License: ${license}
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
    const logger = createConsoleLogger(`seb:${process.pid}`);

    try {
      // Check if no files are specified
      if (files.length === 0) {
        logger.warn('No files specified to analyze');
        return;
      }

      logger.info(`Found ${files.length} files to analyze...`);

      // Create the generator
      const generator = createElectronBridgeGenerator({
        mainProcessHandlerFile: options.main,
        preloadHandlerFile: options.preload,
        typeDefinitionsFile: options.types,
        defaultNamespace: options.namespace,
        logger,
        baseDir: options.baseDir || process.cwd()
      });

      // Check file existence
      const validFiles: string[] = [];
      for (const file of files) {
        try {
          await fs.access(file);
          validFiles.push(file);
        } catch (error) {
          logger.error(`Error accessing ${file}: ${error instanceof Error ? error.message : error}`);
        }
      }

      if (validFiles.length === 0) {
        logger.warn('No valid files found to analyze');
        return;
      }

      // Use the new analyzeFiles method for better performance and accuracy
      const allMethods = await generator.analyzeFiles(validFiles);

      // Generate bridge files
      await generator.generateFiles(allMethods);

    } catch (error) {
      logger.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

// Parse the arguments
program.parse();
