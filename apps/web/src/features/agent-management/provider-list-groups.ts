// Output: Cradle provider list grouping and ordering helpers for Agent Runtime Settings.
// Input: Cradle-owned provider profiles.
// Position: Keeps provider sidebar ownership grouping independent from React rendering.

import type { AgentProfile } from '~/lib/types'

import type { ProviderListEntry } from './provider-settings-utils'
import { createManualProviderListEntry } from './provider-settings-utils'

export interface ProviderListGroup {
  id: string
  label: string
  kind: 'manual'
  entries: ProviderListEntry[]
}

const MANUAL_GROUP_ID = 'manual'
const MANUAL_GROUP_LABEL = 'Manual providers'

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
  return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })
}

function manualGroupDescriptor(): Pick<ProviderListGroup, 'id' | 'kind' | 'label'> {
  return { id: MANUAL_GROUP_ID, kind: 'manual', label: MANUAL_GROUP_LABEL }
}

export function sortProviderProfilesByStatus(profiles: AgentProfile[]): AgentProfile[] {
  return [...profiles].sort(compareProviderProfiles)
}

export function collectProviderListGroups(profiles: AgentProfile[]): ProviderListGroup[] {
  const groups = new Map<string, ProviderListGroup>()

  for (const profile of sortProviderProfilesByStatus(profiles)) {
    const descriptor = manualGroupDescriptor()
    const group = groups.get(descriptor.id)
    if (group) {
      group.entries.push(createManualProviderListEntry(profile))
      continue
    }

    groups.set(descriptor.id, {
      ...descriptor,
      entries: [createManualProviderListEntry(profile)],
    })
  }

  return Array.from(groups.values()).sort(compareProviderGroups)
}
