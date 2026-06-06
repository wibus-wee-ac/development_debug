import type { BuiltinRuntimeKind, ModelDescriptor, RuntimeKind } from '~/lib/types'

import type { ThinkingOption } from './provider-model-menu'
import type { ThinkingEffort } from './types'

type ConcreteThinkingEffort = NonNullable<ThinkingEffort>

export const THINKING_EFFORTS: { value: ConcreteThinkingEffort, label: string, description: string }[] = [
  { value: 'low', label: '', description: '' },
  { value: 'medium', label: '', description: '' },
  { value: 'high', label: '', description: '' },
  { value: 'xhigh', label: '', description: '' },
]

export interface RuntimeKindOption {
  value: RuntimeKind
  label?: string
  description?: string
  iconKey?: string
}

export const RUNTIME_KIND_OPTIONS: RuntimeKindOption[] = [
  { value: 'claude-agent' },
  { value: 'codex' },
  { value: 'jar-core' },
  { value: 'cli-tui' },
]

export const JARVIS_RUNTIME_KIND_OPTIONS: RuntimeKindOption[] = [
  { value: 'jar-core' },
  { value: 'codex' },
  { value: 'claude-agent' },
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
    if (option.value === 'minimal' || option.value === 'xhigh' || option.value === 'max') {
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
