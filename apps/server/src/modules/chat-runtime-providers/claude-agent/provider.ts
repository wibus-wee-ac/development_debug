import type { Query } from '@anthropic-ai/claude-agent-sdk'
import { getSessionInfo, query, renameSession } from '@anthropic-ai/claude-agent-sdk'
import type { LangfuseGeneration } from '@langfuse/tracing'
import { startObservation } from '@langfuse/tracing'
import type { UIMessageChunk } from 'ai'

import { aiTelemetryEnabled } from '../../../telemetry/config'
import type {
  CancelTurnInput,
  ChatRuntime,
  GenerateSessionTitleInput,
  GetCapabilitiesInput,
  GetContextUsageInput,
  GetUiSlotStatesInput,
  ProviderContext,
  QuickQuestionInput,
  ResumeChatSessionInput,
  RuntimeCompactUiSlotState,
  RuntimeContextUsage,
  RuntimePresentationCapabilities,
  RuntimeSession,
  RuntimeUiSlotState,
  StartChatSessionInput,
  SteerTurnInput,
  StreamTurnInput,
  UpdateRuntimeSettingsInput,
} from '../../chat-runtime/runtime-provider-types'
import { ProviderErrors, ProviderRuntimeError } from '../../chat-runtime/runtime-provider-types'
import { isChatStreamTraceEnabled, recordChatStreamTrace } from '../../chat-runtime/stream-trace'
import type { TokenUsage } from '../../chat-runtime-engine/ai-sdk-engine'
import { readTrustedClaudeAgentConfig } from '../../provider-contracts/provider-base'
import { createBoundedTextCollector } from '../bounded-text-collector'
import { readWorkspaceProviderStateSnapshot } from '../provider-state-snapshot'
import { ClaudeAgentInputStream, emptyClaudeAgentInput } from './async-input-stream'
import { projectClaudeAgentCompactState, projectClaudeAgentContextUsage } from './context-usage-projector'
import { createClaudeAgentChunkMapperState, mapClaudeAgentMessageToChunks } from './event-to-chunk-mapper'
import {
  buildClaudeAgentTurnContent,
  buildClaudeQueryOptions,
  CLAUDE_AGENT_SDK_PERSIST_SESSION,
  describeClaudeAgentUserContent,
  projectClaudeAgentInput,
  projectRuntimeSettingsToClaudePermissionMode,
  readClaudeAgentModelId,
} from './input-projector'
import {
  CLAUDE_AGENT_RUNTIME_CAPABILITIES,
  CLAUDE_AGENT_RUNTIME_KIND,
  CLAUDE_AGENT_RUNTIME_METADATA,
  projectClaudeAgentPresentation,
} from './metadata'
import { generateClaudeSessionTitle, shouldGenerateClaudeSessionTitle } from './provider-title-generation'
import { activateClaudeAgentSdkConfigDir, resolveClaudeAgentRuntimeContext } from './runtime-context'
import {
  clearClaudeAgentCapturedPlan,
  clearClaudeAgentPendingModelSwitch,
  projectClaudeAgentPlanUiSlotState,
  readClaudeAgentPendingModelSwitchId,
  resolveClaudeAgentPendingModelSwitchId,
  writeClaudeAgentCapturedPlan,
  writeClaudeAgentPendingModelSwitch,
} from './state-projector'
import type { ClaudeAgentProviderDeps, ClaudeAgentSessionInfo, ClaudeTitleGenerationThinkingEffort } from './types'

type ActiveClaudeQuery = {
  query: Query
  abortController: AbortController
  inputStream: ClaudeAgentInputStream
}

type ContextUsageRuntimeInput = Pick<GetContextUsageInput, 'runtimeSession'>

const COMPACT_SLOT_CONTEXT_USAGE_TTL_MS = 15_000

export function createClaudeAgentProvider(ctx: ProviderContext): ChatRuntime {
  return new ClaudeAgentProvider(ctx)
}

export class ClaudeAgentProvider implements ChatRuntime {
  readonly runtimeKind = CLAUDE_AGENT_RUNTIME_KIND
  readonly metadata = CLAUDE_AGENT_RUNTIME_METADATA
  readonly capabilities = CLAUDE_AGENT_RUNTIME_CAPABILITIES

