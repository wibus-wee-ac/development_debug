import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { CliOptions } from 'repomix'
import { runCli } from 'repomix'

import { AppError } from '../../errors/app-error'
import * as Workspace from '../workspace/service'

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

export async function packWorkspace(workspaceId: string, options: PackCodebaseOptions): Promise<PackCodebaseResult> {
  const workspace = Workspace.get(workspaceId)
  if (!workspace) {
    throw new AppError({
      code: 'workspace_not_found',
      status: 404,
      message: 'Workspace not found',
      details: { workspaceId },
    })
  }

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

    const result = await runCli([workspace.path], workspace.path, cliOptions)
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
