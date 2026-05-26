import { randomUUID } from 'node:crypto'

import type { BackendRun, BackendSessionBinding, Message } from '@cradle/db'
import {
  agents,
  backendRuns,
  backendSessionBindings,
  chatSessionQueueItems,
  messages,
  sessions,
  stepUsage as stepUsageTable,
  usageLogs,
  workspaces
} from '@cradle/db'
import type { FileUIPart, UIMessage, UIMessageChunk } from 'ai'
import { and, desc, eq, isNull, or } from 'drizzle-orm'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { AgentRuntimeConfigJsonSchema } from '../../helpers/agent-runtime-config'
import { getSystemWorkflow } from '../../helpers/system-workflow'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import { createChildLogger } from '../../logging/logger'
import { buildAgentMemoryContext } from '../chronicle/agent-context'
import { createDedupeKey, OBSERVABILITY_CODES } from '../observability/contract'
import * as Observability from '../observability/service'
import { resolveProviderTarget } from '../provider-targets/service'
import { ModelRegistryMappingsJsonSchema } from '../providers/model-registry-mappings'
import { runtimeSupportsProviderKind } from '../providers/runtime-compatibility'
import type { RuntimeKind } from '../providers/types'
import { estimateCost } from '../usage/pricing'
import { getRuntimeRegistry } from './chat-runtime-provider-registry'
import type {
  ChatStreamEvent,
  MessageProjection,
  ProjectionApplyResult,
  SubagentMessageContext
} from './delta-events'
import {
  applyChunkToProjection,
  applySnapshotToProjection,
  createAssistantMessage,
  createMessageProjection,
  createUserMessage,
  extractMessageText,
  normalizeMessageSnapshot,
  readChunkRouteContext,
  UiMessageSnapshotJsonSchema
} from './delta-events'
import { ProviderStateSnapshotJsonSchema } from './providers/provider-state-snapshot'
import type {
  ChatRuntime,
  ChatRuntimeCapabilities,
  RuntimeProviderTargetProfile,
  RuntimeSession,
  TokenUsage
} from './runtime-provider-types'
import type { ChatStreamTraceRecord } from './stream-trace'
import { readChatRunTrace, recordChatStreamTrace } from './stream-trace'

const chatLogger = createChildLogger({ module: 'chat-runtime' })
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema)
  ])
)
const JsonObjectTextSchema = z
  .string()
  .transform((raw) => JSON.parse(raw))
  .pipe(z.record(z.string(), z.unknown()))
const FileUIPartJsonSchema = z
  .object({
    type: z.literal('file'),
    mediaType: z.string().min(1),
    filename: z.string().optional(),
    url: z.string().min(1),
    providerMetadata: z.unknown().optional()
  })
  .passthrough()
const FileUIPartArrayJsonSchema = z.array(FileUIPartJsonSchema)
const SerializableErrorSchema = z
  .object({
    code: z.union([z.number(), z.string()]).optional(),
    data: z.unknown().optional()
  })
  .passthrough()
const SerializableErrorCarrierSchema = z.union([
  SerializableErrorSchema,
  z.null().transform(() => null),
  z.undefined().transform(() => null)
])
const ErrorDetailValueSchema = z.union([
  z
    .object({
      details: z.unknown()
    })
    .passthrough()
    .transform((value) => value.details),
  z.unknown()
])
const ErrorTextSchema = z.union([
  z.string(),
  z.null().transform(() => null),
  z.undefined().transform(() => null),
  JsonValueSchema.transform((value) => JSON.stringify(value))
])

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
  profile: RuntimeProviderTargetProfile
  providerTarget: { id: string; kind: 'manual' | 'external' }
}

interface ActiveRun {
  runId: string
  sessionId: string
  messageId: string
  providerTargetKind: 'manual' | 'external'
  providerTargetId: string
  runtime: ChatRuntime
  runtimeSession: RuntimeSession
  modelId: string | null
  mainProjection: MessageProjection
  subagentProjections: Map<string, SubagentProjectionRecord>
  nextSeq: number
  eventBuffer: ChatStreamEvent[]
  terminalStatus?: TerminalChatMessageStatus
  cancelRequested?: boolean
  queueItemId?: string
}

export interface ActiveRunSummary {
  runId: string
  sessionId: string
  messageId: string
  providerTargetKind: 'manual' | 'external'
  providerTargetId: string
  modelId: string | null
}

export interface ChatRunTraceDto {
  runId: string
  sessionId: string
  messageId: string | null
  status: ChatMessageStatus
  startedAt: number
  finishedAt: number | null
  path: string
  recordCount: number
  records: ChatStreamTraceRecord[]
}

