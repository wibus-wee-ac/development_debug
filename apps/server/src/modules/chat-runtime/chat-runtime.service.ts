// Input: chat runtime store, turn context, and runtime providers
// Output: chat-runtime orchestration for runs, timeline hydration, streaming, and abort
// Position: apps/server/src/modules/chat-runtime/chat-runtime.service.ts

import { inject, injectable } from 'tsyringe'

import { AppError } from '../../errors/app-error'
import { createDedupeKey, OBSERVABILITY_CODES } from '../observability/contract'
import { ObservabilityService } from '../observability/observability.service'
import { ChatRuntimeStore } from './chat-runtime.store'
import { ChatRuntimeProviderRegistry } from './chat-runtime-provider-registry'
import { ChatTurnContextResolver } from './chat-turn-context'
import type { RuntimeSession, TimelineInputEvent } from './runtime-provider-types'
import type { StoredTimelineEvent } from './timeline-events'

interface ActiveRun {
  runId: string
  sessionId: string
  messageId: string
  agentProfileId: string
  provider: ReturnType<ChatRuntimeProviderRegistry['get']>
  runtimeSession: RuntimeSession
  modelId: string | null
}

type RunSubscriber = (event: StoredTimelineEvent, terminal: boolean) => void

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
  commandEventCount: number
  commandOutputCharCount: number
  fileChangeEventCount: number
}

@injectable()
export class ChatRuntimeService {
  private readonly activeRuns = new Map<string, ActiveRun>()
  private readonly activeRunIdsBySession = new Map<string, string>()
  private readonly runSubscribers = new Map<string, Set<RunSubscriber>>()

  constructor(
    @inject(ChatRuntimeStore) private readonly store: ChatRuntimeStore,
    @inject(ChatTurnContextResolver) private readonly turnContextResolver: ChatTurnContextResolver,
    @inject(ChatRuntimeProviderRegistry) private readonly providers: ChatRuntimeProviderRegistry,
    @inject(ObservabilityService) private readonly observability: ObservabilityService,
  ) {}

  getTimeline(sessionId: string) {
    const context = this.store.getSessionRunContext(sessionId)
    if (!context) {
      throw new AppError({ code: 'chat_session_not_found', status: 404, message: 'Chat session not found', details: { sessionId } })
    }
    return this.store.getTimeline(sessionId)
  }

  async createRun(input: { sessionId: string, text: string, modelId?: string, thinkingEffort?: 'low' | 'medium' | 'high' }) {
    if (this.activeRunIdsBySession.has(input.sessionId)) {
      throw new AppError({ code: 'chat_run_in_progress', status: 409, message: 'Chat session already has an active run', details: { sessionId: input.sessionId } })
    }

    const context = this.store.getSessionRunContext(input.sessionId)
    if (!context) {
      throw new AppError({ code: 'chat_session_not_found', status: 404, message: 'Chat session not found', details: { sessionId: input.sessionId } })
    }
    if (!context.profile.enabled) {
      throw new AppError({ code: 'chat_profile_not_available', status: 409, message: 'Agent profile is disabled', details: { profileId: context.profile.id } })
    }

    const provider = this.providers.get(context.profile.providerKind)
    if (!provider) {
      throw new AppError({ code: 'chat_provider_not_available', status: 501, message: `Provider is not available: ${context.profile.providerKind}` })
    }

    const binding = this.store.getBinding(input.sessionId)
    const runtimeSession = binding
      ? await provider.resumeChatSession({
          runtimeSession: {
            id: input.sessionId,
            chatSessionId: input.sessionId,
            agentProfileId: context.profile.id,
            providerKind: binding.providerKind,
            providerSessionId: binding.backendSessionId,
            providerStateSnapshot: binding.backendStateSnapshot,
          },
          profile: context.profile,
          workspacePath: context.workspacePath,
          modelId: input.modelId,
        })
      : await provider.startChatSession({
          chatSessionId: input.sessionId,
          profile: context.profile,
          workspacePath: context.workspacePath,
          modelId: input.modelId,
        })

    this.store.attachBinding({
      sessionId: input.sessionId,
      agentProfileId: context.profile.id,
      providerKind: runtimeSession.providerKind,
      runtimeSession,
      requestedModelId: input.modelId ?? extractModelId(runtimeSession.providerStateSnapshot),
    })

    const draft = this.store.createDraftTurn({ sessionId: input.sessionId, userText: input.text })
    const run = this.store.startRun({ sessionId: input.sessionId, messageId: draft.assistantMessageId, origin: 'user' })
    const activeRun: ActiveRun = {
      runId: run.id,
      sessionId: input.sessionId,
      messageId: draft.assistantMessageId,
      agentProfileId: context.profile.id,
      provider,
      runtimeSession,
      modelId: input.modelId ?? extractModelId(runtimeSession.providerStateSnapshot),
    }
    this.activeRuns.set(run.id, activeRun)
    this.activeRunIdsBySession.set(input.sessionId, run.id)

    const turnContext = this.turnContextResolver.resolve({
      sessionId: input.sessionId,
      draftMessageId: draft.assistantMessageId,
      draftUserMessageId: draft.userMessageId,
    })

    void this.executeRun(activeRun, {
      text: input.text,
      profile: context.profile,
      modelId: input.modelId,
      thinkingEffort: input.thinkingEffort,
      systemPrompt: turnContext.systemPrompt,
      history: turnContext.history,
    })

    return {
      runId: run.id,
      assistantMessageId: draft.assistantMessageId,
      userMessageId: draft.userMessageId,
    }
  }

