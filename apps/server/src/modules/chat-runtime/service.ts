import { randomUUID } from 'node:crypto'

import type { AgentProfile, BackendRun, BackendSessionBinding, Message } from '@cradle/db'
import {
  agents,
  backendRuns,
  backendSessionBindings,
  messages,
  sessions,
  stepUsage as stepUsageTable,
  usageLogs,
  workspaces,
} from '@cradle/db'
import type { UIMessage, UIMessageChunk } from 'ai'
import { and, eq, isNull, or } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { AgentRuntimeConfigJsonSchema } from '../../helpers/agent-runtime-config'
import { getSystemWorkflow } from '../../helpers/system-workflow'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import { createChildLogger } from '../../logging/logger'
import { createDedupeKey, OBSERVABILITY_CODES } from '../observability/contract'
import * as Observability from '../observability/service'
import * as Profiles from '../profiles/service'
import type { RuntimeKind } from '../providers/types'
import { estimateCost } from '../usage/pricing'
import { getRuntimeRegistry } from './chat-runtime-provider-registry'
import type { ChatStreamEvent, MessageProjection, ProjectionApplyResult, SubagentMessageContext } from './delta-events'
import {
  applyChunkToProjection,
  applySnapshotToProjection,
  createAssistantMessage,
  createMessageProjection,
  createUserMessage,
  extractMessageText,
  parseMessageJson,
  readChunkRouteContext,
} from './delta-events'
import { ProviderStateSnapshotJsonSchema } from './providers/provider-state-snapshot'
import type { ChatRuntime, ChatRuntimeCapabilities, RuntimeSession, TokenUsage } from './runtime-provider-types'

const chatLogger = createChildLogger({ module: 'chat-runtime' })

// ── types ──

export type ChatMessageStatus = 'streaming' | 'complete' | 'aborted' | 'failed'
type TerminalChatMessageStatus = Exclude<ChatMessageStatus, 'streaming'>

export interface ChatMessageSnapshotRow {
  messageId: string
  role: 'user' | 'assistant'
  status: ChatMessageStatus
  errorText?: string
  content: string
  message: Omit<UIMessage, 'role'> & { role: 'user' | 'assistant' }
  parentMessageId: string | null
  parentToolCallId: string | null
  taskId: string | null
  depth: number
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
  runtime: ChatRuntime
  runtimeSession: RuntimeSession
  modelId: string | null
  mainProjection: MessageProjection
  subagentProjections: Map<string, SubagentProjectionRecord>
  nextSeq: number
  eventBuffer: ChatStreamEvent[]
  terminalStatus?: TerminalChatMessageStatus
  cancelRequested?: boolean
}

export interface ActiveRunSummary {
  runId: string
  sessionId: string
  messageId: string
  agentProfileId: string
  modelId: string | null
}

interface SubagentProjectionRecord {
  context: SubagentMessageContext
  projection: MessageProjection
}

type RunSubscriber = (event: ChatStreamEvent, terminal: boolean) => void

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
const pendingRunSessionIds = new Set<string>()
const runSubscribers = new Map<string, Set<RunSubscriber>>()

// ── store helpers (merged from chat-runtime.store.ts) ──

function getSessionRunContext(sessionId: string): SessionRunContext | null {
  const session = db().select().from(sessions).where(eq(sessions.id, sessionId)).get()
  if (!session) {
    return null
  }
  if (!session.agentProfileId) {
    return null
  }
  const workspace = session.workspaceId
    ? db().select().from(workspaces).where(eq(workspaces.id, session.workspaceId)).get()
    : null
  const profile = Profiles.getProfile(session.agentProfileId)
  if (!profile) {
    return null
  }
  if (session.workspaceId && !workspace) {
    return null
  }

  const profileConfig = readJsonObject(profile.configJson)
  const agent = session.agentId
    ? db().select().from(agents).where(eq(agents.id, session.agentId)).get()
    : null
  const agentConfig = readJsonObject(agent?.configJson)
  const sessionConfig = readJsonObject(session.configJson)
  const effectiveProfile = {
    ...profile,
    configJson: JSON.stringify({ ...profileConfig, ...agentConfig, ...sessionConfig }),
  }

  return { session, workspacePath: workspace?.path ?? '', profile: effectiveProfile }
}

