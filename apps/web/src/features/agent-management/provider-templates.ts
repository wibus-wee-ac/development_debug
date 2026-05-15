// Input: ProviderKind type
// Output: Provider preset catalog for LLM connection setup
// Position: Data layer for provider setup

import type { ProviderKind } from '~/lib/types'

export interface ProviderPreset {
  id: string
  name: string
  tagline: string
  providerKind: ProviderKind
  accent: string
  fields: PresetField[]
  defaults: Record<string, unknown>
}

interface PresetField {
  key: string
  label: string
  type: 'text' | 'password' | 'url'
  placeholder?: string
  mono?: boolean
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    tagline: 'Claude — high-capability models',
    providerKind: 'openai-compatible',
    accent: 'orange',
    fields: [
      { key: 'baseUrl', label: 'Endpoint', type: 'url', placeholder: 'https://api.anthropic.com/v1', mono: true },
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-ant-...', mono: true },
    ],
    defaults: { baseUrl: 'https://api.anthropic.com/v1' },
  },
  {
    id: 'openai',
    name: 'OpenAI',
    tagline: 'GPT / o-series models',
    providerKind: 'openai-compatible',
    accent: 'emerald',
    fields: [
      { key: 'baseUrl', label: 'Endpoint', type: 'url', placeholder: 'https://api.openai.com/v1', mono: true },
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-...', mono: true },
    ],
    defaults: { baseUrl: 'https://api.openai.com/v1' },
  },
  {
    id: 'custom',
    name: 'Custom',
    tagline: 'Any OpenAI-compatible endpoint',
    providerKind: 'openai-compatible',
    accent: 'violet',
    fields: [
      { key: 'baseUrl', label: 'Endpoint', type: 'url', placeholder: 'https://api.example.com/v1', mono: true },
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-...', mono: true },
    ],
    defaults: { baseUrl: '' },
  },
]