  async abortRun(runId: string): Promise<void> {
    const active = this.activeRuns.get(runId)
    if (!active) {
      if (!this.store.getRun(runId)) {
        throw new AppError({ code: 'chat_run_not_found', status: 404, message: 'Chat run not found', details: { runId } })
      }
      return
    }

    const context = this.store.getSessionRunContext(active.sessionId)
    if (!context) {
      throw new AppError({ code: 'chat_session_not_found', status: 404, message: 'Chat session not found', details: { sessionId: active.sessionId } })
    }

    await active.provider?.cancelTurn({ runtimeSession: active.runtimeSession, profile: context.profile })
  }

  openRunStream(runId: string): ReadableStream<Uint8Array> {
    const run = this.store.getRun(runId)
    if (!run) {
      throw new AppError({ code: 'chat_run_not_found', status: 404, message: 'Chat run not found', details: { runId } })
    }

    const encoder = new TextEncoder()
    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        let unsubscribe = () => {}

        const writeEvent = (event: StoredTimelineEvent, terminal: boolean) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          if (terminal) {
            unsubscribe()
            controller.close()
          }
        }

        for (const event of this.store.listRunEvents(runId)) {
          const terminal = event.type === 'run.completed' || event.type === 'run.aborted' || event.type === 'run.failed'
          writeEvent(event, terminal)
          if (terminal) {
            return
          }
        }

        if (run.status !== 'streaming') {
          controller.close()
          return
        }

        const subscribers = this.runSubscribers.get(runId) ?? new Set<RunSubscriber>()
        const subscriber: RunSubscriber = (event, terminal) => writeEvent(event, terminal)
        subscribers.add(subscriber)
        this.runSubscribers.set(runId, subscribers)