export interface ChatSessionTraceDto {
  sessionId: string
  traces: ChatRunTraceDto[]
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

export type ChatSessionQueueMode = 'queue' | 'steer'
export type ChatSessionQueueStatus = 'pending' | 'running' | 'cancelled' | 'completed' | 'failed'

export interface ChatSessionQueueItemDto {
  id: string
  sessionId: string
  mode: ChatSessionQueueMode
  status: ChatSessionQueueStatus
  text: string
  files: FileUIPart[]
  providerTargetId: string | null
  modelId: string | null
  thinkingEffort: 'low' | 'medium' | 'high' | null
  position: number
  sourceRunId: string | null
  startedRunId: string | null
  errorText: string | null
  createdAt: number
  updatedAt: number
}

export interface EnqueueSessionQueueItemInput {
  sessionId: string
  mode: ChatSessionQueueMode
  text?: string
  files?: FileUIPart[]
  providerTargetId?: string
  modelId?: string
  thinkingEffort?: 'low' | 'medium' | 'high'
}

// ── in-memory run state ──

interface PendingRunState {
  cancelled: boolean
  queueItemId?: string
}

const activeRuns = new Map<string, ActiveRun>()
const activeRunIdsBySession = new Map<string, string>()
const pendingRunSessions = new Map<string, PendingRunState>()
const runSubscribers = new Map<string, Set<RunSubscriber>>()
const drainingQueueSessionIds = new Set<string>()
const requestedQueueDrainSessionIds = new Set<string>()

// ── store helpers (merged from chat-runtime.store.ts) ──

function getSessionRunContext(
  sessionId: string,
  input: { providerTargetId?: string } = {}
): SessionRunContext | null {
  const session = db().select().from(sessions).where(eq(sessions.id, sessionId)).get()
  if (!session) {
    return null
  }
  const providerTargetId = input.providerTargetId ?? session.providerTargetId
  const providerTarget = providerTargetId ? { id: providerTargetId } : null
  if (!providerTarget) {
    return null
  }
  const workspace = session.workspaceId
    ? db().select().from(workspaces).where(eq(workspaces.id, session.workspaceId)).get()
    : null
  if (session.workspaceId && !workspace) {
    return null
  }

  const resolvedTarget = resolveProviderTarget(providerTarget)
  const profileConfig = JsonObjectTextSchema.parse(resolvedTarget.configJson)
  const targetModelRegistryConfig = {
    modelRegistryMappings: ModelRegistryMappingsJsonSchema.parse(
      resolvedTarget.modelRegistryMappingsJson
    )
  }
  const agent = session.agentId
    ? db().select().from(agents).where(eq(agents.id, session.agentId)).get()
    : null
  const agentConfig = agent ? JsonObjectTextSchema.parse(agent.configJson) : {}
  const sessionConfig = JsonObjectTextSchema.parse(session.configJson)
  const effectiveProfile = {
    id: resolvedTarget.target.id,
    name: resolvedTarget.label,
    providerKind: resolvedTarget.providerKind,
    enabled: resolvedTarget.enabled,
    configJson: JSON.stringify({
      ...profileConfig,
      ...targetModelRegistryConfig,
      ...agentConfig,
      ...sessionConfig
    }),
    credentialRef: resolvedTarget.credentialRef,
    customModels: resolvedTarget.customModelsJson,
    iconSlug: resolvedTarget.iconSlug,
    providerTargetKind: resolvedTarget.target.kind,
    providerTargetId: resolvedTarget.target.id
  }

  return {
    session,
    workspacePath: workspace?.path ?? '',
    profile: effectiveProfile,
    providerTarget: resolvedTarget.target
  }
}

function getBinding(sessionId: string): BackendSessionBinding | undefined {
  return db()
    .select()
    .from(backendSessionBindings)
    .where(eq(backendSessionBindings.chatSessionId, sessionId))
    .get()
}

export function listChatSessionIdsByBackendSessionId(backendSessionId: string): string[] {
  return db()
    .select({ chatSessionId: backendSessionBindings.chatSessionId })
    .from(backendSessionBindings)
    .where(eq(backendSessionBindings.backendSessionId, backendSessionId))
    .all()
    .map((row) => row.chatSessionId)
}

function attachBinding(input: {
  sessionId: string
  providerTargetId: string
  runtimeKind: RuntimeKind
  runtimeSession: RuntimeSession
  requestedModelId: string | null
}): BackendSessionBinding {
  const now = currentUnixSeconds()
  const existing = getBinding(input.sessionId)

  if (existing) {
    db()
      .update(backendSessionBindings)
      .set({
        providerTargetId: input.providerTargetId,
        runtimeKind: input.runtimeKind,
        backendSessionId: input.runtimeSession.providerSessionId,
        backendStateSnapshot: input.runtimeSession.providerStateSnapshot,
        requestedModelId: input.requestedModelId,
        updatedAt: now
      })
      .where(eq(backendSessionBindings.id, existing.id))
      .run()
    return db()
      .select()
      .from(backendSessionBindings)
      .where(eq(backendSessionBindings.id, existing.id))
      .get()!
  }

  return db()
    .insert(backendSessionBindings)
    .values({
      id: randomUUID(),
      chatSessionId: input.sessionId,
      providerTargetId: input.providerTargetId,
      runtimeKind: input.runtimeKind,
      backendSessionId: input.runtimeSession.providerSessionId,
      backendStateSnapshot: input.runtimeSession.providerStateSnapshot,
      requestedModelId: input.requestedModelId,
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get()
}

function createDraftTurn(input: { sessionId: string; userText: string; files: FileUIPart[] }): {
  userMessageId: string
  assistantMessageId: string
  userMessage: UIMessage
} {
  const userMessageId = randomUUID()
  const assistantMessageId = randomUUID()
  const now = currentUnixSeconds()
  const userMessage = createUserMessage(userMessageId, input.userText, input.files)
  const assistantMessage = createAssistantMessage(assistantMessageId)
  const userContent = extractMessageText(userMessage)

  db().transaction((tx) => {
    tx.insert(messages)
      .values({
        id: userMessageId,
        sessionId: input.sessionId,
        parentMessageId: null,
        parentToolCallId: null,
        taskId: null,
        depth: 0,
        role: 'user',
        status: 'complete',
        content: userContent,
        messageJson: JSON.stringify(userMessage),
        createdAt: now,
        updatedAt: now
      })
      .run()
    tx.insert(messages)
      .values({
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
        updatedAt: now
      })
      .run()
    tx.update(sessions).set({ updatedAt: now }).where(eq(sessions.id, input.sessionId)).run()
  })

  return { userMessageId, assistantMessageId, userMessage }
}

function insertCompletedUserMessage(input: { sessionId: string; message: UIMessage }): void {
  const now = currentUnixSeconds()
  db().transaction((tx) => {
    tx.insert(messages)
      .values({
        id: input.message.id,
        sessionId: input.sessionId,
        parentMessageId: null,
        parentToolCallId: null,
        taskId: null,
        depth: 0,
        role: 'user',
        status: 'complete',
        content: extractMessageText(input.message),
        messageJson: JSON.stringify(input.message),
        createdAt: now,
        updatedAt: now
      })
      .run()
    tx.update(sessions).set({ updatedAt: now }).where(eq(sessions.id, input.sessionId)).run()
  })
}

function startRun(input: {
  sessionId: string
  messageId: string
  origin: 'user' | 'issue-agent' | 'system'
}): BackendRun {
  const binding = getBinding(input.sessionId)
  if (!binding) {
    throw new Error(`Backend binding not found for chat session: ${input.sessionId}`)
  }
  return db()
    .insert(backendRuns)
    .values({
      id: randomUUID(),
      bindingId: binding.id,
      chatSessionId: input.sessionId,
      messageId: input.messageId,
      origin: input.origin,
      status: 'streaming',
      stopReason: null,
      errorText: null,
      startedAt: currentUnixSeconds(),
      finishedAt: null
    })
    .returning()
    .get()
}

export function getRun(runId: string): BackendRun | undefined {
  return db().select().from(backendRuns).where(eq(backendRuns.id, runId)).get()
}

export function getRunTrace(runId: string): ChatRunTraceDto {
  const run = getRun(runId)
  if (!run) {
    throw new AppError({
      code: 'chat_run_not_found',
      status: 404,
      message: 'Chat run not found',
      details: { runId }
    })
  }
  return toRunTraceDto(run)
}

export function getSessionTraces(sessionId: string): ChatSessionTraceDto {
  const rows = db()
    .select()
    .from(backendRuns)
    .where(eq(backendRuns.chatSessionId, sessionId))
    .orderBy(desc(backendRuns.startedAt))
    .all()

  return {
    sessionId,
    traces: rows.map(toRunTraceDto)
  }
}

export function listActiveRunSummaries(): ActiveRunSummary[] {
  return Array.from(activeRuns.values(), (run) => ({
    runId: run.runId,
    sessionId: run.sessionId,
    messageId: run.messageId,
    providerTargetKind: run.providerTargetKind,
    providerTargetId: run.providerTargetId,
    modelId: run.modelId
  }))
}

function toRunTraceDto(run: BackendRun): ChatRunTraceDto {
  const trace = readChatRunTrace(run.id)
  return {
    runId: run.id,
    sessionId: run.chatSessionId,
    messageId: run.messageId,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    path: trace.path,
    recordCount: trace.recordCount,
    records: trace.records
  }
}

function persistMessageSnapshot(input: {
  sessionId: string
  messageId: string
  message: UIMessage
  messageStatus: ChatMessageStatus
  errorText: string | null
}): void {
  const now = currentUnixSeconds()
  const message = normalizeMessageSnapshot(input.message)
  db().transaction((tx) => {
    tx.update(messages)
      .set({
        content: extractMessageText(message),
        messageJson: JSON.stringify(message),
        status: input.messageStatus,
        errorText: input.errorText,
        updatedAt: now
      })
      .where(and(eq(messages.id, input.messageId), eq(messages.sessionId, input.sessionId)))
      .run()

    tx.update(sessions).set({ updatedAt: now }).where(eq(sessions.id, input.sessionId)).run()
  })
}

function insertUsage(input: {
  sessionId: string
  messageId: string
  providerTargetId: string
  modelId: string | null
  usage: TokenUsage
}): void {
  db()
    .insert(usageLogs)
    .values({
      id: randomUUID(),
      sessionId: input.sessionId,
      messageId: input.messageId,
      providerTargetId: input.providerTargetId,
      modelId: input.modelId,
      promptTokens: input.usage.promptTokens,
      completionTokens: input.usage.completionTokens,
      totalTokens: input.usage.totalTokens,
      createdAt: currentUnixSeconds()
    })
    .run()
}

function parseQueueFiles(filesJson: string): FileUIPart[] {
  try {
    return FileUIPartArrayJsonSchema.parse(JSON.parse(filesJson)) as FileUIPart[]
  } catch (error) {
    throw new AppError({
      code: 'chat_queue_item_invalid',
      status: 500,
      message: 'Stored chat queue item is invalid',
      details: {
        reason: error instanceof Error ? error.message : 'Invalid file attachment payload'
      }
    })
  }
}

function serializeQueueFiles(files: FileUIPart[]): string {
  return JSON.stringify(FileUIPartArrayJsonSchema.parse(files))
}

function toQueueItemDto(row: typeof chatSessionQueueItems.$inferSelect): ChatSessionQueueItemDto {
  return {
    id: row.id,
    sessionId: row.sessionId,
    mode: row.mode as ChatSessionQueueMode,
    status: row.status as ChatSessionQueueStatus,
    text: row.text,
    files: parseQueueFiles(row.filesJson),
    providerTargetId: row.providerTargetId,
    modelId: row.modelId,
    thinkingEffort: row.thinkingEffort as ChatSessionQueueItemDto['thinkingEffort'],
    position: row.position,
    sourceRunId: row.sourceRunId,
    startedRunId: row.startedRunId,
    errorText: row.errorText,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

function compareQueueRows(
  left: typeof chatSessionQueueItems.$inferSelect,
  right: typeof chatSessionQueueItems.$inferSelect
): number {
  const statusRank: Record<string, number> = {
    running: 0,
    pending: 1,
    completed: 2,
    cancelled: 2,
    failed: 2
  }
  const leftRank = statusRank[left.status] ?? 3
  const rightRank = statusRank[right.status] ?? 3
  if (leftRank !== rightRank) {
    return leftRank - rightRank
  }
  if (left.status === 'running' || left.status === 'pending') {
    return left.position - right.position || left.createdAt - right.createdAt
  }
  return right.createdAt - left.createdAt || right.updatedAt - left.updatedAt
}

function assertRunnableSession(sessionId: string): SessionRunContext {
  const context = getSessionRunContext(sessionId)
  if (!context) {
    throw new AppError({
      code: 'chat_session_not_found',
      status: 404,
      message: 'Chat session not found',
      details: { sessionId }
    })
  }
  return context
}

function assertRuntimeCompatibleTarget(
  context: SessionRunContext,
  requestedProviderTargetId?: string
): SessionRunContext {
  const runtimeKind = context.session.runtimeKind ?? 'standard'
  if (runtimeSupportsProviderKind(runtimeKind, context.profile.providerKind)) {
    return context
  }

  throw new AppError({
    code: 'chat_profile_runtime_incompatible',
    status: 400,
    message: 'Agent profile is not compatible with the chat runtime',
    details: {
      runtimeKind,
      providerKind: context.profile.providerKind,
      providerTargetId: requestedProviderTargetId ?? context.providerTarget.id
    }
  })
}

function listPendingQueueRows(sessionId: string): Array<typeof chatSessionQueueItems.$inferSelect> {
  return db()
    .select()
    .from(chatSessionQueueItems)
    .where(
      and(
        eq(chatSessionQueueItems.sessionId, sessionId),
        eq(chatSessionQueueItems.status, 'pending')
      )
    )
    .orderBy(chatSessionQueueItems.position, chatSessionQueueItems.createdAt)
    .all()
}

function recoverOrphanedRunningQueueItems(sessionId: string): void {
  db()
    .update(chatSessionQueueItems)
    .set({
      status: 'pending',
      errorText: null,
      updatedAt: currentUnixSeconds()
    })
    .where(
      and(
        eq(chatSessionQueueItems.sessionId, sessionId),
        eq(chatSessionQueueItems.status, 'running'),
        isNull(chatSessionQueueItems.startedRunId)
      )
    )
    .run()
}

function normalizePendingQueuePositions(sessionId: string): void {
  const pendingRows = listPendingQueueRows(sessionId)
  const now = currentUnixSeconds()
  db().transaction((tx) => {
    pendingRows.forEach((row, index) => {
      const position = index + 1
      if (row.position !== position) {
        tx.update(chatSessionQueueItems)
          .set({ position, updatedAt: now })
          .where(eq(chatSessionQueueItems.id, row.id))
          .run()
      }
    })
  })
}

function getSourceRunId(sessionId: string): string | null {
  return activeRunIdsBySession.get(sessionId) ?? null
}

// ── turn context resolver (merged from chat-turn-context.ts) ──

interface ChatTurnContext {
  systemPrompt?: string
  history?: UIMessage[]
}

function resolveSessionSystemPrompt(
  session: import('@cradle/db').Session | null | undefined
): string | undefined {
  let systemPrompt: string | undefined
  if (session?.agentId) {
    const agent = db().select().from(agents).where(eq(agents.id, session.agentId)).get()
    systemPrompt = AgentRuntimeConfigJsonSchema.parse(agent?.configJson).systemPrompt
  }

  // Inject system workflow as base context for all agents
  const workflow = getSystemWorkflow()
  if (workflow) {
    systemPrompt = systemPrompt ? `${workflow}\n\n---\n\n${systemPrompt}` : workflow
  }

  return systemPrompt
}

function resolveTurnContext(input: {
  sessionId: string
  draftMessageId: string
  draftUserMessageId: string
}): ChatTurnContext {
  const session = db().select().from(sessions).where(eq(sessions.id, input.sessionId)).get()

  let systemPrompt = resolveSessionSystemPrompt(session)
  const draftUserMessage = db()
    .select()
    .from(messages)
    .where(eq(messages.id, input.draftUserMessageId))
    .get()
  const chronicleContext = draftUserMessage?.content
    ? resolveChronicleTurnContext(draftUserMessage.content)
    : null
  if (chronicleContext) {
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n---\n\n${chronicleContext}` : chronicleContext
  }

  const historyRows = db()
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.sessionId, input.sessionId),
        eq(messages.status, 'complete'),
        isNull(messages.parentToolCallId)
      )
    )
    .orderBy(messages.createdAt)
    .all()
    .filter((row) => row.id !== input.draftMessageId && row.id !== input.draftUserMessageId)

  const history = historyRows
    .map((row) => {
      const role = row.role as 'user' | 'assistant'
      return parseStoredMessageSnapshot(row, role)
    })
    .filter((message) => message.parts.length > 0)

  return {
    systemPrompt,
    history: history.length > 0 ? history : undefined
  }
}

function resolveChronicleTurnContext(query: string): string | null {
  try {
    return buildAgentMemoryContext({
      query,
      memoryLimit: 3,
      knowledgeLimit: 3,
      maxChars: 6_000
    })
  } catch (error) {
    chatLogger.warn('failed to resolve Chronicle turn context', {
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}

// ── public service functions ──

export function getMessageGroups(sessionId: string): ChatMessageSnapshotRow[] {
  const context = getSessionRunContext(sessionId)
  if (!context) {
    throw new AppError({
      code: 'chat_session_not_found',
      status: 404,
      message: 'Chat session not found',
      details: { sessionId }
    })
  }

  if (!activeRunIdsBySession.has(sessionId) && !pendingRunSessions.has(sessionId)) {
    abortPersistedStreamingSession(sessionId)
  }

  const rows = db()
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt)
    .all()

  return rows.map((row) => {
    const role = row.role as 'user' | 'assistant'
    const message = parseStoredMessageSnapshot(row, role)
    if (message.id !== row.id || message.role !== role) {
      throw new AppError({
        code: 'chat_message_snapshot_invalid',
        status: 500,
        message: 'Stored chat message snapshot is invalid',
        details: {
          messageId: row.id,
          role,
          reason:
            message.id !== row.id
              ? 'message_json.id must match messages.id'
              : 'message_json.role must match messages.role'
        }
      })
    }

    return {
      messageId: row.id,
      role,
      status: row.status as ChatMessageStatus,
      errorText: row.errorText ?? undefined,
      content: row.content,
      message,
      parentMessageId: row.parentMessageId,
      parentToolCallId: row.parentToolCallId,
      taskId: row.taskId,
      depth: row.depth
    }
  })
}

function parseStoredMessageSnapshot(
  row: typeof messages.$inferSelect,
  role: 'user' | 'assistant'
): ChatMessageSnapshotRow['message'] {
  try {
    return UiMessageSnapshotJsonSchema.parse(row.messageJson) as ChatMessageSnapshotRow['message']
  } catch (error) {
    throw new AppError({
      code: 'chat_message_snapshot_invalid',
      status: 500,
      message: 'Stored chat message snapshot is invalid',
      details: {
        messageId: row.id,
        role,
        reason:
          error instanceof Error
            ? `Invalid UIMessage snapshot: ${error.message}`
            : 'Invalid UIMessage snapshot'
      }
    })
  }
}

export async function getCapabilities(sessionId: string): Promise<ChatRuntimeCapabilities> {
  const context = getSessionRunContext(sessionId)
  if (!context) {
    throw new AppError({
      code: 'chat_session_not_found',
      status: 404,
      message: 'Chat session not found',
      details: { sessionId }
    })
  }

  const registry = getRuntimeRegistry()
  const runtimeKind = context.session.runtimeKind ?? 'standard'
  const runtime = registry.get(runtimeKind)
  if (!runtime) {
    throw new AppError({
      code: 'chat_runtime_not_available',
      status: 501,
      message: `Runtime is not available: ${runtimeKind}`
    })
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
          providerTargetId: context.providerTarget.id,
          runtimeKind,
          providerSessionId: binding.backendSessionId,
          providerStateSnapshot: binding.backendStateSnapshot
        },
        profile: context.profile,
        workspacePath: context.workspacePath,
        modelId:
          ProviderStateSnapshotJsonSchema.parse(binding.backendStateSnapshot).models
            .currentModelId ?? undefined
      })
    : await runtime.startChatSession({
        chatSessionId: sessionId,
        profile: context.profile,
        workspacePath: context.workspacePath
      })

  return runtime.getCapabilities({
    runtimeSession,
    profile: context.profile,
    workspaceId: context.session.workspaceId,
    workspacePath: context.workspacePath,
    modelId:
      ProviderStateSnapshotJsonSchema.parse(runtimeSession.providerStateSnapshot).models
        .currentModelId ?? undefined,
    systemPrompt: resolveSessionSystemPrompt(context.session)
  })
}

export async function createRun(input: {
  sessionId: string
  text?: string
  files?: FileUIPart[]
  providerTargetId?: string
  modelId?: string
  thinkingEffort?: 'low' | 'medium' | 'high'
  queueItemId?: string
}) {
  if (activeRunIdsBySession.has(input.sessionId) || pendingRunSessions.has(input.sessionId)) {
    throw new AppError({
      code: 'chat_run_in_progress',
      status: 409,
      message: 'Chat session already has an active run',
      details: { sessionId: input.sessionId }
    })
  }
  const pendingState: PendingRunState = { cancelled: false, queueItemId: input.queueItemId }
  pendingRunSessions.set(input.sessionId, pendingState)

  try {
    const userText = input.text ?? ''
    const files = input.files ?? []
    if (!userText.trim() && files.length === 0) {
      throw new AppError({
        code: 'chat_message_empty',
        status: 400,
        message: 'Chat message requires text or at least one file attachment',
        details: { sessionId: input.sessionId }
      })
    }

    const requestedProviderTargetId = input.providerTargetId
    const context = getSessionRunContext(input.sessionId, { providerTargetId: requestedProviderTargetId })
    if (!context) {
      throw new AppError({
        code: 'chat_session_not_found',
        status: 404,
        message: 'Chat session not found',
        details: { sessionId: input.sessionId }
      })
    }
    assertRuntimeCompatibleTarget(context, requestedProviderTargetId)
    if (!context.profile.enabled) {
      throw new AppError({
        code: 'chat_provider_target_not_available',
        status: 409,
        message: 'Provider target is disabled',
        details: {
          providerTargetId: context.providerTarget.id
        }
      })
    }

    const registry = getRuntimeRegistry()
    const runtimeKind = context.session.runtimeKind ?? 'standard'
    const runtime = registry.get(runtimeKind)
    if (!runtime) {
      throw new AppError({
        code: 'chat_runtime_not_available',
        status: 501,
        message: `Runtime is not available: ${runtimeKind}`
      })
    }

    const binding = getBinding(input.sessionId)
    const reusableBinding =
      binding?.providerTargetId === context.providerTarget.id &&
      binding.runtimeKind === runtimeKind
        ? binding
        : undefined
    const runtimeSession = reusableBinding
      ? await runtime.resumeChatSession({
          runtimeSession: {
            id: input.sessionId,
            chatSessionId: input.sessionId,
            providerTargetId: context.providerTarget.id,
            runtimeKind,
            providerSessionId: reusableBinding.backendSessionId,
            providerStateSnapshot: reusableBinding.backendStateSnapshot
          },
          profile: context.profile,
          workspacePath: context.workspacePath,
          modelId: input.modelId
        })
      : await runtime.startChatSession({
          chatSessionId: input.sessionId,
          profile: context.profile,
          workspacePath: context.workspacePath,
          modelId: input.modelId
        })

    if (pendingState.cancelled) {
      if (input.queueItemId) {
        db()
          .update(chatSessionQueueItems)
          .set({
            status: 'cancelled',
            errorText: null,
            updatedAt: currentUnixSeconds()
          })
          .where(
            and(
              eq(chatSessionQueueItems.id, input.queueItemId),
              eq(chatSessionQueueItems.sessionId, input.sessionId)
            )
          )
          .run()
      }
      try {
        await runtime.cancelTurn({ runtimeSession, profile: context.profile })
      } catch (error) {
        chatLogger.warn('runtime turn cancellation failed before chat run was created', {
          error,
          sessionId: input.sessionId,
          queueItemId: input.queueItemId
        })
      }
      throw new AppError({
        code: 'chat_run_cancelled',
        status: 409,
        message: 'Chat run was cancelled before it started',
        details: { sessionId: input.sessionId, queueItemId: input.queueItemId }
      })
    }

    attachBinding({
      sessionId: input.sessionId,
      providerTargetId: context.providerTarget.id,
      runtimeKind: runtimeSession.runtimeKind,
      runtimeSession,
      requestedModelId:
        input.modelId ??
        ProviderStateSnapshotJsonSchema.parse(runtimeSession.providerStateSnapshot).models
          .currentModelId
    })

    const draft = createDraftTurn({ sessionId: input.sessionId, userText, files })
    const run = startRun({
      sessionId: input.sessionId,
      messageId: draft.assistantMessageId,
      origin: 'user'
    })
    const activeRun: ActiveRun = {
      runId: run.id,
      sessionId: input.sessionId,
      messageId: draft.assistantMessageId,
      providerTargetKind: context.providerTarget.kind,
      providerTargetId: context.providerTarget.id,
      runtime,
      runtimeSession,
      modelId:
        input.modelId ??
        ProviderStateSnapshotJsonSchema.parse(runtimeSession.providerStateSnapshot).models
          .currentModelId,
      mainProjection: createMessageProjection(createAssistantMessage(draft.assistantMessageId)),
      subagentProjections: new Map(),
      nextSeq: 0,
      eventBuffer: [],
      queueItemId: input.queueItemId
    }
    activeRuns.set(run.id, activeRun)
    activeRunIdsBySession.set(input.sessionId, run.id)
    recordChatStreamTrace({
      chatSessionId: activeRun.sessionId,
      runId: activeRun.runId,
      messageId: activeRun.messageId,
      runtimeKind: activeRun.runtimeSession.runtimeKind,
      providerSessionId: activeRun.runtimeSession.providerSessionId,
      phase: 'run_started',
      payload: {
        providerTargetId: activeRun.providerTargetId,
        modelId: activeRun.modelId,
        queueItemId: activeRun.queueItemId ?? null
      }
    })
    if (input.queueItemId) {
      db()
        .update(chatSessionQueueItems)
        .set({
          status: 'running',
          startedRunId: run.id,
          errorText: null,
          updatedAt: currentUnixSeconds()
        })
        .where(
          and(
            eq(chatSessionQueueItems.id, input.queueItemId),
            eq(chatSessionQueueItems.sessionId, input.sessionId)
          )
        )
        .run()
    }
    pendingRunSessions.delete(input.sessionId)

    const turnContext = resolveTurnContext({
      sessionId: input.sessionId,
      draftMessageId: draft.assistantMessageId,
      draftUserMessageId: draft.userMessageId
    })

    void executeRun(activeRun, {
      message: draft.userMessage,
      profile: context.profile,
      modelId: input.modelId,
      thinkingEffort: input.thinkingEffort,
      systemPrompt: turnContext.systemPrompt,
      history: turnContext.history,
      workspaceId: context.session.workspaceId,
      workspacePath: context.workspacePath
    })

    return {
      runId: run.id,
      assistantMessageId: draft.assistantMessageId,
      userMessageId: draft.userMessageId
    }
  } catch (error) {
    const pending = pendingRunSessions.get(input.sessionId)
    pendingRunSessions.delete(input.sessionId)
    const cancelledClaimedQueueItem = Boolean(
      input.queueItemId &&
      pending?.cancelled &&
      error instanceof AppError &&
      error.code === 'chat_run_cancelled'
    )
    if (!cancelledClaimedQueueItem) {
      scheduleSessionQueueDrain(input.sessionId)
    }
    throw error
  }
}

/**
 * Single endpoint: create run + return SSE stream.
 * POST /chat/sessions/:sessionId/response → SSE
 */
export async function streamResponse(input: {
  sessionId: string
  text?: string
  files?: FileUIPart[]
  providerTargetId?: string
  modelId?: string
  thinkingEffort?: 'low' | 'medium' | 'high'
}): Promise<{
  runId: string
  assistantMessageId: string
  userMessageId: string
  stream: ReadableStream<Uint8Array>
}> {
  const result = await createRun(input)
  return {
    ...result,
    stream: openRunStream(result.runId)
  }
}

export async function abortRun(runId: string): Promise<void> {
  const active = activeRuns.get(runId)
  if (!active) {
    const persistedRun = getRun(runId)
    if (!persistedRun) {
      throw new AppError({
        code: 'chat_run_not_found',
        status: 404,
        message: 'Chat run not found',
        details: { runId }
      })
    }
    abortPersistedRun(persistedRun)
    return
  }

  settleActiveRun(active, 'aborted', null)
  try {
    await requestRuntimeCancel(active)
  } finally {
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
    const pendingState = pendingRunSessions.get(sessionId)
    if (pendingState) {
      pendingState.cancelled = true
      if (pendingState.queueItemId) {
        db()
          .update(chatSessionQueueItems)
          .set({
            status: 'cancelled',
            errorText: null,
            updatedAt: currentUnixSeconds()
          })
          .where(
            and(
              eq(chatSessionQueueItems.id, pendingState.queueItemId),
              eq(chatSessionQueueItems.sessionId, sessionId)
            )
          )
          .run()
        normalizePendingQueuePositions(sessionId)
      }
      return
    }
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
        } finally {
          releaseActiveRun(active)
        }
      }
    } catch {
      /* best-effort */
    }
  }
  activeRuns.clear()
  activeRunIdsBySession.clear()
}

export function openRunStream(runId: string): ReadableStream<Uint8Array> {
  const run = getRun(runId)
  if (!run) {
    throw new AppError({
      code: 'chat_run_not_found',
      status: 404,
      message: 'Chat run not found',
      details: { runId }
    })
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
    }
  })
}

export function waitForRunCompletion(runId: string): Promise<BackendRun> {
  const run = getRun(runId)
  if (!run) {
    throw new AppError({
      code: 'chat_run_not_found',
      status: 404,
      message: 'Chat run not found',
      details: { runId }
    })
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
  return db()
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt)
    .all()
}

export function listSessionQueueItems(sessionId: string): ChatSessionQueueItemDto[] {
  assertRunnableSession(sessionId)
  return db()
    .select()
    .from(chatSessionQueueItems)
    .where(eq(chatSessionQueueItems.sessionId, sessionId))
    .all()
    .sort(compareQueueRows)
    .map(toQueueItemDto)
}

export async function enqueueSessionQueueItem(
  input: EnqueueSessionQueueItemInput
): Promise<ChatSessionQueueItemDto> {
  const context = getSessionRunContext(input.sessionId, { providerTargetId: input.providerTargetId })
  if (!context) {
    throw new AppError({
      code: 'chat_session_not_found',
      status: 404,
      message: 'Chat session not found',
      details: { sessionId: input.sessionId }
    })
  }
  assertRuntimeCompatibleTarget(context, input.providerTargetId)

  const text = input.text?.trim() ?? ''
  const files = input.files ?? []
  if (!text && files.length === 0) {
    throw new AppError({
      code: 'chat_queue_item_empty',
      status: 400,
      message: 'Chat queue item requires text or at least one file attachment',
      details: { sessionId: input.sessionId }
    })
  }

  const pendingRows = listPendingQueueRows(input.sessionId)
  const position =
    pendingRows.reduce((maxPosition, row) => Math.max(maxPosition, row.position), 0) + 1
  const now = currentUnixSeconds()
  const row = db()
    .insert(chatSessionQueueItems)
    .values({
      id: randomUUID(),
      sessionId: input.sessionId,
      mode: input.mode,
      status: 'pending',
      text,
      filesJson: serializeQueueFiles(files),
      providerTargetId: input.providerTargetId?.trim() || null,
      modelId: input.modelId?.trim() || null,
      thinkingEffort: input.thinkingEffort ?? null,
      position,
      sourceRunId: getSourceRunId(input.sessionId),
      startedRunId: null,
      errorText: null,
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get()

  if (input.mode === 'steer') {
    const steered = await tryApplyLiveSteer({
      queueItemId: row.id,
      sessionId: input.sessionId,
      text,
      files
    })
    if (steered) {
      return steered
    }
  }

  scheduleSessionQueueDrain(input.sessionId)
  return toQueueItemDto(row)
}

async function tryApplyLiveSteer(input: {
  queueItemId: string
  sessionId: string
  text: string
  files: FileUIPart[]
}): Promise<ChatSessionQueueItemDto | null> {
  const runId = activeRunIdsBySession.get(input.sessionId)
  if (!runId) {
    return null
  }

  const activeRun = activeRuns.get(runId)
  if (!activeRun?.runtime.steerTurn || activeRun.terminalStatus) {
    return null
  }

  const context = getSessionRunContext(input.sessionId)
  if (!context) {
    return null
  }

  const claimed = db()
    .update(chatSessionQueueItems)
    .set({
      status: 'running',
      startedRunId: runId,
      errorText: null,
      updatedAt: currentUnixSeconds()
    })
    .where(
      and(
        eq(chatSessionQueueItems.id, input.queueItemId),
        eq(chatSessionQueueItems.sessionId, input.sessionId),
        eq(chatSessionQueueItems.status, 'pending')
      )
    )
    .returning()
    .get()
  if (!claimed) {
    const current = db()
      .select()
      .from(chatSessionQueueItems)
      .where(
        and(
          eq(chatSessionQueueItems.id, input.queueItemId),
          eq(chatSessionQueueItems.sessionId, input.sessionId)
        )
      )
      .get()
    return current ? toQueueItemDto(current) : null
  }

  const steerMessage = createUserMessage(randomUUID(), input.text, input.files)
  try {
    await activeRun.runtime.steerTurn({
      runtimeSession: activeRun.runtimeSession,
      profile: context.profile,
      message: steerMessage
    })
  } catch (error) {
    chatLogger.warn('runtime live steer failed; leaving item queued for later drain', {
      error,
      sessionId: input.sessionId,
      runId,
      queueItemId: input.queueItemId,
      runtimeKind: activeRun.runtimeSession.runtimeKind
    })
    db()
      .update(chatSessionQueueItems)
      .set({
        status: 'pending',
        startedRunId: null,
        errorText: null,
        updatedAt: currentUnixSeconds()
      })
      .where(
        and(
          eq(chatSessionQueueItems.id, input.queueItemId),
          eq(chatSessionQueueItems.sessionId, input.sessionId),
          eq(chatSessionQueueItems.status, 'running'),
          eq(chatSessionQueueItems.startedRunId, runId)
        )
      )
      .run()
    return null
  }

  let historyErrorText: string | null = null
  try {
    insertCompletedUserMessage({ sessionId: input.sessionId, message: steerMessage })
  } catch (error) {
    historyErrorText = serializeChatError(error).text
    chatLogger.warn('runtime live steer was applied but history persistence failed', {
      error,
      sessionId: input.sessionId,
      runId,
      queueItemId: input.queueItemId,
      runtimeKind: activeRun.runtimeSession.runtimeKind
    })
  }

  const updated = db()
    .update(chatSessionQueueItems)
    .set({
      status: 'completed',
      startedRunId: runId,
      errorText: historyErrorText,
      updatedAt: currentUnixSeconds()
    })
    .where(
      and(
        eq(chatSessionQueueItems.id, input.queueItemId),
        eq(chatSessionQueueItems.sessionId, input.sessionId),
        eq(chatSessionQueueItems.status, 'running'),
        eq(chatSessionQueueItems.startedRunId, runId)
      )
    )
    .returning()
    .get()
  if (!updated) {
    const current = db()
      .select()
      .from(chatSessionQueueItems)
      .where(
        and(
          eq(chatSessionQueueItems.id, input.queueItemId),
          eq(chatSessionQueueItems.sessionId, input.sessionId)
        )
      )
      .get()
    return current ? toQueueItemDto(current) : toQueueItemDto(claimed)
  }
  normalizePendingQueuePositions(input.sessionId)
  return toQueueItemDto(updated)
}

export function cancelSessionQueueItem(
  sessionId: string,
  queueItemId: string
): ChatSessionQueueItemDto {
  assertRunnableSession(sessionId)
  const row = db()
    .select()
    .from(chatSessionQueueItems)
    .where(
      and(eq(chatSessionQueueItems.id, queueItemId), eq(chatSessionQueueItems.sessionId, sessionId))
    )
    .get()
  if (!row) {
    throw new AppError({
      code: 'chat_queue_item_not_found',
      status: 404,
      message: 'Chat queue item not found',
      details: { sessionId, queueItemId }
    })
  }
  if (row.status !== 'pending') {
    throw new AppError({
      code: 'chat_queue_item_not_pending',
      status: 409,
      message: 'Only pending chat queue items can be cancelled',
      details: { sessionId, queueItemId, status: row.status }
    })
  }

  const now = currentUnixSeconds()
  const updated = db()
    .update(chatSessionQueueItems)
    .set({ status: 'cancelled', updatedAt: now })
    .where(
      and(
        eq(chatSessionQueueItems.id, queueItemId),
        eq(chatSessionQueueItems.sessionId, sessionId),
        eq(chatSessionQueueItems.status, 'pending')
      )
    )
    .returning()
    .get()
  if (!updated) {
    const current = db()
      .select()
      .from(chatSessionQueueItems)
      .where(
        and(
          eq(chatSessionQueueItems.id, queueItemId),
          eq(chatSessionQueueItems.sessionId, sessionId)
        )
      )
      .get()
    throw new AppError({
      code: 'chat_queue_item_not_pending',
      status: 409,
      message: 'Only pending chat queue items can be cancelled',
      details: { sessionId, queueItemId, status: current?.status ?? 'missing' }
    })
  }
  normalizePendingQueuePositions(sessionId)
  return toQueueItemDto(updated)
}

export function reorderSessionQueueItems(
  sessionId: string,
  queueItemIds: string[]
): ChatSessionQueueItemDto[] {
  assertRunnableSession(sessionId)
  const pendingRows = listPendingQueueRows(sessionId)
  const pendingIds = pendingRows.map((row) => row.id)
  const requestedIds = new Set(queueItemIds)
  const pendingIdSet = new Set(pendingIds)
  const hasSameItems =
    queueItemIds.length === pendingIds.length &&
    queueItemIds.every((id) => pendingIdSet.has(id)) &&
    pendingIds.every((id) => requestedIds.has(id))
  if (!hasSameItems) {
    throw new AppError({
      code: 'chat_queue_reorder_invalid',
      status: 400,
      message: 'Queue reorder must include every pending chat queue item exactly once',
      details: { sessionId, pendingIds, queueItemIds }
    })
  }

  const now = currentUnixSeconds()
  db().transaction((tx) => {
    queueItemIds.forEach((queueItemId, index) => {
      tx.update(chatSessionQueueItems)
        .set({ position: index + 1, updatedAt: now })
        .where(
          and(
            eq(chatSessionQueueItems.id, queueItemId),
            eq(chatSessionQueueItems.sessionId, sessionId),
            eq(chatSessionQueueItems.status, 'pending')
          )
        )
        .run()
    })
  })

  return listPendingQueueRows(sessionId).map(toQueueItemDto)
}

// ── run execution (private) ──

async function executeRun(
  activeRun: ActiveRun,
  input: {
    message: UIMessage
    profile: RuntimeProviderTargetProfile
    modelId?: string
    thinkingEffort?: 'low' | 'medium' | 'high'
    systemPrompt?: string
    history?: UIMessage[]
    workspaceId?: string | null
    workspacePath?: string
  }
): Promise<void> {
  const diagnostics: TurnOutputDiagnostics = {
    emittedEventCount: 0,
    assistantBoundaryCount: 0,
    assistantTextCharCount: 0,
    reasoningTextCharCount: 0,
    toolEventCount: 0,
    commandEventCount: 0,
    commandOutputCharCount: 0,
    fileChangeEventCount: 0
  }
  let failurePayload: SerializedChatError['payload'] | undefined
  let finalChunk: UIMessageChunk = { type: 'finish', finishReason: 'stop' }
  let streamEmittedError = false
  let snapshotTerminal: { status: ChatMessageStatus; errorText: string | null } | null = null
  const usesSnapshotStream = typeof activeRun.runtime.streamTurnSnapshots === 'function'
  let actualModelId = activeRun.modelId

  try {
    if (usesSnapshotStream) {
      for await (const message of activeRun.runtime.streamTurnSnapshots!({
        runId: activeRun.runId,
        runtimeSession: activeRun.runtimeSession,
        profile: input.profile,
        message: input.message,
        responseMessageId: activeRun.messageId,
        modelId: input.modelId,
        workspaceId: input.workspaceId,
        workspacePath: input.workspacePath,
        providerOptions: input.thinkingEffort
          ? { thinkingEffort: input.thinkingEffort }
          : undefined,
        systemPrompt: input.systemPrompt,
        history: input.history
      })) {
        if (activeRun.terminalStatus) {
          break
        }
        recordChatStreamTrace({
          chatSessionId: activeRun.sessionId,
          runId: activeRun.runId,
          messageId: activeRun.messageId,
          runtimeKind: activeRun.runtimeSession.runtimeKind,
          providerSessionId: activeRun.runtimeSession.providerSessionId,
          phase: 'runtime_chunk',
          payload: { snapshot: message }
        })
        const applied = applyAndPublishSnapshot(activeRun, message)
        accumulateDeltaDiagnostics(diagnostics, applied.deltas)
      }

      if (!activeRun.terminalStatus) {
        const validation = validateTurnOutput(diagnostics)
        snapshotTerminal = validation.ok
          ? { status: 'complete', errorText: null }
          : { status: 'failed', errorText: validation.errorText }
      }
    } else {
      applyAndPublishChunk(activeRun, { type: 'start' })

      for await (const chunk of activeRun.runtime.streamTurn({
        runId: activeRun.runId,
        runtimeSession: activeRun.runtimeSession,
        profile: input.profile,
        message: input.message,
        responseMessageId: activeRun.messageId,
        modelId: input.modelId,
        workspaceId: input.workspaceId,
        workspacePath: input.workspacePath,
        providerOptions: input.thinkingEffort
          ? { thinkingEffort: input.thinkingEffort }
          : undefined,
        systemPrompt: input.systemPrompt,
        history: input.history
      })) {
        if (activeRun.terminalStatus) {
          break
        }
        recordChatStreamTrace({
          chatSessionId: activeRun.sessionId,
          runId: activeRun.runId,
          messageId: activeRun.messageId,
          runtimeKind: activeRun.runtimeSession.runtimeKind,
          providerSessionId: activeRun.runtimeSession.providerSessionId,
          phase: 'runtime_chunk',
          payload: chunk
        })
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
  } catch (error) {
    if (isAbortError(error)) {
      snapshotTerminal = { status: 'aborted', errorText: null }
      finalChunk = { type: 'abort', reason: 'user' }
    } else {
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
          snapshotTerminal?.errorText ?? null
        )
      } else if (!streamEmittedError) {
        applyAndPublishChunk(activeRun, finalChunk)
      }

      const finalFailureText = usesSnapshotStream
        ? snapshotTerminal?.status === 'failed'
          ? (snapshotTerminal.errorText ?? 'Chat run failed')
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
          dedupeKey:
            observabilityCode === OBSERVABILITY_CODES.chatEmptyOutputCompletion
              ? createDedupeKey({
                  code: observabilityCode,
                  chatSessionId: activeRun.sessionId,
                  runId: null
                })
              : undefined,
          attrs: {
            providerTargetId: activeRun.providerTargetId,
            runtimeKind: activeRun.runtimeSession.runtimeKind,
            providerSessionId: activeRun.runtimeSession.providerSessionId,
            diagnostics,
            ...(failurePayload ? { payload: failurePayload } : {})
          }
        })
      }

      const usage = activeRun.runtime?.lastUsage
      actualModelId = activeRun.runtime?.lastModelId ?? activeRun.modelId
      if (usage) {
        insertUsage({
          sessionId: activeRun.sessionId,
          messageId: activeRun.messageId,
          providerTargetId: activeRun.providerTargetId,
          modelId: actualModelId,
          usage
        })
      }

      // Write per-step usage if the runtime supports it
      const runtimeWithSteps = activeRun.runtime as {
        lastStepUsages?: Array<{
          stepNumber: number
          stepType: string
          modelId?: string
          usage: TokenUsage
        }>
      }
      const steps = runtimeWithSteps.lastStepUsages ?? []
      if (steps.length > 0) {
        const fallbackModelId = actualModelId ?? 'gpt-4o'
        for (const step of steps) {
          const effectiveModelId = step.modelId ?? fallbackModelId
          db()
            .insert(stepUsageTable)
            .values({
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
              createdAt: currentUnixSeconds()
            })
            .run()
        }
      }
    }
  } catch (error) {
    chatLogger.error('failed to persist run finalization (session may have been deleted)', {
      error
    })
  } finally {
    // Persist updated providerSessionId/state obtained during the run
    try {
      attachBinding({
        sessionId: activeRun.sessionId,
        providerTargetId: activeRun.providerTargetId,
        runtimeKind: activeRun.runtimeSession.runtimeKind,
        runtimeSession: activeRun.runtimeSession,
        requestedModelId: actualModelId
      })
    } catch {
      // session may have been deleted during the run
    }
    releaseActiveRun(activeRun)
    scheduleSessionQueueDrain(activeRun.sessionId)
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
  recordChatStreamTrace({
    chatSessionId: activeRun.sessionId,
    runId: activeRun.runId,
    messageId: target.projection.message.id,
    runtimeKind: activeRun.runtimeSession.runtimeKind,
    providerSessionId: activeRun.runtimeSession.providerSessionId,
    toolCallId: readChunkTraceToolCallId(chunk) ?? route.parentToolCallId,
    phase: 'projection_apply',
    payload: {
      chunk,
      route,
      deltaCount: applied.deltas.length,
      deltas: applied.deltas,
      nextSeq: applied.nextSeq,
      status: applied.status,
      terminal: applied.terminal,
      errorText: applied.errorText
    }
  })

  persistMessageSnapshot({
    sessionId: activeRun.sessionId,
    messageId: target.projection.message.id,
    message: target.projection.message,
    messageStatus: applied.status,
    errorText: applied.errorText
  })

  if (applied.deltas.length > 0) {
    publishStreamEvent(
      activeRun,
      target.context
        ? {
            type: 'subagent_message_delta',
            data: { context: target.context, deltas: applied.deltas }
          }
        : {
            type: 'message_delta',
            data: { messageId: activeRun.messageId, deltas: applied.deltas }
          },
      false
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
      errorText: null
    }
  }

  const applied = applySnapshotToProjection(activeRun.mainProjection, message, activeRun.nextSeq)
  activeRun.nextSeq = applied.nextSeq
  recordChatStreamTrace({
    chatSessionId: activeRun.sessionId,
    runId: activeRun.runId,
    messageId: activeRun.mainProjection.message.id,
    runtimeKind: activeRun.runtimeSession.runtimeKind,
    providerSessionId: activeRun.runtimeSession.providerSessionId,
    phase: 'projection_apply',
    payload: {
      snapshot: message,
      deltaCount: applied.deltas.length,
      deltas: applied.deltas,
      nextSeq: applied.nextSeq,
      status: applied.status,
      terminal: applied.terminal,
      errorText: applied.errorText
    }
  })

  persistMessageSnapshot({
    sessionId: activeRun.sessionId,
    messageId: activeRun.mainProjection.message.id,
    message: activeRun.mainProjection.message,
    messageStatus: applied.status,
    errorText: applied.errorText
  })

  if (applied.deltas.length > 0) {
    publishStreamEvent(
      activeRun,
      {
        type: 'message_delta',
        data: { messageId: activeRun.messageId, deltas: applied.deltas }
      },
      false
    )
  }

  return applied
}

function readChunkTraceToolCallId(chunk: UIMessageChunk): string | null {
  const value = (chunk as { toolCallId?: unknown }).toolCallId
  return typeof value === 'string' ? value : null
}

function applyAndPublishTerminalState(
  activeRun: ActiveRun,
  status: ChatMessageStatus,
  errorText: string | null,
  persistMainSnapshot = true
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
      errorText
    })
  }

  finalizeRun(activeRun, status, errorText)
  finalizeSubagentSnapshots(activeRun, status, errorText)
  recordChatStreamTrace({
    chatSessionId: activeRun.sessionId,
    runId: activeRun.runId,
    messageId: activeRun.messageId,
    runtimeKind: activeRun.runtimeSession.runtimeKind,
    providerSessionId: activeRun.runtimeSession.providerSessionId,
    phase:
      status === 'complete' ? 'run_completed' : status === 'aborted' ? 'run_aborted' : 'run_failed',
    payload: {
      status,
      errorText,
      nextSeq: activeRun.nextSeq,
      subagentCount: activeRun.subagentProjections.size
    }
  })

  const event: ChatStreamEvent =
    status === 'complete'
      ? { type: 'run_completed', data: { messageId: activeRun.messageId } }
      : status === 'aborted'
        ? { type: 'run_aborted', data: { messageId: activeRun.messageId } }
        : {
            type: 'run_failed',
            data: { messageId: activeRun.messageId, errorText: errorText ?? 'Chat run failed' }
          }
  publishStreamEvent(activeRun, event, true)
}

function settleActiveRun(
  activeRun: ActiveRun,
  status: TerminalChatMessageStatus,
  errorText: string | null
): void {
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
      runId: activeRun.runId
    })
    return
  }

  try {
    await activeRun.runtime.cancelTurn({
      runtimeSession: activeRun.runtimeSession,
      profile: context.profile
    })
  } catch (error) {
    chatLogger.warn('runtime turn cancellation failed after chat run was marked aborted', {
      error,
      sessionId: activeRun.sessionId,
      runId: activeRun.runId
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
        or(eq(messages.id, run.messageId), eq(messages.parentMessageId, run.messageId))
      )
    : and(eq(messages.sessionId, run.chatSessionId), eq(messages.status, 'streaming'))

  db().transaction((tx) => {
    tx.update(backendRuns)
      .set({
        status: 'aborted',
        stopReason: 'response.cancelled',
        errorText: null,
        finishedAt: now
      })
      .where(eq(backendRuns.id, run.id))
      .run()

    tx.update(messages)
      .set({
        status: 'aborted',
        errorText: null,
        updatedAt: now
      })
      .where(messagePredicate)
      .run()

    tx.update(chatSessionQueueItems)
      .set({
        status: 'cancelled',
        errorText: null,
        updatedAt: now
      })
      .where(
        and(
          eq(chatSessionQueueItems.startedRunId, run.id),
          eq(chatSessionQueueItems.status, 'running')
        )
      )
      .run()

    tx.update(sessions).set({ updatedAt: now }).where(eq(sessions.id, run.chatSessionId)).run()
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
        updatedAt: now
      })
      .where(and(eq(messages.sessionId, sessionId), eq(messages.status, 'streaming')))
      .run()

    tx.update(sessions).set({ updatedAt: now }).where(eq(sessions.id, sessionId)).run()
  })
}

function releaseActiveRun(activeRun: ActiveRun): void {
  activeRuns.delete(activeRun.runId)
  if (activeRunIdsBySession.get(activeRun.sessionId) === activeRun.runId) {
    activeRunIdsBySession.delete(activeRun.sessionId)
  }
}

function scheduleSessionQueueDrain(sessionId: string): void {
  if (drainingQueueSessionIds.has(sessionId)) {
    requestedQueueDrainSessionIds.add(sessionId)
    return
  }

  requestedQueueDrainSessionIds.add(sessionId)
  queueMicrotask(() => {
    void drainSessionQueue(sessionId)
  })
}

async function drainSessionQueue(sessionId: string): Promise<void> {
  if (drainingQueueSessionIds.has(sessionId)) {
    requestedQueueDrainSessionIds.add(sessionId)
    return
  }
  if (activeRunIdsBySession.has(sessionId) || pendingRunSessions.has(sessionId)) {
    return
  }

  drainingQueueSessionIds.add(sessionId)
  requestedQueueDrainSessionIds.delete(sessionId)
  try {
    recoverOrphanedRunningQueueItems(sessionId)
    while (!activeRunIdsBySession.has(sessionId) && !pendingRunSessions.has(sessionId)) {
      const next = listPendingQueueRows(sessionId).sort((left, right) => {
        if (left.mode !== right.mode) {
          return left.mode === 'steer' ? -1 : 1
        }
        return left.position - right.position || left.createdAt - right.createdAt
      })[0]
      if (!next) {
        return
      }

      const now = currentUnixSeconds()
      const claimed = db()
        .update(chatSessionQueueItems)
        .set({ status: 'running', updatedAt: now })
        .where(
          and(
            eq(chatSessionQueueItems.id, next.id),
            eq(chatSessionQueueItems.sessionId, sessionId),
            eq(chatSessionQueueItems.status, 'pending')
          )
        )
        .returning()
        .get()
      if (!claimed) {
        continue
      }

      try {
        const run = await createRun({
          sessionId,
          text: claimed.text,
          files: parseQueueFiles(claimed.filesJson),
          providerTargetId: claimed.providerTargetId ?? undefined,
          modelId: claimed.modelId ?? undefined,
          thinkingEffort: claimed.thinkingEffort as 'low' | 'medium' | 'high' | undefined,
          queueItemId: claimed.id
        })
        db()
          .update(chatSessionQueueItems)
          .set({
            startedRunId: run.runId,
            updatedAt: currentUnixSeconds()
          })
          .where(
            and(
              eq(chatSessionQueueItems.id, claimed.id),
              eq(chatSessionQueueItems.sessionId, sessionId),
              eq(chatSessionQueueItems.status, 'running')
            )
          )
          .run()
        normalizePendingQueuePositions(sessionId)
        return
      } catch (error) {
        if (error instanceof AppError && error.code === 'chat_run_cancelled') {
          normalizePendingQueuePositions(sessionId)
          return
        }

        if (error instanceof AppError && error.code === 'chat_run_in_progress') {
          db()
            .update(chatSessionQueueItems)
            .set({
              status: 'pending',
              startedRunId: null,
              errorText: null,
              updatedAt: currentUnixSeconds()
            })
            .where(
              and(
                eq(chatSessionQueueItems.id, claimed.id),
                eq(chatSessionQueueItems.sessionId, sessionId),
                eq(chatSessionQueueItems.status, 'running')
              )
            )
            .run()
          return
        }

        const serializedError = serializeChatError(error)
        db()
          .update(chatSessionQueueItems)
          .set({
            status: 'failed',
            errorText: serializedError.text,
            updatedAt: currentUnixSeconds()
          })
          .where(
            and(
              eq(chatSessionQueueItems.id, claimed.id),
              eq(chatSessionQueueItems.sessionId, sessionId),
              eq(chatSessionQueueItems.status, 'running')
            )
          )
          .run()
        normalizePendingQueuePositions(sessionId)
      }
    }
  } finally {
    drainingQueueSessionIds.delete(sessionId)
    if (
      requestedQueueDrainSessionIds.delete(sessionId) ||
      (!activeRunIdsBySession.has(sessionId) &&
        !pendingRunSessions.has(sessionId) &&
        listPendingQueueRows(sessionId).length > 0)
    ) {
      scheduleSessionQueueDrain(sessionId)
    }
  }
}

function publishStreamEvent(activeRun: ActiveRun, event: ChatStreamEvent, terminal: boolean): void {
  recordChatStreamTrace({
    chatSessionId: activeRun.sessionId,
    runId: activeRun.runId,
    messageId: activeRun.messageId,
    runtimeKind: activeRun.runtimeSession.runtimeKind,
    providerSessionId: activeRun.runtimeSession.providerSessionId,
    phase: 'sse_emit',
    payload: {
      event,
      terminal,
      subscriberCount: runSubscribers.get(activeRun.runId)?.size ?? 0
    }
  })
  activeRun.eventBuffer.push(event)
  const subscribers = runSubscribers.get(activeRun.runId)
  if (!subscribers) {
    return
  }
  const dead: RunSubscriber[] = []
  for (const subscriber of subscribers) {
    try {
      subscriber(event, terminal)
    } catch {
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

function getSubagentProjection(
  activeRun: ActiveRun,
  parentToolCallId: string,
  taskId: string | null
): SubagentProjectionRecord {
  const existing = activeRun.subagentProjections.get(parentToolCallId)
  if (existing) {
    if (!existing.context.taskId && taskId) {
      existing.context.taskId = taskId
      db()
        .update(messages)
        .set({ taskId, updatedAt: currentUnixSeconds() })
        .where(eq(messages.id, existing.context.messageId))
        .run()
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
    taskId
  }
  db()
    .insert(messages)
    .values({
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
      updatedAt: now
    })
    .run()

  const record = { context, projection: createMessageProjection(message) }
  activeRun.subagentProjections.set(parentToolCallId, record)
  return record
}

function finalizeRun(
  activeRun: ActiveRun,
  status: ChatMessageStatus,
  errorText: string | null
): void {
  const stopReason =
    status === 'complete'
      ? 'response.completed'
      : status === 'aborted'
        ? 'response.cancelled'
        : status === 'failed'
          ? 'response.failed'
          : null
  if (!stopReason || status === 'streaming') {
    return
  }
  db()
    .update(backendRuns)
    .set({
      status,
      stopReason,
      errorText,
      finishedAt: currentUnixSeconds()
    })
    .where(eq(backendRuns.id, activeRun.runId))
    .run()
  if (activeRun.queueItemId) {
    db()
      .update(chatSessionQueueItems)
      .set({
        status: status === 'complete' ? 'completed' : status === 'aborted' ? 'cancelled' : 'failed',
        errorText,
        startedRunId: activeRun.runId,
        updatedAt: currentUnixSeconds()
      })
      .where(
        and(
          eq(chatSessionQueueItems.id, activeRun.queueItemId),
          eq(chatSessionQueueItems.sessionId, activeRun.sessionId),
          eq(chatSessionQueueItems.status, 'running')
        )
      )
      .run()
  }
}

function finalizeSubagentSnapshots(
  activeRun: ActiveRun,
  status: ChatMessageStatus,
  errorText: string | null
): void {
  for (const record of activeRun.subagentProjections.values()) {
    persistMessageSnapshot({
      sessionId: activeRun.sessionId,
      messageId: record.context.messageId,
      message: record.projection.message,
      messageStatus: status,
      errorText
    })
  }
}

function isTerminalStreamEvent(event: ChatStreamEvent): boolean {
  return (
    event.type === 'run_completed' || event.type === 'run_aborted' || event.type === 'run_failed'
  )
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'))
  )
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

function accumulateDeltaDiagnostics(
  diagnostics: TurnOutputDiagnostics,
  deltas: ProjectionApplyResult['deltas']
): void {
  diagnostics.emittedEventCount += Math.max(deltas.length, 1)

  for (const delta of deltas) {
    switch (delta.type) {
      case 'part_add':
        if (delta.part.type === 'text') {
          diagnostics.assistantTextCharCount += delta.part.text?.length ?? 0
        } else if (delta.part.type === 'reasoning') {
          diagnostics.reasoningTextCharCount += delta.part.text?.length ?? 0
        } else if (delta.part.type === 'dynamic-tool') {
          diagnostics.toolEventCount += 1
        }
        break
      case 'text_append':
        if (delta.partType === 'reasoning') {
          diagnostics.reasoningTextCharCount += delta.text.length
        } else {
          diagnostics.assistantTextCharCount += delta.text.length
        }
        break
      case 'tool_arguments_append':
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
  const hasTextOutput =
    diagnostics.assistantTextCharCount > 0 || diagnostics.reasoningTextCharCount > 0
  const hasToolOutput = diagnostics.toolEventCount > 0
  const hasCommandOutput =
    diagnostics.commandEventCount > 0 || diagnostics.commandOutputCharCount > 0
  const hasFileChangeOutput = diagnostics.fileChangeEventCount > 0

  if (hasTextOutput || hasToolOutput || hasCommandOutput || hasFileChangeOutput) {
    return { ok: true, errorText: null }
  }

  return {
    ok: false,
    errorText: `Provider finished without any assistant output events (events=${diagnostics.emittedEventCount}, assistant_boundaries=${diagnostics.assistantBoundaryCount}, assistant_text_chars=${diagnostics.assistantTextCharCount}, reasoning_chars=${diagnostics.reasoningTextCharCount}, tool_events=${diagnostics.toolEventCount}, command_events=${diagnostics.commandEventCount}, command_output_chars=${diagnostics.commandOutputCharCount}, file_change_events=${diagnostics.fileChangeEventCount})`
  }
}

function resolveTerminalChunkWithDiagnostics(
  chunk: UIMessageChunk,
  diagnostics: TurnOutputDiagnostics
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

function resolveTurnFailureObservabilityCode(chunk: UIMessageChunk): string {
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
    message: error instanceof Error ? error.message : String(error)
  }

  if (error instanceof Error) {
    payload.name = error.name
    payload.stack = error.stack
  }

  const candidate = SerializableErrorCarrierSchema.parse(error)
  if (candidate) {
    payload.code = candidate.code
    payload.data = candidate.data
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
  return stringifyErrorValue(ErrorDetailValueSchema.parse(data))
}

function stringifyErrorValue(value: unknown): string | null {
  return ErrorTextSchema.parse(value)
}
