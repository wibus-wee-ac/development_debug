// Input: repomix library (runCli, setWasmBasePath), Electron app, Node fs/os/path
// Output: packCodebase() — packs a workspace directory into a string using repomix; initPackCodebaseWasm() for production WASM setup
// Position: Feature module for pack-codebase; called only from IPC adapter

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { app } from 'electron'
import type { CliOptions } from 'repomix'
import { runCli, setWasmBasePath } from 'repomix'

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

/**
 * Call once during app startup to configure repomix's Tree-sitter WASM paths
 * so they resolve correctly from unpacked ASAR resources in the packaged app.
 */
export function initPackCodebaseWasm(): void {
  if (app.isPackaged) {
    const unpackedBase = join(process.resourcesPath, 'app.asar.unpacked', 'node_modules')
    setWasmBasePath(join(unpackedBase, 'web-tree-sitter'))
    process.env.REPOMIX_WASM_DIR = join(unpackedBase, '@repomix', 'tree-sitter-wasms', 'out')
  }
  // In dev mode, repomix locates WASM files relative to its own node_modules
}

/**
 * Pack a workspace directory into a single AI-friendly string using repomix.
 * Writes to a temp file and reads it back so the output never goes to stdout.
 */
export async function packCodebase(
  workspacePath: string,
  options: PackCodebaseOptions,
): Promise<PackCodebaseResult> {
  const ext = options.style === 'markdown' ? 'md' : options.style === 'xml' ? 'xml' : 'txt'
  const tmpDir = await mkdtemp(join(tmpdir(), 'cradle-pack-'))
  const outputFile = join(tmpDir, `output.${ext}`)

  try {
    const cliOptions: CliOptions = {
      style: options.style,
      output: outputFile,
      compress: options.compress,
      quiet: true,
      noSecurityCheck: true, // Skip secretlint — we trust local workspace
    }

    if (options.include) {
      cliOptions.include = options.include
    }

    if (options.ignore) {
      cliOptions.ignore = options.ignore
    }

    if (options.removeComments) {
      cliOptions.removeComments = options.removeComments
    }

    if (options.removeEmptyLines) {
      cliOptions.removeEmptyLines = options.removeEmptyLines
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
    await rm(tmpDir, { recursive: true, force: true })
  }
}