        unsubscribe = () => {
          const current = this.runSubscribers.get(runId)
          if (!current) {
            return
          }
          current.delete(subscriber)
          if (current.size === 0) {
            this.runSubscribers.delete(runId)
          }
        }
      },
    })
  }

  private async executeRun(activeRun: ActiveRun, input: {
    text: string
    profile: import('@cradle/db').AgentProfile
    modelId?: string
    thinkingEffort?: 'low' | 'medium' | 'high'
    systemPrompt?: string
    history?: Array<{ role: 'user' | 'assistant', content: string }>
  }): Promise<void> {
    const diagnostics: TurnOutputDiagnostics = {
      emittedEventCount: 0,
      assistantBoundaryCount: 0,
      assistantTextCharCount: 0,
      reasoningTextCharCount: 0,
      toolEventCount: 0,
      commandEventCount: 0,
      commandOutputCharCount: 0,
      fileChangeEventCount: 0,
    }
    let failurePayload: SerializedChatError['payload'] | undefined
    let finalEvent: TimelineInputEvent = {
      type: 'run.completed',
      source: { backend: activeRun.runtimeSession.providerKind, eventType: 'chat.turn.completed' },
    }

    try {
      this.publish(this.persist(activeRun, {
        type: 'run.started',
        source: { backend: activeRun.runtimeSession.providerKind, eventType: 'chat.turn.started' },
      }))

      for await (const event of activeRun.provider!.streamTurn({
        runtimeSession: activeRun.runtimeSession,
        profile: input.profile,
        message: input.text,
        modelId: input.modelId,
        providerOptions: input.thinkingEffort ? { thinkingEffort: input.thinkingEffort } : undefined,
        systemPrompt: input.systemPrompt,
        history: input.history,
      })) {
        accumulateTurnOutputDiagnostics(diagnostics, event)
        this.publish(this.persist(activeRun, event))
      }

      finalEvent = resolveTerminalEventWithDiagnostics(finalEvent, activeRun.runtimeSession.providerKind, diagnostics)
    }
    catch (error) {
      if (isAbortError(error)) {
        finalEvent = {
          type: 'run.aborted',
          source: { backend: activeRun.runtimeSession.providerKind, eventType: 'chat.turn.aborted' },
        }
      }
      else {
        const serializedError = serializeChatError(error)
        failurePayload = serializedError.payload
        finalEvent = {
          type: 'run.failed',
          error: serializedError.text,
          source: { backend: activeRun.runtimeSession.providerKind, eventType: 'chat.turn.failed' },
        }
      }
    }

    const terminal = this.persist(activeRun, finalEvent)
    this.publish(terminal)

    if (terminal.event.type === 'run.failed') {
      const observabilityCode = resolveTurnFailureObservabilityCode(terminal.event)
      this.observability.record({
        source: 'chat-engine',
        code: observabilityCode,
        severity: 'error',
        category: 'chat',
        message: terminal.event.error,
        chatSessionId: activeRun.sessionId,
        runId: activeRun.runId,
        messageId: activeRun.messageId,
        dedupeKey: observabilityCode === OBSERVABILITY_CODES.chatEmptyOutputCompletion
          ? createDedupeKey({
              code: observabilityCode,
              chatSessionId: activeRun.sessionId,
              runId: null,
            })
          : undefined,
        attrs: {
          agentProfileId: activeRun.agentProfileId,
          providerKind: activeRun.runtimeSession.providerKind,
          providerSessionId: activeRun.runtimeSession.providerSessionId,
          diagnostics,
          ...(failurePayload ? { payload: failurePayload } : {}),
        },
      })
    }

    const usage = activeRun.provider?.lastUsage
    if (usage) {
      this.store.insertUsage({
        sessionId: activeRun.sessionId,
        messageId: activeRun.messageId,
        agentProfileId: activeRun.agentProfileId,
        modelId: activeRun.modelId,
        usage,
      })
    }

    this.activeRuns.delete(activeRun.runId)
    this.activeRunIdsBySession.delete(activeRun.sessionId)
  }

  private persist(activeRun: ActiveRun, event: TimelineInputEvent): { event: StoredTimelineEvent, terminal: boolean } {
    const terminal = event.type === 'run.completed' || event.type === 'run.aborted' || event.type === 'run.failed'
    const messageStatus = event.type === 'run.completed'
      ? 'complete'
      : event.type === 'run.aborted'
        ? 'aborted'
        : event.type === 'run.failed'
          ? 'failed'
          : 'streaming'

    const stopReason = event.type === 'run.completed'
      ? 'response.completed'
      : event.type === 'run.aborted'
        ? 'response.cancelled'
        : event.type === 'run.failed'
          ? 'response.failed'
          : null

    const terminalStatus = messageStatus === 'streaming' ? null : messageStatus

    const storedEvent = this.store.persistEvent({
      sessionId: activeRun.sessionId,
      runId: activeRun.runId,
      messageId: activeRun.messageId,
      event,
      messageStatus,
      errorText: event.type === 'run.failed' ? event.error : null,
      runCompletion: terminal && terminalStatus
        ? {
            status: terminalStatus,
            stopReason,
            errorText: event.type === 'run.failed' ? event.error : null,
          }
        : undefined,
    })

    return { event: storedEvent, terminal }
  }

  private publish(input: { event: StoredTimelineEvent, terminal: boolean }): void {
    const subscribers = this.runSubscribers.get(input.event.runId)
    if (!subscribers) {
      return
    }
    for (const subscriber of subscribers) {
      subscriber(input.event, input.terminal)
    }
    if (input.terminal) {
      this.runSubscribers.delete(input.event.runId)
    }
  }
}

function extractModelId(providerStateSnapshot: string | null): string | null {
  if (!providerStateSnapshot) {
    return null
  }
  try {
    const parsed = JSON.parse(providerStateSnapshot) as { models?: { currentModelId?: string } }
    return typeof parsed.models?.currentModelId === 'string' ? parsed.models.currentModelId : null
  }
  catch {
    return null
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'))
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
    case 'tool_call.started':
    case 'tool_call.completed':
      diagnostics.toolEventCount += 1
      break
    case 'command.started':
    case 'command.completed':
      diagnostics.commandEventCount += 1
      break
    case 'command.output.delta':
      diagnostics.commandEventCount += 1
      diagnostics.commandOutputCharCount += event.delta.length
      break
    case 'file_change.started':
    case 'file_change.completed':
      diagnostics.fileChangeEventCount += 1
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
  const hasCommandOutput = diagnostics.commandEventCount > 0 || diagnostics.commandOutputCharCount > 0
  const hasFileChangeOutput = diagnostics.fileChangeEventCount > 0

  if (hasTextOutput || hasToolOutput || hasCommandOutput || hasFileChangeOutput) {
    return { ok: true, errorText: null }
  }

  return {
    ok: false,
    errorText: `Provider finished without any assistant output events (events=${diagnostics.emittedEventCount}, assistant_boundaries=${diagnostics.assistantBoundaryCount}, assistant_text_chars=${diagnostics.assistantTextCharCount}, reasoning_chars=${diagnostics.reasoningTextCharCount}, tool_events=${diagnostics.toolEventCount}, command_events=${diagnostics.commandEventCount}, command_output_chars=${diagnostics.commandOutputCharCount}, file_change_events=${diagnostics.fileChangeEventCount})`,
  }
}

function buildEmptyOutputFailureEvent(
  originalEvent: Extract<TimelineInputEvent, { type: 'run.completed' }>,
  providerKind: ActiveRun['runtimeSession']['providerKind'],
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
  providerKind: ActiveRun['runtimeSession']['providerKind'],
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