function readJsonObject(json: string | null | undefined): Record<string, unknown> {
  if (!json || json === '{}') {
    return {}
  }
  try {
    const parsed = JSON.parse(json) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  }
  catch {
    return {}
  }
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
  runtimeKind: RuntimeKind
  runtimeSession: RuntimeSession
  requestedModelId: string | null
}): BackendSessionBinding {
  const now = currentUnixSeconds()
  const existing = getBinding(input.sessionId)

  if (existing) {
    db().update(backendSessionBindings).set({
        agentProfileId: input.agentProfileId,
        runtimeKind: input.runtimeKind,
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
    runtimeKind: input.runtimeKind,
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
  const now = currentUnixSeconds()
  const userMessage = createUserMessage(userMessageId, input.userText)
  const assistantMessage = createAssistantMessage(assistantMessageId)

  db().transaction((tx) => {
    tx.insert(messages).values({
      id: userMessageId,
      sessionId: input.sessionId,
      parentMessageId: null,
      parentToolCallId: null,
      taskId: null,
      depth: 0,
      role: 'user',
      status: 'complete',
      content: input.userText,
      messageJson: JSON.stringify(userMessage),
      createdAt: now,
      updatedAt: now,
    }).run()
    tx.insert(messages).values({
      id: assistantMessageId,
      sessionId: input.sessionId,
      parentMessageId: null,
      parentToolCallId: null,
      taskId: null,
      depth: 0,
      role: 'assistant',
      status: 'streaming',
      content: '',
      messageJson: JSON.stringify(assistantMessage),
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
    startedAt: currentUnixSeconds(),
    finishedAt: null,
  }).returning().get()
}

export function getRun(runId: string): BackendRun | undefined {
  return db().select().from(backendRuns).where(eq(backendRuns.id, runId)).get()
}

export function listActiveRunSummaries(): ActiveRunSummary[] {
  return [...activeRuns.values()].map(run => ({
    runId: run.runId,
    sessionId: run.sessionId,
    messageId: run.messageId,
    agentProfileId: run.agentProfileId,
    modelId: run.modelId,
  }))
}

function persistMessageSnapshot(input: {
  sessionId: string
  messageId: string
  message: UIMessage
  messageStatus: ChatMessageStatus
  errorText: string | null
}): void {
  const now = currentUnixSeconds()
  db().transaction((tx) => {
    tx.update(messages)
      .set({
        content: extractMessageText(input.message),
        messageJson: JSON.stringify(input.message),
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
    createdAt: currentUnixSeconds(),
  }).run()
}

// ── turn context resolver (merged from chat-turn-context.ts) ──

interface ChatTurnContext {
  systemPrompt?: string
  history?: Array<{ role: 'user' | 'assistant', content: string }>
}

function resolveSessionSystemPrompt(session: import('@cradle/db').Session | null | undefined): string | undefined {
  let systemPrompt: string | undefined
  if (session?.agentId) {
    const agent = db().select().from(agents).where(eq(agents.id, session.agentId)).get()
    systemPrompt = AgentRuntimeConfigJsonSchema.parse(agent?.configJson).systemPrompt
  }

  // Inject system workflow as base context for all agents
  const workflow = getSystemWorkflow()
  if (workflow) {
    systemPrompt = systemPrompt
      ? `${workflow}\n\n---\n\n${systemPrompt}`
      : workflow
  }

  return systemPrompt
}

function resolveTurnContext(input: { sessionId: string, draftMessageId: string, draftUserMessageId: string }): ChatTurnContext {
  const session = db().select().from(sessions).where(eq(sessions.id, input.sessionId)).get()

  const systemPrompt = resolveSessionSystemPrompt(session)

  const historyRows = db()
    .select()
    .from(messages)
    .where(and(eq(messages.sessionId, input.sessionId), eq(messages.status, 'complete'), isNull(messages.parentToolCallId)))
    .orderBy(messages.createdAt)
    .all()
    .filter(row => row.id !== input.draftMessageId && row.id !== input.draftUserMessageId)

  const history = historyRows.map(row => ({
    role: row.role as 'user' | 'assistant',
    content: row.content,
  })).filter(item => item.content.length > 0)

  return {
    systemPrompt,
    history: history.length > 0 ? history : undefined,
  }
}

// ── public service functions ──

export function getMessageGroups(sessionId: string): ChatMessageSnapshotRow[] {
  const context = getSessionRunContext(sessionId)
  if (!context) {
    throw new AppError({ code: 'chat_session_not_found', status: 404, message: 'Chat session not found', details: { sessionId } })
  }

  const rows = db()
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt)
    .all()

  return rows.map((row) => {
    const role = row.role as 'user' | 'assistant'
    return {
      messageId: row.id,
      role,
      status: row.status as ChatMessageStatus,
      errorText: row.errorText ?? undefined,
      content: row.content,
      message: parseMessageJson(row.id, role, row.messageJson) as ChatMessageSnapshotRow['message'],
      parentMessageId: row.parentMessageId,
      parentToolCallId: row.parentToolCallId,
      taskId: row.taskId,
      depth: row.depth,
    }
  })
}

export async function getCapabilities(sessionId: string): Promise<ChatRuntimeCapabilities> {
  const context = getSessionRunContext(sessionId)
  if (!context) {
    throw new AppError({ code: 'chat_session_not_found', status: 404, message: 'Chat session not found', details: { sessionId } })
  }

  const registry = getRuntimeRegistry()
  const runtimeKind = context.session.runtimeKind ?? 'standard'
  const runtime = registry.get(runtimeKind)
  if (!runtime) {
    throw new AppError({ code: 'chat_runtime_not_available', status: 501, message: `Runtime is not available: ${runtimeKind}` })
  }

  if (!runtime.getCapabilities) {
    return { runtimeKind, slashCommands: [], skills: [] }
  }

  const binding = getBinding(sessionId)
  const runtimeSession = binding
    ? await runtime.resumeChatSession({
        runtimeSession: {
          id: sessionId,
          chatSessionId: sessionId,
          agentProfileId: context.profile.id,
          runtimeKind,
          providerSessionId: binding.backendSessionId,
          providerStateSnapshot: binding.backendStateSnapshot,
        },
        profile: context.profile,
        workspacePath: context.workspacePath,
        modelId: ProviderStateSnapshotJsonSchema.parse(binding.backendStateSnapshot).models.currentModelId ?? undefined,
      })
    : await runtime.startChatSession({
        chatSessionId: sessionId,
        profile: context.profile,
        workspacePath: context.workspacePath,
      })

  return runtime.getCapabilities({
    runtimeSession,
    profile: context.profile,
    workspaceId: context.session.workspaceId,
    workspacePath: context.workspacePath,
    modelId: ProviderStateSnapshotJsonSchema.parse(runtimeSession.providerStateSnapshot).models.currentModelId ?? undefined,
    systemPrompt: resolveSessionSystemPrompt(context.session),
  })
}

export async function createRun(input: { sessionId: string, text: string, modelId?: string, thinkingEffort?: 'low' | 'medium' | 'high' }) {
  if (activeRunIdsBySession.has(input.sessionId) || pendingRunSessionIds.has(input.sessionId)) {
    throw new AppError({ code: 'chat_run_in_progress', status: 409, message: 'Chat session already has an active run', details: { sessionId: input.sessionId } })
  }
  pendingRunSessionIds.add(input.sessionId)

  try {
    const context = getSessionRunContext(input.sessionId)
    if (!context) {
      throw new AppError({ code: 'chat_session_not_found', status: 404, message: 'Chat session not found', details: { sessionId: input.sessionId } })
    }
    if (!context.profile.enabled) {
      throw new AppError({ code: 'chat_profile_not_available', status: 409, message: 'Agent profile is disabled', details: { profileId: context.profile.id } })
    }

    const registry = getRuntimeRegistry()
    const runtimeKind = context.session.runtimeKind ?? 'standard'
    const runtime = registry.get(runtimeKind)
    if (!runtime) {
      throw new AppError({ code: 'chat_runtime_not_available', status: 501, message: `Runtime is not available: ${runtimeKind}` })
    }

    const binding = getBinding(input.sessionId)
    const runtimeSession = binding
      ? await runtime.resumeChatSession({
          runtimeSession: {
            id: input.sessionId,
            chatSessionId: input.sessionId,
            agentProfileId: context.profile.id,
            runtimeKind,
            providerSessionId: binding.backendSessionId,
            providerStateSnapshot: binding.backendStateSnapshot,
          },
          profile: context.profile,
          workspacePath: context.workspacePath,
          modelId: input.modelId,
        })
      : await runtime.startChatSession({
          chatSessionId: input.sessionId,
          profile: context.profile,
          workspacePath: context.workspacePath,
          modelId: input.modelId,
        })

    attachBinding({
      sessionId: input.sessionId,
      agentProfileId: context.profile.id,
      runtimeKind: runtimeSession.runtimeKind,
      runtimeSession,
      requestedModelId: input.modelId ?? ProviderStateSnapshotJsonSchema.parse(runtimeSession.providerStateSnapshot).models.currentModelId,
    })

    const draft = createDraftTurn({ sessionId: input.sessionId, userText: input.text })
    const run = startRun({ sessionId: input.sessionId, messageId: draft.assistantMessageId, origin: 'user' })
    const activeRun: ActiveRun = {
      runId: run.id,
      sessionId: input.sessionId,
      messageId: draft.assistantMessageId,
      agentProfileId: context.profile.id,
      runtime,
      runtimeSession,
      modelId: input.modelId ?? ProviderStateSnapshotJsonSchema.parse(runtimeSession.providerStateSnapshot).models.currentModelId,
      mainProjection: createMessageProjection(createAssistantMessage(draft.assistantMessageId)),
      subagentProjections: new Map(),
      nextSeq: 0,
      eventBuffer: [],
    }
    activeRuns.set(run.id, activeRun)
    activeRunIdsBySession.set(input.sessionId, run.id)
    pendingRunSessionIds.delete(input.sessionId)

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
      workspaceId: context.session.workspaceId,
      workspacePath: context.workspacePath,
    })

    return {
      runId: run.id,
      assistantMessageId: draft.assistantMessageId,
      userMessageId: draft.userMessageId,
    }
  }
  catch (error) {
    pendingRunSessionIds.delete(input.sessionId)
    throw error
  }
}

/**
 * Single endpoint: create run + return SSE stream.
 * POST /chat/sessions/:sessionId/response → SSE
 */
export async function streamResponse(input: {
  sessionId: string
  text: string
  modelId?: string
  thinkingEffort?: 'low' | 'medium' | 'high'
}): Promise<ReadableStream<Uint8Array>> {
  const result = await createRun(input)
  return openRunStream(result.runId)
}

export async function abortRun(runId: string): Promise<void> {
  const active = activeRuns.get(runId)
  if (!active) {
    const persistedRun = getRun(runId)
    if (!persistedRun) {
      throw new AppError({ code: 'chat_run_not_found', status: 404, message: 'Chat run not found', details: { runId } })
    }
    abortPersistedRun(persistedRun)
    return
  }

  settleActiveRun(active, 'aborted', null)
  try {
    await requestRuntimeCancel(active)
  }
  finally {
    releaseActiveRun(active)
  }
}

/**
 * Cancel the active run for a session (if any).
 * POST /chat/sessions/:sessionId/cancel
 */
export async function cancelSession(sessionId: string): Promise<void> {
  const runId = activeRunIdsBySession.get(sessionId)
  if (!runId) {
    abortPersistedStreamingSession(sessionId)
    return
  }
  await abortRun(runId)
}

export async function abortAllRuns(): Promise<void> {
  const runIds = [...activeRuns.keys()]
  for (const runId of runIds) {
    try {
      const active = activeRuns.get(runId)
      if (active) {
        settleActiveRun(active, 'aborted', null)
        try {
          await requestRuntimeCancel(active)
        }
        finally {
          releaseActiveRun(active)
        }
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
  const active = activeRuns.get(runId)

  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start: (controller) => {
      let unsubscribe = () => {}

      const writeEvent = (event: ChatStreamEvent, terminal: boolean) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        if (terminal) {
          unsubscribe()
          controller.close()
        }
      }

      for (const event of active?.eventBuffer ?? []) {
        const terminal = isTerminalStreamEvent(event)
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

export function waitForRunCompletion(runId: string): Promise<BackendRun> {
  const run = getRun(runId)
  if (!run) {
    throw new AppError({ code: 'chat_run_not_found', status: 404, message: 'Chat run not found', details: { runId } })
  }
  if (run.status !== 'streaming') {
    return Promise.resolve(run)
  }

  return new Promise((resolve) => {
    const subscribers = runSubscribers.get(runId) ?? new Set<RunSubscriber>()
    const subscriber: RunSubscriber = (_event, terminal) => {
      if (!terminal) {
        return
      }
      const current = runSubscribers.get(runId)
      current?.delete(subscriber)
      if (current?.size === 0) {
        runSubscribers.delete(runId)
      }
      resolve(getRun(runId) ?? run)
    }
    subscribers.add(subscriber)
    runSubscribers.set(runId, subscribers)

    const latest = getRun(runId)
    if (latest && latest.status !== 'streaming') {
      const current = runSubscribers.get(runId)
      current?.delete(subscriber)
      if (current?.size === 0) {
        runSubscribers.delete(runId)
      }
      resolve(latest)
    }
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
  workspaceId?: string | null
  workspacePath?: string
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
  let finalChunk: UIMessageChunk = { type: 'finish', finishReason: 'stop' }
  let streamEmittedError = false
  let snapshotTerminal: { status: ChatMessageStatus, errorText: string | null } | null = null
  const usesSnapshotStream = typeof activeRun.runtime.streamTurnSnapshots === 'function'
  let actualModelId = activeRun.modelId

  try {
    if (usesSnapshotStream) {
      for await (const message of activeRun.runtime.streamTurnSnapshots!({
        runtimeSession: activeRun.runtimeSession,
        profile: input.profile,
        message: input.text,
        responseMessageId: activeRun.messageId,
        modelId: input.modelId,
        workspaceId: input.workspaceId,
        workspacePath: input.workspacePath,
        providerOptions: input.thinkingEffort ? { thinkingEffort: input.thinkingEffort } : undefined,
        systemPrompt: input.systemPrompt,
        history: input.history,
      })) {
        if (activeRun.terminalStatus) {
          break
        }
        const applied = applyAndPublishSnapshot(activeRun, message)
        accumulateDeltaDiagnostics(diagnostics, applied.deltas)
      }

      if (!activeRun.terminalStatus) {
        const validation = validateTurnOutput(diagnostics)
        snapshotTerminal = validation.ok
          ? { status: 'complete', errorText: null }
          : { status: 'failed', errorText: validation.errorText }
      }
    }
    else {
      applyAndPublishChunk(activeRun, { type: 'start' })

      for await (const chunk of activeRun.runtime.streamTurn({
        runtimeSession: activeRun.runtimeSession,
        profile: input.profile,
        message: input.text,
        responseMessageId: activeRun.messageId,
        modelId: input.modelId,
        workspaceId: input.workspaceId,
        workspacePath: input.workspacePath,
        providerOptions: input.thinkingEffort ? { thinkingEffort: input.thinkingEffort } : undefined,
        systemPrompt: input.systemPrompt,
        history: input.history,
      })) {
        if (activeRun.terminalStatus) {
          break
        }
        accumulateDiagnostics(diagnostics, chunk)
        applyAndPublishChunk(activeRun, chunk)
        if (chunk.type === 'error') {
          streamEmittedError = true
          finalChunk = chunk
        }
      }

      if (!streamEmittedError) {
        finalChunk = resolveTerminalChunkWithDiagnostics(finalChunk, diagnostics)
      }
    }
  }
  catch (error) {
    if (isAbortError(error)) {
      snapshotTerminal = { status: 'aborted', errorText: null }
      finalChunk = { type: 'abort', reason: 'user' }
    }
    else {
      const serializedError = serializeChatError(error)
      failurePayload = serializedError.payload
      snapshotTerminal = { status: 'failed', errorText: serializedError.text }
      finalChunk = { type: 'error', errorText: serializedError.text }
    }
  }

  try {
    if (!activeRun.cancelRequested) {
      if (usesSnapshotStream) {
        applyAndPublishTerminalState(
          activeRun,
          snapshotTerminal?.status ?? 'complete',
          snapshotTerminal?.errorText ?? null,
        )
      }
      else if (!streamEmittedError) {
        applyAndPublishChunk(activeRun, finalChunk)
      }

      const finalFailureText = usesSnapshotStream
        ? snapshotTerminal?.status === 'failed'
          ? snapshotTerminal.errorText ?? 'Chat run failed'
          : null
        : finalChunk.type === 'error'
          ? finalChunk.errorText
          : null

      if (finalFailureText) {
        const observabilityCode = usesSnapshotStream
          ? resolveSnapshotFailureObservabilityCode(finalFailureText)
          : resolveTurnFailureObservabilityCode(finalChunk)
        Observability.record({
          source: 'chat-engine',
          code: observabilityCode,
          severity: 'error',
          category: 'chat',
          message: finalFailureText,
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
            runtimeKind: activeRun.runtimeSession.runtimeKind,
            providerSessionId: activeRun.runtimeSession.providerSessionId,
            diagnostics,
            ...(failurePayload ? { payload: failurePayload } : {}),
          },
        })
      }

      const usage = activeRun.runtime?.lastUsage
      actualModelId = activeRun.runtime?.lastModelId ?? activeRun.modelId
      if (usage) {
        insertUsage({
          sessionId: activeRun.sessionId,
          messageId: activeRun.messageId,
          agentProfileId: activeRun.agentProfileId,
          modelId: actualModelId,
          usage,
        })
      }

      // Write per-step usage if the runtime supports it
      const runtimeWithSteps = activeRun.runtime as { lastStepUsages?: Array<{ stepNumber: number, stepType: string, modelId?: string, usage: TokenUsage }> }
      const steps = runtimeWithSteps.lastStepUsages ?? []
      if (steps.length > 0) {
        const fallbackModelId = actualModelId ?? 'gpt-4o'
        for (const step of steps) {
          const effectiveModelId = step.modelId ?? fallbackModelId
          db().insert(stepUsageTable).values({
            id: randomUUID(),
            runId: activeRun.runId,
            sessionId: activeRun.sessionId,
            stepNumber: step.stepNumber,
            stepType: step.stepType,
            modelId: effectiveModelId,
            promptTokens: step.usage.promptTokens,
            completionTokens: step.usage.completionTokens,
            totalTokens: step.usage.totalTokens,
            estimatedCostUsd: estimateCost(effectiveModelId, step.usage),
            createdAt: currentUnixSeconds(),
          }).run()
        }
      }
    }
  }
  catch (error) {
    chatLogger.error('failed to persist run finalization (session may have been deleted)', { error })
  }
  finally {
    // Persist updated providerSessionId/state obtained during the run
    try {
      attachBinding({
        sessionId: activeRun.sessionId,
        agentProfileId: activeRun.agentProfileId,
        runtimeKind: activeRun.runtimeSession.runtimeKind,
        runtimeSession: activeRun.runtimeSession,
        requestedModelId: actualModelId,
      })
    }
    catch {
      // session may have been deleted during the run
    }
    releaseActiveRun(activeRun)
  }
}

function applyAndPublishChunk(activeRun: ActiveRun, chunk: UIMessageChunk): void {
  if (activeRun.terminalStatus) {
    return
  }

  const route = readChunkRouteContext(chunk)
  const target = route.parentToolCallId
    ? getSubagentProjection(activeRun, route.parentToolCallId, route.taskId)
    : { projection: activeRun.mainProjection, context: null }

  const applied = applyChunkToProjection(target.projection, chunk, activeRun.nextSeq)
  activeRun.nextSeq = applied.nextSeq

  persistMessageSnapshot({
    sessionId: activeRun.sessionId,
    messageId: target.projection.message.id,
    message: target.projection.message,
    messageStatus: applied.status,
    errorText: applied.errorText,
  })

  if (applied.deltas.length > 0) {
    publishStreamEvent(
      activeRun,
      target.context
        ? { type: 'subagent_message_delta', data: { context: target.context, deltas: applied.deltas } }
        : { type: 'message_delta', data: { messageId: activeRun.messageId, deltas: applied.deltas } },
      false,
    )
  }

  if (applied.terminal) {
    applyAndPublishTerminalState(activeRun, applied.status, applied.errorText, false)
  }
}

function applyAndPublishSnapshot(activeRun: ActiveRun, message: UIMessage): ProjectionApplyResult {
  if (activeRun.terminalStatus) {
    return {
      deltas: [],
      nextSeq: activeRun.nextSeq,
      terminal: false,
      status: 'streaming',
      errorText: null,
    }
  }

  const applied = applySnapshotToProjection(activeRun.mainProjection, message, activeRun.nextSeq)
  activeRun.nextSeq = applied.nextSeq

  persistMessageSnapshot({
    sessionId: activeRun.sessionId,
    messageId: activeRun.mainProjection.message.id,
    message: activeRun.mainProjection.message,
    messageStatus: applied.status,
    errorText: applied.errorText,
  })

  if (applied.deltas.length > 0) {
    publishStreamEvent(activeRun, {
      type: 'message_delta',
      data: { messageId: activeRun.messageId, deltas: applied.deltas },
    }, false)
  }

  return applied
}

function applyAndPublishTerminalState(
  activeRun: ActiveRun,
  status: ChatMessageStatus,
  errorText: string | null,
  persistMainSnapshot = true,
): void {
  if (status === 'streaming' || activeRun.terminalStatus) {
    return
  }

  activeRun.terminalStatus = status

  if (persistMainSnapshot) {
    persistMessageSnapshot({
      sessionId: activeRun.sessionId,
      messageId: activeRun.mainProjection.message.id,
      message: activeRun.mainProjection.message,
      messageStatus: status,
      errorText,
    })
  }

  finalizeRun(activeRun, status, errorText)
  finalizeSubagentSnapshots(activeRun, status, errorText)

  const event: ChatStreamEvent = status === 'complete'
    ? { type: 'run_completed', data: { messageId: activeRun.messageId } }
    : status === 'aborted'
      ? { type: 'run_aborted', data: { messageId: activeRun.messageId } }
      : { type: 'run_failed', data: { messageId: activeRun.messageId, errorText: errorText ?? 'Chat run failed' } }
  publishStreamEvent(activeRun, event, true)
}

function settleActiveRun(activeRun: ActiveRun, status: TerminalChatMessageStatus, errorText: string | null): void {
  if (activeRun.terminalStatus) {
    return
  }
  if (status === 'aborted') {
    activeRun.cancelRequested = true
  }
  applyAndPublishTerminalState(activeRun, status, errorText)
}

async function requestRuntimeCancel(activeRun: ActiveRun): Promise<void> {
  const context = getSessionRunContext(activeRun.sessionId)
  if (!context) {
    chatLogger.warn('cannot cancel runtime turn because chat session context is missing', {
      sessionId: activeRun.sessionId,
      runId: activeRun.runId,
    })
    return
  }

  try {
    await activeRun.runtime.cancelTurn({ runtimeSession: activeRun.runtimeSession, profile: context.profile })
  }
  catch (error) {
    chatLogger.warn('runtime turn cancellation failed after chat run was marked aborted', {
      error,
      sessionId: activeRun.sessionId,
      runId: activeRun.runId,
    })
  }
}

function abortPersistedRun(run: BackendRun): void {
  if (run.status !== 'streaming') {
    return
  }

  const now = currentUnixSeconds()
  const messagePredicate = run.messageId
    ? and(
        eq(messages.sessionId, run.chatSessionId),
        eq(messages.status, 'streaming'),
        or(eq(messages.id, run.messageId), eq(messages.parentMessageId, run.messageId)),
      )
    : and(eq(messages.sessionId, run.chatSessionId), eq(messages.status, 'streaming'))

  db().transaction((tx) => {
    tx.update(backendRuns)
      .set({
        status: 'aborted',
        stopReason: 'response.cancelled',
        errorText: null,
        finishedAt: now,
      })
      .where(eq(backendRuns.id, run.id))
      .run()

    tx.update(messages)
      .set({
        status: 'aborted',
        errorText: null,
        updatedAt: now,
      })
      .where(messagePredicate)
      .run()

    tx.update(sessions)
      .set({ updatedAt: now })
      .where(eq(sessions.id, run.chatSessionId))
      .run()
  })
}

function abortPersistedStreamingSession(sessionId: string): void {
  const streamingRuns = db()
    .select()
    .from(backendRuns)
    .where(and(eq(backendRuns.chatSessionId, sessionId), eq(backendRuns.status, 'streaming')))
    .all()

  if (streamingRuns.length > 0) {
    for (const run of streamingRuns) {
      abortPersistedRun(run)
    }
    abortPersistedStreamingMessages(sessionId)
    return
  }

  abortPersistedStreamingMessages(sessionId)
}

function abortPersistedStreamingMessages(sessionId: string): void {
  const now = currentUnixSeconds()
  db().transaction((tx) => {
    tx.update(messages)
      .set({
        status: 'aborted',
        errorText: null,
        updatedAt: now,
      })
      .where(and(eq(messages.sessionId, sessionId), eq(messages.status, 'streaming')))
      .run()

    tx.update(sessions)
      .set({ updatedAt: now })
      .where(eq(sessions.id, sessionId))
      .run()
  })
}

function releaseActiveRun(activeRun: ActiveRun): void {
  activeRuns.delete(activeRun.runId)
  if (activeRunIdsBySession.get(activeRun.sessionId) === activeRun.runId) {
    activeRunIdsBySession.delete(activeRun.sessionId)
  }
}

function publishStreamEvent(activeRun: ActiveRun, event: ChatStreamEvent, terminal: boolean): void {
  activeRun.eventBuffer.push(event)
  const subscribers = runSubscribers.get(activeRun.runId)
  if (!subscribers) {
    return
  }
  const dead: RunSubscriber[] = []
  for (const subscriber of subscribers) {
    try {
      subscriber(event, terminal)
    }
    catch {
      // Subscriber stream was cancelled/closed — remove it
      dead.push(subscriber)
    }
  }
  for (const s of dead) {
    subscribers.delete(s)
  }
  if (terminal || subscribers.size === 0) {
    runSubscribers.delete(activeRun.runId)
  }
}

function getSubagentProjection(activeRun: ActiveRun, parentToolCallId: string, taskId: string | null): SubagentProjectionRecord {
  const existing = activeRun.subagentProjections.get(parentToolCallId)
  if (existing) {
    if (!existing.context.taskId && taskId) {
      existing.context.taskId = taskId
      db().update(messages).set({ taskId, updatedAt: currentUnixSeconds() }).where(eq(messages.id, existing.context.messageId)).run()
    }
    return existing
  }

  const now = currentUnixSeconds()
  const messageId = randomUUID()
  const message = createAssistantMessage(messageId)
  const context: SubagentMessageContext = {
    messageId,
    parentMessageId: activeRun.messageId,
    parentToolCallId,
    taskId,
  }
  db().insert(messages).values({
    id: messageId,
    sessionId: activeRun.sessionId,
    parentMessageId: activeRun.messageId,
    parentToolCallId,
    taskId,
    depth: 1,
    role: 'assistant',
    status: 'streaming',
    content: '',
    messageJson: JSON.stringify(message),
    createdAt: now,
    updatedAt: now,
  }).run()

  const record = { context, projection: createMessageProjection(message) }
  activeRun.subagentProjections.set(parentToolCallId, record)
  return record
}

function finalizeRun(activeRun: ActiveRun, status: ChatMessageStatus, errorText: string | null): void {
  const stopReason = status === 'complete'
    ? 'response.completed'
    : status === 'aborted'
      ? 'response.cancelled'
      : status === 'failed'
        ? 'response.failed'
        : null
  if (!stopReason || status === 'streaming') {
    return
  }
  db().update(backendRuns).set({
      status,
      stopReason,
      errorText,
      finishedAt: currentUnixSeconds(),
    }).where(eq(backendRuns.id, activeRun.runId)).run()
}

function finalizeSubagentSnapshots(activeRun: ActiveRun, status: ChatMessageStatus, errorText: string | null): void {
  for (const record of activeRun.subagentProjections.values()) {
    persistMessageSnapshot({
      sessionId: activeRun.sessionId,
      messageId: record.context.messageId,
      message: record.projection.message,
      messageStatus: status,
      errorText,
    })
  }
}

function isTerminalStreamEvent(event: ChatStreamEvent): boolean {
  return event.type === 'run_completed' || event.type === 'run_aborted' || event.type === 'run_failed'
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'))
}

function accumulateDiagnostics(diagnostics: TurnOutputDiagnostics, chunk: UIMessageChunk): void {
  diagnostics.emittedEventCount += 1
  switch (chunk.type) {
    case 'text-start':
    case 'text-end':
      diagnostics.assistantBoundaryCount += 1
      break
    case 'text-delta':
      diagnostics.assistantTextCharCount += chunk.delta.length
      break
    case 'reasoning-delta':
      diagnostics.reasoningTextCharCount += chunk.delta.length
      break
    case 'tool-input-start':
    case 'tool-input-available':
    case 'tool-output-available':
      diagnostics.toolEventCount += 1
      break
    default:
      break
  }
}

function accumulateDeltaDiagnostics(diagnostics: TurnOutputDiagnostics, deltas: ProjectionApplyResult['deltas']): void {
  diagnostics.emittedEventCount += Math.max(deltas.length, 1)

  for (const delta of deltas) {
    switch (delta.type) {
      case 'part_add':
        if (delta.part.type === 'text') {
          diagnostics.assistantTextCharCount += delta.part.text?.length ?? 0
        }
        else if (delta.part.type === 'reasoning') {
          diagnostics.reasoningTextCharCount += delta.part.text?.length ?? 0
        }
        else if (delta.part.type === 'dynamic-tool') {
          diagnostics.toolEventCount += 1
        }
        break
      case 'text_append':
        if (delta.partType === 'reasoning') {
          diagnostics.reasoningTextCharCount += delta.text.length
        }
        else {
          diagnostics.assistantTextCharCount += delta.text.length
        }
        break
      case 'tool_input_append':
      case 'tool_input_set':
      case 'tool_output_streaming':
      case 'tool_output_set':
        diagnostics.toolEventCount += 1
        break
      default:
        break
    }
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

function resolveTerminalChunkWithDiagnostics(
  chunk: UIMessageChunk,
  diagnostics: TurnOutputDiagnostics,
): UIMessageChunk {
  if (chunk.type !== 'finish') {
    return chunk
  }

  const validation = validateTurnOutput(diagnostics)
  if (validation.ok) {
    return chunk
  }

  const errorText = validation.errorText ?? 'Provider finished without assistant output events'
  return { type: 'error', errorText }
}

function resolveTurnFailureObservabilityCode(
  chunk: UIMessageChunk,
): string {
  if (chunk.type !== 'error') {
    return OBSERVABILITY_CODES.turnStreamFailed
  }

  // Check if this is an empty-output failure
  if (chunk.errorText.includes('without any assistant output')) {
    return OBSERVABILITY_CODES.chatEmptyOutputCompletion
  }

  return OBSERVABILITY_CODES.turnStreamFailed
}

function resolveSnapshotFailureObservabilityCode(errorText: string): string {
  if (errorText.includes('without any assistant output')) {
    return OBSERVABILITY_CODES.chatEmptyOutputCompletion
  }

  return OBSERVABILITY_CODES.turnStreamFailed
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
