// Input: ThinkingEffort type
// Output: Label maps for thinking effort and runtime kind options
// Position: Single source of truth for selector labels

import type { RuntimeKind } from '~/lib/types'

import type { ThinkingEffort } from './types'

export const THINKING_EFFORTS: { value: ThinkingEffort, label: string, description: string }[] = [
  { value: null, label: 'Auto', description: '根据任务复杂度自动调整' },
  { value: 'low', label: '快速', description: '简单问题，快速响应' },
  { value: 'medium', label: '平衡', description: '适中思考，兼顾速度与质量' },
  { value: 'high', label: '深度', description: '复杂推理，深度思考' },
]

export const RUNTIME_KIND_OPTIONS: { value: RuntimeKind, label: string, description: string }[] = [
  { value: 'standard', label: 'Standard', description: 'Direct API calls' },
  { value: 'claude-agent', label: 'Claude Agent', description: 'Agentic tool-use loop' },
  { value: 'codex', label: 'Codex', description: 'Code-focused autonomous' },
  { value: 'cli-tui', label: 'CLI TUI', description: 'Agent-first terminal runtime' },
]
