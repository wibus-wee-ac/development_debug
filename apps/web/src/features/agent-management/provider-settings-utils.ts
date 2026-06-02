// Output: Shared provider settings constants and helpers for Agent Management.
// Input: Agent profile records, provider presets, and model visibility sentinel values.
// Position: Agent Management owns provider settings semantics used by list, draft, detail, and model panels.

import { ALL_MODELS_DISABLED_SENTINEL } from '~/features/agent-runtime/model-visibility'
import type { AgentProfile, ApiProviderKind, ProviderKind } from '~/lib/types'

import type { ProviderPreset } from './provider-templates'
import { PROVIDER_PRESETS } from './provider-templates'

const RE_WHITESPACE = /\s+/g

export const ALL_DISABLED_SENTINEL = ALL_MODELS_DISABLED_SENTINEL

export const PROVIDER_KIND_LABELS: Record<ProviderKind, string> = {
  'openai-compatible': 'OpenAI-compatible',
  'anthropic': 'Anthropic',
  'cli-tool': 'CLI Tool',
}

export interface DraftProvider {
  id: string
  presetId: string | null
}

export interface ExternalProviderSourceView {
  id: string
  pluginName: string
  label: string
  lastSyncStatus: 'never' | 'ok' | 'warning' | 'error'
  lastSyncMessage: string | null
  lastSyncError: string | null
  lastSyncAt: number | null
  inventory: Record<string, unknown>
  warnings: Array<{ code: string, message: string, severity: 'info' | 'warning' | 'error' }>
}

export interface ExternalProviderRecordView {
  id: string
  providerTargetId: string | null
  sourceKey: string
  externalId: string
  app: string
  name: string
  providerKind: ProviderKind
  status: 'active' | 'stale' | 'missing' | 'unsupported' | 'error'
  runtimeTargetEnabled: boolean
  metadata: Record<string, unknown>
  warnings: Array<{ code: string, message: string, severity: 'info' | 'warning' | 'error' }>
}

export interface ExternalProviderRuntimeTargetView {
  id: string
  sourceKey: string
  externalRecordId: string
  providerKind: ProviderKind
  displayName: string
  enabled: boolean
  credentialRef: string | null
  iconSlug: string | null
  lastResolvedFingerprint: string
  createdAt: number
  updatedAt: number
}

export interface ManualProviderListEntry {
  id: string
  kind: 'manual'
  profile: AgentProfile
}

export type ProviderListEntry = ManualProviderListEntry

export function buildProfileId(name: string, fallback: string): string {
  const base = name.trim().toLowerCase().replace(RE_WHITESPACE, '-')
  return base || fallback
}

export function providerListEntryId(kind: ProviderListEntry['kind'], id: string): string {
  return `${kind}:${id}`
}

export function createManualProviderListEntry(profile: AgentProfile): ManualProviderListEntry {
  return {
    id: providerListEntryId('manual', profile.id),
    kind: 'manual',
    profile,
  }
}

export function presetForProviderKind(providerKind: ProviderKind): ProviderPreset {
  return (
    PROVIDER_PRESETS.find(preset => preset.providerKind === providerKind)
    ?? PROVIDER_PRESETS.at(-1)!
  )
}

export function presetForProfile(profile: AgentProfile): ProviderPreset {
  return presetForProviderKind(profile.providerKind)
}

export function isApiProviderKind(providerKind: ProviderKind): providerKind is ApiProviderKind {
  return providerKind === 'openai-compatible' || providerKind === 'anthropic'
}
