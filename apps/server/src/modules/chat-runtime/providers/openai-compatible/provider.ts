// Input: OpenAI-compatible profile config, credential reader, and fetch streaming responses
// Output: openai-compatible chat runtime provider for server-native turn execution
// Position: apps/server/src/modules/chat-runtime/providers/openai-compatible/provider.ts

import { randomUUID } from 'node:crypto'

import { fetchWithRetry } from '../../../../lib/fetch-retry'
import {
  OpenAICompatibleConfigSchema,
  parseConfigWith,
} from '../../../providers/provider-base'
import type { ProviderKind } from '../../../providers/types'
import type {
  CancelTurnInput,
  ChatRuntimeProvider,
  ResumeChatSessionInput,
  RuntimeSession,
  StartChatSessionInput,
  StreamTurnInput,
  TimelineInputEvent,
  TokenUsage,
} from '../../runtime-provider-types'

interface OpenAICompatibleProviderDeps {
  readSecret: (credentialRef: string) => string
}

interface OpenAICompatibleToolCallDelta {
  index?: number
  id?: string
  function?: {
    name?: string
    arguments?: string
  }
}

interface OpenAICompatibleChoiceDelta {
  content?: string | null
  reasoning_content?: string
  tool_calls?: OpenAICompatibleToolCallDelta[]
}

interface ToolCallAccumulator {
  itemId: string
  toolName: string
  toolInput: string
}

const TRAILING_SLASH_RE = /\/$/
const SSE_LINE_SPLIT_RE = /\r?\n/
const TOOL_CALL_NO_RUNTIME_OUTPUT = 'Tool call emitted without runtime execution'

export class OpenAICompatibleProvider implements ChatRuntimeProvider {
  readonly providerKind = 'openai-compatible' as const satisfies ProviderKind

  private readonly activeTurns = new Map<string, AbortController>()
  private _lastUsage: TokenUsage | null = null

  get lastUsage(): TokenUsage | null {
    return this._lastUsage
  }

  constructor(private readonly deps: OpenAICompatibleProviderDeps) {}

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    const config = parseConfigWith(input.profile.configJson, OpenAICompatibleConfigSchema)
    const currentModelId = input.modelId ?? config.model ?? null

    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      agentProfileId: input.profile.id,
      providerKind: this.providerKind,
      providerSessionId: null,
      providerStateSnapshot: JSON.stringify({
        baseUrl: config.baseUrl ?? null,
        models: { currentModelId },
      }),
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    if (!input.modelId) {
      return input.runtimeSession
    }

