// Output: Regression coverage for provider sidebar grouping and enabled-first ordering.
// Input: Agent profiles plus external provider source and record summaries.
// Position: Guards Agent Runtime Settings list ownership semantics.

import { describe, expect, it } from 'vitest'

import type { AgentProfile } from '~/lib/types'

import { collectProviderListGroups, sortProviderProfilesByStatus } from './provider-list-groups'
import type { ExternalProviderRecordView, ExternalProviderSourceView } from './provider-settings-utils'

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

function externalRecord(
  input: Pick<ExternalProviderRecordView, 'id' | 'sourceKey' | 'externalId' | 'name' | 'status'> & {
    runtimeTargetEnabled?: boolean
  },
): ExternalProviderRecordView {
  return {
    ...input,
    app: 'codex',
    providerKind: 'openai-compatible',
    runtimeTargetEnabled: input.runtimeTargetEnabled ?? true,
    providerTargetId: input.id,
    metadata: {},
    warnings: [],
  }
}

function externalSource(
  input: Pick<ExternalProviderSourceView, 'id' | 'pluginName' | 'label'>,
): ExternalProviderSourceView {
  return {
    ...input,
    lastSyncStatus: 'ok',
    lastSyncMessage: null,
    lastSyncError: null,
    lastSyncAt: null,
    inventory: {},
    warnings: [],
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

  it('groups external records by source plugin owner rather than source label', () => {
    const groups = collectProviderListGroups(
      [
        profile({ id: 'manual', name: 'OpenAI', enabled: true }),
      ],
      [
        externalRecord({
          id: 'record-1',
          sourceKey: 'source-a',
          externalId: 'cc-switch:one',
          name: 'CC Switch / 0516',
          status: 'missing',
        }),
        externalRecord({
          id: 'record-2',
          sourceKey: 'source-b',
          externalId: 'cc-switch:two',
          name: 'CC Switch / 0523',
          status: 'active',
        }),
      ],
      [
        externalSource({ id: 'source-a', pluginName: 'cc-switch', label: 'CC Switch A' }),
        externalSource({ id: 'source-b', pluginName: 'cc-switch', label: 'CC Switch B' }),
      ],
    )

    expect(groups.map(group => ({ id: group.id, entries: group.entries.map(item => item.id) })))
      .toEqual([
        { id: 'manual', entries: ['manual:manual'] },
        {
          id: 'external-plugin:cc-switch',
          entries: ['external:record-2', 'external:record-1'],
        },
      ])
    expect(groups[0]?.label).toBe('Manual providers')
  })

  it('sorts enabled active external records before disabled active records', () => {
    const groups = collectProviderListGroups(
      [],
      [
        externalRecord({
          id: 'record-disabled',
          sourceKey: 'source-a',
          externalId: 'cc-switch:disabled',
          name: 'Disabled',
          status: 'active',
          runtimeTargetEnabled: false,
        }),
        externalRecord({
          id: 'record-stale',
          sourceKey: 'source-a',
          externalId: 'cc-switch:stale',
          name: 'Stale',
          status: 'stale',
          runtimeTargetEnabled: true,
        }),
        externalRecord({
          id: 'record-active',
          sourceKey: 'source-a',
          externalId: 'cc-switch:active',
          name: 'Active',
          status: 'active',
          runtimeTargetEnabled: true,
        }),
      ],
      [externalSource({ id: 'source-a', pluginName: 'cc-switch', label: 'CC Switch' })],
    )

    expect(groups[0]?.entries.map(item => item.id)).toEqual([
      'external:record-active',
      'external:record-disabled',
      'external:record-stale',
    ])
  })
})
