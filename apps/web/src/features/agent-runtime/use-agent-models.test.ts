// Output: Unit coverage for Agent Runtime model query-key ownership.
// Input: Agent Runtime model query-key helpers.
// Position: Guards model inventory request deduplication across chat, composer, and settings.

import { describe, expect, it } from 'vitest'

import {
  AGENT_MODELS_QUERY_KEY,
  agentModelsQueryKey,
  providerTargetModelsQueryKey
} from './use-agent-models'

describe('agentModelsQueryKey', () => {
  it('uses one stable cache slot per profile', () => {
    expect(agentModelsQueryKey('profile-1')).toEqual([...AGENT_MODELS_QUERY_KEY, 'profile-1'])
  })

  it('uses a stable disabled-query key for empty profile selection', () => {
    expect(agentModelsQueryKey(null)).toEqual([...AGENT_MODELS_QUERY_KEY, 'no-profile'])
  })
})

describe('providerTargetModelsQueryKey', () => {
  it('uses one stable cache slot per provider target', () => {
    expect(providerTargetModelsQueryKey({ kind: 'external-record', id: 'target-1' })).toEqual([
      ...AGENT_MODELS_QUERY_KEY,
      'external-record:target-1'
    ])
  })

  it('uses a stable disabled-query key for empty target selection', () => {
    expect(providerTargetModelsQueryKey(null)).toEqual([
      ...AGENT_MODELS_QUERY_KEY,
      'no-provider-target'
    ])
  })
})
