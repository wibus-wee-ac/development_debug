import { randomUUID } from 'node:crypto'
import path from 'node:path'

import type { DefaultRuntimeConfigOptions, MessageIngressCommand, MessageIngressResult } from '@hijarvis/core'
import { defaultRuntimeConfig, executeIngressCommand } from '@hijarvis/core'
import type { UIMessageChunk } from 'ai'

import { getServerConfig } from '../../../infra'
import * as ModelRegistry from '../../model-registry/service'
import * as Preferences from '../../preferences/service'
import { lookupModelRaw, lookupModelRawExact } from '../../model-registry/model-info-registry'
import {
  readTrustedSystemAgentConfig,
} from '../../provider-contracts/provider-base'
import type { RuntimeKind } from '../../provider-contracts/types'
import type {
  CancelTurnInput,
  ChatRuntime,
  ResumeChatSessionInput,
  RuntimeSession,
  StartChatSessionInput,
  StreamTurnInput,
  TokenUsage,
} from '../../chat-runtime/runtime-provider-types'
import { projectTextOnlyInput } from '../../chat-runtime/ui-message-input'
import { readProviderStateSnapshot } from '../provider-state-snapshot'

interface SystemAgentProviderDeps {
  readSecret: (credentialRef: string) => string
  resolveSkillPaths: (workspacePath: string) => string[]
}

const RUNTIME_KIND: RuntimeKind = 'jar-core'
type JarvisThinkingLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

const EXTENDED_REASONING_MODEL_RE = /(?:^|[\s/:_-])(?:gpt-5(?:\.\d+)?|o1|o3|o4|claude-(?:opus|sonnet)-4|gemini-2\.5-pro|grok-4|deepseek-r1)(?:$|[\s:._-])/

/** Map Cradle's providerKind to jar-core's provider identifier */
function inferProviderFromKind(providerKind: string): string {
  switch (providerKind) {
    case 'anthropic': return 'anthropic'
    case 'openai-compatible': return 'openai'
    default: return 'openai'
  }
}

/** Infer jar-core API protocol from Cradle's providerKind */
function inferApiFromKind(providerKind: string): string {
  switch (providerKind) {
    case 'anthropic': return 'anthropic-messages'
    case 'openai-compatible': return 'openai-completions'
    default: return 'openai-completions'
  }
}

function supportsExtendedThinking(modelId: string, family?: string): boolean {
  return EXTENDED_REASONING_MODEL_RE.test(`${modelId} ${family ?? ''}`.toLowerCase())
}

function selectRuntimeThinkingLevel(
  modelId: string,
  requested: JarvisThinkingLevel,
  registryModel: Awaited<ReturnType<typeof lookupModelRaw>>,
): JarvisThinkingLevel | undefined {
  if (registryModel?.reasoning !== true) {
    return undefined
  }
  if (requested === 'minimal') {
    return supportsExtendedThinking(modelId, registryModel.family) ? 'minimal' : 'low'
  }
  if (requested === 'xhigh') {
    return supportsExtendedThinking(modelId, registryModel.family) ? 'xhigh' : 'high'
  }
  return requested
}

async function resolveMappedRegistryModel(modelId: string): Promise<Awaited<ReturnType<typeof lookupModelRaw>> | null> {
  const mapping = ModelRegistry.getMapping(modelId)
  if (!mapping) {
    return null
  }
  if (mapping.model) {
    return mapping.model
  }
  if (!mapping.registryModelId) {
    return null
  }
  return lookupModelRawExact(mapping.registryModelId)
}

export class SystemAgentProvider implements ChatRuntime {
  readonly runtimeKind = RUNTIME_KIND

  private readonly activeTurns = new Map<string, AbortController>()
  private _lastUsage: TokenUsage | null = null
  private _lastModelId: string | null = null

  get lastUsage(): TokenUsage | null {
    return this._lastUsage
  }

  get lastModelId(): string | null {
    return this._lastModelId
  }

