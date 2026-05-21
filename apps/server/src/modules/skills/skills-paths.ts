import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type SkillScope = 'builtin' | 'legacy' | 'global' | 'workspace' | 'agent'

export interface SkillContext {
  workspacePath?: string
  agentId?: string
}

const UNSAFE_PATH_RE = /[/\\]|\.\./
const CRADLE_DIR_PARTS = ['.cradle'] as const

export function resolveScopeRoot(scope: SkillScope, context: SkillContext): string {
  switch (scope) {
    case 'builtin':
      return resolveBuiltinSkillsRoot()
    case 'legacy':
      return path.join(os.homedir(), '.agents', 'skills')
    case 'global':
      return path.join(os.homedir(), ...CRADLE_DIR_PARTS, 'skills')
    case 'workspace':
      if (!context.workspacePath) {
        throw new Error('workspacePath is required for workspace skills')
      }
      return path.join(context.workspacePath, ...CRADLE_DIR_PARTS, 'skills')
    case 'agent':
      if (!context.agentId) {
        throw new Error('agentId is required for agent skills')
      }
      assertAgentId(context.agentId)
      return path.join(os.homedir(), ...CRADLE_DIR_PARTS, 'agents', context.agentId, 'skills')
  }
}

export function assertWorkspaceId(workspaceId: string): void {
  assertSafeId(workspaceId)
}

export function assertAgentId(agentId: string): void {
  assertSafeId(agentId)
}

export function assertWritableScope(scope: SkillScope): void {
  if (scope === 'builtin' || scope === 'legacy') {
    throw new Error(`${scope} skills are read-only`)
  }
}

function assertSafeId(id: string): void {
  if (!id || UNSAFE_PATH_RE.test(id)) {
    throw new Error(`Invalid ID: ${id}`)
  }
}

function resolveBuiltinSkillsRoot(): string {
  const candidates = [
    path.resolve(process.cwd(), '../../../resources/skills'),
    path.resolve(process.cwd(), '../../resources/skills'),
    path.resolve(process.cwd(), '../resources/skills'),
    path.resolve(process.cwd(), 'resources/skills'),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  return candidates[0]
}
