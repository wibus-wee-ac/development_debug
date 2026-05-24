// Output: Composer-owned provider target selection helpers.
// Input: Provider target options plus runtime kind compatibility.
// Position: Composer Toolbar owns which provider targets are selectable in composer surfaces.

import { runtimeSupportsProviderKind } from '~/features/agent-runtime/runtime-compatibility'
import type { RuntimeKind } from '~/lib/types'

import type { ProviderModelOption } from './types'

interface SelectableProfilesInput {
  profiles: ProviderModelOption[]
  runtimeKind: RuntimeKind
}

interface PickProfileInput {
  profiles: ProviderModelOption[]
  lastProfileId: string | null
}

export function listSelectableComposerProfiles({
  profiles,
  runtimeKind,
}: SelectableProfilesInput): ProviderModelOption[] {
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
