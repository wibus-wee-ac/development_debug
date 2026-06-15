// Resolves Cradle-owned Codex runtime filesystem context for one chat session.

import { ensureAgentRuntimeHome } from '../../../skills/skills-paths'

export interface CodexRuntimeContext {
  cwd: string
  workspacePath: string
  runtimeWorkspaceRoots: string[]
  agentHome: string | null
}

export function resolveCodexRuntimeContext(workspacePath: string, agentId?: string | null): CodexRuntimeContext {
  const resolvedWorkspacePath = workspacePath || '.'
  const agentHome = agentId ? ensureAgentRuntimeHome(agentId) : null
  const runtimeWorkspaceRoots = uniquePaths([
    agentHome,
    resolvedWorkspacePath,
  ])

  return {
    cwd: agentHome ?? resolvedWorkspacePath,
    workspacePath: resolvedWorkspacePath,
    runtimeWorkspaceRoots,
    agentHome,
  }
}

function uniquePaths(paths: Array<string | null | undefined>): string[] {
  return [...new Set(paths.filter((path): path is string => Boolean(path)))]
}
