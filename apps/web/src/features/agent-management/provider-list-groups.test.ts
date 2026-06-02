// Output: Regression coverage for provider sidebar grouping and enabled-first ordering.
// Input: Cradle-owned provider profiles.
// Position: Guards Agent Runtime Settings list ownership semantics.

import { describe, expect, it } from 'vitest'

import type { AgentProfile } from '~/lib/types'

import { collectProviderListGroups, sortProviderProfilesByStatus } from './provider-list-groups'

function profile(input: Pick<AgentProfile, 'id' | 'name' | 'enabled'>): AgentProfile {
  return {
    ...input,
    providerKind: 'openai-compatible',
    configJson: '{}',
    credentialRef: null,
    customModels: '[]',
    iconSlug: null,
    createdAt: 0,
    updatedAt: 0,
  }
}

describe('provider-list-groups', () => {
  it('sorts enabled providers before disabled providers', () => {
    expect(
      sortProviderProfilesByStatus([
        profile({ id: 'off-b', name: 'Beta', enabled: false }),
        profile({ id: 'on-c', name: 'Charlie', enabled: true }),
        profile({ id: 'on-a', name: 'Alpha', enabled: true }),
      ]).map(item => item.id),
    ).toEqual(['on-a', 'on-c', 'off-b'])
  })

  it('groups provider profiles under the Cradle-owned manual provider group', () => {
    const groups = collectProviderListGroups([
      profile({ id: 'off-b', name: 'Beta', enabled: false }),
      profile({ id: 'on-a', name: 'Alpha', enabled: true }),
    ])

    expect(
      groups.map(group => ({ id: group.id, entries: group.entries.map(item => item.id) })),
    ).toEqual([
      { id: 'manual', entries: ['manual:on-a', 'manual:off-b'] },
    ])
    expect(groups[0]?.label).toBe('Manual providers')
  })
})
