// Input: ProviderKind type
// Output: Provider preset catalog
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

export interface PresetField {
  key: string
  label: string
  type: 'text' | 'password' | 'url'
  placeholder?: string
  mono?: boolean
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'claude-agent',
    name: 'Claude',
    tagline: 'Anthropic — autonomous coding agent',
    providerKind: 'claude-agent',
    accent: 'orange',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-ant-...', mono: true },
    ],
    defaults: { model: 'claude-sonnet-4-20250514', baseUrl: 'https://api.anthropic.com/v1', permissionMode: 'acceptEdits' },
  },
  {
    id: 'claude-cli',
    name: 'Claude CLI',
    tagline: 'Local terminal — full system access',
    providerKind: 'cli-tui',
    accent: 'amber',
    fields: [],
    defaults: { executable: 'claude', args: [] },
  },
  {
    id: 'codex',
    name: 'Codex',
    tagline: 'OpenAI — reasoning agent',
    providerKind: 'codex',
    accent: 'emerald',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-...', mono: true },
    ],
    defaults: { model: 'codex-mini-latest', baseUrl: 'https://api.openai.com/v1' },
  },
  {
    id: 'openai',
    name: 'OpenAI',
    tagline: 'GPT-4o — chat completions',
    providerKind: 'openai-compatible',
    accent: 'sky',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-...', mono: true },
    ],
    defaults: { model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' },
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
    defaults: { model: '', baseUrl: '' },
  },
]
