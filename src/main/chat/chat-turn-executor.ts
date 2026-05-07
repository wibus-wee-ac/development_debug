// Input: Provider sessions, chat profiles, timeline repository, and chat turn context resolution
// Output: In-flight chat turn executor with per-session draft state, persistence, and domain event publication
// Position: Chat write-side runtime behind ChatEngine's thin shell

import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'

import type { ChatRuntimeProvider, ProviderKind, RuntimeSession as ProviderSession } from '../agent-runtime/runtime-provider-types'
import { getBackendControlPlaneService } from '../backend-control-plane/backend-control-plane'
import type { TimelineInputEvent } from '../backend-control-plane/timeline-events'
import { getDb } from '../db'
import type { AgentProfile } from '../db/schema'
import { backendTimelineEvents, messages, sessions } from '../db/schema'
import { getAgentContextDevtoolStore } from '../devtools/agent-context-devtool-store'
import type { DomainEventBus } from '../events/domain-event-bus'
import { OBSERVABILITY_CODES } from '../observability/service'
import type { ObservabilitySink } from '../observability/sink'
import { resolveChatTurnContext } from './chat-turn-context'
import { persistTimelineEvent } from './timeline-event-sink'
import { coordinateTurn } from './turn-coordinator'
import type { TurnRepository } from './turn-repository'
import { createTurnRepository } from './turn-repository'

export type MessageStatus = 'streaming' | 'complete' | 'aborted' | 'failed'
export type ChatTurnStatus = 'complete' | 'aborted' | 'failed'

export interface PreparedChatTurn {
  chatSessionId: string
  runId: string | null
  messageId: string
  userMessageId: string
  agentId: string
  runtimeSession: ProviderSession
  abortController: AbortController
  modelId?: string
  providerOptions?: Record<string, unknown>
}

export interface PrepareTurnArgs {
  chatSessionId: string
  agentId: string
  agentIdentityId?: string
  runtimeSession: ProviderSession
  userText: string
  modelId?: string
  providerOptions?: Record<string, unknown>
  newSession?: {
    workspaceId: string
    title: string
  }
}

interface SerializedChatError {
  text: string
  payload: {
    name?: string
    message: string
    code?: number | string
    data?: unknown
    stack?: string
  }
}

interface TurnOutputDiagnostics {
  emittedEventCount: number
  assistantBoundaryCount: number
  assistantTextCharCount: number
  reasoningTextCharCount: number
  toolEventCount: number
}

export interface ChatTurnExecutorDeps {
  loadProfile: (agentId: string) => AgentProfile
  getChatProvider: (providerKind: string) => ChatRuntimeProvider
  getEventBus: () => DomainEventBus | null
  getObservability: () => ObservabilitySink
}

export interface ChatTurnExecutor {
  prepareTurn: (args: PrepareTurnArgs) => PreparedChatTurn
  executeTurn: (draft: PreparedChatTurn, userText: string) => Promise<void>
  hasDraft: (chatSessionId: string) => boolean
  abort: (chatSessionId: string) => Promise<void>
  recoverStrandedRuns: () => void
  destroy: () => void
}

