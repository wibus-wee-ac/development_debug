import { describe, expect, it } from 'vitest'

import type { ModelDescriptor } from '~/lib/types'

import { resolveChatModelId, selectChatThinkingEffort } from './use-composer-state'

function model(overrides: Partial<ModelDescriptor> & { id: string }): ModelDescriptor {
  return {
    id: overrides.id,
    label: overrides.label ?? overrides.id,
    providerKind: overrides.providerKind ?? 'openai-compatible',
    capabilities: overrides.capabilities ?? {},
  }
}

describe('resolveChatModelId', () => {
  it('does not treat a missing bound agent model as a resolved chat model', () => {
    expect(resolveChatModelId({
      boundAgentModelId: 'old-model',
      boundAgentProviderTargetId: 'provider-1',
      boundModelId: null,
      boundProviderTargetId: 'provider-1',
      manualProfileId: null,
      models: [model({ id: 'current-model' })],
    })).toBe('current-model')
  })
})

describe('selectChatThinkingEffort', () => {
  it('drops unsupported bound agent thinking effort for non-reasoning models', () => {
    expect(selectChatThinkingEffort({
      effectiveModel: model({ id: 'plain-model', capabilities: { reasoning: false } }),
      preferredThinkingEffort: 'xhigh',
    })).toBeNull()
  })
})
