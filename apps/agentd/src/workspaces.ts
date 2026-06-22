import { readdirSync, statSync } from 'node:fs'
import { basename, delimiter, join } from 'node:path'

import type { RemoteWorkspaceSummary, WorkspaceListParams, WorkspaceListResult } from '@cradle/remote-agent-protocol'

export function listWorkspaces(rawParams: unknown): WorkspaceListResult {
  const params = rawParams as WorkspaceListParams
  const roots = readWorkspaceRoots(params.root)
  if (roots.length === 0) {
    return {
      workspaces: [],
      message: 'Set CRADLE_AGENTD_WORKSPACE_ROOTS to list remote workspaces.',
    }
  }

  return {
    workspaces: roots.flatMap(listRootWorkspaces),
    message: null,
  }
}

function readWorkspaceRoots(explicitRoot?: string | null): string[] {
  if (explicitRoot) {
    return [explicitRoot]
  }
  return (process.env.CRADLE_AGENTD_WORKSPACE_ROOTS ?? '')
    .split(delimiter)
    .map(root => root.trim())
    .filter(Boolean)
}

function listRootWorkspaces(root: string): RemoteWorkspaceSummary[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => join(root, entry.name))
      .filter(isWorkspaceDirectory)
      .map(path => ({
        id: path,
        name: basename(path),
        path,
        reason: readWorkspaceReason(path),
      }))
  }
  catch {
    return []
  }
}

function isWorkspaceDirectory(path: string): boolean {
  return ['.git', 'package.json', 'pnpm-workspace.yaml'].some(name => exists(join(path, name)))
}

function readWorkspaceReason(path: string): string {
  if (exists(join(path, '.git'))) {
    return '.git'
  }
  if (exists(join(path, 'pnpm-workspace.yaml'))) {
    return 'pnpm-workspace.yaml'
  }
  return 'package.json'
}

function exists(path: string): boolean {
  try {
    statSync(path)
    return true
  }
  catch {
    return false
  }
}
