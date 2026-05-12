import { randomUUID } from 'node:crypto'

import type { AgentProfile, BackendRun, BackendSessionBinding, Message } from '@cradle/db'
import {
  agents,
  backendRuns,
  backendSessionBindings,
  backendTimelineEvents,
  messages,
  sessions,
  usageLogs,
  workspaces,
} from '@cradle/db'
import { and, desc, eq, inArray } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import { createDedupeKey, OBSERVABILITY_CODES } from '../observability/contract'
import * as Observability from '../observability/service'
import * as Profiles from '../profiles/service'
import type { ProviderKind } from '../providers/types'
import { getProviderRegistry } from './chat-runtime-provider-registry'
import type { ChatRuntimeProvider, RuntimeSession, TimelineInputEvent, TokenUsage } from './runtime-provider-types'
import type { StoredTimelineEvent } from './timeline-events'
import { decodeTimelineInputEvent, encodeTimelineInputEvent, TIMELINE_SCHEMA_VERSION } from './timeline-events'

// ── types ──

export type ChatMessageStatus = 'streaming' | 'complete' | 'aborted' | 'failed'

export interface ChatTimelineGroup {
  messageId: string
  role: 'user' | 'assistant'
  userText?: string
  status: ChatMessageStatus
  errorText?: string
  events: StoredTimelineEvent[]
}

interface SessionRunContext {
  session: import('@cradle/db').Session
  workspacePath: string
  profile: AgentProfile
}

