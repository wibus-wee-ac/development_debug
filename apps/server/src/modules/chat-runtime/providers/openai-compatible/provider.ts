// Input: OpenAI-compatible profile config, credential reader, AI SDK execution engine
// Output: openai-compatible chat runtime provider powered by Vercel AI SDK
// Position: apps/server/src/modules/chat-runtime/providers/openai-compatible/provider.ts

import type { UIMessage, UIMessageChunk } from 'ai'

import { lookupContextWindow } from '../../../providers/model-info-registry'
import {
  OpenAICompatibleConfigSchema,
  parseConfigWith,
} from '../../../providers/provider-base'
import type { RuntimeKind } from '../../../providers/types'
import type { TokenUsage } from '../../engine/ai-sdk-engine'
import { buildModelMessages, executeAiSdkTurn, executeAiSdkTurnSnapshots } from '../../engine/ai-sdk-engine'
import { createAssistantMessage } from '../../delta-events'
import { createLanguageModel, detectApiFormat } from '../../engine/providers'
import type {
  CancelTurnInput,
  ChatRuntime,
  ResumeChatSessionInput,
  RuntimeSession,
  StartChatSessionInput,
  StreamTurnInput,
} from '../../runtime-provider-types'

interface OpenAICompatibleProviderDeps {
  readSecret: (credentialRef: string) => string
}

export interface StepUsageEntry {
  stepNumber: number
  stepType: string
  modelId?: string
  usage: TokenUsage
}

export class OpenAICompatibleProvider implements ChatRuntime {
  readonly runtimeKind = 'standard' as const satisfies RuntimeKind

  private readonly activeTurns = new Map<string, AbortController>()
  private _lastUsage: TokenUsage | null = null
  private _lastStepUsages: StepUsageEntry[] = []

  get lastUsage(): TokenUsage | null {
    return this._lastUsage
  }

  get lastStepUsages(): StepUsageEntry[] {
    return this._lastStepUsages
  }

  constructor(private readonly deps: OpenAICompatibleProviderDeps) {}

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    const config = parseConfigWith(input.profile.configJson, OpenAICompatibleConfigSchema)
    const currentModelId = input.modelId ?? config.model ?? null

    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      agentProfileId: input.profile.id,
      runtimeKind: this.runtimeKind,
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

  async* streamTurnSnapshots(input: StreamTurnInput): AsyncGenerator<UIMessage, void, void> {
    const { runtimeSession, profile, message, modelId: requestedModelId, providerOptions } = input
    const config = parseConfigWith(profile.configJson, OpenAICompatibleConfigSchema)
    const effectiveModel = requestedModelId ?? config.model
    if (!config.baseUrl || !effectiveModel) {
      throw new Error('OpenAI-compatible provider requires baseUrl and model')
    }
    if (!input.responseMessageId) {
      throw new Error('OpenAI-compatible snapshot streaming requires responseMessageId')
    }

    const apiKey = profile.credentialRef
      ? this.deps.readSecret(profile.credentialRef)
      : 'no-key'

    const abortController = new AbortController()
    this.activeTurns.set(runtimeSession.chatSessionId, abortController)
    this._lastUsage = null
    this._lastStepUsages = []

    try {
      const apiFormat = detectApiFormat(config.baseUrl)
      const model = createLanguageModel({
        apiFormat,
        apiKey,
        baseUrl: config.baseUrl,
        modelId: effectiveModel,
        apiMode: config.apiMode,
      })

      const messages = buildModelMessages(
        input.history,
        message,
        config.maxMessages ?? 50,
      )

      const contextWindow = await lookupContextWindow(effectiveModel) ?? 128_000

      yield* executeAiSdkTurnSnapshots({
        model,
        messages,
        initialMessage: createAssistantMessage(input.responseMessageId),
        system: input.systemPrompt,
        maxSteps: 1,
        abortSignal: abortController.signal,
        providerOptions,
        onUsage: (usage) => { this._lastUsage = usage },
        onStepFinish: (step) => { this._lastStepUsages.push(step) },
        approvalContext: {
          chatSessionId: runtimeSession.chatSessionId,
          runtimeKind: this.runtimeKind,
        },
        contextWindow,
        chatSessionId: runtimeSession.chatSessionId,
      })
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

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
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
    this._lastStepUsages = []

    try {
      const apiFormat = detectApiFormat(config.baseUrl)
      const model = createLanguageModel({
        apiFormat,
        apiKey,
        baseUrl: config.baseUrl,
        modelId: effectiveModel,
        apiMode: config.apiMode,
      })

      const messages = buildModelMessages(
        input.history,
        message,
        config.maxMessages ?? 50,
      )

      const contextWindow = await lookupContextWindow(effectiveModel) ?? 128_000

      yield* executeAiSdkTurn({
        model,
        messages,
        system: input.systemPrompt,
        maxSteps: 1, // single-turn for openai-compatible (no tool execution)
        abortSignal: abortController.signal,
        providerOptions,
        onUsage: (usage) => { this._lastUsage = usage },
        onStepFinish: (step) => { this._lastStepUsages.push(step) },
        approvalContext: {
          chatSessionId: runtimeSession.chatSessionId,
          runtimeKind: this.runtimeKind,
        },
        contextWindow,
        chatSessionId: runtimeSession.chatSessionId,
      })
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

function createAbortError(): Error {
  const error = new Error('OpenAI-compatible turn aborted')
  error.name = 'AbortError'
  return error
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  // Standard AbortError (DOMException or custom)
  if (error.name === 'AbortError') {
    return true
  }
  // AI SDK wraps abort as various error messages
  if (error.message.includes('aborted') || error.message.includes('abort')) {
    return true
  }
  // AI SDK's AbortError from node-fetch or undici
  if (error.message.includes('This operation was aborted')) {
    return true
  }
  return false
}
