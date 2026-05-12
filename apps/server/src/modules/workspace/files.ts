// Input: workspace path + relative paths
// Output: safe file listing + text read/write
// Position: apps/server/src/modules/workspace/files.ts

import { readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'

import fg from 'fast-glob'
import ignore from 'ignore'

export interface WorkspaceFileEntry {
  type: 'file' | 'directory'
  name: string
  path: string
}

export async function listFiles(workspacePath: string): Promise<WorkspaceFileEntry[]> {
  const ig = ignore()
  try {
    ig.add(await readFile(join(workspacePath, '.gitignore'), 'utf8'))
  }
  catch {
    // Missing .gitignore is fine.
  }
  ig.add(['node_modules', '.git', '.DS_Store'])

  const entries = await fg('**/*', {
    cwd: workspacePath,
    dot: false,
    onlyFiles: false,
    markDirectories: true,
  })

  return entries
    .filter(ig.createFilter())
    .map((entry) => {
      const isDirectory = entry.endsWith('/')
      const cleanPath = isDirectory ? entry.slice(0, -1) : entry
      return {
        type: isDirectory ? 'directory' as const : 'file' as const,
        name: basename(cleanPath),
        path: cleanPath,
      }
    })
}

export async function readTextFile(workspacePath: string, relativePath: string): Promise<string | null> {
  const fullPath = resolveWorkspacePath(workspacePath, relativePath)
  if (!fullPath) {
    return null
  }
  try {
    return await readFile(fullPath, 'utf8')
  }
  catch {
    return null
  }
}

export async function writeTextFile(workspacePath: string, relativePath: string, content: string): Promise<boolean> {
  const fullPath = resolveWorkspacePath(workspacePath, relativePath)
  if (!fullPath) {
    return false
  }
  try {
    await writeFile(fullPath, content, 'utf8')
    return true
  }
  catch {
    return false
  }
}

function resolveWorkspacePath(workspacePath: string, relativePath: string): string | null {
  const resolvedWorkspace = resolve(workspacePath)
  const fullPath = resolve(resolvedWorkspace, relativePath)
  return isWithinRoot(resolvedWorkspace, fullPath) ? fullPath : null
}

function isWithinRoot(rootDir: string, targetPath: string): boolean {
  const normalizedRoot = resolve(rootDir)
  const normalizedTarget = resolve(targetPath)
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${sep}`)
}
