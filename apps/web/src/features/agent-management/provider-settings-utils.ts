// Output: Shared provider settings constants and helpers for Agent Management.
// Input: Agent profile records, provider presets, and model visibility sentinel values.
// Position: Agent Management owns provider settings semantics used by list, draft, detail, and model panels.

import { ALL_MODELS_DISABLED_SENTINEL } from '~/features/agent-runtime/model-visibility'
import type { AgentProfile, ProviderKind } from '~/lib/types'

import type { ProviderPreset } from './provider-templates'
import { PROVIDER_PRESETS } from './provider-templates'

const RE_WHITESPACE = /\s+/g

export const ALL_DISABLED_SENTINEL = ALL_MODELS_DISABLED_SENTINEL

export const PROVIDER_KIND_LABELS: Record<ProviderKind, string> = {
  'openai-compatible': 'OpenAI-compatible',
  anthropic: 'Anthropic'
}

export interface DraftProvider {
  id: string
  presetId: string | null
}

export function buildProfileId(name: string, fallback: string): string {
  const base = name.trim().toLowerCase().replace(RE_WHITESPACE, '-')
  return base || fallback
}

export function presetForProfile(profile: AgentProfile): ProviderPreset {
  return (
    PROVIDER_PRESETS.find((p) => p.providerKind === profile.providerKind) ??
    PROVIDER_PRESETS.at(-1)!
  )
}
