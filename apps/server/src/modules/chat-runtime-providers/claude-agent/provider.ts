import type { Query } from '@anthropic-ai/claude-agent-sdk'
import { getSessionInfo, query } from '@anthropic-ai/claude-agent-sdk'
import type { LangfuseGeneration } from '@langfuse/tracing'
import { startObservation } from '@langfuse/tracing'
import type { UIMessageChunk } from 'ai'

import { langfuseEnabled } from '../../../langfuse'
import { readTrustedClaudeAgentConfig } from '../../provider-contracts/provider-base'
import type { TokenUsage } from '../../chat-runtime-engine/ai-sdk-engine'
import { ProviderErrors, ProviderRuntimeError } from '../../chat-runtime/runtime-provider-types'
import type {
  CancelTurnInput,
  ChatRuntime,
  GetCapabilitiesInput,
  ProviderContext,
  ResumeChatSessionInput,
  RuntimePresentationCapabilities,
  RuntimeSession,
  SetPermissionModeInput,
  StartChatSessionInput,
  SteerTurnInput,
  StreamTurnInput,
} from '../../chat-runtime/runtime-provider-types'
import { isChatStreamTraceEnabled, recordChatStreamTrace } from '../../chat-runtime/stream-trace'
import { createBoundedTextCollector } from '../bounded-text-collector'
import { readWorkspaceProviderStateSnapshot } from '../provider-state-snapshot'
import { ClaudeAgentInputStream, emptyClaudeAgentInput } from './async-input-stream'
import { createClaudeAgentChunkMapperState, mapClaudeAgentMessageToChunks } from './event-to-chunk-mapper'
import {
  buildClaudeAgentTurnContent,
  buildClaudeQueryOptions,
  CLAUDE_AGENT_SDK_PERSIST_SESSION,
  describeClaudeAgentUserContent,
  projectClaudeAgentInput,
  readClaudeAgentModelId,
} from './input-projector'
import {
  CLAUDE_AGENT_RUNTIME_CAPABILITIES,
  CLAUDE_AGENT_RUNTIME_KIND,
  CLAUDE_AGENT_RUNTIME_METADATA,
  projectClaudeAgentPresentation,
} from './metadata'
import { resolveClaudeAgentRuntimeContext } from './runtime-context'
import {
  clearClaudeAgentPendingModelSwitch,
  readClaudeAgentPendingModelSwitchId,
  resolveClaudeAgentPendingModelSwitchId,
  writeClaudeAgentPendingModelSwitch,
} from './state-projector'
import type { ClaudeAgentSessionInfo } from './types'

type ActiveClaudeQuery = {
  query: Query
  abortController: AbortController
  inputStream: ClaudeAgentInputStream
}

export function createClaudeAgentProvider(ctx: ProviderContext): ChatRuntime {
  return new ClaudeAgentProvider(ctx)
}

export class ClaudeAgentProvider implements ChatRuntime {
  readonly runtimeKind = CLAUDE_AGENT_RUNTIME_KIND
  readonly metadata = CLAUDE_AGENT_RUNTIME_METADATA
  readonly capabilities = CLAUDE_AGENT_RUNTIME_CAPABILITIES

  private readonly activeQueries = new Map<string, ActiveClaudeQuery>()
  private _lastUsage: TokenUsage | null = null

  get lastUsage(): TokenUsage | null {
    return this._lastUsage
  }

  constructor(private readonly deps: ProviderContext) {}

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

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    const abortController = new AbortController()
    const shouldResumeProviderSession = CLAUDE_AGENT_SDK_PERSIST_SESSION && Boolean(input.runtimeSession.providerSessionId)
    const projectedUserContent = projectClaudeAgentInput(input.message, 'Claude Agent provider')
    const userContent = buildClaudeAgentTurnContent({
      userContent: projectedUserContent,
      history: input.history,
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
    const traceMessageId = input.responseMessageId ?? input.message.id

    const mapperState = createClaudeAgentChunkMapperState()

    // Langfuse tracing via @langfuse/tracing SDK
    let generation: LangfuseGeneration | null = null
    if (langfuseEnabled) {
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

    try {
      if (shouldResumeProviderSession && pendingModelSwitchId) {
        await activeQuery.setModel(pendingModelSwitchId)
        clearClaudeAgentPendingModelSwitch(input.runtimeSession)
      }
      if (shouldResumeProviderSession) {
        await this.reportClaudeSessionTitle(input.runtimeSession.providerSessionId, input.reportSessionTitle)
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

        for (const chunk of result.chunks) {
          // Collect text output for Langfuse
          if (generation && chunk.type === 'text-delta' && 'delta' in chunk) {
            outputTextCollector.append((chunk as { delta: string }).delta)
          }
          yield chunk
        }

        if (result.sessionId && result.sessionId !== input.runtimeSession.providerSessionId) {
          input.runtimeSession.providerSessionId = result.sessionId
          await this.reportClaudeSessionTitle(result.sessionId, input.reportSessionTitle)
        }

        if (result.usage) {
          this._lastUsage = result.usage
        }

        if (message.type === 'result') {
          inputStream.close()
        }
      }

      if (mapperState.assistantStarted) {
        yield { type: 'text-end', id: mapperState.textItemId }
      }

      // Record usage and output in the generation
      if (generation) {
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
      generation?.end()
    }
    catch (error) {
      if (generation) {
        generation.update({
          level: 'ERROR',
          statusMessage: error instanceof Error ? error.message : String(error),
        })
        generation.end()
      }
      throw error
    }
    finally {
      inputStream.close()
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

  async setPermissionMode(input: SetPermissionModeInput): Promise<void> {
    const sessionId = input.runtimeSession.chatSessionId
    const entry = this.activeQueries.get(sessionId)
    if (!entry) {
      return
    }
    entry.query.setPermissionMode(input.mode)
  }

  private async reportClaudeSessionTitle(sessionId: string, reportSessionTitle?: (title: string) => void): Promise<void> {
    if (!reportSessionTitle) {
      return
    }

    const info = await getSessionInfo(sessionId).catch(() => undefined)
    const title = normalizeClaudeSessionTitle(
      (info as ClaudeAgentSessionInfo | undefined)?.customTitle
      ?? (info as ClaudeAgentSessionInfo | undefined)?.summary,
    )
    if (title) {
      reportSessionTitle(title)
    }
  }
}

function normalizeClaudeSessionTitle(title: string | null | undefined): string | null {
  const normalized = title?.replace(/\s+/g, ' ').trim() ?? ''
  return normalized.length > 0 ? normalized : null
}
