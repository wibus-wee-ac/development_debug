// Resolves Cradle-owned Claude Agent runtime filesystem context for one chat session.

import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

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

export function resolveClaudeAgentSdkConfigDir(input: {
  env?: NodeJS.ProcessEnv
  homeDir?: string
} = {}): string {
  const env = input.env ?? process.env
  const dataDir = env.CRADLE_DATA_DIR?.trim()
  if (dataDir) {
    return join(dataDir, 'runtimes', 'claude-agent')
  }

  const dbPath = env.CRADLE_DB_PATH?.trim()
  if (dbPath) {
    return join(dirname(dbPath), 'runtimes', 'claude-agent')
  }

  return join(input.homeDir ?? homedir(), '.cradle', 'runtimes', 'claude-agent')
}

export function prepareClaudeAgentSdkConfigDir(): string {
  const configDir = resolveClaudeAgentSdkConfigDir()
  mkdirSync(configDir, { recursive: true })
  return configDir
}

export function activateClaudeAgentSdkConfigDir(): string {
  const configDir = prepareClaudeAgentSdkConfigDir()
  process.env.CLAUDE_CONFIG_DIR = configDir
  return configDir
}

function uniquePaths(paths: Array<string | null | undefined>): string[] {
  return [...new Set(paths.filter((path): path is string => Boolean(path)))]
}