    const snapshot = parseProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    return {
      ...input.runtimeSession,
      providerStateSnapshot: JSON.stringify({
        ...snapshot,
        models: { currentModelId: input.modelId },
      }),
    }
  }

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<TimelineInputEvent, void, void> {
    const { runtimeSession, profile, message, modelId: requestedModelId, providerOptions } = input
    const config = parseConfigWith(profile.configJson, OpenAICompatibleConfigSchema)
    const effectiveModel = requestedModelId ?? config.model
    if (!config.baseUrl || !effectiveModel) {
      throw new Error('OpenAI-compatible provider requires baseUrl and model')
    }

    const apiKey = profile.credentialRef
      ? this.deps.readSecret(profile.credentialRef)
      : 'no-key'

    const abortController = new AbortController()
    this.activeTurns.set(runtimeSession.chatSessionId, abortController)
    this._lastUsage = null

    const textItemId = randomUUID()
    let firstChunk = true
    let reasoningItemId: string | null = null
    const toolCallsByIndex = new Map<number, ToolCallAccumulator>()

    try {
      const response = await fetchWithRetry(`${config.baseUrl.replace(TRAILING_SLASH_RE, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: effectiveModel,
          messages: buildChatMessages(input.systemPrompt, input.history, message, config.maxMessages ?? 50),
          stream_options: { include_usage: true },
          ...(providerOptions?.thinkingEffort ? { reasoning_effort: providerOptions.thinkingEffort } : {}),
        }),
        signal: abortController.signal,
      })

      if (!response.ok) {
        let errorText = `OpenAI-compatible provider returned ${response.status}`
        try {
          const body = await response.json() as { error?: { message?: string } }
          if (body?.error?.message) {
            errorText = body.error.message
          }
        }
        catch { /* ignore parse failure */ }
        throw new Error(errorText)
      }
      if (!response.body) {
        throw new Error('OpenAI-compatible provider returned an empty body')
      }

      for await (const line of iterateSseData(response.body, abortController.signal)) {
        if (line === '[DONE]') {
          break
        }

        const chunk = JSON.parse(line) as {
          id?: string
          choices?: Array<{
            delta?: OpenAICompatibleChoiceDelta
            finish_reason?: string | null
          }>
          usage?: {
            prompt_tokens?: number
            completion_tokens?: number
            total_tokens?: number
          }
        }

        const choice = chunk.choices?.[0]
        const delta = choice?.delta ?? {}
        if (chunk.usage) {
          this._lastUsage = {
            promptTokens: chunk.usage.prompt_tokens ?? 0,
            completionTokens: chunk.usage.completion_tokens ?? 0,
            totalTokens: chunk.usage.total_tokens ?? 0,
          }
        }

        if (delta.reasoning_content) {
          if (!reasoningItemId) {
            reasoningItemId = randomUUID()
            yield {
              type: 'reasoning.started',
              itemId: reasoningItemId,
              source: { backend: this.providerKind, eventType: 'response.reasoning.started', eventId: chunk.id, itemId: reasoningItemId },
            }
          }
          yield {
            type: 'reasoning.delta',
            itemId: reasoningItemId,
            delta: delta.reasoning_content,
            source: { backend: this.providerKind, eventType: 'response.reasoning.delta', eventId: chunk.id, itemId: reasoningItemId },
          }
        }

        if (delta.tool_calls?.length) {
          collectToolCalls(toolCallsByIndex, delta.tool_calls)
        }

        if (delta.content) {
          if (reasoningItemId) {
            yield {
              type: 'reasoning.completed',
              itemId: reasoningItemId,
              source: { backend: this.providerKind, eventType: 'response.reasoning.completed', eventId: chunk.id, itemId: reasoningItemId },
            }
            reasoningItemId = null
          }
          if (firstChunk) {
            firstChunk = false
            yield {
              type: 'assistant.message.started',
              itemId: textItemId,
              source: { backend: this.providerKind, eventType: 'response.output_item.added', eventId: chunk.id, itemId: textItemId },
            }
          }
          yield {
            type: 'assistant.text.delta',
            itemId: textItemId,
            delta: delta.content,
            source: { backend: this.providerKind, eventType: 'response.output_text.delta', eventId: chunk.id, itemId: textItemId },
          }
        }

        if (choice?.finish_reason === 'tool_calls' && toolCallsByIndex.size > 0) {
          if (reasoningItemId) {
            yield {
              type: 'reasoning.completed',
              itemId: reasoningItemId,
              source: { backend: this.providerKind, eventType: 'response.reasoning.completed', eventId: chunk.id, itemId: reasoningItemId },
            }
            reasoningItemId = null
          }
          yield* flushToolCalls(this.providerKind, toolCallsByIndex, chunk.id)
          toolCallsByIndex.clear()
        }

        if (abortController.signal.aborted) {
          throw createAbortError()
        }
      }

      if (abortController.signal.aborted) {
        throw createAbortError()
      }

      if (reasoningItemId) {
        yield {
          type: 'reasoning.completed',
          itemId: reasoningItemId,
          source: { backend: this.providerKind, eventType: 'response.reasoning.completed', itemId: reasoningItemId },
        }
      }

      if (toolCallsByIndex.size > 0) {
        yield* flushToolCalls(this.providerKind, toolCallsByIndex)
      }

      if (!firstChunk) {
        yield {
          type: 'assistant.message.completed',
          itemId: textItemId,
          source: { backend: this.providerKind, eventType: 'response.output_item.done', itemId: textItemId },
        }
      }
    }
    catch (error) {
      if (isAbortError(error)) {
        throw createAbortError()
      }
      throw error
    }
    finally {
      this.activeTurns.delete(runtimeSession.chatSessionId)
    }
  }

  async cancelTurn(input: CancelTurnInput): Promise<void> {
    const controller = this.activeTurns.get(input.runtimeSession.chatSessionId)
    if (controller) {
      controller.abort()
      this.activeTurns.delete(input.runtimeSession.chatSessionId)
    }
  }
}

function truncateHistory(
  history: Array<{ role: 'user' | 'assistant', content: string }>,
  maxMessages: number,
): Array<{ role: 'user' | 'assistant', content: string }> {
  if (history.length <= maxMessages) {
    return history
  }
  const truncated = history.slice(-maxMessages)
  if (truncated[0]?.role === 'assistant') {
    return truncated.slice(1)
  }
  return truncated
}

function buildChatMessages(systemPrompt: string | undefined, history: Array<{ role: 'user' | 'assistant', content: string }> | undefined, message: string, maxMessages = 50): Array<{ role: string, content: string }> {
  const messages: Array<{ role: string, content: string }> = []
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt })
  }
  const effectiveHistory = history ? truncateHistory(history, maxMessages) : []
  for (const item of effectiveHistory) {
    messages.push(item)
  }
  messages.push({ role: 'user', content: message })
  return messages
}

function parseProviderStateSnapshot(providerStateSnapshot: string | null): Record<string, unknown> {
  if (!providerStateSnapshot) {
    return {}
  }
  try {
    const parsed = JSON.parse(providerStateSnapshot) as Record<string, unknown>
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  }
  catch {
    return {}
  }
}

async function* iterateSseData(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<string, void, void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        buffer += decoder.decode()
        break
      }
      if (signal.aborted) {
        throw createAbortError()
      }
      buffer += decoder.decode(value, { stream: true })
      while (true) {
        const delimiterIndex = buffer.indexOf('\n\n')
        if (delimiterIndex === -1) {
          break
        }
        const rawEvent = buffer.slice(0, delimiterIndex)
        buffer = buffer.slice(delimiterIndex + 2)
        const dataLines = rawEvent.split(SSE_LINE_SPLIT_RE).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim())
        if (dataLines.length > 0) {
          yield dataLines.join('\n')
        }
      }
    }
  }
  finally {
    reader.releaseLock()
  }
}

function collectToolCalls(target: Map<number, ToolCallAccumulator>, deltas: OpenAICompatibleToolCallDelta[]): void {
  for (const toolCall of deltas) {
    const index = typeof toolCall.index === 'number' ? toolCall.index : target.size
    const current = target.get(index)
    target.set(index, {
      itemId: current?.itemId ?? toolCall.id ?? randomUUID(),
      toolName: toolCall.function?.name ?? current?.toolName ?? 'tool',
      toolInput: `${current?.toolInput ?? ''}${toolCall.function?.arguments ?? ''}`,
    })
  }
}

function* flushToolCalls(providerKind: ProviderKind, toolCallsByIndex: Map<number, ToolCallAccumulator>, eventId?: string): Generator<TimelineInputEvent, void, void> {
  const toolCalls = [...toolCallsByIndex.entries()].sort((left, right) => left[0] - right[0])
  for (const [, toolCall] of toolCalls) {
    yield {
      type: 'tool_call.started',
      itemId: toolCall.itemId,
      toolName: toolCall.toolName,
      toolInput: toolCall.toolInput || null,
      source: { backend: providerKind, eventType: 'response.tool_call.started', eventId, itemId: toolCall.itemId },
    }
    yield {
      type: 'tool_call.completed',
      itemId: toolCall.itemId,
      result: TOOL_CALL_NO_RUNTIME_OUTPUT,
      source: { backend: providerKind, eventType: 'response.tool_call.completed', eventId, itemId: toolCall.itemId },
    }
  }
}

function createAbortError(): Error {
  const error = new Error('OpenAI-compatible turn aborted')
  error.name = 'AbortError'
  return error
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'))
}
