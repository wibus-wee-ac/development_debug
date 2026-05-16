// Input: ThinkingEffort type
// Output: Label maps for thinking effort and runtime kind options
// Position: Single source of truth for selector labels

import type { RuntimeKind } from '~/lib/types'

import type { ThinkingEffort } from './types'

export const THINKING_EFFORTS: { value: ThinkingEffort, label: string }[] = [
  { value: null, label: 'Auto' },
  { value: 'low', label: '快速' },
  { value: 'medium', label: '平衡' },
  { value: 'high', label: '深度' },
]

export const RUNTIME_KIND_OPTIONS: { value: RuntimeKind, label: string, description: string }[] = [
  { value: 'standard', label: 'Standard', description: 'Direct API calls' },
  { value: 'claude-agent', label: 'Claude Agent', description: 'Agentic tool-use loop' },
  { value: 'codex', label: 'Codex', description: 'Code-focused autonomous' },
  { value: 'cli-tui', label: 'Claude Code', description: 'Full terminal interface' },
]
