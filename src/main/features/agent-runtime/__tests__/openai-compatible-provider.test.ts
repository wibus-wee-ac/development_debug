// Input: OpenAICompatibleProvider with fake credential reader and injected streaming client
// Output: Unit tests for OpenAI-compatible provider configuration, secret handling, and abort semantics
// Position: Provider test coverage for Base URL / API key based agents

import OpenAI from 'openai'
import { describe, expect, it, vi } from 'vitest'

import { OpenAICompatibleProvider } from '../providers/openai-compatible-provider'
import type { AgentProfile, RuntimeSession } from '../runtime-provider-types'

const profile: AgentProfile = {
  id: 'openai-local',
  name: 'OpenAI Local',
  providerKind: 'openai-compatible',
  enabled: true,
  configJson: '{"baseUrl":"https://api.example.test/v1","model":"gpt-test"}',
  credentialRef: 'credential-1',
  createdAt: 1,
  updatedAt: 1,
}

describe('openAICompatibleProvider', () => {
  it('lists configured default model without exposing the API key', async () => {
    const readSecret = vi.fn().mockReturnValue('sk-secret-value')
    const provider = new OpenAICompatibleProvider({ readSecret })

    await expect(provider.listModels(profile)).resolves.toEqual([
      {
        id: 'gpt-test',
        label: 'gpt-test',
        providerKind: 'openai-compatible',
        contextWindow: null,
      },
    ])
    expect(readSecret).toHaveBeenCalledWith('credential-1')
  })

  it('returns probe failure when Base URL is missing', async () => {
    const provider = new OpenAICompatibleProvider({ readSecret: vi.fn() })

    await expect(provider.probe({ ...profile, configJson: '{}' })).resolves.toMatchObject({
      ok: false,
      label: 'OpenAI Local',
      errorText: 'Base URL is required',
    })
  })

  it('treats a cancelled streaming turn as AbortError even when the stream ends quietly', async () => {
    const create = vi.fn(async (_params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming, options?: { signal?: AbortSignal }) => ({
      async *[Symbol.asyncIterator](): AsyncGenerator<OpenAI.Chat.Completions.ChatCompletionChunk, void, void> {
        yield {
          id: 'chunk-1',
          object: 'chat.completion.chunk',
          created: 0,
          model: 'gpt-test',
          choices: [{
            index: 0,
            delta: { content: 'Hello' },
            finish_reason: null,
            logprobs: null,
          }],
          usage: null,
        }

        await new Promise<void>((resolve) => {
          if (options?.signal?.aborted) {
            resolve()
            return
          }
          options?.signal?.addEventListener('abort', () => resolve(), { once: true })
        })
      },
    }))

    const provider = new OpenAICompatibleProvider({
      readSecret: vi.fn().mockReturnValue('sk-secret-value'),
      createClient: () => ({
        chat: {
          completions: {
            create,
          },
        },
      }),
    })

    const runtimeSession: RuntimeSession = {
      id: 'chat-session-1',
      chatSessionId: 'chat-session-1',
      agentProfileId: profile.id,
      providerKind: 'openai-compatible',
      providerSessionId: null,
      providerStateSnapshot: null,
    }

    const iterator = provider.streamTurn({
      runtimeSession,
      profile,
      message: 'Please stop',
    })

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'assistant.message.started' },
    })
    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'assistant.text.delta', delta: 'Hello' },
    })

    await provider.cancelTurn({ runtimeSession, profile })

    await expect(iterator.next()).rejects.toMatchObject({
      name: 'AbortError',
      message: 'OpenAI-compatible turn aborted',
    })
    expect(create).toHaveBeenCalledTimes(1)
  })
})