export function createChatTurnExecutor(deps: ChatTurnExecutorDeps): ChatTurnExecutor {
  const drafts = new Map<string, PreparedChatTurn>()
  let repository: TurnRepository | null = null

  function getRepository(): TurnRepository {
    if (!repository) {
      repository = createTurnRepository({ db: getDb() })
    }
    return repository
  }

  function prepareTurn(args: PrepareTurnArgs): PreparedChatTurn {
    const { chatSessionId, agentId, agentIdentityId, runtimeSession, userText, newSession, modelId, providerOptions } = args

    if (drafts.has(chatSessionId)) {
      throw new Error(`Chat session ${chatSessionId} already has a turn in progress`)
    }

    const userMessageId = randomUUID()
    const assistantMessageId = randomUUID()
    const db = getDb()

    db.transaction((tx) => {
      if (newSession) {
        tx.insert(sessions)
          .values({
            id: chatSessionId,
            workspaceId: newSession.workspaceId,
            title: newSession.title,
            agentProfileId: agentId,
            agentId: agentIdentityId ?? null,
          })
          .run()
      }

      tx.insert(messages)
        .values({
          id: userMessageId,
          sessionId: chatSessionId,
          role: 'user',
          status: 'complete',
          content: userText,
        })
        .run()

      tx.insert(messages)
        .values({
          id: assistantMessageId,
          sessionId: chatSessionId,
          role: 'assistant',
          status: 'streaming',
          content: '',
        })
        .run()

      if (!newSession) {
        tx.update(sessions)
          .set({ updatedAt: nowUnix() })
          .where(eq(sessions.id, chatSessionId))
          .run()
      }
    })

    const draft: PreparedChatTurn = {
      chatSessionId,
      runId: null,
      messageId: assistantMessageId,
      userMessageId,
      agentId,
      runtimeSession,
      abortController: new AbortController(),
      modelId,
      providerOptions,
    }
    drafts.set(chatSessionId, draft)

    return draft
  }

  async function executeTurn(draft: PreparedChatTurn, userText: string): Promise<void> {
    let finalStatus: MessageStatus = 'complete'
    let finalError: string | null = null
    let provider: ChatRuntimeProvider | null = null
    const turnOutputDiagnostics: TurnOutputDiagnostics = {
      emittedEventCount: 0,
      assistantBoundaryCount: 0,
      assistantTextCharCount: 0,
      reasoningTextCharCount: 0,
      toolEventCount: 0,
    }

    try {
      const profile = deps.loadProfile(draft.agentId)
      provider = deps.getChatProvider(profile.providerKind)

      const turnContext = resolveChatTurnContext({
        chatSessionId: draft.chatSessionId,
        draftMessageId: draft.messageId,
        draftUserMessageId: draft.userMessageId,
        fallbackAgentId: draft.agentId,
        providerKind: profile.providerKind,
      })

      getAgentContextDevtoolStore().record({
        id: randomUUID(),
        timestamp: Date.now(),
        chatSessionId: draft.chatSessionId,
        agentId: draft.agentId ?? null,
        agentName: turnContext.agentName,
        systemPrompt: turnContext.systemPrompt ?? null,
        skillsCatalog: [],
        historyLength: turnContext.history?.length ?? 0,
        providerKind: profile.providerKind,
      })

      const turnGenerator = coordinateTurn({
        provider,
        streamInput: {
          runtimeSession: draft.runtimeSession,
          profile,
          message: userText,
          modelId: draft.modelId,
          providerOptions: draft.providerOptions,
          systemPrompt: turnContext.systemPrompt,
          history: turnContext.history,
        },
        providerKind: profile.providerKind,
        signal: draft.abortController.signal,
      })

      for await (const yielded of turnGenerator) {
        if (yielded.type === 'terminal') {
          const terminalInput = yielded.event as Extract<TimelineInputEvent, { type: 'run.completed' | 'run.aborted' | 'run.failed' }>
          const terminalEvent = resolveTerminalEventWithDiagnostics(
            terminalInput,
            draft.runtimeSession.providerKind,
            turnOutputDiagnostics,
          )

          finalStatus = terminalEvent.type === 'run.completed'
            ? 'complete'
            : terminalEvent.type === 'run.aborted'
              ? 'aborted'
              : 'failed'
          finalError = terminalEvent.type === 'run.failed' ? terminalEvent.error : null

          if (finalStatus === 'failed') {
            const observabilityCode = resolveTurnFailureObservabilityCode(terminalEvent)
            deps.getObservability().record({
              source: 'chat-engine',
              code: observabilityCode,
              severity: 'error',
              category: 'chat',
              message: finalError ?? 'Chat turn failed',
              chatSessionId: draft.chatSessionId,
              runId: draft.runId ?? undefined,
              messageId: draft.messageId,
              attrs: {
                agentId: draft.agentId,
                providerSessionId: draft.runtimeSession.providerSessionId,
                diagnostics: turnOutputDiagnostics,
              },
            })
            console.error('[ChatTurnExecutor] turn failed', {
              chatSessionId: draft.chatSessionId,
              messageId: draft.messageId,
              agentId: draft.agentId,
              providerSessionId: draft.runtimeSession.providerSessionId,
              error: finalError,
              diagnostics: turnOutputDiagnostics,
            })
          }

          writeTimelineEvent({
            repository: getRepository(),
            eventBus: deps.getEventBus(),
          }, draft, terminalEvent, {
            messageStatus: finalStatus,
            errorText: finalError,
            runCompletion: {
              status: finalStatus,
              stopReason: finalStatus === 'complete'
                ? 'response.completed'
                : finalStatus === 'aborted'
                  ? 'response.cancelled'
                  : 'response.failed',
              errorText: finalError,
            },
          })
          continue
        }

        const { event } = yielded
        accumulateTurnOutputDiagnostics(turnOutputDiagnostics, event)
        writeTimelineEvent({
          repository: getRepository(),
          eventBus: deps.getEventBus(),
        }, draft, event)
      }
    }
    catch (error) {
      finalStatus = draft.abortController.signal.aborted ? 'aborted' : 'failed'
      const serializedError = serializeChatError(error)
      finalError = serializedError.text

      if (!draft.abortController.signal.aborted) {
        deps.getObservability().record({
          source: 'chat-engine',
          code: OBSERVABILITY_CODES.turnStreamFailed,
          severity: 'error',
          category: 'chat',
          message: finalError ?? 'Chat stream failed outside coordinator',
          chatSessionId: draft.chatSessionId,
          runId: draft.runId ?? undefined,
          messageId: draft.messageId,
          attrs: {
            payload: serializedError.payload,
          },
        })
        console.error('[ChatTurnExecutor] runStream outer failure', {
          chatSessionId: draft.chatSessionId,
          messageId: draft.messageId,
          error: serializedError.payload,
        })
      }

      writeTimelineEvent(
        {
          repository: getRepository(),
          eventBus: deps.getEventBus(),
        },
        draft,
        finalStatus === 'aborted'
          ? {
              type: 'run.aborted',
              source: {
                backend: draft.runtimeSession.providerKind,
                eventType: 'chat.turn.aborted',
              },
            }
          : {
              type: 'run.failed',
              error: finalError ?? 'chat failed',
              source: {
                backend: draft.runtimeSession.providerKind,
                eventType: 'chat.turn.failed',
              },
            },
        {
          messageStatus: finalStatus,
          errorText: finalError,
          runCompletion: {
            status: finalStatus,
            stopReason: draft.abortController.signal.aborted
              ? 'response.cancelled'
              : 'response.failed',
            errorText: finalError,
          },
        },
      )
    }

    getRepository().flush()
    drafts.delete(draft.chatSessionId)

    const eventBus = deps.getEventBus()
    if (eventBus) {
      const binding = getBackendControlPlaneService().getBinding(draft.chatSessionId)
      const timelineRows = getDb()
        .select()
        .from(backendTimelineEvents)
        .where(eq(backendTimelineEvents.runId, draft.runId!))
        .orderBy(backendTimelineEvents.sequenceNumber)
        .all()
      const assistantText = timelineRows
        .map(row => JSON.parse(row.payloadJson) as { type: string, delta?: string })
        .filter(event => event.type === 'assistant.text.delta')
        .map(event => event.delta ?? '')
        .join('')

      void eventBus.publish({
        id: randomUUID(),
        type: 'chat.message-completed',
        occurredAt: Date.now(),
        payload: {
          chatSessionId: draft.chatSessionId,
          messageId: draft.messageId,
          status: finalStatus,
          errorText: finalError,
          assistantText,
          agentProfileId: draft.agentId,
          modelId: draft.modelId ?? binding?.requestedModelId ?? null,
          usage: provider?.lastUsage ?? null,
        },
      })

      void eventBus.publish({
        id: randomUUID(),
        type: 'chat.turn-finished',
        occurredAt: Date.now(),
        payload: {
          chatSessionId: draft.chatSessionId,
          messageId: draft.messageId,
          status: finalStatus,
          errorText: finalError,
          agentProfileId: draft.agentId,
          finishedAt: Date.now(),
        },
      })
    }
  }

  return {
    prepareTurn,
    executeTurn,
    hasDraft(chatSessionId) {
      return drafts.has(chatSessionId)
    },
    async abort(chatSessionId) {
      const draft = drafts.get(chatSessionId)
      if (!draft) {
        return
      }

      draft.abortController.abort()
      try {
        const profile = deps.loadProfile(draft.agentId)
        const provider = deps.getChatProvider(profile.providerKind)
        await provider.cancelTurn({ runtimeSession: draft.runtimeSession, profile })
      }
      catch (error) {
        console.warn('[ChatTurnExecutor] cancel failed (will still finalize as aborted):', error)
      }
    },
    recoverStrandedRuns() {
      getRepository().recoverStrandedRuns()
    },
    destroy() {
      drafts.clear()
      repository?.flush()
      repository = null
    },
  }
}

