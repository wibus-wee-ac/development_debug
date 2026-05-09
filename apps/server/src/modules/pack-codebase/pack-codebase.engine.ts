// Input: repomix library plus Node temp-file helpers
// Output: workspace packing engine returning HTTP-ready content and stats
// Position: apps/server/src/modules/pack-codebase/pack-codebase.engine.ts

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { CliOptions } from 'repomix'
import { runCli } from 'repomix'
import { injectable } from 'tsyringe'

export type PackStyle = 'xml' | 'markdown' | 'plain'

export interface PackCodebaseOptions {
  style: PackStyle
  compress: boolean
  include?: string
  ignore?: string
  removeComments?: boolean
  removeEmptyLines?: boolean
}

export interface PackCodebaseResult {
  content: string
  totalFiles: number
  totalTokens: number
}

@injectable()
export class PackCodebaseEngine {
  async packWorkspace(workspacePath: string, options: PackCodebaseOptions): Promise<PackCodebaseResult> {
    const ext = options.style === 'markdown' ? 'md' : options.style === 'xml' ? 'xml' : 'txt'
    const tempDir = await mkdtemp(join(tmpdir(), 'cradle-pack-'))
    const outputFile = join(tempDir, `output.${ext}`)

    try {
      const cliOptions: CliOptions = {
        style: options.style,
        output: outputFile,
        compress: options.compress,
        quiet: true,
        noSecurityCheck: true,
      }

      if (options.include) {
        cliOptions.include = options.include
      }
      if (options.ignore) {
        cliOptions.ignore = options.ignore
      }
      if (options.removeComments) {
        cliOptions.removeComments = true
      }
      if (options.removeEmptyLines) {
        cliOptions.removeEmptyLines = true
      }

      const result = await runCli([workspacePath], workspacePath, cliOptions)
      const packResult = result && 'packResult' in result ? result.packResult : null
      const content = await readFile(outputFile, 'utf-8')

      return {
        content,
        totalFiles: packResult?.totalFiles ?? 0,
        totalTokens: packResult?.totalTokens ?? 0,
      }
    }
    finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  }
}
