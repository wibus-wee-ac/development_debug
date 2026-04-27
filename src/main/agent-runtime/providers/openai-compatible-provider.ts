// Input: AgentProfile config and main-process credential reader
// Output: OpenAICompatibleProvider for Base URL / API key model access with streaming chat
// Position: Concrete Agent Runtime provider for OpenAI-compatible HTTP APIs

import { randomUUID } from 'node:crypto'

import OpenAI from 'openai'

import type { ResponseStreamEvent } from '../../lib/chat-provider'
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
} from '../types'

interface OpenAICompatibleProviderDeps {
  readSecret: (credentialRef: string) => string
}

interface OpenAICompatibleConfig {
  baseUrl?: string
  model?: string
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

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<ResponseStreamEvent, void, void> {
    const { runtimeSession, profile, message, modelId: inputModelId, thinkingEffort } = input
    const config = parseConfig(profile.configJson)

    const effectiveModel = inputModelId ?? config.model
    if (!config.baseUrl || !effectiveModel) {
      throw new Error('OpenAI-compatible provider requires baseUrl and model in configJson')
    }

    const apiKey = profile.credentialRef
      ? this.deps.readSecret(profile.credentialRef)
      : 'no-key'

    const client = new OpenAI({
      apiKey,
      baseURL: config.baseUrl,
      dangerouslyAllowBrowser: false,
    })

    const abortController = new AbortController()
    this.activeTurns.set(runtimeSession.chatSessionId, abortController)

    const textItemId = randomUUID()
    let outputIndex = 0
    let seqNum = 0
    const nextSeq = (): number => {
      seqNum++
      return seqNum
    }

    try {
      const extraParams: Record<string, unknown> = {}
      if (thinkingEffort) {
        extraParams.reasoning_effort = thinkingEffort
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
        // Capture usage from the final chunk (sent when include_usage is true)
        if (chunk.usage) {
          this._lastUsage = {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
          }
        }

        const delta = chunk.choices[0]?.delta?.content
        if (!delta) {
          continue
        }

        if (firstChunk) {
          firstChunk = false
          outputIndex++
          yield {
            type: 'response.output_item.added',
            output_index: outputIndex,
            item: {
              type: 'message',
              id: textItemId,
              role: 'assistant',
              status: 'in_progress',
              content: [],
            },
            sequence_number: nextSeq(),
          } as Extract<ResponseStreamEvent, { type: 'response.output_item.added' }>
        }

        yield {
          type: 'response.output_text.delta',
          item_id: textItemId,
          content_index: 0,
          delta,
          logprobs: [],
          output_index: outputIndex,
          sequence_number: nextSeq(),
        } as Extract<ResponseStreamEvent, { type: 'response.output_text.delta' }>
      }

      if (!firstChunk) {
        yield {
          type: 'response.output_item.done',
          output_index: outputIndex,
          item: {
            type: 'message',
            id: textItemId,
            role: 'assistant',
            status: 'completed',
            content: [],
          },
          sequence_number: nextSeq(),
        } as Extract<ResponseStreamEvent, { type: 'response.output_item.done' }>
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
