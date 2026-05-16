// Input: jar-core agent runtime, provider config, credential reader
// Output: system-agent chat runtime provider wrapping @hijarvis/jar-core via executeIngressCommand
// Position: apps/server/src/modules/chat-runtime/providers/system-agent/provider.ts

import { randomUUID } from 'node:crypto'
import path from 'node:path'

import type { LoadedRuntimeConfig, MessageIngressCommand } from '@hijarvis/jar-core'
import { executeIngressCommand } from '@hijarvis/jar-core'
import type { UIMessageChunk } from 'ai'

import { getServerConfig } from '../../../../infra'
import * as Preferences from '../../../preferences/service'
import {
  BaseProviderConfig,
  parseConfigWith,
  SystemAgentConfigSchema,
} from '../../../providers/provider-base'
import type { RuntimeKind } from '../../../providers/types'
import type {
  CancelTurnInput,
  ChatRuntime,
  ResumeChatSessionInput,
  RuntimeSession,
  StartChatSessionInput,
  StreamTurnInput,
} from '../../runtime-provider-types'

interface SystemAgentProviderDeps {
  readSecret: (credentialRef: string) => string
}

const RUNTIME_KIND: RuntimeKind = 'jar-core'

export class SystemAgentProvider implements ChatRuntime {
  readonly runtimeKind = RUNTIME_KIND

  private readonly activeTurns = new Map<string, AbortController>()

  constructor(private readonly deps: SystemAgentProviderDeps) {}

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      agentProfileId: input.profile.id,
      runtimeKind: RUNTIME_KIND,
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
    const jarvisPrefs = await Preferences.getJarvisPreferences()
    const config = parseConfigWith(input.profile.configJson, SystemAgentConfigSchema)
    const baseConfig = parseConfigWith(input.profile.configJson, BaseProviderConfig)

    const provider = config.provider ?? 'openai'
    const model = config.model ?? jarvisPrefs.model ?? baseConfig.model ?? input.modelId
    const baseUrl = config.baseUrl ?? baseConfig.baseUrl
    if (!model) {
      throw new Error('No model configured for Jarvis. Set a model in Settings → Jarvis.')
    }

    const secretRef = input.profile.credentialRef ?? null
    const apiKey = secretRef
      ? this.deps.readSecret(secretRef)
      : (config.apiKey ?? baseConfig.apiKey ?? null)

    const thinkingLevel = jarvisPrefs.thinkingLevel ?? config.thinkingLevel ?? 'medium'
    const systemPrompt = input.systemPrompt ?? 'You are Jarvis, a helpful system assistant.'
    const sessionId = input.runtimeSession.chatSessionId

    const serverCfg = getServerConfig()
    const sessionsRootDir = serverCfg.dataDir
      ? path.join(serverCfg.dataDir, 'jar-sessions')
      : path.join(process.cwd(), 'data', 'jar-sessions')

    const jarConfig: LoadedRuntimeConfig = {
      configFilePath: '',
      logging: { level: 'error', stderr: false },
      agent: {
        provider: provider as unknown as LoadedRuntimeConfig['agent']['provider'],
        model,
        systemPrompt,
        thinkingLevel: thinkingLevel as unknown as LoadedRuntimeConfig['agent']['thinkingLevel'],
        providerConfig: { apiKey: apiKey ?? undefined, baseUrl },
        execution: {
          requestTimeoutMs: 60_000,
          retryAttempts: 2,
          retryInitialDelayMs: 1_000,
          retryBackoffMultiplier: 2,
          retryMaxDelayMs: 10_000,
        },
        compaction: {
          enabled: true,
          triggerRatio: 0.9,
          budgetRatio: 0.9,
          summaryMaxTokens: 1024,
        },
      },
      skills: {
        enabled: false,
        roots: [],
        maxScanDepth: 0,
        maxSkills: 0,
        maxCatalogChars: 0,
        maxBodyChars: 0,
        entries: [],
        catalog: null,
        errors: [],
        truncatedByLimit: false,
      },
      toolOptions: {
        provider: provider as unknown as LoadedRuntimeConfig['toolOptions']['provider'],
        model,
        providerBaseUrl: baseUrl,
        providerApiKey: apiKey ?? undefined,
        workspaceRoot: input.workspacePath ?? process.cwd(),
        maxFileBytes: 5 * 1024 * 1024,
        commandTimeoutMs: 30_000,
        maxCommandOutputBytes: 1024 * 1024,
        webRequestTimeoutMs: 30_000,
        maxWebResponseBytes: 5 * 1024 * 1024,
      },
      sessions: { rootDir: sessionsRootDir },
      memory: { enabled: false, provider: '', providers: {} },
      plugins: [],
      entities: {},
      platformIdentities: {},
      platform: {},
    }

    const abortController = new AbortController()
    this.activeTurns.set(sessionId, abortController)

    const chunks: UIMessageChunk[] = []
    let done = false
    let streamError: Error | null = null
    let resolveNext: (() => void) | null = null
    const textItemId = randomUUID()
    let assistantStarted = false

    const command: MessageIngressCommand = {
      kind: 'message',
      source: { platform: 'cli' },
      routing: {
        platform: 'cli',
        scope: { kind: 'local_thread', threadId: sessionId },
      },
      message: { text: input.message },
      prompt: input.message,
      audit: { trigger: 'user_input' },
      execution: {
        onEvent: (event) => {
          if (abortController.signal.aborted) {
            return
          }

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
        },
      },
    }

    executeIngressCommand({ config: jarConfig, command }).catch((err) => {
      streamError = err instanceof Error ? err : new Error(String(err))
      if (!done) {
        done = true
        resolveNext?.()
      }
    })

    try {
      // eslint-disable-next-line no-unmodified-loop-condition
      while (!done || chunks.length > 0) {
        if (abortController.signal.aborted) {
          break
        }
        if (chunks.length > 0) {
          yield chunks.shift()!
        }
        else if (!done) {
          await new Promise<void>((resolve) => {
            resolveNext = resolve
          })
          resolveNext = null
        }
      }
    }
    finally {
      this.activeTurns.delete(sessionId)
    }

    if (streamError) {
      throw streamError
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
  if (!raw) {
    return {}
  }
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
      out.push({ type: 'text-delta', delta: '\n\n[Error occurred]' } as UIMessageChunk)
      break
  }

  return out
}
