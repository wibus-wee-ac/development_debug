import type { AccountInfo, Query, SDKAuthStatusMessage, SDKMessage, SDKRateLimitEvent, SessionMessage } from '@anthropic-ai/claude-agent-sdk'
import { getSessionInfo, getSubagentMessages, listSubagents, query, renameSession } from '@anthropic-ai/claude-agent-sdk'
import type { LangfuseGeneration } from '@langfuse/tracing'
import { startObservation } from '@langfuse/tracing'
import type { UIMessage, UIMessageChunk } from 'ai'

import { readObjectRecord as readRecord } from '../../../helpers/json-record'
import { aiTelemetryEnabled } from '../../../telemetry/config'
import type {
  CancelTurnInput,
  ChatRuntime,
  GenerateSessionTitleInput,
  GetCapabilitiesInput,
  GetContextUsageInput,
  GetUiSlotStatesInput,
  ProviderContext,
  ProviderThread,
  ProviderThreadListInput,
  ProviderThreadListResult,
  ProviderThreadReadInput,
  ProviderThreadReadResult,
  ProviderThreadTurn,
  ProviderThreadTurnsInput,
  ProviderThreadTurnsResult,
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
import type { ClaudeAgentCapturedCrewCall, ClaudeAgentCapturedUserQuestion } from './event-to-chunk-mapper'
import { createClaudeAgentChunkMapperState, mapClaudeAgentMessageToChunks } from './event-to-chunk-mapper'
import {
  buildClaudeAgentTurnContent,
  buildClaudeQueryOptions,
  CLAUDE_AGENT_SDK_PERSIST_SESSION,
  describeClaudeAgentUserContent,
  projectClaudeAgentInput,
  projectRuntimeSettingsToClaudePermissionMode,
  readClaudeAgentModelId,
  shouldPersistClaudeAgentSdkSession,
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
  CLAUDE_AGENT_RUNTIME_DEFAULT_MODEL_SWITCH_ID,
  projectClaudeAgentCrewUiSlotState,
  projectClaudeAgentPlanUiSlotState,
  projectClaudeAgentProgressUiSlotState,
  projectClaudeAgentUsageUiSlotState,
  readClaudeAgentPendingModelSwitchId,
  resolveClaudeAgentPendingModelSwitchId,
  writeClaudeAgentAccountSnapshot,
  writeClaudeAgentAuthStatusSnapshot,
  writeClaudeAgentCapturedPlan,
  writeClaudeAgentCrewCall,
  writeClaudeAgentProgress,
  writeClaudeAgentRateLimitSnapshot,
  writeClaudeAgentPendingModelSwitch,
} from './state-projector'
import type { ClaudeAgentProviderDeps, ClaudeAgentSessionInfo, ClaudeTitleGenerationThinkingEffort } from './types'
import {
  CLAUDE_AGENT_ASK_USER_QUESTION_METHOD,
  buildClaudeAgentAskUserQuestionOutput,
  projectClaudeAgentUserInputQuestions,
} from './user-question'

type ActiveClaudeQuery = {
  query: Query
  abortController: AbortController
  inputStream: ClaudeAgentInputStream
}

type ContextUsageRuntimeInput = Pick<GetContextUsageInput, 'runtimeSession'>

const COMPACT_SLOT_CONTEXT_USAGE_TTL_MS = 15_000
const DEFAULT_PROVIDER_THREAD_LIMIT = 50
const CLAUDE_SUBAGENT_SOURCE_KIND = 'subAgent'

type ClaudeTranscriptContentBlock = {
  type: string
  text?: string
  thinking?: string
  content?: unknown
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  is_error?: boolean
}

type ClaudeTranscriptMessagePayload = {
  role?: string
  content?: string | ClaudeTranscriptContentBlock[]
  model?: string
}

type ClaudeSubagentSessionMessage = SessionMessage & {
  timestamp?: string
  subagent_type?: string
  task_description?: string
  message: ClaudeTranscriptMessagePayload | string
}

interface ClaudeSubagentThreadRecord {
  agentId: string
  parentSessionId: string
  cwd: string
  messages: ClaudeSubagentSessionMessage[]
}

function closeClaudeQuery(activeQuery: Query): void {
  const close = (activeQuery as { close?: unknown }).close
  if (typeof close === 'function') {
    close.call(activeQuery)
  }
}

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
    const pendingModelSwitchId = CLAUDE_AGENT_SDK_PERSIST_SESSION && input.modelId !== undefined
      ? resolveClaudeAgentPendingModelSwitchId(snapshot, input.modelId)
      : null
    const nextSnapshot = writeClaudeAgentPendingModelSwitch({
      ...snapshot,
      workspacePath: input.workspacePath,
      agentId,
      agentHome: runtimeContext.agentHome,
      models: {
        ...snapshot.models,
        currentModelId: input.modelId !== undefined ? input.modelId : snapshot.models.currentModelId,
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
      closeClaudeQuery(activeQuery)
    }
  }

  async getUiSlotStates(input: GetUiSlotStatesInput): Promise<RuntimeUiSlotState[]> {
    const planState = projectClaudeAgentPlanUiSlotState(input.runtimeSession)
    const progressState = projectClaudeAgentProgressUiSlotState(input.runtimeSession)
    const crewState = projectClaudeAgentCrewUiSlotState(input.runtimeSession)
    const compactState = await this.readCompactState(input)
    const states: RuntimeUiSlotState[] = []
    if (planState) {
      states.push(planState)
    }
    if (progressState) {
      states.push(progressState)
    }
    if (crewState) {
      states.push(crewState)
    }
    const usageState = projectClaudeAgentUsageUiSlotState(input.runtimeSession)
    if (usageState) {
      states.push(usageState)
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
      closeClaudeQuery(activeQuery)
    }
  }

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    const abortController = new AbortController()
    const config = readTrustedClaudeAgentConfig(input.profile.configJson)
    const shouldPersistSession = shouldPersistClaudeAgentSdkSession(config.authMode)
    const resumedProviderSessionId = shouldPersistSession ? input.runtimeSession.providerSessionId : null
    const shouldResumeProviderSession = Boolean(resumedProviderSessionId)
    const projectedUserContent = projectClaudeAgentInput(input.message, 'Claude Agent provider')
    const userContent = buildClaudeAgentTurnContent({
      userContent: projectedUserContent,
      history: input.history,
      historyScope: shouldResumeProviderSession ? 'recentCradleLocal' : 'full',
    })
    const userPromptText = describeClaudeAgentUserContent(userContent)
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
    void this.captureClaudeAgentAccountSnapshot(input.runtimeSession, activeQuery)
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
        await activeQuery.setModel(
          pendingModelSwitchId === CLAUDE_AGENT_RUNTIME_DEFAULT_MODEL_SWITCH_ID
            ? undefined
            : pendingModelSwitchId,
        )
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

        this.projectClaudeAgentRuntimeState(input.runtimeSession, message)

        const result = await mapClaudeAgentMessageToChunks(message, mapperState)
        for (const plan of result.capturedPlans) {
          writeClaudeAgentCapturedPlan(input.runtimeSession, plan)
        }
        for (const progress of result.capturedTodos) {
          writeClaudeAgentProgress(input.runtimeSession, progress)
        }
        for (const crewCall of result.capturedCrewCalls) {
          writeClaudeAgentCrewCall(input.runtimeSession, mapCrewCallToSnapshot(crewCall))
        }
        for (const mode of result.capturedInteractionModes) {
          await this.requestRuntimeInteractionModeUpdate(input.runtimeSession, mode.interactionMode)
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

        const nextProviderSessionId = shouldPersistSession && result.sessionId && result.sessionId !== input.runtimeSession.providerSessionId
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

        for (const userQuestion of result.capturedUserQuestions) {
          await this.answerClaudeAgentUserQuestion(input, userQuestion, inputStream)
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
              runtimeSession: input.runtimeSession,
              profile: titleGeneration.profile,
              mainSessionId: nextProviderSessionId,
              promptText: userPromptText,
              modelId: titleGeneration.modelId ?? titleGeneration.fallbackModel,
              fallbackModel: titleGeneration.fallbackModel,
              thinkingEffort: titleGeneration.thinkingEffort,
              workspaceId: input.workspaceId,
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
      closeClaudeQuery(activeQuery)
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
    closeClaudeQuery(entry.query)
    entry.inputStream.close()
    this.releaseQuery(sessionId, entry)
  }

  async listProviderThreads(input: ProviderThreadListInput): Promise<ProviderThreadListResult> {
    const parentSessionId = input.runtimeSession.providerSessionId
    if (!parentSessionId || !supportsClaudeSubagentSourceKinds(input.sourceKinds)) {
      return {
        runtimeKind: this.runtimeKind,
        providerSessionId: parentSessionId,
        threads: [],
        nextCursor: null,
        backwardsCursor: null,
      }
    }

    const cwd = this.resolveClaudeProviderThreadDir(input)
    const agentIds = await listSubagents(parentSessionId, { dir: cwd })
    const records = await Promise.all(agentIds.map(async agentId => ({
      agentId,
      parentSessionId,
      cwd,
      messages: await this.readClaudeSubagentMessages(parentSessionId, agentId, cwd),
    } satisfies ClaudeSubagentThreadRecord)))
    const sortKey = input.sortKey ?? 'updated_at'
    const sortDirection = input.sortDirection ?? 'desc'
    const searchTerm = normalizeProviderThreadText(input.searchTerm)
    const threads = records
      .map(projectClaudeSubagentThread)
      .filter(thread => !searchTerm || claudeProviderThreadMatchesSearch(thread, searchTerm))
      .sort((left, right) => compareClaudeProviderThreads(left, right, sortKey, sortDirection))

    const offset = readProviderThreadOffset(input.cursor)
    const limit = readProviderThreadLimit(input.limit)
    const page = threads.slice(offset, offset + limit)
    return {
      runtimeKind: this.runtimeKind,
      providerSessionId: parentSessionId,
      threads: page,
      nextCursor: offset + limit < threads.length ? String(offset + limit) : null,
      backwardsCursor: offset > 0 ? String(Math.max(0, offset - limit)) : null,
    }
  }

  async readProviderThread(input: ProviderThreadReadInput): Promise<ProviderThreadReadResult> {
    const record = await this.resolveClaudeSubagentThreadRecord(input.threadId, input)
    return {
      runtimeKind: this.runtimeKind,
      providerSessionId: record.parentSessionId,
      thread: projectClaudeSubagentThread(record),
    }
  }

  async listProviderThreadTurns(input: ProviderThreadTurnsInput): Promise<ProviderThreadTurnsResult> {
    const record = await this.resolveClaudeSubagentThreadRecord(input.threadId, input)
    const sortDirection = input.sortDirection ?? 'asc'
    const displayMessages = record.messages.filter(hasClaudeSubagentDisplayParts)
    const messages = sortDirection === 'desc' ? [...displayMessages].reverse() : displayMessages
    const offset = readProviderThreadOffset(input.cursor)
    const limit = readProviderThreadLimit(input.limit)
    const page = messages.slice(offset, offset + limit)
    return {
      runtimeKind: this.runtimeKind,
      providerSessionId: record.parentSessionId,
      threadId: record.agentId,
      turns: page.map(message => projectClaudeSubagentTurn(record.agentId, message)),
      messages: projectClaudeSubagentMessagesToUiMessages(record.agentId, page),
      nextCursor: offset + limit < messages.length ? String(offset + limit) : null,
      backwardsCursor: offset > 0 ? String(Math.max(0, offset - limit)) : null,
    }
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
    await entry.query.setPermissionMode(input.mode)
  }

  private async requestRuntimeInteractionModeUpdate(
    runtimeSession: RuntimeSession,
    interactionMode: 'plan',
  ): Promise<void> {
    if (!this.deps.updateSessionRuntimeSettings) {
      return
    }

    try {
      await this.deps.updateSessionRuntimeSettings({
        sessionId: runtimeSession.chatSessionId,
        patch: { interactionMode },
      })
    }
    catch (error) {
      this.deps.logger?.warn?.('Claude Agent runtime interaction mode update failed', {
        error,
        sessionId: runtimeSession.chatSessionId,
        interactionMode,
      })
    }
  }

  private async answerClaudeAgentUserQuestion(
    input: StreamTurnInput,
    request: ClaudeAgentCapturedUserQuestion,
    inputStream: ClaudeAgentInputStream,
  ): Promise<void> {
    if (!this.deps.requestUserInput) {
      throw new ProviderRuntimeError(
        ProviderErrors.requestFailed(
          this.runtimeKind,
          CLAUDE_AGENT_ASK_USER_QUESTION_METHOD,
          'Chat Runtime does not expose pending user input handling',
        ),
      )
    }

    const resolution = await this.deps.requestUserInput({
      sessionId: input.runtimeSession.chatSessionId,
      runId: input.runId,
      providerRequestId: request.toolCallId,
      providerKind: input.profile.providerKind,
      runtimeKind: this.runtimeKind,
      providerMethod: CLAUDE_AGENT_ASK_USER_QUESTION_METHOD,
      toolCallId: request.toolCallId,
      questions: projectClaudeAgentUserInputQuestions(request.input),
      metadata: {
        params: request.input,
      },
    })
    const output = buildClaudeAgentAskUserQuestionOutput({
      request: request.input,
      answers: resolution.answers,
    })
    inputStream.push(
      [
        {
          type: 'tool_result',
          tool_use_id: request.toolCallId,
          content: JSON.stringify(output),
        },
      ],
      {
        parentToolUseId: request.parentToolUseId,
        toolUseResult: output,
      },
    )
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
        runtimeSession: input.runtimeSession,
        profile: titleGeneration.profile,
        promptText: input.promptText,
        modelId: titleGeneration.modelId ?? titleGeneration.fallbackModel,
        thinkingEffort: titleGeneration.thinkingEffort,
        workspaceId: input.workspaceId,
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

  private async captureClaudeAgentAccountSnapshot(runtimeSession: RuntimeSession, activeQuery: Query): Promise<void> {
    const initializationResult = (activeQuery as { initializationResult?: () => Promise<{ account?: AccountInfo }> }).initializationResult
    if (typeof initializationResult !== 'function') {
      return
    }

    try {
      const result = await initializationResult.call(activeQuery)
      if (hasClaudeAgentAccountSignal(result.account)) {
        writeClaudeAgentAccountSnapshot(runtimeSession, result.account)
      }
    }
    catch (error) {
      this.deps.logger?.debug?.('Claude Agent account initialization probe failed', {
        error,
        sessionId: runtimeSession.chatSessionId,
      })
    }
  }

  private projectClaudeAgentRuntimeState(runtimeSession: RuntimeSession, message: SDKMessage): void {
    if (message.type === 'auth_status') {
      writeClaudeAgentAuthStatusSnapshot(runtimeSession, message as SDKAuthStatusMessage)
      return
    }
    if (message.type === 'rate_limit_event') {
      writeClaudeAgentRateLimitSnapshot(runtimeSession, (message as SDKRateLimitEvent).rate_limit_info)
    }
  }

  private resolveClaudeSessionProjectDir(input: {
    workspacePath?: string | null
    agentId?: string | null
  }): string {
    activateClaudeAgentSdkConfigDir()
    return resolveClaudeAgentRuntimeContext(input.workspacePath ?? undefined, input.agentId ?? null).cwd
  }

  private resolveClaudeProviderThreadDir(input: GetCapabilitiesInput): string {
    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    return this.resolveClaudeSessionProjectDir({
      workspacePath: input.workspacePath ?? snapshot.workspacePath ?? undefined,
      agentId: input.agentId ?? snapshot.agentId ?? null,
    })
  }

  private async readClaudeSubagentMessages(
    parentSessionId: string,
    agentId: string,
    cwd: string,
  ): Promise<ClaudeSubagentSessionMessage[]> {
    const messages = await getSubagentMessages(parentSessionId, agentId, { dir: cwd })
    return messages.map(message => message as ClaudeSubagentSessionMessage)
  }

  private async resolveClaudeSubagentThreadRecord(
    requestedThreadId: string,
    input: GetCapabilitiesInput,
  ): Promise<ClaudeSubagentThreadRecord> {
    const parentSessionId = input.runtimeSession.providerSessionId
    if (!parentSessionId) {
      throw new ProviderRuntimeError(ProviderErrors.sessionNotFound(this.runtimeKind, input.runtimeSession.chatSessionId))
    }

    const cwd = this.resolveClaudeProviderThreadDir(input)
    const agentIds = await listSubagents(parentSessionId, { dir: cwd })
    if (agentIds.includes(requestedThreadId)) {
      const messages = await this.readClaudeSubagentMessages(parentSessionId, requestedThreadId, cwd)
      return { agentId: requestedThreadId, parentSessionId, cwd, messages }
    }

    for (const agentId of agentIds) {
      const messages = await this.readClaudeSubagentMessages(parentSessionId, agentId, cwd)
      if (messages.some(message => message.parent_tool_use_id === requestedThreadId)) {
        return { agentId, parentSessionId, cwd, messages }
      }
    }

    throw new ProviderRuntimeError(
      ProviderErrors.requestFailed(
        this.runtimeKind,
        'provider-thread/read',
        `Claude Agent subagent transcript was not found: ${requestedThreadId}`,
      ),
    )
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
    runtimeSession: RuntimeSession
    profile: StreamTurnInput['profile']
    mainSessionId: string
    promptText: string
    modelId: string | null
    fallbackModel: string | null
    thinkingEffort: ClaudeTitleGenerationThinkingEffort
    workspaceId?: string | null
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
            runtimeSession: input.runtimeSession,
            profile: input.profile,
            promptText: input.promptText,
            modelId: model,
            thinkingEffort: input.thinkingEffort,
            workspaceId: input.workspaceId,
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

function hasClaudeAgentAccountSignal(account: AccountInfo | undefined): account is AccountInfo {
  return Boolean(
    account?.email
    || account?.organization
    || account?.subscriptionType
    || account?.tokenSource
    || account?.apiKeySource
    || account?.apiProvider,
  )
}

function normalizeClaudeSessionTitle(title: string | null | undefined): string | null {
  const normalized = title?.replace(/\s+/g, ' ').trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

function supportsClaudeSubagentSourceKinds(sourceKinds: ProviderThreadListInput['sourceKinds']): boolean {
  return !sourceKinds || sourceKinds.length === 0 || sourceKinds.includes(CLAUDE_SUBAGENT_SOURCE_KIND)
}

function readProviderThreadLimit(limit: number | null | undefined): number {
  return Number.isFinite(limit) && typeof limit === 'number' && limit > 0
    ? Math.floor(limit)
    : DEFAULT_PROVIDER_THREAD_LIMIT
}

function readProviderThreadOffset(cursor: string | null | undefined): number {
  if (!cursor) {
    return 0
  }
  const offset = Number.parseInt(cursor, 10)
  return Number.isFinite(offset) && offset > 0 ? offset : 0
}

function projectClaudeSubagentThread(record: ClaudeSubagentThreadRecord): ProviderThread {
  const parentToolUseId = readClaudeSubagentParentToolUseId(record.messages)
  const preview = readClaudeSubagentPreview(record.messages)
  const createdAt = readClaudeSubagentBoundaryTimestamp(record.messages, 'first')
  const updatedAt = readClaudeSubagentBoundaryTimestamp(record.messages, 'last')
  const subagentType = readFirstClaudeSubagentString(record.messages, 'subagent_type')
  const taskDescription = readFirstClaudeSubagentString(record.messages, 'task_description')
  return {
    id: record.agentId,
    providerSessionTreeId: record.parentSessionId,
    forkedFromId: parentToolUseId,
    preview,
    ephemeral: false,
    modelProvider: readClaudeSubagentModel(record.messages),
    createdAt,
    updatedAt,
    status: 'completed',
    sourceKind: CLAUDE_SUBAGENT_SOURCE_KIND,
    source: {
      type: 'claude-agent-subagent',
      agentId: record.agentId,
      parentToolUseId,
    },
    threadSource: {
      kind: 'claude-agent-transcript',
      parentSessionId: record.parentSessionId,
      agentId: record.agentId,
      parentToolUseId,
    },
    agentNickname: subagentType,
    agentRole: taskDescription,
    name: taskDescription ?? subagentType ?? preview,
    cwd: record.cwd,
  }
}

function compareClaudeProviderThreads(
  left: ProviderThread,
  right: ProviderThread,
  sortKey: ProviderThreadListInput['sortKey'],
  sortDirection: ProviderThreadListInput['sortDirection'],
): number {
  const leftValue = sortKey === 'created_at' ? left.createdAt : left.updatedAt
  const rightValue = sortKey === 'created_at' ? right.createdAt : right.updatedAt
  const direction = sortDirection === 'asc' ? 1 : -1
  return ((leftValue ?? 0) - (rightValue ?? 0)) * direction
}

function claudeProviderThreadMatchesSearch(thread: ProviderThread, searchTerm: string): boolean {
  return [
    thread.id,
    thread.forkedFromId,
    thread.preview,
    thread.agentNickname,
    thread.agentRole,
    thread.name,
  ].some(value => normalizeProviderThreadText(value)?.includes(searchTerm))
}

function normalizeProviderThreadText(text: string | null | undefined): string | null {
  const normalized = text?.replace(/\s+/g, ' ').trim().toLowerCase() ?? ''
  return normalized.length > 0 ? normalized : null
}

function readClaudeSubagentParentToolUseId(messages: ClaudeSubagentSessionMessage[]): string | null {
  return messages.find(message => message.parent_tool_use_id)?.parent_tool_use_id ?? null
}

function readClaudeSubagentModel(messages: ClaudeSubagentSessionMessage[]): string | null {
  for (const message of messages) {
    const payload = readClaudeTranscriptPayload(message)
    const model = normalizeProviderThreadText(payload?.model)
    if (model) {
      return payload!.model!
    }
  }
  return null
}

function readFirstClaudeSubagentString(
  messages: ClaudeSubagentSessionMessage[],
  key: 'subagent_type' | 'task_description',
): string | null {
  for (const message of messages) {
    const value = normalizeProviderThreadText(message[key])
    if (value) {
      return message[key]!
    }
  }
  return null
}

function readClaudeSubagentPreview(messages: ClaudeSubagentSessionMessage[]): string | null {
  for (const message of messages) {
    const text = readClaudeMessageText(message)
    if (text) {
      return text.length > 240 ? `${text.slice(0, 237)}...` : text
    }
  }
  return null
}

function readClaudeSubagentBoundaryTimestamp(
  messages: ClaudeSubagentSessionMessage[],
  boundary: 'first' | 'last',
): number | null {
  const ordered = boundary === 'first' ? messages : [...messages].reverse()
  for (const message of ordered) {
    const timestamp = readClaudeSubagentTimestamp(message)
    if (timestamp !== null) {
      return timestamp
    }
  }
  return null
}

function readClaudeSubagentTimestamp(message: ClaudeSubagentSessionMessage): number | null {
  if (!message.timestamp) {
    return null
  }
  const timestamp = Date.parse(message.timestamp)
  return Number.isFinite(timestamp) ? timestamp : null
}

function projectClaudeSubagentTurn(agentId: string, message: ClaudeSubagentSessionMessage): ProviderThreadTurn {
  const timestamp = readClaudeSubagentTimestamp(message)
  return {
    id: message.uuid,
    status: 'completed',
    startedAt: timestamp,
    completedAt: timestamp,
    durationMs: null,
    itemsView: 'full',
    items: [{
      provider: 'claude-agent',
      providerThreadId: agentId,
      message,
    }],
  }
}

function projectClaudeSubagentMessagesToUiMessages(
  agentId: string,
  messages: ClaudeSubagentSessionMessage[],
): UIMessage[] {
  return messages.flatMap((message): UIMessage[] => {
    const parts = projectClaudeSubagentMessageParts(message)
    if (parts.length === 0) {
      return []
    }
    return [{
      id: `provider-thread:${agentId}:message:${message.uuid}`,
      role: readClaudeSubagentUiRole(message),
      parts,
      metadata: {
        provider: 'claude-agent',
        providerThreadId: agentId,
        providerMessageId: message.uuid,
        parentToolUseId: message.parent_tool_use_id,
      },
    }]
  })
}

function hasClaudeSubagentDisplayParts(message: ClaudeSubagentSessionMessage): boolean {
  return projectClaudeSubagentMessageParts(message).length > 0
}

function readClaudeSubagentUiRole(message: ClaudeSubagentSessionMessage): UIMessage['role'] {
  return message.type === 'assistant' || message.type === 'system' ? message.type : 'user'
}

function projectClaudeSubagentMessageParts(message: ClaudeSubagentSessionMessage): UIMessage['parts'] {
  const payload = readClaudeTranscriptPayload(message)
  if (!payload) {
    return projectClaudeSubagentTextPart(typeof message.message === 'string' ? message.message : null)
  }
  const content = payload.content
  if (typeof content === 'string') {
    return projectClaudeSubagentTextPart(content)
  }
  if (!Array.isArray(content)) {
    return []
  }

  const parts: UIMessage['parts'] = []
  for (const block of content) {
    if (block.type === 'text') {
      const text = normalizeProviderThreadRawText(block.text)
      if (text) {
        parts.push({ type: 'text', text, state: 'done' })
      }
      continue
    }
    if (block.type === 'thinking') {
      const thinking = normalizeProviderThreadRawText(block.thinking)
      if (thinking) {
        parts.push({ type: 'reasoning', text: thinking, state: 'done' })
      }
      continue
    }
  }
  return parts
}

function projectClaudeSubagentTextPart(text: string | null): UIMessage['parts'] {
  const normalized = normalizeProviderThreadRawText(text)
  return normalized ? [{ type: 'text', text: normalized, state: 'done' }] : []
}

function readClaudeMessageText(message: ClaudeSubagentSessionMessage): string | null {
  return projectClaudeSubagentMessageParts(message)
    .flatMap(part => part.type === 'text' || part.type === 'reasoning' ? [part.text] : [])
    .join('\n')
    .trim() || null
}

function readClaudeTranscriptPayload(message: ClaudeSubagentSessionMessage): ClaudeTranscriptMessagePayload | null {
  if (typeof message.message === 'string') {
    return null
  }
  const record = readRecord(message.message)
  if (!('content' in record) && !('model' in record)) {
    return null
  }
  return {
    role: typeof record.role === 'string' ? record.role : undefined,
    content: readClaudeTranscriptContent(record.content),
    model: typeof record.model === 'string' ? record.model : undefined,
  }
}

function readClaudeTranscriptContent(value: unknown): ClaudeTranscriptMessagePayload['content'] {
  if (typeof value === 'string') {
    return value
  }
  if (!Array.isArray(value)) {
    return undefined
  }
  return value.map(block => readRecord(block) as ClaudeTranscriptContentBlock)
}

function normalizeProviderThreadRawText(text: string | null | undefined): string | null {
  const normalized = text?.trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

function mapCrewCallToSnapshot(call: ClaudeAgentCapturedCrewCall): {
  id: string
  tool: string
  prompt: string | null
  description: string | null
  subagentType: string | null
  model: string | null
  reasoningEffort: string | null
  runInBackground: boolean
  status: 'running' | 'completed' | 'failed'
  startedAt: number
  completedAt: number | null
} {
  return {
    id: call.toolCallId,
    tool: 'Agent',
    prompt: call.prompt,
    description: call.description,
    subagentType: call.subagentType,
    model: call.model,
    reasoningEffort: call.reasoningEffort,
    runInBackground: call.runInBackground,
    status: call.status,
    startedAt: call.startedAt,
    completedAt: call.completedAt,
  }
}
