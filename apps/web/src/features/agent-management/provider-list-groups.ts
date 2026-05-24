// Output: Provider list grouping and ordering helpers for Agent Runtime Settings.
// Input: Agent profiles, external provider records, and external provider sources.
// Position: Keeps provider sidebar ownership grouping independent from React rendering.

import type { AgentProfile } from '~/lib/types'

export interface ExternalProviderRecordSummary {
  id: string
  sourceKey: string
}

export interface ExternalProviderSourceSummary {
  id: string
  pluginName: string
}

export interface ProviderListGroup {
  id: string
  label: string
  kind: 'external-plugin' | 'external-source' | 'manual'
  profiles: AgentProfile[]
}

const MANUAL_GROUP_ID = 'manual'
const MANUAL_GROUP_LABEL = 'Manual providers'
const UNKNOWN_EXTERNAL_SOURCE_LABEL = 'External source'

function compareProviderProfiles(a: AgentProfile, b: AgentProfile): number {
  if (a.enabled !== b.enabled) {
    return a.enabled ? -1 : 1
  }

  return (
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    || a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' })
  )
}

function compareProviderGroups(a: ProviderListGroup, b: ProviderListGroup): number {
  const aHasEnabled = a.profiles.some(profile => profile.enabled)
  const bHasEnabled = b.profiles.some(profile => profile.enabled)
  if (aHasEnabled !== bHasEnabled) {
    return aHasEnabled ? -1 : 1
  }

  if (a.kind !== b.kind) {
    const order: Record<ProviderListGroup['kind'], number> = {
      'external-plugin': 0,
      'external-source': 1,
      'manual': 2,
    }
    return order[a.kind] - order[b.kind]
  }

  return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })
}

function profileGroupDescriptor(
  profile: AgentProfile,
  sourceKeyByProfileId: Map<string, string>,
  sourceById: Map<string, ExternalProviderSourceSummary>,
): Pick<ProviderListGroup, 'id' | 'kind' | 'label'> {
  const sourceKey = sourceKeyByProfileId.get(profile.id)
  if (!sourceKey) {
    return { id: MANUAL_GROUP_ID, kind: 'manual', label: MANUAL_GROUP_LABEL }
  }

  const source = sourceById.get(sourceKey)
  if (!source) {
    return {
      id: `external-source:${sourceKey}`,
      kind: 'external-source',
      label: UNKNOWN_EXTERNAL_SOURCE_LABEL,
    }
  }

  return {
    id: `external-plugin:${source.pluginName}`,
    kind: 'external-plugin',
    label: source.pluginName,
  }
}

export function sortProviderProfilesByStatus(profiles: AgentProfile[]): AgentProfile[] {
  return [...profiles].sort(compareProviderProfiles)
}

export function collectProviderListGroups(
  profiles: AgentProfile[],
  externalRecords: ExternalProviderRecordSummary[],
  externalSources: ExternalProviderSourceSummary[],
): ProviderListGroup[] {
  const sourceById = new Map(externalSources.map(source => [source.id, source]))
  const sourceKeyByProfileId = new Map(externalRecords.map(record => [record.id, record.sourceKey]))
  const groups = new Map<string, ProviderListGroup>()

  for (const profile of sortProviderProfilesByStatus(profiles)) {
    const descriptor = profileGroupDescriptor(profile, sourceKeyByProfileId, sourceById)
    const group = groups.get(descriptor.id)
    if (group) {
      group.profiles.push(profile)
      continue
    }

    groups.set(descriptor.id, {
      ...descriptor,
      profiles: [profile],
    })
  }

  return Array.from(groups.values()).sort(compareProviderGroups)
}
