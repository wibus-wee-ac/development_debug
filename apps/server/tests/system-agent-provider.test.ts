// Tests Jarvis runtime provider integration behavior.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AgentProfile } from '@cradle/db'
import { afterEach, describe, expect, it, vi } from 'vitest'

const jarCoreMocks = vi.hoisted(() => ({
  defaultRuntimeConfig: vi.fn(async (options: unknown) => ({ options })),
  executeIngressCommand: vi.fn(async ({ command }: {
    command: { execution: { onEvent: (event: { type: string }) => void } }
  }) => {
    command.execution.onEvent({ type: 'agent_end' })
    return { kind: 'message' as const, model: 'gpt-5', usage: null }
  }),
}))

vi.mock('@hijarvis/jar-core', () => jarCoreMocks)

vi.mock('../src/modules/providers/model-info-registry', () => ({
  lookupModelRaw: vi.fn(async () => null),
  lookupModelRawExact: vi.fn(async () => null),
}))

import { SystemAgentProvider } from '../src/modules/chat-runtime/providers/system-agent/provider'

describe('SystemAgentProvider', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('injects chat session and workspace env for Jarvis shell commands', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cradle-jarvis-provider-'))
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    mkdirSync(join(dataDir, 'preferences'), { recursive: true })
    writeFileSync(join(dataDir, 'preferences', 'jarvis.json'), JSON.stringify({
      profileId: 'profile-jarvis',
      model: 'gpt-5',
      thinkingLevel: 'medium',
    }), 'utf8')

    try {
      const provider = new SystemAgentProvider({
        readSecret: () => 'secret',
        resolveSkillPaths: () => [],
      })
      const profile: AgentProfile = {
        id: 'profile-jarvis',
        name: 'Jarvis',
        providerKind: 'openai-compatible',
        enabled: true,
        configJson: '{}',
        credentialRef: null,
        customModels: '[]',
        iconSlug: null,
        createdAt: 1,
        updatedAt: 1,
      }

      for await (const _chunk of provider.streamTurn({
        runtimeSession: {
          id: 'chat-session-jarvis',
          chatSessionId: 'chat-session-jarvis',
          agentProfileId: 'profile-jarvis',
          runtimeKind: 'jar-core',
          providerSessionId: null,
          providerStateSnapshot: null,
        },
        profile,
        message: 'Create an issue',
        workspaceId: 'workspace-cradle',
      })) {
        // The mock completes through an agent_end event without yielding chunks.
      }

      expect(jarCoreMocks.defaultRuntimeConfig).toHaveBeenCalledWith(expect.objectContaining({
        extraShellEnv: {
          CRADLE_CHAT_SESSION_ID: 'chat-session-jarvis',
          CRADLE_WORKSPACE_ID: 'workspace-cradle',
        },
      }))
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })
})
