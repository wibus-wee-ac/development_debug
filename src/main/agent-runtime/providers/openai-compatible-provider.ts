// Input: AgentProfile config, credential reader, and optional injected OpenAI client factory
// Output: OpenAICompatibleProvider that maps OpenAI-compatible streams into typed timeline facts
// Position: Concrete Agent Runtime provider for OpenAI-compatible HTTP APIs

import { randomUUID } from 'node:crypto'

import OpenAI from 'openai'

import type { TimelineInputEvent } from '../../backend-control-plane/timeline-events'
import type {
  AgentProfile,
  CancelTurnInput,
  ChatRuntimeProvider,
  ModelDescriptor,
  ProviderProbeResult,
  ResumeChatSessionInput,
  RuntimeSession,
  StartChatSessionInput,
  StreamTurnInput,
  TokenUsage,
} from '../runtime-provider-types'

interface OpenAICompatibleProviderDeps {
  readSecret: (credentialRef: string) => string
  createClient?: (input: { apiKey: string, baseURL: string }) => OpenAICompatibleClient
}

interface OpenAICompatibleConfig {
  baseUrl?: string
  model?: string
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

const TOOL_CALL_NO_RUNTIME_OUTPUT = 'Tool call emitted without runtime execution'

type OpenAICompatibleStream = AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>

interface OpenAICompatibleClient {
  chat: {
    completions: {
      create: (
        params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
        options?: { signal?: AbortSignal },
      ) => Promise<OpenAICompatibleStream>
    }
  }
}

export class OpenAICompatibleProvider implements ChatRuntimeProvider {
  readonly providerKind = 'openai-compatible' as const

  /** Active AbortControllers keyed by chatSessionId for in-flight turns. */
  private readonly activeTurns = new Map<string, AbortController>()

  /** Token usage captured from the most recently completed streamTurn. */
  private _lastUsage: TokenUsage | null = null
  get lastUsage(): TokenUsage | null { return this._lastUsage }

  constructor(private readonly deps: OpenAICompatibleProviderDeps) {}

  // ── AgentProvider ─────────────────────────────────────────────────────────

  async probe(profile: AgentProfile): Promise<ProviderProbeResult> {
    const config = parseConfig(profile.configJson)
    if (!config.baseUrl) {
      return {
        ok: false,
        label: profile.name,
        version: null,
        details: {},
        errorText: 'Base URL is required',
      }
    }
    if (!profile.credentialRef) {
      return {
        ok: false,
        label: profile.name,
        version: null,
        details: { baseUrl: config.baseUrl },
        errorText: 'API key credential is required',
      }
    }
    this.deps.readSecret(profile.credentialRef)
    return {
      ok: true,
      label: profile.name,
      version: null,
      details: { baseUrl: config.baseUrl },
      errorText: null,
    }
  }

  async listModels(profile: AgentProfile): Promise<ModelDescriptor[]> {
    if (profile.credentialRef) {
      this.deps.readSecret(profile.credentialRef)
    }
    const config = parseConfig(profile.configJson)
    if (!config.model) {
      return []
    }
    return [{
      id: config.model,
      label: config.model,
      providerKind: this.providerKind,
      contextWindow: null,
    }]
  }

