// Output: Regression coverage for composer provider profile visibility.
// Input: Provider profiles and composer context inputs.
// Position: Guards Composer Toolbar ownership of selectable provider profile lists.

import { describe, expect, it } from 'vitest'

import type { AgentProfile } from '~/lib/types'

import { listSelectableComposerProfiles, pickComposerProfileId } from './composer-profile-selection'

function profile(overrides: Partial<AgentProfile> & Pick<AgentProfile, 'id'>): AgentProfile {
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    providerKind: overrides.providerKind ?? 'openai-compatible',
    enabled: overrides.enabled ?? true,
    configJson: overrides.configJson ?? '{}',
    credentialRef: overrides.credentialRef ?? null,
    customModels: overrides.customModels ?? '[]',
    iconSlug: overrides.iconSlug ?? null,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
  }
}

describe('listSelectableComposerProfiles', () => {
  it('hides disabled profiles', () => {
    const profiles = [
      profile({ id: 'enabled-provider' }),
      profile({ id: 'disabled-provider', enabled: false }),
    ]

    expect(listSelectableComposerProfiles({ profiles, runtimeKind: 'standard' }).map(item => item.id))
      .toEqual(['enabled-provider'])
  })

  it('keeps openai-compatible providers for Codex', () => {
    const profiles = [
      profile({ id: 'openai-provider', providerKind: 'openai-compatible' }),
      profile({ id: 'anthropic-provider', providerKind: 'anthropic' }),
    ]

    expect(listSelectableComposerProfiles({ profiles, runtimeKind: 'codex' }).map(item => item.id))
      .toEqual(['openai-provider'])
  })

  it('keeps anthropic providers for Claude Agent', () => {
    const profiles = [
      profile({ id: 'openai-provider', providerKind: 'openai-compatible' }),
      profile({ id: 'anthropic-provider', providerKind: 'anthropic' }),
    ]

    expect(listSelectableComposerProfiles({ profiles, runtimeKind: 'claude-agent' }).map(item => item.id))
      .toEqual(['anthropic-provider'])
  })
})

describe('pickComposerProfileId', () => {
  it('keeps a selectable persisted profile', () => {
    const profiles = [
      profile({ id: 'first-provider' }),
      profile({ id: 'persisted-provider' }),
    ]

    expect(pickComposerProfileId({ profiles, lastProfileId: 'persisted-provider' })).toBe('persisted-provider')
  })

  it('falls back to the first selectable profile', () => {
    const profiles = [
      profile({ id: 'first-provider' }),
      profile({ id: 'second-provider' }),
    ]

    expect(pickComposerProfileId({ profiles, lastProfileId: 'missing-provider' })).toBe('first-provider')
  })
})