  private readonly activeQueries = new Map<string, ActiveClaudeQuery>()
  private readonly compactStates = new Map<string, RuntimeCompactUiSlotState>()
  private readonly lastContextUsageBySession = new Map<string, RuntimeContextUsage>()
  private readonly lastContextUsageSampledAtBySession = new Map<string, number>()
  private _lastUsage: TokenUsage | null = null
  private _totalUsage: TokenUsage | null = null

  get lastUsage(): TokenUsage | null {
    return this._lastUsage
  }

  get totalUsage(): TokenUsage | null {
    return this._totalUsage
  }

  constructor(private readonly deps: ClaudeAgentProviderDeps) {}

  private releaseQuery(sessionId: string, entry: ActiveClaudeQuery): void {
    if (this.activeQueries.get(sessionId) === entry) {
      this.activeQueries.delete(sessionId)
    }
  }

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    const runtimeContext = resolveClaudeAgentRuntimeContext(input.workspacePath, input.agentId)
    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      providerTargetId: input.profile.providerTargetId,
      runtimeKind: CLAUDE_AGENT_RUNTIME_KIND,
      providerSessionId: null,
      providerStateSnapshot: JSON.stringify({
        workspacePath: input.workspacePath,
        agentId: input.agentId ?? null,
        agentHome: runtimeContext.agentHome,
        models: { currentModelId: input.modelId },
      }),
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const agentId = input.agentId ?? snapshot.agentId ?? null
    const runtimeContext = resolveClaudeAgentRuntimeContext(input.workspacePath, agentId)
    const pendingModelSwitchId = CLAUDE_AGENT_SDK_PERSIST_SESSION
      ? resolveClaudeAgentPendingModelSwitchId(snapshot, input.modelId ?? null)
      : null
    const nextSnapshot = writeClaudeAgentPendingModelSwitch({
      ...snapshot,
      workspacePath: input.workspacePath,
      agentId,
      agentHome: runtimeContext.agentHome,
      models: {
        ...snapshot.models,
        currentModelId: input.modelId ?? snapshot.models.currentModelId,
      },
    }, pendingModelSwitchId)
    return {
      ...input.runtimeSession,
      providerStateSnapshot: JSON.stringify(nextSnapshot),
    }
  }

  async getPresentation(input: GetCapabilitiesInput): Promise<RuntimePresentationCapabilities> {
    const abortController = new AbortController()
    const queryOptions = buildClaudeQueryOptions({
      deps: this.deps,
      input,
      abortController,
      attachPermissionHandler: false,
      persistSession: false,
    })
    const activeQuery = query({ prompt: emptyClaudeAgentInput(), options: queryOptions })

    try {
      const slashCommands = await activeQuery.supportedCommands()

      return projectClaudeAgentPresentation(slashCommands)
    }
    finally {
      activeQuery.close()
    }
  }

  async getUiSlotStates(input: GetUiSlotStatesInput): Promise<RuntimeUiSlotState[]> {
    const planState = projectClaudeAgentPlanUiSlotState(input.runtimeSession)
    const compactState = await this.readCompactState(input)
    const states: RuntimeUiSlotState[] = []
    if (planState) {
      states.push(planState)
    }
    if (compactState) {
      states.push(compactState)
    }
    return states
  }

  async* quickQuestion(input: QuickQuestionInput): AsyncGenerator<UIMessageChunk, void, void> {
    const abortController = new AbortController()
    const config = readTrustedClaudeAgentConfig(input.profile.configJson)
    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const effectiveModel = snapshot.models.currentModelId ?? config.model

    // Build query options with tools disabled
    const queryOptions = buildClaudeQueryOptions({
      deps: this.deps,
      input: {
        runtimeSession: input.runtimeSession,
        profile: input.profile,
        workspacePath: input.workspacePath,
        workspaceId: input.workspaceId,
        modelId: effectiveModel,
      } as GetCapabilitiesInput,
      abortController,
      attachPermissionHandler: false,
      persistSession: false,
    })

    // Quick questions are a no-tools, no-persistence side path. Keep the
    // transcript in prompt context, but do not initialize provider tools,
    // MCP servers, or SDK skill discovery for this ephemeral query.
    queryOptions.tools = []
    delete queryOptions.mcpServers
    delete queryOptions.skills

    const inputStream = new ClaudeAgentInputStream()
    const activeQuery = query({ prompt: inputStream, options: queryOptions })
    const mapperState = createClaudeAgentChunkMapperState()

    try {
      // Build user content with full transcript for prompt cache reuse
      const userContent = buildClaudeAgentTurnContent({
        userContent: projectClaudeAgentInput(input.question, 'QuickQuestion'),
        history: input.transcript,
      })

      inputStream.push(userContent)

      // Stream response chunks
      for await (const message of activeQuery) {
        if (abortController.signal.aborted) {
          break
        }

        const result = await mapClaudeAgentMessageToChunks(message, mapperState)
        for (const chunk of result.chunks) {
          yield chunk
        }

        // Check if finished
        if (message.type === 'result') {
          break
        }
      }
    }
    finally {
      abortController.abort()
      activeQuery.close()
    }
  }

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    const abortController = new AbortController()
    const resumedProviderSessionId = CLAUDE_AGENT_SDK_PERSIST_SESSION
      ? input.runtimeSession.providerSessionId
      : null
    const shouldResumeProviderSession = Boolean(resumedProviderSessionId)
    const projectedUserContent = projectClaudeAgentInput(input.message, 'Claude Agent provider')
    const userContent = buildClaudeAgentTurnContent({
      userContent: projectedUserContent,
      history: input.history,
      historyScope: shouldResumeProviderSession ? 'recentCradleLocal' : 'full',
    })
    const userPromptText = describeClaudeAgentUserContent(userContent)
    const config = readTrustedClaudeAgentConfig(input.profile.configJson)
    const effectiveModel = readClaudeAgentModelId(input, config)
    const pendingModelSwitchId = readClaudeAgentPendingModelSwitchId(
      readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot),
    )
    const queryOptions = buildClaudeQueryOptions({
      deps: this.deps,
      input,
      abortController,
      attachPermissionHandler: true,
    })

    const inputStream = new ClaudeAgentInputStream()
    const activeQuery = query({ prompt: inputStream, options: queryOptions })
    const sessionId = input.runtimeSession.chatSessionId
    const activeEntry: ActiveClaudeQuery = { query: activeQuery, abortController, inputStream }
    this.activeQueries.set(sessionId, activeEntry)
    this._lastUsage = null
    this._totalUsage = null
    const traceMessageId = input.responseMessageId ?? input.message.id

    const mapperState = createClaudeAgentChunkMapperState()
    clearClaudeAgentCapturedPlan(input.runtimeSession)

    // Langfuse tracing via @langfuse/tracing SDK
    let generation: LangfuseGeneration | null = null
    if (aiTelemetryEnabled()) {
      generation = startObservation('claude-agent-generation', {
        model: effectiveModel,
        input: input.systemPrompt
          ? [{ role: 'system', content: input.systemPrompt }, { role: 'user', content: userPromptText }]
          : [{ role: 'user', content: userPromptText }],
      }, { asType: 'generation' }) as LangfuseGeneration
      // Set trace-level attributes for session grouping
      const span = generation.otelSpan
      span.setAttribute('langfuse.session.id', input.runtimeSession.chatSessionId)
      span.setAttribute('langfuse.trace.name', 'claude-agent-chat')
    }
    const outputTextCollector = createBoundedTextCollector()
    let generationEnded = false
    const endGeneration = (error?: unknown) => {
      if (!generation || generationEnded) {
        return
      }
      if (error !== undefined) {
        generation.update({
          level: 'ERROR',
          statusMessage: error instanceof Error ? error.message : String(error),
        })
      }
      else {
        generation.update({
          output: outputTextCollector.read(),
          ...(this._lastUsage && {
            usageDetails: {
              input: this._lastUsage.promptTokens,
              output: this._lastUsage.completionTokens,
              total: this._lastUsage.totalTokens,
            },
          }),
        })
      }
      generation.end()
      generationEnded = true
    }

    const shouldGenerateTitle = shouldGenerateClaudeSessionTitle({
      providerSessionId: resumedProviderSessionId,
      promptText: userPromptText,
    })

    try {
      if (shouldResumeProviderSession && pendingModelSwitchId) {
        await activeQuery.setModel(pendingModelSwitchId)
        clearClaudeAgentPendingModelSwitch(input.runtimeSession)
      }
      if (resumedProviderSessionId) {
        await this.reportClaudeSessionTitle({
          sessionId: resumedProviderSessionId,
          runtimeSession: input.runtimeSession,
          reportSessionTitle: input.reportSessionTitle,
        })
      }
      inputStream.push(userContent)

      for await (const message of activeQuery) {
        if (abortController.signal.aborted) {
          break
        }

        if (isChatStreamTraceEnabled()) {
          recordChatStreamTrace({
            chatSessionId: input.runtimeSession.chatSessionId,
            runId: input.runId,
            messageId: traceMessageId,
            runtimeKind: this.runtimeKind,
            providerSessionId: input.runtimeSession.providerSessionId,
            phase: 'provider_raw',
            payload: message,
          })
        }

        const result = await mapClaudeAgentMessageToChunks(message, mapperState)
        for (const plan of result.capturedPlans) {
          writeClaudeAgentCapturedPlan(input.runtimeSession, plan)
        }

        if (isChatStreamTraceEnabled()) {
          recordChatStreamTrace({
            chatSessionId: input.runtimeSession.chatSessionId,
            runId: input.runId,
            messageId: traceMessageId,
            runtimeKind: this.runtimeKind,
            providerSessionId: result.sessionId ?? input.runtimeSession.providerSessionId,
            phase: 'mapper_output',
            payload: {
              messageType: message.type,
              chunks: result.chunks,
              sessionId: result.sessionId ?? null,
              usage: result.usage ?? null,
              assistantStarted: mapperState.assistantStarted,
            },
          })
        }

        const nextProviderSessionId = result.sessionId && result.sessionId !== input.runtimeSession.providerSessionId
          ? result.sessionId
          : null
        if (nextProviderSessionId) {
          input.runtimeSession.providerSessionId = nextProviderSessionId
        }

        if (result.usage) {
          this._lastUsage = result.usage
          // Accumulate usage across all streaming messages
          if (this._totalUsage) {
            this._totalUsage = {
              promptTokens: this._totalUsage.promptTokens + result.usage.promptTokens,
              completionTokens: this._totalUsage.completionTokens + result.usage.completionTokens,
              totalTokens: this._totalUsage.totalTokens + result.usage.totalTokens,
            }
          }
          else {
            this._totalUsage = { ...result.usage }
          }
        }

        for (const chunk of result.chunks) {
          // Collect text output for Langfuse
          if (generation && chunk.type === 'text-delta' && 'delta' in chunk) {
            outputTextCollector.append((chunk as { delta: string }).delta)
          }
          yield chunk
        }

        if (nextProviderSessionId) {
          await this.reportClaudeSessionTitle({
            sessionId: nextProviderSessionId,
            runtimeSession: input.runtimeSession,
            reportSessionTitle: input.reportSessionTitle,
          })

          if (shouldGenerateTitle) {
            const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
            const titleGeneration = this.resolveClaudeSessionTitleGenerationConfig({
              currentProfile: input.profile,
              fallbackModel: effectiveModel ?? null,
            })
            this.generateClaudeSessionTitleInBackground({
              profile: titleGeneration.profile,
              mainSessionId: nextProviderSessionId,
              promptText: userPromptText,
              modelId: titleGeneration.modelId,
              fallbackModel: titleGeneration.fallbackModel,
              thinkingEffort: titleGeneration.thinkingEffort,
              workspacePath: input.workspacePath ?? snapshot.workspacePath ?? '',
              agentId: input.agentId ?? snapshot.agentId ?? null,
              reportSessionTitle: input.reportSessionTitle,
            })
          }
        }

        if (message.type === 'result') {
          await this.refreshCompactState(input).catch(() => undefined)
          inputStream.close()
        }
      }

      if (mapperState.assistantStarted) {
        yield { type: 'text-end', id: mapperState.textItemId }
      }

      endGeneration()
    }
    catch (error) {
      endGeneration(error)
      throw error
    }
    finally {
      inputStream.close()
      activeQuery.close()
      endGeneration()
      this.releaseQuery(sessionId, activeEntry)
    }
  }

  async steerTurn(input: SteerTurnInput): Promise<void> {
    const sessionId = input.runtimeSession.chatSessionId
    const entry = this.activeQueries.get(sessionId)
    if (!entry) {
      throw new ProviderRuntimeError(ProviderErrors.sessionNotFound(this.runtimeKind, sessionId))
    }

    const userContent = projectClaudeAgentInput(input.message, 'Claude Agent steer')
    await entry.query.interrupt()
    entry.inputStream.push(userContent)
  }

  async getContextUsage(input: GetContextUsageInput): Promise<RuntimeContextUsage | null> {
    return await this.readContextUsage(input)
  }

  async cancelTurn(input: CancelTurnInput): Promise<void> {
    const sessionId = input.runtimeSession.chatSessionId
    const entry = this.activeQueries.get(sessionId)
    if (!entry) {
      return
    }
    entry.abortController.abort()
    entry.query.close()
    entry.inputStream.close()
    this.releaseQuery(sessionId, entry)
  }

  private async readCompactState(input: GetUiSlotStatesInput): Promise<RuntimeCompactUiSlotState | null> {
    const sessionId = input.runtimeSession.chatSessionId
    const cached = this.readFreshCompactState(sessionId)
    if (cached) {
      return cached
    }

    try {
      return await this.refreshCompactState(input)
        ?? this.compactStates.get(sessionId)
        ?? null
    }
    catch {
      return this.compactStates.get(sessionId) ?? null
    }
  }

  private async readContextUsage(input: ContextUsageRuntimeInput): Promise<RuntimeContextUsage | null> {
    const sessionId = input.runtimeSession.chatSessionId
    const entry = this.activeQueries.get(sessionId)
    if (!entry) {
      return this.lastContextUsageBySession.get(sessionId) ?? null
    }

    const updatedAt = Math.floor(Date.now() / 1000)
    const response = await entry.query.getContextUsage()
    const usage = projectClaudeAgentContextUsage({
      providerSessionId: input.runtimeSession.providerSessionId,
      response,
      updatedAt,
    })
    this.lastContextUsageBySession.set(sessionId, usage)
    this.lastContextUsageSampledAtBySession.set(sessionId, Date.now())
    this.compactStates.set(sessionId, this.projectCompactState(input.runtimeSession, usage))
    return usage
  }

  private readFreshCompactState(sessionId: string): RuntimeCompactUiSlotState | null {
    const compactState = this.compactStates.get(sessionId)
    const sampledAt = this.lastContextUsageSampledAtBySession.get(sessionId)
    if (!compactState || !sampledAt) {
      return null
    }
    return Date.now() - sampledAt <= COMPACT_SLOT_CONTEXT_USAGE_TTL_MS ? compactState : null
  }

  private async refreshCompactState(input: ContextUsageRuntimeInput): Promise<RuntimeCompactUiSlotState | null> {
    const usage = await this.readContextUsage(input)
    if (!usage) {
      return null
    }
    const compactState = this.projectCompactState(input.runtimeSession, usage)
    this.compactStates.set(input.runtimeSession.chatSessionId, compactState)
    return compactState
  }

  private projectCompactState(
    runtimeSession: ContextUsageRuntimeInput['runtimeSession'],
    usage: RuntimeContextUsage,
  ): RuntimeCompactUiSlotState {
    return projectClaudeAgentCompactState({
      threadId: runtimeSession.chatSessionId,
      turnId: null,
      usage,
      updatedAt: usage.updatedAt,
    })
  }

  private async updateActiveQueryPermissionMode(
    input: Pick<UpdateRuntimeSettingsInput, 'runtimeSession'> & { mode: 'bypassPermissions' | 'plan' },
  ): Promise<void> {
    const sessionId = input.runtimeSession.chatSessionId
    const entry = this.activeQueries.get(sessionId)
    if (!entry) {
      return
    }
    entry.query.setPermissionMode(input.mode)
  }

  async updateRuntimeSettings(input: UpdateRuntimeSettingsInput): Promise<void> {
    const mode = projectRuntimeSettingsToClaudePermissionMode(input.settings) ?? 'bypassPermissions'
    await this.updateActiveQueryPermissionMode({
      runtimeSession: input.runtimeSession,
      mode,
    })
  }

  async generateSessionTitle(input: GenerateSessionTitleInput): Promise<string | null> {
    const config = readTrustedClaudeAgentConfig(input.profile.configJson)
    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const titleGeneration = this.resolveClaudeSessionTitleGenerationConfig({
      currentProfile: input.profile,
      fallbackModel: input.modelId ?? snapshot.models.currentModelId ?? config.model ?? null,
    })
    const abortController = new AbortController()
    try {
      const title = await generateClaudeSessionTitle({
        profile: titleGeneration.profile,
        promptText: input.promptText,
        modelId: titleGeneration.modelId ?? titleGeneration.fallbackModel,
        thinkingEffort: titleGeneration.thinkingEffort,
        workspacePath: input.workspacePath ?? snapshot.workspacePath ?? '',
        agentId: input.agentId ?? snapshot.agentId ?? null,
        deps: this.deps,
        signal: abortController.signal,
      })
      if (title && input.runtimeSession.providerSessionId) {
        await renameSession(input.runtimeSession.providerSessionId, title, {
          dir: this.resolveClaudeSessionProjectDir({
            workspacePath: input.workspacePath ?? snapshot.workspacePath ?? undefined,
            agentId: input.agentId ?? snapshot.agentId ?? null,
          }),
        }).catch(() => undefined)
      }
      return title
    }
    finally {
      abortController.abort()
    }
  }

  private async reportClaudeSessionTitle(input: {
    sessionId: string
    runtimeSession: RuntimeSession
    reportSessionTitle?: (title: string) => void
  }): Promise<void> {
    if (!input.reportSessionTitle) {
      return
    }

    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const info = await getSessionInfo(input.sessionId, {
      dir: this.resolveClaudeSessionProjectDir({
        workspacePath: snapshot.workspacePath ?? undefined,
        agentId: snapshot.agentId ?? null,
      }),
    }).catch(() => undefined)
    const title = normalizeClaudeSessionTitle(
      (info as ClaudeAgentSessionInfo | undefined)?.customTitle
      ?? (info as ClaudeAgentSessionInfo | undefined)?.summary,
    )
    if (title) {
      input.reportSessionTitle(title)
    }
  }

  private resolveClaudeSessionProjectDir(input: {
    workspacePath?: string | null
    agentId?: string | null
  }): string {
    activateClaudeAgentSdkConfigDir()
    return resolveClaudeAgentRuntimeContext(input.workspacePath ?? undefined, input.agentId ?? null).cwd
  }

  private resolveClaudeSessionTitleGenerationConfig(input: {
    currentProfile: StreamTurnInput['profile']
    fallbackModel: string | null
  }): {
    profile: StreamTurnInput['profile']
    modelId: string | null
    fallbackModel: string | null
    thinkingEffort: ClaudeTitleGenerationThinkingEffort
  } {
    const preferences = this.deps.readChatPreferences?.()
    const titlePreferences = preferences?.titleGeneration
    const thinkingEffort = titlePreferences?.thinkingEffort ?? 'minimal'
    const explicitProviderTargetId = titlePreferences?.providerTargetId ?? null
    const explicitModelId = titlePreferences?.modelId ?? null

    if (!explicitProviderTargetId) {
      return {
        profile: input.currentProfile,
        modelId: explicitModelId,
        fallbackModel: input.fallbackModel,
        thinkingEffort,
      }
    }

    const profile = this.deps.resolveProviderTargetProfile?.(explicitProviderTargetId)
    if (!profile) {
      return {
        profile: input.currentProfile,
        modelId: explicitModelId,
        fallbackModel: input.fallbackModel,
        thinkingEffort,
      }
    }

    const config = readTrustedClaudeAgentConfig(profile.configJson)
    const modelId = explicitModelId ?? config.model ?? null
    return {
      profile,
      modelId,
      fallbackModel: input.fallbackModel,
      thinkingEffort,
    }
  }

  private generateClaudeSessionTitleInBackground(input: {
    profile: StreamTurnInput['profile']
    mainSessionId: string
    promptText: string
    modelId: string | null
    fallbackModel: string | null
    thinkingEffort: ClaudeTitleGenerationThinkingEffort
    workspacePath: string
    agentId: string | null
    reportSessionTitle?: (title: string) => void
  }): void {
    setTimeout(() => {
      void (async () => {
        const abortController = new AbortController()
        try {
          const model = input.modelId ?? input.fallbackModel
          const generatedTitle = await generateClaudeSessionTitle({
            profile: input.profile,
            promptText: input.promptText,
            modelId: model,
            thinkingEffort: input.thinkingEffort,
            workspacePath: input.workspacePath,
            agentId: input.agentId,
            deps: this.deps,
            signal: abortController.signal,
          })
          if (generatedTitle) {
            await renameSession(input.mainSessionId, generatedTitle, {
              dir: this.resolveClaudeSessionProjectDir({
                workspacePath: input.workspacePath,
                agentId: input.agentId,
              }),
            })
            input.reportSessionTitle?.(generatedTitle)
          }
        }
        catch {
          // Title generation is opportunistic and must not affect the active turn.
        }
        finally {
          abortController.abort()
        }
      })()
    }, 0)
  }
}

function normalizeClaudeSessionTitle(title: string | null | undefined): string | null {
  const normalized = title?.replace(/\s+/g, ' ').trim() ?? ''
  return normalized.length > 0 ? normalized : null
}