interface ActiveRun {
  runId: string
  sessionId: string
  messageId: string
  agentProfileId: string
  provider: ChatRuntimeProvider
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

// ── in-memory run state ──

const activeRuns = new Map<string, ActiveRun>()
const activeRunIdsBySession = new Map<string, string>()
const runSubscribers = new Map<string, Set<RunSubscriber>>()

// ── store helpers (merged from chat-runtime.store.ts) ──

function nowUnix(): number {
  return Math.floor(Date.now() / 1000)
}

function getSessionRunContext(sessionId: string): SessionRunContext | null {
  const session = db().select().from(sessions).where(eq(sessions.id, sessionId)).get()
  if (!session) {
    return null
  }
  const workspace = db().select().from(workspaces).where(eq(workspaces.id, session.workspaceId)).get()
  const profile = Profiles.getProfile(session.agentProfileId)
  if (!workspace || !profile) {
    return null
  }
  return { session, workspacePath: workspace.path, profile }
}

function getBinding(sessionId: string): BackendSessionBinding | undefined {
  return db().select().from(backendSessionBindings).where(eq(backendSessionBindings.chatSessionId, sessionId)).get()
}

export function listChatSessionIdsByBackendSessionId(backendSessionId: string): string[] {
  return db()
    .select({ chatSessionId: backendSessionBindings.chatSessionId })
    .from(backendSessionBindings)
    .where(eq(backendSessionBindings.backendSessionId, backendSessionId))
    .all()
    .map(row => row.chatSessionId)
}

function attachBinding(input: {
  sessionId: string
  agentProfileId: string
  providerKind: ProviderKind
  runtimeSession: RuntimeSession
  requestedModelId: string | null
}): BackendSessionBinding {
  const now = nowUnix()
  const existing = getBinding(input.sessionId)

  if (existing) {
    db().update(backendSessionBindings).set({
        agentProfileId: input.agentProfileId,
        providerKind: input.providerKind,
        backendSessionId: input.runtimeSession.providerSessionId,
        backendStateSnapshot: input.runtimeSession.providerStateSnapshot,
        requestedModelId: input.requestedModelId,
        updatedAt: now,
      }).where(eq(backendSessionBindings.id, existing.id)).run()
    return db().select().from(backendSessionBindings).where(eq(backendSessionBindings.id, existing.id)).get()!
  }

  return db().insert(backendSessionBindings).values({
    id: randomUUID(),
    chatSessionId: input.sessionId,
    agentProfileId: input.agentProfileId,
    providerKind: input.providerKind,
    backendSessionId: input.runtimeSession.providerSessionId,
    backendStateSnapshot: input.runtimeSession.providerStateSnapshot,
    requestedModelId: input.requestedModelId,
    createdAt: now,
    updatedAt: now,
  }).returning().get()
}

function createDraftTurn(input: { sessionId: string, userText: string }): { userMessageId: string, assistantMessageId: string } {
  const userMessageId = randomUUID()
  const assistantMessageId = randomUUID()
  const now = nowUnix()

  db().transaction((tx) => {
    tx.insert(messages).values({
      id: userMessageId,
      sessionId: input.sessionId,
      role: 'user',
      status: 'complete',
      content: input.userText,
      createdAt: now,
      updatedAt: now,
    }).run()
    tx.insert(messages).values({
      id: assistantMessageId,
      sessionId: input.sessionId,
      role: 'assistant',
      status: 'streaming',
      content: '',
      createdAt: now,
      updatedAt: now,
    }).run()
    tx.update(sessions).set({ updatedAt: now }).where(eq(sessions.id, input.sessionId)).run()
  })

  return { userMessageId, assistantMessageId }
}

function startRun(input: { sessionId: string, messageId: string, origin: 'user' | 'issue-agent' | 'system' }): BackendRun {
  const binding = getBinding(input.sessionId)
  if (!binding) {
    throw new Error(`Backend binding not found for chat session: ${input.sessionId}`)
  }
  return db().insert(backendRuns).values({
    id: randomUUID(),
    bindingId: binding.id,
    chatSessionId: input.sessionId,
    messageId: input.messageId,
    origin: input.origin,
    status: 'streaming',
    stopReason: null,
    errorText: null,
    startedAt: nowUnix(),
    finishedAt: null,
  }).returning().get()
}

export function getRun(runId: string): BackendRun | undefined {
  return db().select().from(backendRuns).where(eq(backendRuns.id, runId)).get()
}

function persistEvent(input: {
  sessionId: string
  runId: string
  messageId: string
  event: TimelineInputEvent
  messageStatus: ChatMessageStatus
  errorText: string | null
  runCompletion?: {
    status: 'complete' | 'aborted' | 'failed'
    stopReason: string | null
    errorText: string | null
  }
}): StoredTimelineEvent {
  return db().transaction((tx) => {
    const now = nowUnix()
    const encoded = encodeTimelineInputEvent(input.event)
    const last = tx.select().from(backendTimelineEvents).where(eq(backendTimelineEvents.runId, input.runId)).orderBy(desc(backendTimelineEvents.sequenceNumber)).get()
    const sequenceNumber = (last?.sequenceNumber ?? -1) + 1

    const row = tx.insert(backendTimelineEvents)
      .values({
        id: randomUUID(),
        runId: input.runId,
        chatSessionId: input.sessionId,
        sequenceNumber,
        eventType: encoded.eventType,
        schemaVersion: TIMELINE_SCHEMA_VERSION,
        payloadJson: encoded.payloadJson,
        sourceJson: encoded.sourceJson,
        createdAt: now,
      })
      .returning()
      .get()

    const currentMessage = tx.select().from(messages).where(eq(messages.id, input.messageId)).get()
    const nextContent = input.event.type === 'assistant.text.delta'
      ? `${currentMessage?.content ?? ''}${input.event.delta}`
      : currentMessage?.content ?? ''

    tx.update(messages)
      .set({
        content: nextContent,
        status: input.messageStatus,
        errorText: input.errorText,
        updatedAt: now,
      })
      .where(and(eq(messages.id, input.messageId), eq(messages.sessionId, input.sessionId)))
      .run()

    tx.update(sessions)
      .set({ updatedAt: now })
      .where(eq(sessions.id, input.sessionId))
      .run()

    if (input.runCompletion) {
      tx.update(backendRuns)
        .set({
          status: input.runCompletion.status,
          stopReason: input.runCompletion.stopReason,
          errorText: input.runCompletion.errorText,
          finishedAt: now,
        })
        .where(eq(backendRuns.id, input.runId))
        .run()
    }

    return {
      id: row.id,
      runId: row.runId,
      chatSessionId: row.chatSessionId,
      sequenceNumber: row.sequenceNumber,
      schemaVersion: row.schemaVersion as typeof TIMELINE_SCHEMA_VERSION,
      createdAt: row.createdAt,
      ...decodeTimelineInputEvent({
        eventType: row.eventType,
        payloadJson: row.payloadJson,
        sourceJson: row.sourceJson,
      }),
    }
  })
}

function insertUsage(input: { sessionId: string, messageId: string, agentProfileId: string, modelId: string | null, usage: TokenUsage }): void {
  db().insert(usageLogs).values({
    id: randomUUID(),
    sessionId: input.sessionId,
    messageId: input.messageId,
    agentProfileId: input.agentProfileId,
    modelId: input.modelId,
    promptTokens: input.usage.promptTokens,
    completionTokens: input.usage.completionTokens,
    totalTokens: input.usage.totalTokens,
    createdAt: nowUnix(),
  }).run()
}

function listRunEvents(runId: string): StoredTimelineEvent[] {
  return db().select().from(backendTimelineEvents).where(eq(backendTimelineEvents.runId, runId)).orderBy(backendTimelineEvents.sequenceNumber).all().map(row => ({
    id: row.id,
    runId: row.runId,
    chatSessionId: row.chatSessionId,
    sequenceNumber: row.sequenceNumber,
    schemaVersion: row.schemaVersion as typeof TIMELINE_SCHEMA_VERSION,
    createdAt: row.createdAt,
    ...decodeTimelineInputEvent({
      eventType: row.eventType,
      payloadJson: row.payloadJson,
      sourceJson: row.sourceJson,
    }),
  }))
}

// ── turn context resolver (merged from chat-turn-context.ts) ──

interface ChatTurnContext {
  systemPrompt?: string
  history?: Array<{ role: 'user' | 'assistant', content: string }>
}

function resolveTurnContext(input: { sessionId: string, draftMessageId: string, draftUserMessageId: string }): ChatTurnContext {
  const session = db().select().from(sessions).where(eq(sessions.id, input.sessionId)).get()

  let systemPrompt: string | undefined
  if (session?.agentId) {
    const agent = db().select().from(agents).where(eq(agents.id, session.agentId)).get()
    systemPrompt = readAgentSystemPrompt(agent?.configJson)
  }

  const historyRows = db().select().from(messages).where(and(eq(messages.sessionId, input.sessionId), eq(messages.status, 'complete'))).orderBy(messages.createdAt).all().filter(row => row.id !== input.draftMessageId && row.id !== input.draftUserMessageId)

  const history = historyRows.map(row => ({
    role: row.role as 'user' | 'assistant',
    content: row.role === 'assistant' ? readAssistantText(row.id) : row.content,
  })).filter(item => item.content.length > 0)

  return {
    systemPrompt,
    history: history.length > 0 ? history : undefined,
  }
}

function readAssistantText(messageId: string): string {
  const run = db().select({ id: backendRuns.id }).from(backendRuns).where(eq(backendRuns.messageId, messageId)).orderBy(desc(backendRuns.startedAt)).get()
  if (!run) {
    return ''
  }
  const rows = db().select().from(backendTimelineEvents).where(eq(backendTimelineEvents.runId, run.id)).orderBy(backendTimelineEvents.sequenceNumber).all()
  return rows.map((row) => {
    const event = decodeTimelineInputEvent({ eventType: row.eventType, payloadJson: row.payloadJson, sourceJson: row.sourceJson })
    return event.type === 'assistant.text.delta' ? event.delta : ''
  }).join('')
}

function readAgentSystemPrompt(configJson: string | null | undefined): string | undefined {
  if (!configJson) {
    return undefined
  }
  try {
    const parsed = JSON.parse(configJson) as { systemPrompt?: unknown }
    return typeof parsed.systemPrompt === 'string' && parsed.systemPrompt.length > 0 ? parsed.systemPrompt : undefined
  }
  catch {
    return undefined
  }
}

// ── public service functions ──

export function getTimeline(sessionId: string): ChatTimelineGroup[] {
  const context = getSessionRunContext(sessionId)
  if (!context) {
    throw new AppError({ code: 'chat_session_not_found', status: 404, message: 'Chat session not found', details: { sessionId } })
  }

  const rows = db().select().from(messages).where(eq(messages.sessionId, sessionId)).orderBy(messages.createdAt).all()
  const assistantIds = rows.filter(row => row.role === 'assistant').map(row => row.id)
  const latestRunByMessageId = new Map<string, BackendRun>()

  if (assistantIds.length > 0) {
    const runs = db().select().from(backendRuns).where(inArray(backendRuns.messageId, assistantIds)).orderBy(desc(backendRuns.startedAt)).all()
    for (const run of runs) {
      if (!run.messageId || latestRunByMessageId.has(run.messageId)) {
        continue
      }
      latestRunByMessageId.set(run.messageId, run)
    }
  }

  const runIds = [...new Set(Array.from(latestRunByMessageId.values(), run => run.id))]
  const eventsByRunId = new Map<string, StoredTimelineEvent[]>()

  if (runIds.length > 0) {
    const eventRows = db().select().from(backendTimelineEvents).where(inArray(backendTimelineEvents.runId, runIds)).orderBy(backendTimelineEvents.runId, backendTimelineEvents.sequenceNumber).all()
    for (const row of eventRows) {
      const bucket = eventsByRunId.get(row.runId) ?? []
      bucket.push({
        id: row.id,
        runId: row.runId,
        chatSessionId: row.chatSessionId,
        sequenceNumber: row.sequenceNumber,
        schemaVersion: row.schemaVersion as typeof TIMELINE_SCHEMA_VERSION,
        createdAt: row.createdAt,
        ...decodeTimelineInputEvent({
          eventType: row.eventType,
          payloadJson: row.payloadJson,
          sourceJson: row.sourceJson,
        }),
      })
      eventsByRunId.set(row.runId, bucket)
    }
  }

  return rows.map((row) => {
    if (row.role === 'user') {
      return {
        messageId: row.id,
        role: 'user' as const,
        userText: row.content,
        status: row.status as ChatMessageStatus,
        errorText: row.errorText ?? undefined,
        events: [],
      }
    }
    const runId = latestRunByMessageId.get(row.id)?.id
    return {
      messageId: row.id,
      role: 'assistant' as const,
      status: row.status as ChatMessageStatus,
      errorText: row.errorText ?? undefined,
      events: runId ? eventsByRunId.get(runId) ?? [] : [],
    }
  })
}

export async function createRun(input: { sessionId: string, text: string, modelId?: string, thinkingEffort?: 'low' | 'medium' | 'high' }) {
  if (activeRunIdsBySession.has(input.sessionId)) {
    throw new AppError({ code: 'chat_run_in_progress', status: 409, message: 'Chat session already has an active run', details: { sessionId: input.sessionId } })
  }

  const context = getSessionRunContext(input.sessionId)
  if (!context) {
    throw new AppError({ code: 'chat_session_not_found', status: 404, message: 'Chat session not found', details: { sessionId: input.sessionId } })
  }
  if (!context.profile.enabled) {
    throw new AppError({ code: 'chat_profile_not_available', status: 409, message: 'Agent profile is disabled', details: { profileId: context.profile.id } })
  }

  const registry = getProviderRegistry()
  const provider = registry.get(context.profile.providerKind)
  if (!provider) {
    throw new AppError({ code: 'chat_provider_not_available', status: 501, message: `Provider is not available: ${context.profile.providerKind}` })
  }

  const binding = getBinding(input.sessionId)
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

  attachBinding({
    sessionId: input.sessionId,
    agentProfileId: context.profile.id,
    providerKind: runtimeSession.providerKind,
    runtimeSession,
    requestedModelId: input.modelId ?? extractModelId(runtimeSession.providerStateSnapshot),
  })

  const draft = createDraftTurn({ sessionId: input.sessionId, userText: input.text })
  const run = startRun({ sessionId: input.sessionId, messageId: draft.assistantMessageId, origin: 'user' })
  const activeRun: ActiveRun = {
    runId: run.id,
    sessionId: input.sessionId,
    messageId: draft.assistantMessageId,
    agentProfileId: context.profile.id,
    provider,
    runtimeSession,
    modelId: input.modelId ?? extractModelId(runtimeSession.providerStateSnapshot),
  }
  activeRuns.set(run.id, activeRun)
  activeRunIdsBySession.set(input.sessionId, run.id)

  const turnContext = resolveTurnContext({
    sessionId: input.sessionId,
    draftMessageId: draft.assistantMessageId,
    draftUserMessageId: draft.userMessageId,
  })

  void executeRun(activeRun, {
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

export async function abortRun(runId: string): Promise<void> {
  const active = activeRuns.get(runId)
  if (!active) {
    if (!getRun(runId)) {
      throw new AppError({ code: 'chat_run_not_found', status: 404, message: 'Chat run not found', details: { runId } })
    }
    return
  }

  const context = getSessionRunContext(active.sessionId)
  if (!context) {
    throw new AppError({ code: 'chat_session_not_found', status: 404, message: 'Chat session not found', details: { sessionId: active.sessionId } })
  }

  await active.provider?.cancelTurn({ runtimeSession: active.runtimeSession, profile: context.profile })
}

export async function abortAllRuns(): Promise<void> {
  const runIds = [...activeRuns.keys()]
  for (const runId of runIds) {
    try {
      const active = activeRuns.get(runId)
      if (active) {
        await active.provider?.cancelTurn({ runtimeSession: active.runtimeSession, profile: {} as AgentProfile })
      }
    }
    catch { /* best-effort */ }
  }
  activeRuns.clear()
  activeRunIdsBySession.clear()
}

export function openRunStream(runId: string): ReadableStream<Uint8Array> {
  const run = getRun(runId)
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

      for (const event of listRunEvents(runId)) {
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

      const subscribers = runSubscribers.get(runId) ?? new Set<RunSubscriber>()
      const subscriber: RunSubscriber = (event, terminal) => writeEvent(event, terminal)
      subscribers.add(subscriber)
      runSubscribers.set(runId, subscribers)

      unsubscribe = () => {
        const current = runSubscribers.get(runId)
        if (!current) {
          return
        }
        current.delete(subscriber)
        if (current.size === 0) {
          runSubscribers.delete(runId)
        }
      }
    },
  })
}

export function getMessages(sessionId: string): Message[] {
  return db().select().from(messages).where(eq(messages.sessionId, sessionId)).orderBy(messages.createdAt).all()
}

// ── run execution (private) ──

async function executeRun(activeRun: ActiveRun, input: {
  text: string
  profile: AgentProfile
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
    publish(persist(activeRun, {
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
      publish(persist(activeRun, event))
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

  try {
    const terminal = persist(activeRun, finalEvent)
    publish(terminal)

    if (terminal.event.type === 'run.failed') {
      const observabilityCode = resolveTurnFailureObservabilityCode(terminal.event)
      Observability.record({
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
      insertUsage({
        sessionId: activeRun.sessionId,
        messageId: activeRun.messageId,
        agentProfileId: activeRun.agentProfileId,
        modelId: activeRun.modelId,
        usage,
      })
    }
  }
  catch (error) {
    console.error('[chat-runtime] failed to persist run finalization (session may have been deleted):', error)
  }
  finally {
    // Persist updated providerSessionId/state obtained during the run
    try {
      attachBinding({
        sessionId: activeRun.sessionId,
        agentProfileId: activeRun.agentProfileId,
        providerKind: activeRun.runtimeSession.providerKind,
        runtimeSession: activeRun.runtimeSession,
        requestedModelId: activeRun.modelId,
      })
    }
    catch {
      // session may have been deleted during the run
    }
    activeRuns.delete(activeRun.runId)
    activeRunIdsBySession.delete(activeRun.sessionId)
  }
}

function persist(activeRun: ActiveRun, event: TimelineInputEvent): { event: StoredTimelineEvent, terminal: boolean } {
  const terminal = event.type === 'run.completed' || event.type === 'run.aborted' || event.type === 'run.failed'
  const messageStatus: ChatMessageStatus = event.type === 'run.completed'
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

  const storedEvent = persistEvent({
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

function publish(input: { event: StoredTimelineEvent, terminal: boolean }): void {
  const subscribers = runSubscribers.get(input.event.runId)
  if (!subscribers) {
    return
  }
  for (const subscriber of subscribers) {
    subscriber(input.event, input.terminal)
  }
  if (input.terminal) {
    runSubscribers.delete(input.event.runId)
  }
}

// ── helpers ──

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

function accumulateTurnOutputDiagnostics(diagnostics: TurnOutputDiagnostics, event: TimelineInputEvent): void {
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

function resolveTerminalEventWithDiagnostics(
  event: TimelineInputEvent,
  providerKind: ProviderKind,
  diagnostics: TurnOutputDiagnostics,
): TimelineInputEvent {
  if (event.type !== 'run.completed') {
    return event
  }

  const validation = validateTurnOutput(diagnostics)
  if (validation.ok) {
    return event
  }

  const errorText = validation.errorText ?? 'Provider finished without assistant output events'
  return {
    type: 'run.failed',
    error: errorText,
    source: {
      backend: providerKind,
      eventType: 'chat.turn.failed.empty-output',
      metadata: { terminalEventType: event.type, diagnostics },
    },
  }
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
  const errorCode = metadata && typeof metadata.errorCode === 'string' ? metadata.errorCode : null
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