  // ── ChatRuntimeProvider ───────────────────────────────────────────────────

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    const { chatSessionId, profile } = input
    return {
      id: chatSessionId,
      chatSessionId,
      agentProfileId: profile.id,
      providerKind: this.providerKind,
      providerSessionId: null,
      providerStateSnapshot: null,
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    return input.runtimeSession
  }

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<TimelineInputEvent, void, void> {
    const { runtimeSession, profile, message, modelId: inputModelId, providerOptions } = input
    const config = parseConfig(profile.configJson)

    const effectiveModel = inputModelId ?? config.model
    if (!config.baseUrl || !effectiveModel) {
      throw new Error('OpenAI-compatible provider requires baseUrl and model in configJson')
    }

    const apiKey = profile.credentialRef
      ? this.deps.readSecret(profile.credentialRef)
      : 'no-key'

    const client = this.deps.createClient?.({ apiKey, baseURL: config.baseUrl })
      ?? new OpenAI({
        apiKey,
        baseURL: config.baseUrl,
        dangerouslyAllowBrowser: false,
      })

    const abortController = new AbortController()
    this.activeTurns.set(runtimeSession.chatSessionId, abortController)

    const textItemId = randomUUID()
    const toolCallsByIndex = new Map<number, ToolCallAccumulator>()
    let reasoningItemId: string | null = null

    try {
      const extraParams: Record<string, unknown> = {}
      if (providerOptions?.thinkingEffort) {
        extraParams.reasoning_effort = providerOptions.thinkingEffort
      }

      this._lastUsage = null

      const chatMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = []
      if (input.systemPrompt) {
        chatMessages.push({ role: 'system', content: input.systemPrompt })
      }
      for (const msg of input.history ?? []) {
        chatMessages.push({ role: msg.role, content: msg.content })
      }
      chatMessages.push({ role: 'user', content: message })

      const stream = await client.chat.completions.create(
        {
          model: effectiveModel,
          messages: chatMessages,
          stream: true,
          stream_options: { include_usage: true },
          ...extraParams,
        },
        { signal: abortController.signal },
      )

      let firstChunk = true
      for await (const chunk of stream) {
        if (abortController.signal.aborted) {
          throw createAbortError()
        }

        const choice = chunk.choices[0]
        if (!choice) {
          continue
        }

        const delta = readChoiceDelta(choice.delta)

        // Capture usage from the final chunk (sent when include_usage is true)
        if (chunk.usage) {
          this._lastUsage = {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
          }
        }

        if (delta.reasoning_content) {
          if (!reasoningItemId) {
            reasoningItemId = randomUUID()
            yield {
              type: 'reasoning.started',
              itemId: reasoningItemId,
              source: {
                backend: this.providerKind,
                eventType: 'response.reasoning.started',
                eventId: chunk.id,
                itemId: reasoningItemId,
              },
            }
          }

          yield {
            type: 'reasoning.delta',
            itemId: reasoningItemId,
            delta: delta.reasoning_content,
            source: {
              backend: this.providerKind,
              eventType: 'response.reasoning.delta',
              eventId: chunk.id,
              itemId: reasoningItemId,
            },
          }
        }

        if (delta.tool_calls?.length) {
          collectToolCalls(toolCallsByIndex, delta.tool_calls)
        }

        if (!delta.content) {
          if (choice.finish_reason === 'tool_calls' && toolCallsByIndex.size > 0) {
            if (reasoningItemId) {
              yield {
                type: 'reasoning.completed',
                itemId: reasoningItemId,
                source: {
                  backend: this.providerKind,
                  eventType: 'response.reasoning.completed',
                  eventId: chunk.id,
                  itemId: reasoningItemId,
                },
              }
              reasoningItemId = null
            }

            yield* flushToolCalls(this.providerKind, toolCallsByIndex, chunk.id)
            toolCallsByIndex.clear()
          }
          continue
        }

        if (reasoningItemId) {
          yield {
            type: 'reasoning.completed',
            itemId: reasoningItemId,
            source: {
              backend: this.providerKind,
              eventType: 'response.reasoning.completed',
              eventId: chunk.id,
              itemId: reasoningItemId,
            },
          }
          reasoningItemId = null
        }

        if (firstChunk) {
          firstChunk = false
          yield {
            type: 'assistant.message.started',
            itemId: textItemId,
            source: {
              backend: this.providerKind,
              eventType: 'response.output_item.added',
              eventId: chunk.id,
              itemId: textItemId,
            },
          }
        }

        yield {
          type: 'assistant.text.delta',
          itemId: textItemId,
          delta: delta.content,
          source: {
            backend: this.providerKind,
            eventType: 'response.output_text.delta',
            eventId: chunk.id,
            itemId: textItemId,
          },
        }
      }

      if (abortController.signal.aborted) {
        throw createAbortError()
      }

      if (reasoningItemId) {
        yield {
          type: 'reasoning.completed',
          itemId: reasoningItemId,
          source: {
            backend: this.providerKind,
            eventType: 'response.reasoning.completed',
            itemId: reasoningItemId,
          },
        }
      }

      if (toolCallsByIndex.size > 0) {
        yield* flushToolCalls(this.providerKind, toolCallsByIndex)
      }

      if (!firstChunk) {
        yield {
          type: 'assistant.message.completed',
          itemId: textItemId,
          source: {
            backend: this.providerKind,
            eventType: 'response.output_item.done',
            itemId: textItemId,
          },
        }
      }
    }
    finally {
      this.activeTurns.delete(runtimeSession.chatSessionId)
    }
  }

  async cancelTurn(input: CancelTurnInput): Promise<void> {
    const ctrl = this.activeTurns.get(input.runtimeSession.chatSessionId)
    if (ctrl) {
      ctrl.abort()
      this.activeTurns.delete(input.runtimeSession.chatSessionId)
    }
  }
}

function parseConfig(configJson: string): OpenAICompatibleConfig {
  try {
    const parsed = JSON.parse(configJson) as OpenAICompatibleConfig
    return {
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : undefined,
      model: typeof parsed.model === 'string' ? parsed.model : undefined,
    }
  }
  catch {
    return {}
  }
}

function createAbortError(): Error {
  const error = new Error('OpenAI-compatible turn aborted')
  error.name = 'AbortError'
  return error
}

function readChoiceDelta(delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta | undefined): OpenAICompatibleChoiceDelta {
  return (delta ?? {}) as OpenAICompatibleChoiceDelta
}

function collectToolCalls(
  target: Map<number, ToolCallAccumulator>,
  deltas: OpenAICompatibleToolCallDelta[],
): void {
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

function* flushToolCalls(
  providerKind: OpenAICompatibleProvider['providerKind'],
  toolCallsByIndex: Map<number, ToolCallAccumulator>,
  eventId?: string,
): Generator<TimelineInputEvent, void, void> {
  const sortedToolCalls = [...toolCallsByIndex.entries()].sort((left, right) => left[0] - right[0])

  for (const [, toolCall] of sortedToolCalls) {
    yield {
      type: 'tool_call.started',
      itemId: toolCall.itemId,
      toolName: toolCall.toolName,
      toolInput: toolCall.toolInput || null,
      source: {
        backend: providerKind,
        eventType: 'response.tool_call.started',
        eventId,
        itemId: toolCall.itemId,
      },
    }

    yield {
      type: 'tool_call.completed',
      itemId: toolCall.itemId,
      result: TOOL_CALL_NO_RUNTIME_OUTPUT,
      source: {
        backend: providerKind,
        eventType: 'response.tool_call.completed',
        eventId,
        itemId: toolCall.itemId,
      },
    }
  }
}
