import { describe, expect, it } from 'vitest'

import { projectProviderModelCapabilities } from './model-capabilities'

describe('projectProviderModelCapabilities', () => {
  it('adds Anthropic default image input capabilities when upstream metadata is empty', () => {
    expect(projectProviderModelCapabilities({
      id: 'claude-sonnet-4-20250514',
      label: 'Claude Sonnet 4',
      providerKind: 'anthropic',
      capabilities: {},
    })).toEqual({
      id: 'claude-sonnet-4-20250514',
      label: 'Claude Sonnet 4',
      providerKind: 'anthropic',
      capabilities: {
        inputModalities: ['text', 'image'],
        outputModalities: ['text'],
      },
    })
  })

  it('keeps explicit Anthropic modality metadata from registry or manual overrides', () => {
    expect(projectProviderModelCapabilities({
      id: 'claude-text-only',
      label: 'Claude Text Only',
      providerKind: 'anthropic',
      capabilities: {
        inputModalities: ['text'],
        outputModalities: ['text', 'json'],
      },
    }).capabilities).toEqual({
      inputModalities: ['text'],
      outputModalities: ['text', 'json'],
    })
  })

  it('does not add image capabilities to OpenAI-compatible models', () => {
    expect(projectProviderModelCapabilities({
      id: 'text-model',
      label: 'Text Model',
      providerKind: 'openai-compatible',
      capabilities: {},
    }).capabilities).toEqual({})
  })
})
