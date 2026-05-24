// Output: Regression coverage for provider sidebar grouping and enabled-first ordering.
// Input: Agent profiles plus external provider source and record summaries.
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

  it('groups external profiles by source plugin owner rather than source label', () => {
    const groups = collectProviderListGroups(
      [
        profile({ id: 'p-1', name: 'CC Switch / 0516', enabled: false }),
        profile({ id: 'p-2', name: 'CC Switch / 0523', enabled: true }),
        profile({ id: 'manual', name: 'OpenAI', enabled: true }),
      ],
      [
        { id: 'p-1', sourceKey: 'source-a' },
        { id: 'p-2', sourceKey: 'source-b' },
      ],
      [
        { id: 'source-a', pluginName: 'cc-switch' },
        { id: 'source-b', pluginName: 'cc-switch' },
      ],
    )

    expect(groups.map(group => ({ id: group.id, profiles: group.profiles.map(item => item.id) })))
      .toEqual([
        { id: 'manual', profiles: ['manual'] },
        { id: 'external-plugin:cc-switch', profiles: ['p-2', 'p-1'] },
      ])
  })
})