function writeTimelineEvent(
  deps: {
    repository: TurnRepository
    eventBus: DomainEventBus | null
  },
  draft: Pick<PreparedChatTurn, 'chatSessionId' | 'messageId' | 'runId'>,
  event: TimelineInputEvent,
  options: {
    messageStatus?: MessageStatus
    errorText?: string | null
    runCompletion?: {
      status: ChatTurnStatus
      stopReason: string | null
      errorText: string | null
    }
  } = {},
): void {
  if (!draft.runId) {
    throw new Error(`Missing backend run for chat session: ${draft.chatSessionId}`)
  }

  persistTimelineEvent(deps, {
    chatSessionId: draft.chatSessionId,
    messageId: draft.messageId,
    runId: draft.runId,
    event,
    messageStatus: options.messageStatus,
    errorText: options.errorText,
    runCompletion: options.runCompletion,
  })
}

function accumulateTurnOutputDiagnostics(
  diagnostics: TurnOutputDiagnostics,
  event: TimelineInputEvent,
): void {
  diagnostics.emittedEventCount += 1

  switch (event.type) {
    case 'assistant.message.started':
    case 'assistant.message.completed':
      diagnostics.assistantBoundaryCount += 1
      break
    case 'assistant.text.delta':
      diagnostics.assistantTextCharCount += event.delta.length
      break
    case 'reasoning.delta':
      diagnostics.reasoningTextCharCount += event.delta.length
      break
    case 'command.started':
    case 'command.output.delta':
    case 'command.completed':
    case 'tool_call.started':
    case 'tool_call.output.delta':
    case 'tool_call.completed':
    case 'file_change.started':
    case 'file_change.completed':
    case 'approval.requested':
    case 'approval.resolved':
      diagnostics.toolEventCount += 1
      break
    default:
      break
  }
}