  constructor(private readonly deps: SystemAgentProviderDeps) {}

  private releaseTurn(sessionId: string, abortController: AbortController): void {
    if (this.activeTurns.get(sessionId) === abortController) {
      this.activeTurns.delete(sessionId)
    }
  }

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    const jarvisPrefs = await Preferences.getJarvisPreferences()
    const currentModelId = input.modelId ?? jarvisPrefs.model
    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      providerTargetId: input.profile.providerTargetId,
      runtimeKind: RUNTIME_KIND,
      providerSessionId: null,
      providerStateSnapshot: JSON.stringify({
        models: { currentModelId },
      }),
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    const jarvisPrefs = await Preferences.getJarvisPreferences()
    const currentModelId = input.modelId ?? jarvisPrefs.model
    if (!currentModelId) {
      return input.runtimeSession
    }
    const snapshot = readProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    return {
      ...input.runtimeSession,
      providerStateSnapshot: JSON.stringify({
        ...snapshot,
        models: { currentModelId },
      }),
    }
  }

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    const jarvisPrefs = await Preferences.getJarvisPreferences()
    const config = readTrustedSystemAgentConfig(input.profile.configJson)
    const userPrompt = projectTextOnlyInput(input.message, 'Jarvis provider')

    const provider = config.provider ?? inferProviderFromKind(input.profile.providerKind)
    const model = jarvisPrefs.model
    const { baseUrl } = config
    if (!model) {
      throw new Error('No model configured for Jarvis. Set a model in Settings → Jarvis.')
    }

    const secretRef = input.profile.credentialRef
    const apiKey = secretRef
      ? this.deps.readSecret(secretRef)
      : config.apiKey

    const registryModel = await lookupModelRaw(model)
    const mappedRegistryModel = await resolveMappedRegistryModel(model)
    const runtimeRegistryModel = mappedRegistryModel ?? registryModel
    const thinkingLevel = selectRuntimeThinkingLevel(
      model,
      (jarvisPrefs.thinkingLevel ?? config.thinkingLevel) as JarvisThinkingLevel,
      runtimeRegistryModel,
    )
    const systemPrompt = input.systemPrompt ?? 'You are Jarvis, a helpful system assistant.'
    const sessionId = input.runtimeSession.chatSessionId

    const serverCfg = getServerConfig()
    const dataDir = serverCfg.dataDir ?? path.join(process.cwd(), 'data')
    const sessionsRootDir = path.join(dataDir, 'jar-sessions')
    // Jarvis operates from its own workspace within the data dir (independent of user workspaces)
    const jarvisWorkspaceRoot = path.join(dataDir, 'jarvis-workspace')

    const runtimeConfigOptions: DefaultRuntimeConfigOptions = {
      provider,
      model,
      systemPrompt,
      sessionsRootDir,
      workspaceRoot: jarvisWorkspaceRoot,
    }
    if (thinkingLevel) {
      runtimeConfigOptions.thinkingLevel = thinkingLevel as DefaultRuntimeConfigOptions['thinkingLevel']
    }
    if (apiKey) {
      runtimeConfigOptions.apiKey = apiKey
    }
    if (baseUrl) {
      runtimeConfigOptions.baseUrl = baseUrl
    }
    if (config.api) {
      runtimeConfigOptions.api = config.api as DefaultRuntimeConfigOptions['api']
    }
    else {
      // Always provide api protocol — jar-core requires it for non-builtin models
      runtimeConfigOptions.api = inferApiFromKind(input.profile.providerKind) as DefaultRuntimeConfigOptions['api']
    }

    // Build per-model metadata from models.dev registry for non-builtin providers
    if (runtimeRegistryModel) {
      const modelConfig: NonNullable<DefaultRuntimeConfigOptions['models']>[string] = {}
      if (runtimeRegistryModel.limit?.context != null) {
        modelConfig.contextWindow = runtimeRegistryModel.limit.context
      }
      if (runtimeRegistryModel.limit?.output != null) {
        modelConfig.maxTokens = runtimeRegistryModel.limit.output
      }
      if (runtimeRegistryModel.reasoning != null) {
        modelConfig.reasoning = runtimeRegistryModel.reasoning
      }
      if (runtimeRegistryModel.tool_call != null) {
        modelConfig.toolCall = runtimeRegistryModel.tool_call
      }
      if (runtimeRegistryModel.modalities?.input) {
        modelConfig.input = runtimeRegistryModel.modalities.input.filter(
          (m): m is 'text' | 'image' => m === 'text' || m === 'image',
        )
      }
      if (runtimeRegistryModel.cost) {
        const cost: NonNullable<typeof modelConfig.cost> = {}
        if (runtimeRegistryModel.cost.input != null) {
          cost.input = runtimeRegistryModel.cost.input
        }
        if (runtimeRegistryModel.cost.output != null) {
          cost.output = runtimeRegistryModel.cost.output
        }
        if (runtimeRegistryModel.cost.cache_read != null) {
          cost.cacheRead = runtimeRegistryModel.cost.cache_read
        }
        if (runtimeRegistryModel.cost.cache_write != null) {
          cost.cacheWrite = runtimeRegistryModel.cost.cache_write
        }
        if (Object.keys(cost).length > 0) {
          modelConfig.cost = cost
        }
      }
      if (config.headers) {
        modelConfig.headers = config.headers
      }
      if (config.compat) {
        modelConfig.compat = config.compat
      }
      if (Object.keys(modelConfig).length > 0) {
        runtimeConfigOptions.models = { [model]: modelConfig }
      }
    }
    else if (config.headers || config.compat) {
      // Even without registry data, pass headers/compat if configured
      const modelConfig: NonNullable<DefaultRuntimeConfigOptions['models']>[string] = {}
      if (config.headers) {
        modelConfig.headers = config.headers
      }
      if (config.compat) {
        modelConfig.compat = config.compat
      }
      runtimeConfigOptions.models = { [model]: modelConfig }
    }

    // Inject Cradle context so bash subprocesses spawned by skills can call
    // Cradle APIs with the correct identity and workspace.
    runtimeConfigOptions.extraShellEnv = {
      CRADLE_CHAT_SESSION_ID: sessionId,
      ...(input.workspaceId ? { CRADLE_WORKSPACE_ID: input.workspaceId } : {}),
    }

    const jarConfig = await defaultRuntimeConfig(runtimeConfigOptions)

    const abortController = new AbortController()
    this.activeTurns.set(sessionId, abortController)
    this._lastUsage = null
    this._lastModelId = model

    const chunks: UIMessageChunk[] = []
    let done = false
    let streamError: Error | null = null
    let resolveNext: (() => void) | null = null
    const bridgeState: BridgeState = {
      currentTextId: null,
      currentReasoningId: null,
      assistantStarted: false,
    }

    const command: MessageIngressCommand = {
      kind: 'message',
      source: { platform: 'cli' },
      routing: {
        platform: 'cli',
        scope: { kind: 'local_thread', threadId: sessionId },
      },
      message: { text: userPrompt },
      prompt: userPrompt,
      audit: { trigger: 'user_input' },
      execution: {
        onEvent: (event) => {
          if (abortController.signal.aborted) {
            return
          }

          if (event.type === 'message_update') {
            const ame = event.assistantMessageEvent
            const newChunks = bridgeEvent(ame, bridgeState)
            if (newChunks.length > 0) {
              chunks.push(...newChunks)
              resolveNext?.()
            }
          }
 else if (event.type === 'agent_end') {
            if (bridgeState.currentTextId) {
              chunks.push({ type: 'text-end', id: bridgeState.currentTextId })
              bridgeState.currentTextId = null
            }
            if (bridgeState.currentReasoningId) {
              chunks.push({ type: 'reasoning-end', id: bridgeState.currentReasoningId })
              bridgeState.currentReasoningId = null
            }
            done = true
            resolveNext?.()
          }
        },
      },
    }

    // Resolve skill roots — use jarvis workspace root (always has a valid path)
    const skillRoots = this.deps.resolveSkillPaths(jarvisWorkspaceRoot)

    const commandPromise = executeIngressCommand({ config: jarConfig, command, pluginOverrides: { skillRoots } }).then((result) => {
      if (result.kind === 'message') {
        this.captureResultUsage(result, model)
      }
      return result
    }).catch((err) => {
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
      this.releaseTurn(sessionId, abortController)
    }

    if (!abortController.signal.aborted) {
      await commandPromise
    }

    if (streamError) {
      throw streamError
    }
  }

  async cancelTurn(input: CancelTurnInput): Promise<void> {
    const sessionId = input.runtimeSession.chatSessionId
    const controller = this.activeTurns.get(sessionId)
    if (controller) {
      controller.abort()
      this.releaseTurn(sessionId, controller)
    }
  }

  private captureResultUsage(result: MessageIngressResult, fallbackModelId: string): void {
    this._lastModelId = result.model ?? fallbackModelId
    if (!result.usage) {
      this._lastUsage = null
      return
    }
    this._lastUsage = {
      promptTokens: result.usage.inputTokens,
      completionTokens: result.usage.outputTokens,
      totalTokens: result.usage.totalTokens,
    }
  }
}

