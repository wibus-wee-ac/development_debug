// Output: Composer-owned provider profile selection helpers.
// Input: Provider profiles plus runtime kind compatibility.
// Position: Composer Toolbar owns which provider profiles are selectable in composer surfaces.

import { runtimeSupportsProviderKind } from '~/features/agent-runtime/runtime-compatibility'
import type { AgentProfile, RuntimeKind } from '~/lib/types'

interface SelectableProfilesInput {
  profiles: AgentProfile[]
  runtimeKind: RuntimeKind
}

interface PickProfileInput {
  profiles: AgentProfile[]
  lastProfileId: string | null
}

export function listSelectableComposerProfiles({
  profiles,
  runtimeKind,
}: SelectableProfilesInput): AgentProfile[] {
  return profiles.filter(profile =>
    profile.enabled && runtimeSupportsProviderKind(runtimeKind, profile.providerKind))
}

export function pickComposerProfileId({
  profiles,
  lastProfileId,
}: PickProfileInput): string | null {
  if (lastProfileId && profiles.some(profile => profile.id === lastProfileId)) {
    return lastProfileId
  }

  return profiles[0]?.id ?? null
}
