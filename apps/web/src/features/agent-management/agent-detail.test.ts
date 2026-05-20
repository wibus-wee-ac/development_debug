// @vitest-environment jsdom
//
// Input: Agent detail runtime config helpers
// Output: parser and serializer contracts for saved agent settings
// Position: apps/web/src/features/agent-management unit tests

import { describe, expect, it } from 'vitest'

import { getAgentCreateDisabledReason, parseCliEnvText, stringifyConfigJson } from './agent-detail'

describe('parseCliEnvText', () => {
  it('returns env values and invalid line numbers for mixed input', () => {
    expect(parseCliEnvText([
      'ANTHROPIC_API_KEY=secret',
      '',
      'BROKEN',
      '=missing-key',
      'NO_COLOR=1',
      'TOKEN=value=with=equals',
    ].join('\n'))).toEqual({
      env: {
        ANTHROPIC_API_KEY: 'secret',
        NO_COLOR: '1',
        TOKEN: 'value=with=equals',
      },
      invalidLineNumbers: [3, 4],
    })
  })

  it('returns undefined env when only blank or invalid lines are present', () => {
    expect(parseCliEnvText('MISSING_EQUALS\n\n=missing-key')).toEqual({
      env: undefined,
      invalidLineNumbers: [1, 3],
    })
  })
})

describe('stringifyConfigJson', () => {
  const baseInput = {
    systemPrompt: '',
    baseConfig: {},
    runtimeKind: 'claude-agent' as const,
    cliTuiPreset: 'claude-code',
    cliTuiExecutable: '',
    cliTuiArguments: '',
    cliTuiEnvText: '',
  }

  it('saves Claude Agent SDK model aliases under agent config', () => {
    expect(JSON.parse(stringifyConfigJson({
      ...baseInput,
      systemPrompt: 'Use project conventions.',
      claudeAgentHaikuModel: ' claude-haiku-4-5 ',
      claudeAgentSonnetModel: 'claude-sonnet-4-5',
      claudeAgentOpusModel: 'claude-opus-4-5',
    }))).toEqual({
      systemPrompt: 'Use project conventions.',
      claudeAgent: {
        modelAliases: {
          haiku: 'claude-haiku-4-5',
          sonnet: 'claude-sonnet-4-5',
          opus: 'claude-opus-4-5',
        },
      },
    })
  })

  it('does not write empty Claude Agent SDK aliases', () => {
    expect(JSON.parse(stringifyConfigJson({
      ...baseInput,
      claudeAgentHaikuModel: '',
      claudeAgentSonnetModel: '   ',
      claudeAgentOpusModel: '',
    }))).toEqual({})
  })
})

describe('getAgentCreateDisabledReason', () => {
  const baseDraft = {
    name: 'Demo Agent',
    runtimeKind: 'standard' as const,
    agentProfileId: 'profile-1',
    cliTuiExecutable: '',
  }

  it('explains missing create requirements before generic dirty state', () => {
    expect(getAgentCreateDisabledReason({
      draft: { ...baseDraft, name: '' },
      isDirty: false,
      createSaving: false,
    })).toBe('Name is required.')

    expect(getAgentCreateDisabledReason({
      draft: { ...baseDraft, agentProfileId: null },
      isDirty: true,
      createSaving: false,
    })).toBe('Select a provider profile before creating.')

    expect(getAgentCreateDisabledReason({
      draft: { ...baseDraft, runtimeKind: 'cli-tui', agentProfileId: null, cliTuiExecutable: '' },
      isDirty: true,
      createSaving: false,
    })).toBe('CLI TUI agents need an executable command.')
  })

  it('returns state reasons only after required fields are complete', () => {
    expect(getAgentCreateDisabledReason({
      draft: baseDraft,
      isDirty: true,
      createSaving: true,
    })).toBe('Creating agent...')

    expect(getAgentCreateDisabledReason({
      draft: baseDraft,
      isDirty: false,
      createSaving: false,
    })).toBe('Make a change before creating.')

    expect(getAgentCreateDisabledReason({
      draft: baseDraft,
      isDirty: true,
      createSaving: false,
    })).toBeNull()
  })
})
