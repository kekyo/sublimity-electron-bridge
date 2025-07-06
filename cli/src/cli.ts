#!/usr/bin/env node

import { Command } from 'commander'
import { ElectronBridgeGenerator } from '@sublimity-electron-bridge/core'
import { readFileSync } from 'fs'
import { glob } from 'glob'

const program = new Command()

program
  .name('electron-bridge')
  .description('Generate Electron IPC bridge code from TypeScript decorators')
  .version('1.0.0')

program
  .command('generate')
  .description('Generate bridge files from TypeScript source files')
  .option('-i, --input <pattern>', 'Input file pattern (glob)', 'src/**/*.ts')
  .option('-m, --main <dir>', 'Main process output directory', 'main/generated')
  .option('-p, --preload <dir>', 'Preload script output directory', 'preload/generated')
  .option('-t, --types <file>', 'Type definitions output file', 'src/generated/electron-api.d.ts')
  .option('-n, --namespace <name>', 'Default namespace', 'electronAPI')
  .action(async (options) => {
    try {
      const generator = new ElectronBridgeGenerator({
        outputDirs: {
          main: options.main,
          preload: options.preload
        },
        typeDefinitionsFile: options.types,
        defaultNamespace: options.namespace
      })

      // Find all matching files
      const files = await glob(options.input, { ignore: ['node_modules/**', 'dist/**'] })
      
      if (files.length === 0) {
        console.log('No files found matching pattern:', options.input)
        return
      }

      console.log(`Found ${files.length} files to analyze...`)
      
      const allMethods: any[] = []

      // Analyze each file
      for (const file of files) {
        try {
          const content = readFileSync(file, 'utf8')
          const methods = generator.analyzeFile(file, content)
          allMethods.push(...methods)
        } catch (error) {
          console.error(`Error analyzing ${file}:`, error instanceof Error ? error.message : error)
        }
      }

      // Generate bridge files
      generator.generateFiles(allMethods)

    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error)
      process.exit(1)
    }
  })

program.parse()