// ── helpers ──

type AssistantMessageEvent = {
  type: string
  delta?: string
  contentIndex?: number
  [key: string]: unknown
}

interface BridgeState {
  currentTextId: string | null
  currentReasoningId: string | null
  assistantStarted: boolean
}

function bridgeEvent(
  ame: AssistantMessageEvent,
  state: BridgeState,
): UIMessageChunk[] {
  const out: UIMessageChunk[] = []

  function closeTextBlock(): void {
    if (state.currentTextId) {
      out.push({ type: 'text-end', id: state.currentTextId })
      state.currentTextId = null
    }
  }

  function closeReasoningBlock(): void {
    if (state.currentReasoningId) {
      out.push({ type: 'reasoning-end', id: state.currentReasoningId })
      state.currentReasoningId = null
    }
  }

  function openTextBlock(delta?: string): void {
    closeReasoningBlock()
    const id = randomUUID()
    state.currentTextId = id
    out.push({ type: 'text-start', id } as UIMessageChunk)
    if (delta) {
      out.push({ type: 'text-delta', id, delta } as UIMessageChunk)
    }
    state.assistantStarted = true
  }

  function openReasoningBlock(delta?: string): void {
    closeTextBlock()
    const id = randomUUID()
    state.currentReasoningId = id
    out.push({ type: 'reasoning-start', id } as UIMessageChunk)
    if (delta) {
      out.push({ type: 'reasoning-delta', id, delta } as UIMessageChunk)
    }
  }

  switch (ame.type) {
    case 'text_start':
      openTextBlock()
      break
    case 'text_delta':
      if (!state.currentTextId) {
        openTextBlock(ame.delta)
      }
      else if (ame.delta) {
        out.push({ type: 'text-delta', id: state.currentTextId, delta: ame.delta } as UIMessageChunk)
      }
      break
    case 'thinking_start':
      openReasoningBlock()
      break
    case 'thinking_delta':
      if (!state.currentReasoningId) {
        openReasoningBlock(ame.delta)
      }
      else if (ame.delta) {
        out.push({ type: 'reasoning-delta', id: state.currentReasoningId, delta: ame.delta } as UIMessageChunk)
      }
      break
    case 'thinking_end':
      closeReasoningBlock()
      break
    case 'error':
      if (!state.currentTextId) {
        openTextBlock()
      }
      out.push({ type: 'text-delta', id: state.currentTextId!, delta: '\n\n[Error occurred]' } as UIMessageChunk)
      break
  }

  return out
}
