// Output: Regression coverage for Settings Agents batch provider configuration.
// Input: Selected agent records and a target provider/model/thinking selection.
// Position: Proves batch edits preserve identity fields and skip CLI TUI agents.

import { describe, expect, it } from 'vitest'

import type { Agent } from '~/lib/types'

import { buildAgentProviderBatchPatches } from './agent-batch-configuration'

function createAgent(overrides: Partial<Agent>): Agent {
  return {
    id: overrides.id ?? 'agent-a',
    name: overrides.name ?? 'Agent A',
    description: overrides.description ?? 'Description',
    avatarUrl: overrides.avatarUrl ?? null,
    avatarStyle: overrides.avatarStyle ?? 'bottts-neutral',
    avatarSeed: overrides.avatarSeed ?? 'seed',
    agentProfileId: overrides.agentProfileId ?? 'profile-old',
    modelId: overrides.modelId ?? 'model-old',
    thinkingEffort: overrides.thinkingEffort ?? 'auto',
    runtimeKind: overrides.runtimeKind ?? 'standard',
    configJson: overrides.configJson ?? '{}',
    enabled: overrides.enabled ?? true,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 2,
  }
}

describe('buildAgentProviderBatchPatches', () => {
  it('updates provider fields while preserving agent identity and runtime config', () => {
    const result = buildAgentProviderBatchPatches(
      [
        createAgent({
          id: 'agent-a',
          name: 'A',
          avatarSeed: 'avatar-a',
          runtimeKind: 'claude-agent',
          configJson: '{"systemPrompt":"Keep this"}',
          enabled: false,
        }),
      ],
      {
        agentProfileId: 'profile-new',
        modelId: 'model-new',
        thinkingEffort: 'high',
      },
    )

    expect(result).toEqual({
      skippedCliTuiCount: 0,
      patches: [
        {
          id: 'agent-a',
          patch: {
            name: 'A',
            description: 'Description',
            avatarStyle: 'bottts-neutral',
            avatarSeed: 'avatar-a',
            avatarUrl: null,
            agentProfileId: 'profile-new',
            modelId: 'model-new',
            thinkingEffort: 'high',
            runtimeKind: 'claude-agent',
            configJson: '{"systemPrompt":"Keep this"}',
            enabled: false,
          },
        },
      ],
    })
  })

  it('skips CLI TUI agents because they are not provider-backed', () => {
    const result = buildAgentProviderBatchPatches(
      [
        createAgent({ id: 'provider-agent', runtimeKind: 'standard' }),
        createAgent({
          id: 'terminal-agent',
          runtimeKind: 'cli-tui',
          agentProfileId: null,
          modelId: null,
        }),
      ],
      {
        agentProfileId: 'profile-new',
        modelId: null,
        thinkingEffort: 'auto',
      },
    )

    expect(result.skippedCliTuiCount).toBe(1)
    expect(result.patches).toHaveLength(1)
    expect(result.patches[0]?.id).toBe('provider-agent')
  })
})
