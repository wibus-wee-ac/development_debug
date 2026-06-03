// Resolves Cradle-owned Claude Agent runtime filesystem context for one chat session.

import { ensureAgentRuntimeHome } from '../../skills/skills-paths'

export interface ClaudeAgentRuntimeContext {
  cwd: string
  workspacePath: string
  additionalDirectories: string[]
  agentHome: string | null
}

export function resolveClaudeAgentRuntimeContext(workspacePath: string | undefined, agentId?: string | null): ClaudeAgentRuntimeContext {
  const resolvedWorkspacePath = workspacePath || process.cwd()
  const agentHome = agentId ? ensureAgentRuntimeHome(agentId) : null

  return {
    cwd: agentHome ?? resolvedWorkspacePath,
    workspacePath: resolvedWorkspacePath,
    additionalDirectories: uniquePaths([
      agentHome ? resolvedWorkspacePath : null,
    ]),
    agentHome,
  }
}

function uniquePaths(paths: Array<string | null | undefined>): string[] {
  return [...new Set(paths.filter((path): path is string => Boolean(path)))]
}