interface TurnOutputValidationResult {
  ok: boolean
  errorText: string | null
}

function validateTurnOutput(diagnostics: TurnOutputDiagnostics): TurnOutputValidationResult {
  const hasTextOutput = diagnostics.assistantTextCharCount > 0 || diagnostics.reasoningTextCharCount > 0
  const hasToolOutput = diagnostics.toolEventCount > 0

  if (hasTextOutput || hasToolOutput) {
    return { ok: true, errorText: null }
  }

  return {
    ok: false,
    errorText: `Provider finished without any assistant output events (events=${diagnostics.emittedEventCount}, assistant_boundaries=${diagnostics.assistantBoundaryCount}, assistant_text_chars=${diagnostics.assistantTextCharCount}, reasoning_chars=${diagnostics.reasoningTextCharCount}, tool_events=${diagnostics.toolEventCount})`,
  }
}

function buildEmptyOutputFailureEvent(
  originalEvent: Extract<TimelineInputEvent, { type: 'run.completed' }>,
  providerKind: ProviderKind,
  diagnostics: TurnOutputDiagnostics,
): Extract<TimelineInputEvent, { type: 'run.failed' }> {
  const validation = validateTurnOutput(diagnostics)
  const errorText = validation.errorText ?? 'Provider finished without assistant output events'

  return {
    type: 'run.failed',
    error: errorText,
    source: {
      backend: providerKind,
      eventType: 'chat.turn.failed.empty-output',
      metadata: {
        terminalEventType: originalEvent.type,
        diagnostics,
      },
    },
  }
}

function resolveTerminalEventWithDiagnostics(
  event: Extract<TimelineInputEvent, { type: 'run.completed' | 'run.aborted' | 'run.failed' }>,
  providerKind: ProviderKind,
  diagnostics: TurnOutputDiagnostics,
): Extract<TimelineInputEvent, { type: 'run.completed' | 'run.aborted' | 'run.failed' }> {
  if (event.type !== 'run.completed') {
    return event
  }

  const validation = validateTurnOutput(diagnostics)
  if (validation.ok) {
    return event
  }

  return buildEmptyOutputFailureEvent(event, providerKind, diagnostics)
}

function resolveTurnFailureObservabilityCode(
  event: Extract<TimelineInputEvent, { type: 'run.failed' | 'run.aborted' | 'run.completed' }>,
): string {
  if (event.type !== 'run.failed') {
    return OBSERVABILITY_CODES.turnStreamFailed
  }

  if (event.source.eventType === 'chat.turn.failed.empty-output') {
    return OBSERVABILITY_CODES.chatEmptyOutputCompletion
  }

  const metadata = event.source.metadata
  const errorCode = metadata && typeof metadata.errorCode === 'string'
    ? metadata.errorCode
    : null

  return errorCode ?? OBSERVABILITY_CODES.turnStreamFailed
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000)
}

function serializeChatError(error: unknown): SerializedChatError {
  const payload: SerializedChatError['payload'] = {
    message: error instanceof Error ? error.message : String(error),
  }

  if (error instanceof Error) {
    payload.name = error.name
    payload.stack = error.stack
  }

  if (typeof error === 'object' && error !== null) {
    const candidate = error as Record<string, unknown>
    if (typeof candidate.code === 'number' || typeof candidate.code === 'string') {
      payload.code = candidate.code
    }
    if ('data' in candidate) {
      payload.data = candidate.data
    }
  }

  const detailText = formatErrorDetails(payload.data)
  const codePrefix = payload.code !== undefined ? `[code ${String(payload.code)}] ` : ''
  const text = detailText
    ? `${codePrefix}${payload.message}: ${detailText}`
    : `${codePrefix}${payload.message}`

  return { text, payload }
}

function formatErrorDetails(data: unknown): string | null {
  if (data === null || data === undefined) {
    return null
  }

  if (typeof data === 'object' && data !== null && 'details' in data) {
    const details = (data as Record<string, unknown>).details
    return stringifyErrorValue(details)
  }

  return stringifyErrorValue(data)
}

function stringifyErrorValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value)
  }
  catch {
    return String(value)
  }
}
