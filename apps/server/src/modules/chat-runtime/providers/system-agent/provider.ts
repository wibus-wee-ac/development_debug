// Input: jar-core agent runtime, provider config, credential reader
// Output: system-agent chat runtime provider wrapping @hijarvis/jar-core
// Position: apps/server/src/modules/chat-runtime/providers/system-agent/provider.ts

import { randomUUID } from 'node:crypto'

import type { UIMessageChunk } from 'ai'

import {
  parseConfigWith,
  SystemAgentConfigSchema,
} from '../../../providers/provider-base'
import type { ProviderKind } from '../../../providers/types'
import * as Preferences from '../../../preferences/service'
import type {
  CancelTurnInput,
  ChatRuntimeProvider,
  ResumeChatSessionInput,
  RuntimeSession,
  StartChatSessionInput,
  StreamTurnInput,
} from '../../runtime-provider-types'

interface SystemAgentProviderDeps {
  readSecret: (credentialRef: string) => string
}

const PROVIDER_KIND: ProviderKind = 'system-agent'

export class SystemAgentProvider implements ChatRuntimeProvider {
  readonly providerKind = PROVIDER_KIND

  private readonly activeTurns = new Map<string, AbortController>()

  constructor(private readonly deps: SystemAgentProviderDeps) {}

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      agentProfileId: input.profile.id,
      providerKind: PROVIDER_KIND,
      providerSessionId: null,
      providerStateSnapshot: JSON.stringify({
        models: { currentModelId: input.modelId ?? null },
      }),
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    if (!input.modelId) {
      return input.runtimeSession
    }
    const snapshot = parseSnapshot(input.runtimeSession.providerStateSnapshot)
    return {
      ...input.runtimeSession,
      providerStateSnapshot: JSON.stringify({
        ...snapshot,
        models: { currentModelId: input.modelId },
      }),
    }
  }

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    // Read Jarvis preferences for thinking level override
    const jarvisPrefs = await Preferences.getJarvisPreferences()
    const config = parseConfigWith(input.profile.configJson, SystemAgentConfigSchema)

    // Profile config is the source of truth for provider/model
    const provider = config.provider
    const model = config.model
    if (!provider || !model) {
      throw new Error('system-agent profile requires "provider" and "model" in configJson — configure via Settings → Providers')
    }

    // Resolve API key from profile credentialRef or inline config
    const secretRef = input.profile.credentialRef ?? null
    const apiKey = secretRef
      ? this.deps.readSecret(secretRef)
      : (config.apiKey ?? null)

    const abortController = new AbortController()
    this.activeTurns.set(input.runtimeSession.chatSessionId, abortController)

    try {
      const { createAgent } = await import('@hijarvis/jar-core')

      const agent = createAgent({
        provider: provider as any,
        model,
        systemPrompt: input.systemPrompt ?? 'You are Jarvis, a helpful system assistant.',
        thinkingLevel: jarvisPrefs.thinkingLevel ?? config.thinkingLevel ?? 'medium',
        providerConfig: {
          apiKey: apiKey ?? undefined,
          baseUrl: config.baseUrl,
        },
        execution: {
          requestTimeoutMs: 60_000,
          retryAttempts: 2,
          retryInitialDelayMs: 1000,
          retryBackoffMultiplier: 2,
          retryMaxDelayMs: 10_000,
        },
        tools: [],
      })

      const textItemId = randomUUID()
      let assistantStarted = false

      // Subscribe to agent events and bridge to UIMessageChunk
      const chunks: UIMessageChunk[] = []
      let resolveNext: (() => void) | null = null
      let done = false
      let streamError: Error | null = null

      const unsubscribe = agent.subscribe((event) => {
        if (abortController.signal.aborted) return

        if (event.type === 'message_update') {
          const ame = event.assistantMessageEvent
          const newChunks = bridgeEvent(ame, textItemId, assistantStarted)
          if (newChunks.length > 0) {
            if (!assistantStarted && newChunks.some(c => c.type === 'text-start')) {
              assistantStarted = true
            }
            chunks.push(...newChunks)
            resolveNext?.()
          }
        }
        else if (event.type === 'agent_end') {
          if (assistantStarted) {
            chunks.push({ type: 'text-end', id: textItemId })
          }
          done = true
          resolveNext?.()
        }
      })

      // Start the prompt
      const promptPromise = agent.prompt(input.message).catch((err) => {
        streamError = err instanceof Error ? err : new Error(String(err))
        done = true
        resolveNext?.()
      })

      // Yield chunks as they arrive
      try {
        while (!done || chunks.length > 0) {
          if (abortController.signal.aborted) {
            agent.abort()
            break
          }
          if (chunks.length > 0) {
            yield chunks.shift()!
          }
          else if (!done) {
            await new Promise<void>((resolve) => { resolveNext = resolve })
            resolveNext = null
          }
        }
      }
      finally {
        unsubscribe()
        await promptPromise
      }

      if (streamError) {
        throw streamError
      }
    }
    finally {
      this.activeTurns.delete(input.runtimeSession.chatSessionId)
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

// ── helpers ──

function parseSnapshot(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  }
  catch { return {} }
}

type AssistantMessageEvent = {
  type: string
  delta?: string
  contentIndex?: number
  [key: string]: unknown
}

function bridgeEvent(ame: AssistantMessageEvent, textItemId: string, assistantStarted: boolean): UIMessageChunk[] {
  const out: UIMessageChunk[] = []

  switch (ame.type) {
    case 'text_start':
      if (!assistantStarted) {
        out.push({ type: 'text-start', id: textItemId })
      }
      break
    case 'text_delta':
      if (!assistantStarted) {
        out.push({ type: 'text-start', id: textItemId })
      }
      if (ame.delta) {
        out.push({ type: 'text-delta', delta: ame.delta } as UIMessageChunk)
      }
      break
    case 'thinking_start':
      out.push({ type: 'reasoning-start' } as UIMessageChunk)
      break
    case 'thinking_delta':
      if (ame.delta) {
        out.push({ type: 'reasoning-delta', delta: ame.delta } as UIMessageChunk)
      }
      break
    case 'thinking_end':
      out.push({ type: 'reasoning-end' } as UIMessageChunk)
      break
    case 'error':
      // Stream error as text for the user to see
      out.push({ type: 'text-delta', delta: '\n\n[Error occurred]' } as UIMessageChunk)
      break
  }

  return out
}
