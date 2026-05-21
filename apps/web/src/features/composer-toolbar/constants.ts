import type { ModelDescriptor, RuntimeKind } from '~/lib/types'

import type { ThinkingOption } from './provider-model-menu'
import type { ThinkingEffort } from './types'

export const THINKING_EFFORTS: { value: ThinkingEffort, label: string, description: string }[] = [
  { value: null, label: '自动', description: '根据任务复杂度自动调整' },
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

export type ThinkingCapabilityTier = 'none' | 'standard' | 'extended'

const EXTENDED_REASONING_MODEL_RE = /(?:^|[\s/:_-])(?:gpt-5(?:\.\d+)?|o1|o3|o4|claude-(?:opus|sonnet)-4|gemini-2\.5-pro|grok-4|deepseek-r1)(?:$|[\s:._-])/

export function getThinkingCapabilityTier(model: ModelDescriptor | null | undefined): ThinkingCapabilityTier {
  if (model?.capabilities.reasoning !== true) {
    return 'none'
  }

  const searchable = `${model.id} ${model.capabilities.family ?? ''}`.toLowerCase()
  if (EXTENDED_REASONING_MODEL_RE.test(searchable)) {
    return 'extended'
  }

  return 'standard'
}

export function filterThinkingOptionsForModel<TThinking extends string | null>(
  model: ModelDescriptor | null | undefined,
  options: Array<ThinkingOption<TThinking>>,
): Array<ThinkingOption<TThinking>> {
  const tier = getThinkingCapabilityTier(model)

  return options.filter((option) => {
    if (option.value === null || option.value === 'auto') {
      return true
    }
    if (tier === 'none') {
      return false
    }
    if (option.value === 'minimal' || option.value === 'xhigh') {
      return tier === 'extended'
    }
    return true
  })
}

export function selectSupportedThinkingValue<TThinking extends string | null>(
  model: ModelDescriptor | null | undefined,
  options: Array<ThinkingOption<TThinking>>,
  current: TThinking,
  fallback: TThinking,
): TThinking {
  const supportedOptions = filterThinkingOptionsForModel(model, options)
  if (supportedOptions.some(option => option.value === current)) {
    return current
  }
  return supportedOptions[0]?.value ?? fallback
}
