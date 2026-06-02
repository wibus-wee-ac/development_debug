import { randomUUID } from 'node:crypto'

import type { BackendRun, BackendSessionBinding, Message, Session } from '@cradle/db'
import {
  agents,
  backendRuns,
  backendSessionBindings,
  chatSessionQueueItems,
  messages,
  sessions,
  stepUsage as stepUsageTable,
  usageLogs,
  workspaces,
} from '@cradle/db'
import type { FileUIPart, ProviderMetadata, UIMessage, UIMessageChunk } from 'ai'
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { readTrustedAgentRuntimeConfig } from '../../helpers/agent-runtime-config'
import { getSystemWorkflow } from '../../helpers/system-workflow'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import { createChildLogger } from '../../logging/logger'
import { buildAgentMemoryContext } from '../chronicle/agent-context'
import * as ModelRegistry from '../model-registry/service'
import { createDedupeKey, OBSERVABILITY_CODES } from '../observability/contract'
import * as Observability from '../observability/service'
import { resolveProviderTarget } from '../provider-targets/service'
import { runtimeSupportsProviderKind } from '../provider-contracts/runtime-compatibility'
import type { RuntimeKind } from '../provider-contracts/types'
import { estimateCost } from '../usage/pricing'
import { getRuntimeRegistry, resolveRuntimeSkillPaths } from './chat-runtime-provider-registry'
import type { ChatContextPart } from './context-parts'
import {
  annotateGoalMessage,
  createAssistantMessage,
  createUserMessage,
  extractMessageText,
  normalizeMessageSnapshot,
  parseStoredMessageSnapshot as parseTrustedStoredMessageSnapshot,
  readGoalMessageObjective,
} from './message-snapshots'
import { readProviderStateSnapshot } from '../chat-runtime-providers/provider-state-snapshot'
import {
  CodexAppServerBridge,
  getCodexAppServerCapabilities,
  type CodexAppServerCapabilityManifest,
  type CodexAppServerInvokeResponse,
} from '../chat-runtime-providers/codex/app-server-bridge'
import * as Secrets from '../secrets/service'
import type {
  ChatPermissionMode,
  ChatRuntime,
  ChatRuntimeCapabilities,
  RuntimeUiSlotState,
  RuntimeProviderTargetProfile,
  RuntimeSession,
  TokenUsage,
} from './runtime-provider-types'
import type { ChatStreamTraceRecord } from './stream-trace'
import { isChatStreamTraceEnabled, readChatRunTrace, recordChatStreamTrace } from './stream-trace'
import { type CradleTurnTranscript, resolveCradleTurnTranscript } from './transcript'

const chatLogger = createChildLogger({ module: 'chat-runtime' })
const DEFAULT_TURN_CONTEXT_MAX_MESSAGES = 12
const DEFAULT_TURN_CONTEXT_MAX_CHARS = 120_000
const DEFAULT_STORED_MESSAGE_TEXT_MAX_CHARS = 256_000
const DEFAULT_STORED_MESSAGE_REASONING_MAX_CHARS = 64_000
const DEFAULT_STORED_TOOL_PAYLOAD_MAX_CHARS = 128_000
const DEFAULT_STORED_MESSAGE_REPAIR_MIN_CHARS = 512 * 1024
const DEFAULT_RUN_DELTA_FLUSH_MS = 16
const DEFAULT_RUN_DELTA_FLUSH_CHARS = 8_192
const DEFAULT_SNAPSHOT_INTERVAL_MS = 10_000

function parseTrustedJsonObject(json: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(json)
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {}
}

function normalizeChatPermissionMode(value: unknown): ChatPermissionMode | null {
  if (value === 'bypassPermissions' || value === 'plan') {
    return value
  }
  return null
}

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
  session: Session
  workspacePath: string
  profile: RuntimeProviderTargetProfile
  providerTarget: { id: string, kind: 'manual' | 'external' }
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
  chunkBuffer: UIMessageChunk[]
  chunkBufferIndexByKey: Map<string, number>
  pendingDeltaChunk: UIMessageChunk | null
  pendingDeltaFlushTimer: StreamFlushTimer | null
  snapshotTimer: ReturnType<typeof setInterval> | null
  finalMessage: UIMessage
  finalProjection: FinalMessageProjectionState
  startChunkPublished?: boolean
  terminalStatus?: TerminalChatMessageStatus
  cancelRequested?: boolean
  queueItemId?: string
  permissionMode?: ChatPermissionMode
}

interface ChatRuntimeProfile {
  enabled: boolean
  startedAtMs: number
  streamStartedAtMs: number
  streamFinishedAtMs: number | null
  finalizeStartedAtMs: number | null
  finalizeFinishedAtMs: number | null
  memoryStarted: NodeJS.MemoryUsage | null
  memoryFinished: NodeJS.MemoryUsage | null
  finalMessageJsonBytes: number | null
}

interface FinalMessageProjectionState {
  activeTextParts: Map<string, ProjectedTextPart<MutableTextPart>>
  activeReasoningParts: Map<string, ProjectedTextPart<MutableReasoningPart>>
  partialToolCalls: Map<string, ProjectedPartialToolCall>
}

type MutableTextPart = Extract<UIMessage['parts'][number], { type: 'text' }>
type MutableReasoningPart = Extract<UIMessage['parts'][number], { type: 'reasoning' }>
type MutableToolPart = Extract<UIMessage['parts'][number], { toolCallId: string }>

interface ProjectedTextPart<TPart extends MutableTextPart | MutableReasoningPart> {
  part: TPart
  deltas: string[]
}

interface ProjectedPartialToolCall {
  deltas: string[]
  toolName: string
  dynamic?: boolean
  title?: string
}

export interface ActiveRunSummary {
  runId: string
  sessionId: string
  messageId: string
  providerTargetKind: 'manual' | 'external'
  providerTargetId: string
  modelId: string | null
}

export interface ActiveRunReplayBufferSummary {
  runId: string
  chunkCount: number
  textDeltaCount: number
  reasoningDeltaCount: number
  toolInputDeltaCount: number
  toolOutputCount: number
  maxDeltaChars: number
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

export type RuntimeSessionStatusKind = 'idle' | 'pending' | 'streaming' | 'cancelling'

export interface RuntimeSessionRunDto {
  runId: string
  messageId: string | null
  status: ChatMessageStatus
  startedAt: number
  finishedAt: number | null
  modelId: string | null
  providerSessionId: string | null
  queueItemId: string | null
  permissionMode: ChatPermissionMode | null
}

export interface ChatRuntimeSessionStatusDto {
  sessionId: string
  status: RuntimeSessionStatusKind
  runtimeKind: RuntimeKind
  providerTargetId: string | null
  providerSessionId: string | null
  modelId: string | null
  permissionMode: ChatPermissionMode | null
  pendingQueueItemId: string | null
  activeRun: RuntimeSessionRunDto | null
  latestRun: RuntimeSessionRunDto | null
  queue: {
    pending: number
    running: number
  }
}

type RunSubscriber = (chunk: UIMessageChunk, terminal: boolean) => void
type StreamFlushTimer = ReturnType<typeof setTimeout>

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
  contextParts: ChatContextPart[]
  providerTargetId: string | null
  modelId: string | null
  thinkingEffort: 'low' | 'medium' | 'high' | null
  permissionMode: ChatPermissionMode | null
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
  contextParts?: ChatContextPart[]
  providerTargetId?: string
  modelId?: string
  thinkingEffort?: 'low' | 'medium' | 'high'
  permissionMode?: ChatPermissionMode
}

export interface CodexAppServerInvokeInput {
  sessionId: string
  method: string
  params?: unknown
  providerTargetId?: string
  modelId?: string
}

export interface CodexAppServerStreamInput extends CodexAppServerInvokeInput {
  closeOnMethods?: string[]
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
const messageInsertOrder = sql`messages.rowid`

// ── store helpers (merged from chat-runtime.store.ts) ──

function getSessionRunContext(
  sessionId: string,
  input: { providerTargetId?: string } = {},
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
  const profileConfig = parseTrustedJsonObject(resolvedTarget.configJson)
  const targetModelRegistryConfig = {
    modelRegistryMappings: ModelRegistry.listMappingEntries(),
  }
  const agent = session.agentId
    ? db().select().from(agents).where(eq(agents.id, session.agentId)).get()
    : null
  const agentConfig = agent ? parseTrustedJsonObject(agent.configJson) : {}
  const sessionConfig = parseTrustedJsonObject(session.configJson)
  const effectiveProfile = {
    id: resolvedTarget.target.id,
    name: resolvedTarget.label,
    providerKind: resolvedTarget.providerKind,
    enabled: resolvedTarget.enabled,
    configJson: JSON.stringify({
      ...profileConfig,
      ...targetModelRegistryConfig,
      ...agentConfig,
      ...sessionConfig,
    }),
    credentialRef: resolvedTarget.credentialRef,
    customModels: resolvedTarget.customModelsJson,
    iconSlug: resolvedTarget.iconSlug,
    providerTargetKind: resolvedTarget.target.kind,
    providerTargetId: resolvedTarget.target.id,
  }

  return {
    session,
    workspacePath: workspace?.path ?? '',
    profile: effectiveProfile,
    providerTarget: resolvedTarget.target,
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
    .map(row => row.chatSessionId)
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
        updatedAt: now,
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
      updatedAt: now,
    })
    .returning()
    .get()
}

function reportRuntimeSessionTitle(input: {
  sessionId: string
  title: string
}): void {
  const title = normalizeRuntimeSessionTitle(input.title)
  if (!title) {
    return
  }

  const session = db()
    .select({ title: sessions.title })
    .from(sessions)
    .where(eq(sessions.id, input.sessionId))
    .get()
  if (!session || session.title === title) {
    return
  }

  db()
    .update(sessions)
    .set({
      title,
      updatedAt: currentUnixSeconds(),
    })
    .where(eq(sessions.id, input.sessionId))
    .run()
}

function normalizeRuntimeSessionTitle(title: string): string | null {
  const normalized = title.replace(/\s+/g, ' ').trim()
  return normalized.length > 0 ? normalized : null
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const value = process.env[name]
  if (!value) {
    return fallback
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function isChatRuntimeProfileEnabled(): boolean {
  return process.env.CRADLE_CHAT_RUNTIME_PROFILE === '1'
}

function startChatRuntimeProfile(): ChatRuntimeProfile {
  const now = performance.now()
  return {
    enabled: isChatRuntimeProfileEnabled(),
    startedAtMs: now,
    streamStartedAtMs: now,
    streamFinishedAtMs: null,
    finalizeStartedAtMs: null,
    finalizeFinishedAtMs: null,
    memoryStarted: isChatRuntimeProfileEnabled() ? process.memoryUsage() : null,
    memoryFinished: null,
    finalMessageJsonBytes: null,
  }
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value
  }
  return value.slice(0, maxChars)
}

function truncateJsonPayload(value: unknown, maxChars: number): unknown {
  if (value === undefined || value === null) {
    return value
  }

  try {
    const json = JSON.stringify(value)
    if (json.length <= maxChars) {
      return value
    }
    return {
      type: 'cradle.truncated-json-payload.v1',
      originalChars: json.length,
      preview: json.slice(0, maxChars),
    }
  }
 catch {
    const text = String(value)
    if (text.length <= maxChars) {
      return text
    }
    return {
      type: 'cradle.truncated-text-payload.v1',
      originalChars: text.length,
      preview: text.slice(0, maxChars),
    }
  }
}

function parsePartialToolInputText(text: string): unknown {
  try {
    return JSON.parse(text)
  }
  catch {
    return text
  }
}

function annotateContinuationMessage(
  message: UIMessage,
  continuation: { mode: ChatSessionQueueMode, queueItemId?: string } | null,
): UIMessage {
  if (!continuation) {
    return message
  }

  const currentMetadata = readRecord((message as { metadata?: unknown }).metadata)
  const currentCradleMetadata = readRecord(currentMetadata.cradle)

  return {
    ...message,
    metadata: {
      ...currentMetadata,
      cradle: {
        ...currentCradleMetadata,
        continuation: {
          mode: continuation.mode,
          ...(continuation.queueItemId ? { queueItemId: continuation.queueItemId } : {}),
        },
      },
    },
  } as UIMessage
}

function createDraftTurn(input: {
  sessionId: string
  runtimeKind: RuntimeKind
  userText: string
  files: FileUIPart[]
  contextParts: ChatContextPart[]
  continuation?: { mode: ChatSessionQueueMode, queueItemId?: string }
}): {
  userMessageId: string
  assistantMessageId: string
  userMessage: UIMessage
} {
  const userMessageId = randomUUID()
  const assistantMessageId = randomUUID()
  const now = currentUnixSeconds()
  const goalObjective = input.runtimeKind === 'codex' ? readCodexGoalCommandObjective(input.userText) : null
  const userText = goalObjective ?? input.userText
  const userMessage = annotateContinuationMessage(
    goalObjective
      ? annotateGoalMessage(createUserMessage(userMessageId, userText, input.files, input.contextParts), goalObjective)
      : createUserMessage(userMessageId, userText, input.files, input.contextParts),
    input.continuation ?? null,
  )
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
        updatedAt: now,
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
        updatedAt: now,
      })
      .run()
    tx.update(sessions).set({ updatedAt: now }).where(eq(sessions.id, input.sessionId)).run()
  })

  return { userMessageId, assistantMessageId, userMessage }
}

function createDraftTurnFromUserMessage(input: {
  sessionId: string
  userMessage: UIMessage
  continuation?: { mode: ChatSessionQueueMode, queueItemId?: string }
}): {
  userMessageId: string
  assistantMessageId: string
  userMessage: UIMessage
} {
  const assistantMessageId = randomUUID()
  const now = currentUnixSeconds()
  const userMessage = annotateContinuationMessage(input.userMessage, input.continuation ?? null)
  const assistantMessage = createAssistantMessage(assistantMessageId)

  db().transaction((tx) => {
    tx.insert(messages)
      .values({
        id: userMessage.id,
        sessionId: input.sessionId,
        parentMessageId: null,
        parentToolCallId: null,
        taskId: null,
        depth: 0,
        role: 'user',
        status: 'complete',
        content: extractMessageText(userMessage),
        messageJson: JSON.stringify(userMessage),
        createdAt: now,
        updatedAt: now,
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
        updatedAt: now,
      })
      .run()
    tx.update(sessions).set({ updatedAt: now }).where(eq(sessions.id, input.sessionId)).run()
  })

  return { userMessageId: userMessage.id, assistantMessageId, userMessage }
}

function startAssistantContinuation(input: {
  sessionId: string
  message: UIMessage
}): void {
  const now = currentUnixSeconds()
  const updated = db().transaction((tx) => {
    const result = tx.update(messages)
      .set({
        status: 'streaming',
        errorText: null,
        content: extractMessageText(input.message),
        messageJson: JSON.stringify(input.message),
        updatedAt: now,
      })
      .where(and(
        eq(messages.id, input.message.id),
        eq(messages.sessionId, input.sessionId),
        eq(messages.role, 'assistant'),
      ))
      .run()
    tx.update(sessions).set({ updatedAt: now }).where(eq(sessions.id, input.sessionId)).run()
    return result.changes
  })

  if (updated === 0) {
    throw new AppError({
      code: 'chat_assistant_message_not_found',
      status: 404,
      message: 'Assistant message for continuation was not found',
      details: {
        sessionId: input.sessionId,
        messageId: input.message.id,
      },
    })
  }
}

function insertCompletedUserMessage(input: { sessionId: string, message: UIMessage }): void {
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
        updatedAt: now,
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
      finishedAt: null,
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
      details: { runId },
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
    traces: rows.map(toRunTraceDto),
  }
}

export function listActiveRunSummaries(): ActiveRunSummary[] {
  return Array.from(activeRuns.values(), run => ({
    runId: run.runId,
    sessionId: run.sessionId,
    messageId: run.messageId,
    providerTargetKind: run.providerTargetKind,
    providerTargetId: run.providerTargetId,
    modelId: run.modelId,
  }))
}

export function getActiveRunReplayBufferSummary(runId: string): ActiveRunReplayBufferSummary | null {
  const run = activeRuns.get(runId)
  if (!run) {
    return null
  }
  return {
    runId,
    chunkCount: run.chunkBuffer.length,
    textDeltaCount: run.chunkBuffer.filter(chunk => chunk.type === 'text-delta').length,
    reasoningDeltaCount: run.chunkBuffer.filter(chunk => chunk.type === 'reasoning-delta').length,
    toolInputDeltaCount: run.chunkBuffer.filter(chunk => chunk.type === 'tool-input-delta').length,
    toolOutputCount: run.chunkBuffer.filter(chunk => chunk.type === 'tool-output-available').length,
    maxDeltaChars: run.chunkBuffer.reduce((max, chunk) => Math.max(max, readDeltaChunkTextLength(chunk)), 0),
  }
}

export function getActiveSessionRun(sessionId: string): ActiveRunSummary | null {
  const runId = activeRunIdsBySession.get(sessionId)
  if (!runId) {
    return null
  }
  const run = activeRuns.get(runId)
  return run
    ? {
        runId: run.runId,
        sessionId: run.sessionId,
        messageId: run.messageId,
        providerTargetKind: run.providerTargetKind,
        providerTargetId: run.providerTargetId,
        modelId: run.modelId,
      }
    : null
}

export function getRuntimeSessionStatus(sessionId: string): ChatRuntimeSessionStatusDto {
  const session = db().select().from(sessions).where(eq(sessions.id, sessionId)).get()
  if (!session) {
    throw new AppError({
      code: 'chat_session_not_found',
      status: 404,
      message: 'Chat session not found',
      details: { sessionId },
    })
  }

  const binding = getBinding(sessionId)
  const activeRunId = activeRunIdsBySession.get(sessionId)
  const activeRun = activeRunId ? activeRuns.get(activeRunId) : undefined
  const pendingState = pendingRunSessions.get(sessionId)
  const latestRun = db()
    .select()
    .from(backendRuns)
    .where(eq(backendRuns.chatSessionId, sessionId))
    .orderBy(desc(backendRuns.startedAt))
    .get()
  const queueRows = db()
    .select({
      status: chatSessionQueueItems.status,
    })
    .from(chatSessionQueueItems)
    .where(eq(chatSessionQueueItems.sessionId, sessionId))
    .all()
  const queue = queueRows.reduce((counts, row) => {
    if (row.status === 'pending') {
      return { ...counts, pending: counts.pending + 1 }
    }
    if (row.status === 'running') {
      return { ...counts, running: counts.running + 1 }
    }
    return counts
  }, { pending: 0, running: 0 })

  const runtimeKind = activeRun?.runtimeSession.runtimeKind
    ?? binding?.runtimeKind as RuntimeKind | undefined
    ?? session.runtimeKind
  const providerTargetId = activeRun?.providerTargetId ?? binding?.providerTargetId ?? session.providerTargetId
  const providerSessionId = activeRun?.runtimeSession.providerSessionId ?? binding?.backendSessionId ?? null
  const modelId = activeRun?.modelId ?? binding?.requestedModelId ?? null
  const permissionMode = activeRun?.permissionMode ?? null

  return {
    sessionId,
    status: activeRun
      ? activeRun.cancelRequested ? 'cancelling' : 'streaming'
      : pendingState ? 'pending' : 'idle',
    runtimeKind,
    providerTargetId,
    providerSessionId,
    modelId,
    permissionMode,
    pendingQueueItemId: pendingState?.queueItemId ?? null,
    activeRun: activeRun ? toRuntimeSessionRunDto(activeRun, getRun(activeRun.runId)) : null,
    latestRun: latestRun ? toRuntimeSessionRunDto(null, latestRun, {
      modelId: binding?.requestedModelId ?? null,
      providerSessionId: binding?.backendSessionId ?? null,
    }) : null,
    queue,
  }
}

function toRuntimeSessionRunDto(
  activeRun: ActiveRun | null,
  run: BackendRun | undefined,
  fallback: { modelId?: string | null, providerSessionId?: string | null } = {},
): RuntimeSessionRunDto {
  return {
    runId: activeRun?.runId ?? run?.id ?? '',
    messageId: activeRun?.messageId ?? run?.messageId ?? null,
    status: activeRun?.terminalStatus ?? run?.status as ChatMessageStatus | undefined ?? 'streaming',
    startedAt: run?.startedAt ?? currentUnixSeconds(),
    finishedAt: run?.finishedAt ?? null,
    modelId: activeRun?.modelId ?? fallback.modelId ?? null,
    providerSessionId: activeRun?.runtimeSession.providerSessionId ?? fallback.providerSessionId ?? null,
    queueItemId: activeRun?.queueItemId ?? null,
    permissionMode: activeRun?.permissionMode ?? null,
  }
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
    records: trace.records,
  }
}

function persistMessageSnapshot(input: {
  sessionId: string
  messageId: string
  message: UIMessage
  messageStatus: ChatMessageStatus
  errorText: string | null
}): { messageJsonBytes: number } {
  const now = currentUnixSeconds()
  const message = compactStoredMessageSnapshot(normalizeMessageSnapshot(input.message))
  const messageJson = JSON.stringify(message)
  db().transaction((tx) => {
    tx.update(messages)
      .set({
        content: extractMessageText(message),
        messageJson,
        status: input.messageStatus,
        errorText: input.errorText,
        updatedAt: now,
      })
      .where(and(eq(messages.id, input.messageId), eq(messages.sessionId, input.sessionId)))
      .run()

    tx.update(sessions).set({ updatedAt: now }).where(eq(sessions.id, input.sessionId)).run()
  })
  return { messageJsonBytes: Buffer.byteLength(messageJson) }
}

function repairStoredMessageSnapshotIfOversized(input: {
  row: typeof messages.$inferSelect
  message: ChatMessageSnapshotRow['message']
}): ChatMessageSnapshotRow['message'] {
  const repairMinChars = readPositiveIntegerEnv('CRADLE_CHAT_STORED_MESSAGE_REPAIR_MIN_CHARS', DEFAULT_STORED_MESSAGE_REPAIR_MIN_CHARS)
  if (input.row.messageJson.length < repairMinChars) {
    return input.message
  }

  const compactedMessage = compactStoredMessageSnapshot(input.message)
  if (compactedMessage === input.message) {
    return input.message
  }

  const compactedJson = JSON.stringify(compactedMessage)
  if (compactedJson.length >= input.row.messageJson.length) {
    return input.message
  }

  const now = currentUnixSeconds()
  db()
    .update(messages)
    .set({
      content: extractMessageText(compactedMessage),
      messageJson: compactedJson,
      updatedAt: now,
    })
    .where(eq(messages.id, input.row.id))
    .run()
  return compactedMessage as ChatMessageSnapshotRow['message']
}

function compactStoredMessageSnapshot(message: UIMessage): UIMessage {
  const textLimit = readPositiveIntegerEnv('CRADLE_CHAT_STORED_TEXT_MAX_CHARS', DEFAULT_STORED_MESSAGE_TEXT_MAX_CHARS)
  const reasoningLimit = readPositiveIntegerEnv('CRADLE_CHAT_STORED_REASONING_MAX_CHARS', DEFAULT_STORED_MESSAGE_REASONING_MAX_CHARS)
  const toolPayloadLimit = readPositiveIntegerEnv('CRADLE_CHAT_STORED_TOOL_PAYLOAD_MAX_CHARS', DEFAULT_STORED_TOOL_PAYLOAD_MAX_CHARS)
  let changed = false
  let remainingText = textLimit
  let remainingReasoning = reasoningLimit

  const parts = message.parts.map((part) => {
    if (part.type === 'text') {
      const nextText = truncateText(part.text, remainingText)
      remainingText = Math.max(0, remainingText - nextText.length)
      if (nextText !== part.text) {
        changed = true
        return {
          ...part,
          text: nextText,
          providerMetadata: {
            ...readRecord((part as { providerMetadata?: unknown }).providerMetadata),
            cradle: {
              ...readRecord(readRecord((part as { providerMetadata?: unknown }).providerMetadata).cradle),
              truncated: true,
              originalChars: part.text.length,
            },
          },
        } as UIMessage['parts'][number]
      }
      return part
    }

    if (part.type === 'reasoning') {
      const nextText = truncateText(part.text, remainingReasoning)
      remainingReasoning = Math.max(0, remainingReasoning - nextText.length)
      if (nextText !== part.text) {
        changed = true
        return {
          ...part,
          text: nextText,
          providerMetadata: {
            ...readRecord((part as { providerMetadata?: unknown }).providerMetadata),
            cradle: {
              ...readRecord(readRecord((part as { providerMetadata?: unknown }).providerMetadata).cradle),
              truncated: true,
              originalChars: part.text.length,
            },
          },
        } as UIMessage['parts'][number]
      }
      return part
    }

    if ('toolCallId' in part && (part.type === 'dynamic-tool' || part.type.startsWith('tool-'))) {
      let nextPart = part as Record<string, unknown>
      if ('input' in nextPart) {
        const inputPayload = truncateJsonPayload(nextPart.input, toolPayloadLimit)
        if (inputPayload !== nextPart.input) {
          changed = true
          nextPart = { ...nextPart, input: inputPayload }
        }
      }
      if ('output' in nextPart) {
        const outputPayload = truncateJsonPayload(nextPart.output, toolPayloadLimit)
        if (outputPayload !== nextPart.output) {
          changed = true
          nextPart = { ...nextPart, output: outputPayload }
        }
      }
      return nextPart as UIMessage['parts'][number]
    }

    return part
  })

  return changed ? { ...message, parts } : message
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
      createdAt: currentUnixSeconds(),
    })
    .run()
}

function parseQueueFiles(filesJson: string): FileUIPart[] {
  try {
    return JSON.parse(filesJson) as FileUIPart[]
  }
 catch (error) {
    throw new AppError({
      code: 'chat_queue_item_invalid',
      status: 500,
      message: 'Stored chat queue item is invalid',
      details: {
        reason: error instanceof Error ? error.message : 'Invalid file attachment payload',
      },
    })
  }
}

function parseQueueContextParts(contextPartsJson: string): ChatContextPart[] {
  try {
    return JSON.parse(contextPartsJson) as ChatContextPart[]
  }
  catch (error) {
    throw new AppError({
      code: 'chat_queue_item_invalid',
      status: 500,
      message: 'Stored chat queue item is invalid',
      details: {
        reason: error instanceof Error ? error.message : 'Invalid context part payload',
      },
    })
  }
}

function serializeQueueFiles(files: FileUIPart[]): string {
  return JSON.stringify(files)
}

function serializeQueueContextParts(contextParts: ChatContextPart[]): string {
  return JSON.stringify(contextParts)
}

function toQueueItemDto(row: typeof chatSessionQueueItems.$inferSelect): ChatSessionQueueItemDto {
  return {
    id: row.id,
    sessionId: row.sessionId,
    mode: row.mode as ChatSessionQueueMode,
    status: row.status as ChatSessionQueueStatus,
    text: row.text,
    files: parseQueueFiles(row.filesJson),
    contextParts: parseQueueContextParts(row.contextPartsJson),
    providerTargetId: row.providerTargetId,
    modelId: row.modelId,
    thinkingEffort: row.thinkingEffort as ChatSessionQueueItemDto['thinkingEffort'],
    permissionMode: normalizeChatPermissionMode(row.permissionMode),
    position: row.position,
    sourceRunId: row.sourceRunId,
    startedRunId: row.startedRunId,
    errorText: row.errorText,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function compareQueueRows(
  left: typeof chatSessionQueueItems.$inferSelect,
  right: typeof chatSessionQueueItems.$inferSelect,
): number {
  const statusRank: Record<string, number> = {
    running: 0,
    pending: 1,
    completed: 2,
    cancelled: 2,
    failed: 2,
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
      details: { sessionId },
    })
  }
  return context
}

function assertStoredSession(sessionId: string): Session {
  const session = db().select().from(sessions).where(eq(sessions.id, sessionId)).get()
  if (!session) {
    throw new AppError({
      code: 'chat_session_not_found',
      status: 404,
      message: 'Chat session not found',
      details: { sessionId },
    })
  }
  return session
}

function assertRuntimeCompatibleTarget(
  context: SessionRunContext,
  requestedProviderTargetId?: string,
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
      providerTargetId: requestedProviderTargetId ?? context.providerTarget.id,
    },
  })
}

function listPendingQueueRows(sessionId: string): Array<typeof chatSessionQueueItems.$inferSelect> {
  return db()
    .select()
    .from(chatSessionQueueItems)
    .where(
      and(
        eq(chatSessionQueueItems.sessionId, sessionId),
        eq(chatSessionQueueItems.status, 'pending'),
      ),
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
      updatedAt: currentUnixSeconds(),
    })
    .where(
      and(
        eq(chatSessionQueueItems.sessionId, sessionId),
        eq(chatSessionQueueItems.status, 'running'),
        isNull(chatSessionQueueItems.startedRunId),
      ),
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
  transcript?: CradleTurnTranscript
  history?: UIMessage[]
}

function resolveSessionSystemPrompt(
  session: Session | null | undefined,
): string | undefined {
  let systemPrompt: string | undefined
  if (session?.agentId) {
    const agent = db().select().from(agents).where(eq(agents.id, session.agentId)).get()
    systemPrompt = readTrustedAgentRuntimeConfig(agent?.configJson).systemPrompt
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

  const transcript = resolveBoundedTurnHistory({
    sessionId: input.sessionId,
    excludedMessageIds: new Set([input.draftMessageId, input.draftUserMessageId]),
  })

  return {
    systemPrompt,
    transcript,
    history: transcript.history.length > 0 ? transcript.history : undefined,
  }
}

function resolveBoundedTurnHistory(input: {
  sessionId: string
  excludedMessageIds: Set<string>
}): CradleTurnTranscript {
  const maxMessages = readPositiveIntegerEnv('CRADLE_CHAT_TURN_CONTEXT_MAX_MESSAGES', DEFAULT_TURN_CONTEXT_MAX_MESSAGES)
  const maxChars = readPositiveIntegerEnv('CRADLE_CHAT_TURN_CONTEXT_MAX_CHARS', DEFAULT_TURN_CONTEXT_MAX_CHARS)
  return resolveCradleTurnTranscript({
    sessionId: input.sessionId,
    excludedMessageIds: input.excludedMessageIds,
    maxMessages,
    maxChars,
  })
}

function resolveChronicleTurnContext(query: string): string | null {
  try {
    return buildAgentMemoryContext({
      query,
      memoryLimit: 3,
      knowledgeLimit: 3,
      maxChars: 6_000,
    })
  }
 catch (error) {
    chatLogger.warn('failed to resolve Chronicle turn context', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

// ── public service functions ──

export function getMessageGroups(sessionId: string): ChatMessageSnapshotRow[] {
  assertStoredSession(sessionId)

  if (!activeRunIdsBySession.has(sessionId) && !pendingRunSessions.has(sessionId)) {
    abortPersistedStreamingSession(sessionId)
  }

  const rows = db()
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt, messageInsertOrder)
    .all()

  return rows.map((row) => {
    const role = row.role as 'user' | 'assistant'
    const parsedMessage = parseStoredMessageSnapshot(row, role)
    const message = repairStoredMessageSnapshotIfOversized({
      row,
      message: parsedMessage,
    })
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
              : 'message_json.role must match messages.role',
        },
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
      depth: row.depth,
    }
  })
}

function parseStoredMessageSnapshot(
  row: typeof messages.$inferSelect,
  role: 'user' | 'assistant',
): ChatMessageSnapshotRow['message'] {
  try {
    return parseTrustedStoredMessageSnapshot(row.messageJson) as ChatMessageSnapshotRow['message']
  }
 catch (error) {
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
            : 'Invalid UIMessage snapshot',
      },
    })
  }
}

export async function getCapabilities(sessionId: string): Promise<ChatRuntimeCapabilities> {
  const context = getSessionRunContext(sessionId)
  if (!context) {
    const session = assertStoredSession(sessionId)
    return {
      runtimeKind: session.runtimeKind ?? 'standard',
      slashCommands: [],
      uiSlots: [],
      skills: [],
    }
  }

  const registry = getRuntimeRegistry()
  const runtimeKind = context.session.runtimeKind ?? 'standard'
  const runtime = registry.get(runtimeKind)
  if (!runtime) {
    throw new AppError({
      code: 'chat_runtime_not_available',
      status: 501,
      message: `Runtime is not available: ${runtimeKind}`,
    })
  }

  if (!runtime.getCapabilities) {
    return { runtimeKind, slashCommands: [], uiSlots: [], skills: [] }
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
          providerStateSnapshot: binding.backendStateSnapshot,
        },
        profile: context.profile,
        workspacePath: context.workspacePath,
        modelId:
          readProviderStateSnapshot(binding.backendStateSnapshot).models.currentModelId ?? undefined,
      })
    : await runtime.startChatSession({
        chatSessionId: sessionId,
        profile: context.profile,
        workspacePath: context.workspacePath,
        previousProviderStateSnapshot: null,
      })

  return runtime.getCapabilities({
    runtimeSession,
    profile: context.profile,
    workspaceId: context.session.workspaceId,
    workspacePath: context.workspacePath,
    modelId:
      readProviderStateSnapshot(runtimeSession.providerStateSnapshot).models.currentModelId ?? undefined,
    systemPrompt: resolveSessionSystemPrompt(context.session),
  })
}

export async function getUiSlotStates(sessionId: string): Promise<{ runtimeKind: RuntimeKind, states: RuntimeUiSlotState[] }> {
  const context = getSessionRunContext(sessionId)
  if (!context) {
    const session = assertStoredSession(sessionId)
    return {
      runtimeKind: session.runtimeKind ?? 'standard',
      states: [],
    }
  }

  const registry = getRuntimeRegistry()
  const runtimeKind = context.session.runtimeKind ?? 'standard'
  const runtime = registry.get(runtimeKind)
  if (!runtime) {
    throw new AppError({
      code: 'chat_runtime_not_available',
      status: 501,
      message: `Runtime is not available: ${runtimeKind}`,
    })
  }

  if (!runtime.getUiSlotStates) {
    return { runtimeKind, states: [] }
  }

  const activeRunId = activeRunIdsBySession.get(sessionId)
  const activeRun = activeRunId ? activeRuns.get(activeRunId) : undefined
  if (activeRun?.runtimeSession.runtimeKind === runtimeKind) {
    return {
      runtimeKind,
      states: await runtime.getUiSlotStates({
        runtimeSession: activeRun.runtimeSession,
        profile: context.profile,
        workspaceId: context.session.workspaceId,
        workspacePath: context.workspacePath,
        modelId:
          readProviderStateSnapshot(activeRun.runtimeSession.providerStateSnapshot).models.currentModelId ?? undefined,
        systemPrompt: resolveSessionSystemPrompt(context.session),
      }),
    }
  }

  const binding = getBinding(sessionId)
  if (!binding) {
    return { runtimeKind, states: [] }
  }

  const runtimeSession = await runtime.resumeChatSession({
    runtimeSession: {
      id: sessionId,
      chatSessionId: sessionId,
      providerTargetId: context.providerTarget.id,
      runtimeKind,
      providerSessionId: binding.backendSessionId,
      providerStateSnapshot: binding.backendStateSnapshot,
    },
    profile: context.profile,
    workspacePath: context.workspacePath,
    modelId:
      readProviderStateSnapshot(binding.backendStateSnapshot).models.currentModelId ?? undefined,
  })

  return {
    runtimeKind,
    states: await runtime.getUiSlotStates({
      runtimeSession,
      profile: context.profile,
      workspaceId: context.session.workspaceId,
      workspacePath: context.workspacePath,
      modelId:
        readProviderStateSnapshot(runtimeSession.providerStateSnapshot).models.currentModelId ?? undefined,
      systemPrompt: resolveSessionSystemPrompt(context.session),
    }),
  }
}

export function getCodexAppServerCapabilityManifest(): CodexAppServerCapabilityManifest {
  return getCodexAppServerCapabilities()
}

export async function invokeCodexAppServer(input: CodexAppServerInvokeInput): Promise<CodexAppServerInvokeResponse> {
  const context = await resolveCodexAppServerBridgeContext(input)
  return createCodexAppServerBridge().invoke({
    ...context,
    method: input.method,
    params: input.params,
  })
}

export async function openCodexAppServerStream(input: CodexAppServerStreamInput): Promise<ReadableStream<Uint8Array>> {
  const context = await resolveCodexAppServerBridgeContext(input)
  return createCodexAppServerBridge().openEventStream({
    ...context,
    method: input.method,
    params: input.params,
    closeOnMethods: input.closeOnMethods,
  })
}

async function resolveCodexAppServerBridgeContext(input: {
  sessionId: string
  providerTargetId?: string
  modelId?: string
}) {
  const context = getSessionRunContext(input.sessionId, { providerTargetId: input.providerTargetId })
  if (!context) {
    throw new AppError({
      code: 'chat_session_not_found',
      status: 404,
      message: 'Chat session not found',
      details: { sessionId: input.sessionId },
    })
  }
  if ((context.session.runtimeKind ?? 'standard') !== 'codex') {
    throw new AppError({
      code: 'chat_runtime_not_codex',
      status: 400,
      message: 'Codex app-server calls require a Codex chat runtime session',
      details: { sessionId: input.sessionId, runtimeKind: context.session.runtimeKind ?? 'standard' },
    })
  }
  assertRuntimeCompatibleTarget(context, input.providerTargetId)

  const runtime = getRuntimeRegistry().get('codex')
  if (!runtime) {
    throw new AppError({
      code: 'chat_runtime_not_available',
      status: 501,
      message: 'Runtime is not available: codex',
    })
  }

  const binding = getBinding(input.sessionId)
  const reusableBinding
    = binding?.providerTargetId === context.providerTarget.id
      && binding.runtimeKind === 'codex'
      ? binding
      : undefined
  const runtimeSession = reusableBinding
    ? await runtime.resumeChatSession({
        runtimeSession: {
          id: input.sessionId,
          chatSessionId: input.sessionId,
          providerTargetId: context.providerTarget.id,
          runtimeKind: 'codex',
          providerSessionId: reusableBinding.backendSessionId,
          providerStateSnapshot: reusableBinding.backendStateSnapshot,
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
        previousProviderStateSnapshot: binding?.backendStateSnapshot ?? null,
      })

  attachBinding({
    sessionId: input.sessionId,
    providerTargetId: context.providerTarget.id,
    runtimeKind: runtimeSession.runtimeKind,
    runtimeSession,
    requestedModelId:
      input.modelId
      ?? readProviderStateSnapshot(runtimeSession.providerStateSnapshot).models.currentModelId,
  })

  return {
    runtimeSession,
    profile: context.profile,
    workspaceId: context.session.workspaceId,
    workspacePath: context.workspacePath,
    modelId: input.modelId,
  }
}

function createCodexAppServerBridge(): CodexAppServerBridge {
  return new CodexAppServerBridge({
    readSecret: secretRef => Secrets.readSecret(secretRef),
    resolveSkillPaths: resolveRuntimeSkillPaths,
  })
}

export async function createRun(input: {
  sessionId: string
  text?: string
  files?: FileUIPart[]
  contextParts?: ChatContextPart[]
  messages?: UIMessage[]
  providerTargetId?: string
  modelId?: string
  thinkingEffort?: 'low' | 'medium' | 'high'
  permissionMode?: ChatPermissionMode
  continuationMode?: ChatSessionQueueMode
  queueItemId?: string
}) {
  if (activeRunIdsBySession.has(input.sessionId) || pendingRunSessions.has(input.sessionId)) {
    throw new AppError({
      code: 'chat_run_in_progress',
      status: 409,
      message: 'Chat session already has an active run',
      details: { sessionId: input.sessionId },
    })
  }
  const pendingState: PendingRunState = { cancelled: false, queueItemId: input.queueItemId }
  pendingRunSessions.set(input.sessionId, pendingState)

  try {
    const userText = input.text ?? ''
    const files = input.files ?? []
    const contextParts = input.contextParts ?? []
    const requestMessages = input.messages
    const lastRequestMessage = requestMessages?.at(-1)
    if (!requestMessages && !userText.trim() && files.length === 0 && contextParts.length === 0) {
      throw new AppError({
        code: 'chat_message_empty',
        status: 400,
        message: 'Chat message requires text or at least one file attachment',
        details: { sessionId: input.sessionId },
      })
    }
    if (requestMessages && !lastRequestMessage) {
      throw new AppError({
        code: 'chat_message_empty',
        status: 400,
        message: 'Chat message history cannot be empty',
        details: { sessionId: input.sessionId },
      })
    }
    if (lastRequestMessage && lastRequestMessage.role !== 'user' && lastRequestMessage.role !== 'assistant') {
      throw new AppError({
        code: 'chat_message_invalid',
        status: 400,
        message: 'Chat message history must end with a user or assistant message',
        details: {
          sessionId: input.sessionId,
          role: lastRequestMessage.role,
        },
      })
    }

    const requestedProviderTargetId = input.providerTargetId
    const context = getSessionRunContext(input.sessionId, { providerTargetId: requestedProviderTargetId })
    if (!context) {
      throw new AppError({
        code: 'chat_session_not_found',
        status: 404,
        message: 'Chat session not found',
        details: { sessionId: input.sessionId },
      })
    }
    assertRuntimeCompatibleTarget(context, requestedProviderTargetId)
    if (!context.profile.enabled) {
      throw new AppError({
        code: 'chat_provider_target_not_available',
        status: 409,
        message: 'Provider target is disabled',
        details: {
          providerTargetId: context.providerTarget.id,
        },
      })
    }

    const registry = getRuntimeRegistry()
    const runtimeKind = context.session.runtimeKind ?? 'standard'
    const runtime = registry.get(runtimeKind)
    if (!runtime) {
      throw new AppError({
        code: 'chat_runtime_not_available',
        status: 501,
        message: `Runtime is not available: ${runtimeKind}`,
      })
    }

    const binding = getBinding(input.sessionId)
    const reusableBinding
      = binding?.providerTargetId === context.providerTarget.id
        && binding.runtimeKind === runtimeKind
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
            providerStateSnapshot: reusableBinding.backendStateSnapshot,
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
          previousProviderStateSnapshot: binding?.backendStateSnapshot ?? null,
        })

    if (pendingState.cancelled) {
      if (input.queueItemId) {
        db()
          .update(chatSessionQueueItems)
          .set({
            status: 'cancelled',
            errorText: null,
            updatedAt: currentUnixSeconds(),
          })
          .where(
            and(
              eq(chatSessionQueueItems.id, input.queueItemId),
              eq(chatSessionQueueItems.sessionId, input.sessionId),
            ),
          )
          .run()
      }
      try {
        await runtime.cancelTurn({ runtimeSession, profile: context.profile })
      }
 catch (error) {
        chatLogger.warn('runtime turn cancellation failed before chat run was created', {
          error,
          sessionId: input.sessionId,
          queueItemId: input.queueItemId,
        })
      }
      throw new AppError({
        code: 'chat_run_cancelled',
        status: 409,
        message: 'Chat run was cancelled before it started',
        details: { sessionId: input.sessionId, queueItemId: input.queueItemId },
      })
    }

    attachBinding({
      sessionId: input.sessionId,
      providerTargetId: context.providerTarget.id,
      runtimeKind: runtimeSession.runtimeKind,
      runtimeSession,
      requestedModelId:
        input.modelId
        ?? readProviderStateSnapshot(runtimeSession.providerStateSnapshot).models.currentModelId,
    })

    const draft = lastRequestMessage?.role === 'assistant'
      ? {
          userMessageId: '',
          assistantMessageId: lastRequestMessage.id,
          userMessage: lastRequestMessage,
        }
      : lastRequestMessage?.role === 'user'
        ? createDraftTurnFromUserMessage({
            sessionId: input.sessionId,
            userMessage: lastRequestMessage,
            continuation: input.continuationMode
              ? { mode: input.continuationMode, queueItemId: input.queueItemId }
              : undefined,
          })
        : createDraftTurn({
            sessionId: input.sessionId,
            runtimeKind,
            userText,
            files,
            contextParts,
            continuation: input.continuationMode
              ? { mode: input.continuationMode, queueItemId: input.queueItemId }
              : undefined,
          })

    if (lastRequestMessage?.role === 'assistant') {
      startAssistantContinuation({
        sessionId: input.sessionId,
        message: lastRequestMessage,
      })
    }

    const run = startRun({
      sessionId: input.sessionId,
      messageId: draft.assistantMessageId,
      origin: 'user',
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
        input.modelId
        ?? readProviderStateSnapshot(runtimeSession.providerStateSnapshot).models.currentModelId,
      chunkBuffer: [],
      chunkBufferIndexByKey: new Map(),
      pendingDeltaChunk: null,
      pendingDeltaFlushTimer: null,
      snapshotTimer: null,
      finalMessage: lastRequestMessage?.role === 'assistant'
        ? lastRequestMessage
        : createAssistantMessage(draft.assistantMessageId),
      finalProjection: createFinalMessageProjectionState(),
      queueItemId: input.queueItemId,
      permissionMode: input.permissionMode,
    }
    activeRuns.set(run.id, activeRun)
    startSnapshotTimer(activeRun)
    activeRunIdsBySession.set(input.sessionId, run.id)
    if (isChatStreamTraceEnabled()) {
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
          queueItemId: activeRun.queueItemId ?? null,
        },
      })
    }
    if (input.queueItemId) {
      db()
        .update(chatSessionQueueItems)
        .set({
          status: 'running',
          startedRunId: run.id,
          errorText: null,
          updatedAt: currentUnixSeconds(),
        })
        .where(
          and(
            eq(chatSessionQueueItems.id, input.queueItemId),
            eq(chatSessionQueueItems.sessionId, input.sessionId),
          ),
        )
        .run()
    }
    pendingRunSessions.delete(input.sessionId)

    const turnContext = requestMessages
      ? {
          systemPrompt: resolveSessionSystemPrompt(context.session),
          history: requestMessages.slice(0, -1),
        }
      : resolveTurnContext({
          sessionId: input.sessionId,
          draftMessageId: draft.assistantMessageId,
          draftUserMessageId: draft.userMessageId,
        })

    void executeRun(activeRun, {
      message: draft.userMessage,
      profile: context.profile,
      modelId: input.modelId,
      thinkingEffort: input.thinkingEffort,
      permissionMode: input.permissionMode,
      systemPrompt: turnContext.systemPrompt,
      transcript: turnContext.transcript,
      history: turnContext.history?.length ? turnContext.history : undefined,
      originalMessages: requestMessages,
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
    const pending = pendingRunSessions.get(input.sessionId)
    pendingRunSessions.delete(input.sessionId)
    const cancelledClaimedQueueItem = Boolean(
      input.queueItemId
      && pending?.cancelled
      && error instanceof AppError
      && error.code === 'chat_run_cancelled',
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
  contextParts?: ChatContextPart[]
  messages?: UIMessage[]
  providerTargetId?: string
  modelId?: string
  thinkingEffort?: 'low' | 'medium' | 'high'
  permissionMode?: ChatPermissionMode
}): Promise<{
  runId: string
  assistantMessageId: string
  userMessageId: string
  stream: ReadableStream<Uint8Array>
}> {
  const result = await createRun(input)
  return {
    ...result,
    stream: openRunStream(result.runId),
  }
}

export function openSessionRunStream(sessionId: string): ReadableStream<Uint8Array> {
  assertStoredSession(sessionId)

  const runId = activeRunIdsBySession.get(sessionId)
  if (!runId) {
    return openIdleRunStream()
  }

  return openRunEventStream(runId)
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
        details: { runId },
      })
    }
    abortPersistedRun(persistedRun)
    return
  }

  await settleActiveRun(active, 'aborted', null)
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
    const pendingState = pendingRunSessions.get(sessionId)
    if (pendingState) {
      pendingState.cancelled = true
      if (pendingState.queueItemId) {
        db()
          .update(chatSessionQueueItems)
          .set({
            status: 'cancelled',
            errorText: null,
            updatedAt: currentUnixSeconds(),
          })
          .where(
            and(
              eq(chatSessionQueueItems.id, pendingState.queueItemId),
              eq(chatSessionQueueItems.sessionId, sessionId),
            ),
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
        await settleActiveRun(active, 'aborted', null)
        try {
          await requestRuntimeCancel(active)
        }
 finally {
          releaseActiveRun(active)
        }
      }
    }
 catch {
      /* best-effort */
    }
  }
  activeRuns.clear()
  activeRunIdsBySession.clear()
}

export function openRunStream(runId: string): ReadableStream<Uint8Array> {
  return openRunEventStream(runId)
}

function openRunEventStream(runId: string): ReadableStream<Uint8Array> {
  const run = getRun(runId)
  if (!run) {
    throw new AppError({
      code: 'chat_run_not_found',
      status: 404,
      message: 'Chat run not found',
      details: { runId },
    })
  }
  const active = activeRuns.get(runId)

  const encoder = new TextEncoder()
  let unsubscribe = () => {}
  let queuedChunk: UIMessageChunk | null = null
  let flushTimer: StreamFlushTimer | null = null
  let closed = false
  const clearQueuedFlush = () => {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    queuedChunk = null
  }
  return new ReadableStream<Uint8Array>({
    start: (controller) => {
      const clearFlushTimer = () => {
        if (flushTimer) {
          clearTimeout(flushTimer)
          flushTimer = null
        }
      }

      const closeStream = (flushQueued: boolean) => {
        if (closed) {
          return
        }
        if (flushQueued) {
          clearFlushTimer()
          flushQueuedChunk()
        }
        closed = true
        clearQueuedFlush()
        unsubscribe()
        controller.close()
      }

      const writeEncodedChunk = (chunk: UIMessageChunk, terminal: boolean) => {
        if (closed) {
          return
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
        if (terminal) {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          closeStream(false)
        }
      }

      const flushQueuedChunk = () => {
        flushTimer = null
        const chunk = queuedChunk
        queuedChunk = null
        if (chunk) {
          writeEncodedChunk(chunk, false)
        }
      }

      const scheduleFlush = () => {
        flushTimer ??= setTimeout(flushQueuedChunk, 0)
      }

      const writeChunk = (chunk: UIMessageChunk, terminal: boolean) => {
        if (closed) {
          return
        }

        if (terminal) {
          clearFlushTimer()
          flushQueuedChunk()
          writeEncodedChunk(chunk, true)
          return
        }

        if (!queuedChunk) {
          queuedChunk = chunk
          scheduleFlush()
          return
        }

        const merged = mergeSseStreamChunk(queuedChunk, chunk)
        if (merged) {
          queuedChunk = merged
          scheduleFlush()
          return
        }

        flushQueuedChunk()
        queuedChunk = chunk
        scheduleFlush()
      }

      for (const chunk of active?.chunkBuffer ?? []) {
        const terminal = isTerminalUIMessageChunk(chunk)
        writeChunk(chunk, terminal)
        if (terminal) {
          return
        }
      }

      if (run.status !== 'streaming' || !active) {
        closeStream(true)
        return
      }

      const subscribers = runSubscribers.get(runId) ?? new Set<RunSubscriber>()
      const subscriber: RunSubscriber = (chunk, terminal) => writeChunk(chunk, terminal)
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
    cancel: () => {
      closed = true
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
      queuedChunk = null
      unsubscribe()
    },
  })
}

function mergeSseStreamChunk(existing: UIMessageChunk, next: UIMessageChunk): UIMessageChunk | null {
  if (existing.type === 'text-delta' && next.type === 'text-delta' && existing.id === next.id) {
    if (existing.delta.length + next.delta.length > runDeltaFlushChars()) {
      return null
    }
    return {
      ...next,
      delta: `${existing.delta}${next.delta}`,
      providerMetadata: next.providerMetadata ?? existing.providerMetadata,
    }
  }
  if (existing.type === 'reasoning-delta' && next.type === 'reasoning-delta' && existing.id === next.id) {
    if (existing.delta.length + next.delta.length > runDeltaFlushChars()) {
      return null
    }
    return {
      ...next,
      delta: `${existing.delta}${next.delta}`,
      providerMetadata: next.providerMetadata ?? existing.providerMetadata,
    }
  }
  if (existing.type === 'tool-input-delta' && next.type === 'tool-input-delta' && existing.toolCallId === next.toolCallId) {
    if (existing.inputTextDelta.length + next.inputTextDelta.length > runDeltaFlushChars()) {
      return null
    }
    return {
      ...next,
      inputTextDelta: `${existing.inputTextDelta}${next.inputTextDelta}`,
    }
  }
  return null
}

function openIdleRunStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.close()
    },
  })
}

export function waitForRunCompletion(runId: string): Promise<BackendRun> {
  const run = getRun(runId)
  if (!run) {
    throw new AppError({
      code: 'chat_run_not_found',
      status: 404,
      message: 'Chat run not found',
      details: { runId },
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
    .orderBy(messages.createdAt, messageInsertOrder)
    .all()
}

export function listSessionQueueItems(sessionId: string): ChatSessionQueueItemDto[] {
  assertStoredSession(sessionId)
  return db()
    .select()
    .from(chatSessionQueueItems)
    .where(eq(chatSessionQueueItems.sessionId, sessionId))
    .all()
    .sort(compareQueueRows)
    .map(toQueueItemDto)
}

export async function enqueueSessionQueueItem(
  input: EnqueueSessionQueueItemInput,
): Promise<ChatSessionQueueItemDto> {
  const context = getSessionRunContext(input.sessionId, { providerTargetId: input.providerTargetId })
  if (!context) {
    throw new AppError({
      code: 'chat_session_not_found',
      status: 404,
      message: 'Chat session not found',
      details: { sessionId: input.sessionId },
    })
  }
  assertRuntimeCompatibleTarget(context, input.providerTargetId)

  const text = input.text?.trim() ?? ''
  const files = input.files ?? []
  const contextParts = input.contextParts ?? []
  if (!text && files.length === 0 && contextParts.length === 0) {
    throw new AppError({
      code: 'chat_queue_item_empty',
      status: 400,
      message: 'Chat queue item requires text, context, or at least one file attachment',
      details: { sessionId: input.sessionId },
    })
  }

  const pendingRows = listPendingQueueRows(input.sessionId)
  const position
    = pendingRows.reduce((maxPosition, row) => Math.max(maxPosition, row.position), 0) + 1
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
      contextPartsJson: serializeQueueContextParts(contextParts),
      providerTargetId: input.providerTargetId?.trim() || null,
      modelId: input.modelId?.trim() || null,
      thinkingEffort: input.thinkingEffort ?? null,
      permissionMode: input.permissionMode ?? null,
      position,
      sourceRunId: getSourceRunId(input.sessionId),
      startedRunId: null,
      errorText: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get()

  if (input.mode === 'steer') {
    const steered = await tryApplyLiveSteer({
      queueItemId: row.id,
      sessionId: input.sessionId,
      text,
      files,
      contextParts,
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
  contextParts: ChatContextPart[]
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
      updatedAt: currentUnixSeconds(),
    })
    .where(
      and(
        eq(chatSessionQueueItems.id, input.queueItemId),
        eq(chatSessionQueueItems.sessionId, input.sessionId),
        eq(chatSessionQueueItems.status, 'pending'),
      ),
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
          eq(chatSessionQueueItems.sessionId, input.sessionId),
        ),
      )
      .get()
    return current ? toQueueItemDto(current) : null
  }

  const steerMessage = annotateContinuationMessage(
    createUserMessage(randomUUID(), input.text, input.files, input.contextParts),
    { mode: 'steer', queueItemId: input.queueItemId },
  )
  try {
    await activeRun.runtime.steerTurn({
      runtimeSession: activeRun.runtimeSession,
      profile: context.profile,
      message: steerMessage,
    })
  }
 catch (error) {
    chatLogger.warn('runtime live steer failed; leaving item queued for later drain', {
      error,
      sessionId: input.sessionId,
      runId,
      queueItemId: input.queueItemId,
      runtimeKind: activeRun.runtimeSession.runtimeKind,
    })
    db()
      .update(chatSessionQueueItems)
      .set({
        status: 'pending',
        startedRunId: null,
        errorText: null,
        updatedAt: currentUnixSeconds(),
      })
      .where(
        and(
          eq(chatSessionQueueItems.id, input.queueItemId),
          eq(chatSessionQueueItems.sessionId, input.sessionId),
          eq(chatSessionQueueItems.status, 'running'),
          eq(chatSessionQueueItems.startedRunId, runId),
        ),
      )
      .run()
    return null
  }

  let historyErrorText: string | null = null
  try {
    insertCompletedUserMessage({ sessionId: input.sessionId, message: steerMessage })
  }
 catch (error) {
    historyErrorText = serializeChatError(error).text
    chatLogger.warn('runtime live steer was applied but history persistence failed', {
      error,
      sessionId: input.sessionId,
      runId,
      queueItemId: input.queueItemId,
      runtimeKind: activeRun.runtimeSession.runtimeKind,
    })
  }

  const updated = db()
    .update(chatSessionQueueItems)
    .set({
      status: 'completed',
      startedRunId: runId,
      errorText: historyErrorText,
      updatedAt: currentUnixSeconds(),
    })
    .where(
      and(
        eq(chatSessionQueueItems.id, input.queueItemId),
        eq(chatSessionQueueItems.sessionId, input.sessionId),
        eq(chatSessionQueueItems.status, 'running'),
        eq(chatSessionQueueItems.startedRunId, runId),
      ),
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
          eq(chatSessionQueueItems.sessionId, input.sessionId),
        ),
      )
      .get()
    return current ? toQueueItemDto(current) : toQueueItemDto(claimed)
  }
  normalizePendingQueuePositions(input.sessionId)
  return toQueueItemDto(updated)
}

export async function setSessionPermissionMode(input: {
  sessionId: string
  mode: ChatPermissionMode
}): Promise<boolean> {
  const runId = activeRunIdsBySession.get(input.sessionId)
  if (!runId) {
    return false
  }

  const activeRun = activeRuns.get(runId)
  if (!activeRun?.runtime.setPermissionMode || activeRun.terminalStatus) {
    return false
  }

  const context = getSessionRunContext(input.sessionId)
  if (!context) {
    return false
  }

  try {
    await activeRun.runtime.setPermissionMode({
      runtimeSession: activeRun.runtimeSession,
      profile: context.profile,
      mode: input.mode,
    })
    activeRun.permissionMode = input.mode
    return true
  }
  catch (error) {
    chatLogger.warn('set permission mode failed', {
      error,
      sessionId: input.sessionId,
      runId,
      mode: input.mode,
    })
    return false
  }
}

export function cancelSessionQueueItem(
  sessionId: string,
  queueItemId: string,
): ChatSessionQueueItemDto {
  assertRunnableSession(sessionId)
  const row = db()
    .select()
    .from(chatSessionQueueItems)
    .where(
      and(eq(chatSessionQueueItems.id, queueItemId), eq(chatSessionQueueItems.sessionId, sessionId)),
    )
    .get()
  if (!row) {
    throw new AppError({
      code: 'chat_queue_item_not_found',
      status: 404,
      message: 'Chat queue item not found',
      details: { sessionId, queueItemId },
    })
  }
  if (row.status !== 'pending') {
    throw new AppError({
      code: 'chat_queue_item_not_pending',
      status: 409,
      message: 'Only pending chat queue items can be cancelled',
      details: { sessionId, queueItemId, status: row.status },
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
        eq(chatSessionQueueItems.status, 'pending'),
      ),
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
          eq(chatSessionQueueItems.sessionId, sessionId),
        ),
      )
      .get()
    throw new AppError({
      code: 'chat_queue_item_not_pending',
      status: 409,
      message: 'Only pending chat queue items can be cancelled',
      details: { sessionId, queueItemId, status: current?.status ?? 'missing' },
    })
  }
  normalizePendingQueuePositions(sessionId)
  return toQueueItemDto(updated)
}

export function reorderSessionQueueItems(
  sessionId: string,
  queueItemIds: string[],
): ChatSessionQueueItemDto[] {
  assertRunnableSession(sessionId)
  const pendingRows = listPendingQueueRows(sessionId)
  const pendingIds = pendingRows.map(row => row.id)
  const requestedIds = new Set(queueItemIds)
  const pendingIdSet = new Set(pendingIds)
  const hasSameItems
    = queueItemIds.length === pendingIds.length
      && queueItemIds.every(id => pendingIdSet.has(id))
      && pendingIds.every(id => requestedIds.has(id))
  if (!hasSameItems) {
    throw new AppError({
      code: 'chat_queue_reorder_invalid',
      status: 400,
      message: 'Queue reorder must include every pending chat queue item exactly once',
      details: { sessionId, pendingIds, queueItemIds },
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
            eq(chatSessionQueueItems.status, 'pending'),
          ),
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
    permissionMode?: ChatPermissionMode
    systemPrompt?: string
    transcript?: CradleTurnTranscript
    history?: UIMessage[]
    originalMessages?: UIMessage[]
    workspaceId?: string | null
    workspacePath?: string
  },
): Promise<void> {
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
  let actualModelId = activeRun.modelId
  const profile = startChatRuntimeProfile()

  try {
    for await (const chunk of activeRun.runtime.streamTurn({
      runId: activeRun.runId,
      runtimeSession: activeRun.runtimeSession,
      profile: input.profile,
      message: input.message,
      responseMessageId: activeRun.messageId,
      modelId: input.modelId,
      transcript: input.transcript,
      workspaceId: input.workspaceId,
      workspacePath: input.workspacePath,
      providerOptions: input.thinkingEffort || input.permissionMode
        ? {
            ...(input.thinkingEffort ? { thinkingEffort: input.thinkingEffort } : {}),
            ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
          }
        : undefined,
      systemPrompt: input.systemPrompt,
      history: input.history,
      originalMessages: input.originalMessages,
      reportSessionTitle: title => reportRuntimeSessionTitle({ sessionId: activeRun.sessionId, title }),
    })) {
      if (activeRun.terminalStatus) {
        break
      }
      if (isChatStreamTraceEnabled()) {
        recordChatStreamTrace({
          chatSessionId: activeRun.sessionId,
          runId: activeRun.runId,
          messageId: activeRun.messageId,
          runtimeKind: activeRun.runtimeSession.runtimeKind,
          providerSessionId: activeRun.runtimeSession.providerSessionId,
          phase: 'runtime_chunk',
          payload: chunk,
        })
      }
      accumulateDiagnostics(diagnostics, chunk)
      if (isTerminalUIMessageChunk(chunk)) {
        finalChunk = chunk
      }
 else {
        if (chunk.type === 'start' && activeRun.startChunkPublished) {
          continue
        }
        if (chunk.type !== 'start') {
          publishRunStartChunk(activeRun)
        }
        publishRuntimeChunk(activeRun, chunk)
      }
    }

    flushPendingRunDelta(activeRun)
    finalChunk = resolveTerminalChunkWithDiagnostics(finalChunk, diagnostics, {
      allowEmptyAssistantOutput: isProviderNativeNoOutputCommandTurn(activeRun, input.message),
    })
    profile.streamFinishedAtMs = performance.now()
  }
 catch (error) {
    flushPendingRunDelta(activeRun)
    profile.streamFinishedAtMs = performance.now()
    if (isAbortError(error)) {
      finalChunk = { type: 'abort', reason: 'user' }
    }
 else {
      const serializedError = serializeChatError(error)
      failurePayload = serializedError.payload
      finalChunk = { type: 'error', errorText: serializedError.text }
    }
  }

  try {
    if (!activeRun.cancelRequested) {
      await publishTerminalChunk(activeRun, finalChunk, profile)

      const finalFailureText = finalChunk.type === 'error' ? finalChunk.errorText : null

      if (finalFailureText) {
        const observabilityCode = resolveTurnFailureObservabilityCode(finalChunk)
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
                  runId: null,
                })
              : undefined,
          attrs: {
            providerTargetId: activeRun.providerTargetId,
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
          providerTargetId: activeRun.providerTargetId,
          modelId: actualModelId,
          usage,
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
              createdAt: currentUnixSeconds(),
            })
            .run()
        }
      }
    }
  }
 catch (error) {
    chatLogger.error('failed to persist run finalization (session may have been deleted)', {
      error,
    })
  }
 finally {
    // Persist updated providerSessionId/state obtained during the run
    try {
      attachBinding({
        sessionId: activeRun.sessionId,
        providerTargetId: activeRun.providerTargetId,
        runtimeKind: activeRun.runtimeSession.runtimeKind,
        runtimeSession: activeRun.runtimeSession,
        requestedModelId: actualModelId,
      })
    }
 catch {
      // session may have been deleted during the run
    }
    releaseActiveRun(activeRun)
    scheduleSessionQueueDrain(activeRun.sessionId)
    recordChatRuntimeProfile(activeRun, diagnostics, profile)
  }
}

function runDeltaFlushMs(): number {
  return readPositiveIntegerEnv('CRADLE_CHAT_RUN_DELTA_FLUSH_MS', DEFAULT_RUN_DELTA_FLUSH_MS)
}

function runDeltaFlushChars(): number {
  return readPositiveIntegerEnv('CRADLE_CHAT_RUN_DELTA_FLUSH_CHARS', DEFAULT_RUN_DELTA_FLUSH_CHARS)
}

function snapshotIntervalMs(): number {
  return readPositiveIntegerEnv('CRADLE_CHAT_SNAPSHOT_INTERVAL_MS', DEFAULT_SNAPSHOT_INTERVAL_MS)
}

function snapshotActiveRun(activeRun: ActiveRun): void {
  if (activeRun.terminalStatus) {
    return
  }
  flushFinalMessageProjection(activeRun)
  persistMessageSnapshot({
    sessionId: activeRun.sessionId,
    messageId: activeRun.messageId,
    message: activeRun.finalMessage,
    messageStatus: 'streaming',
    errorText: null,
  })
}

function startSnapshotTimer(activeRun: ActiveRun): void {
  stopSnapshotTimer(activeRun)
  activeRun.snapshotTimer = setInterval(() => snapshotActiveRun(activeRun), snapshotIntervalMs())
}

function stopSnapshotTimer(activeRun: ActiveRun): void {
  if (activeRun.snapshotTimer) {
    clearInterval(activeRun.snapshotTimer)
    activeRun.snapshotTimer = null
  }
}

export function flushAllActiveRunSnapshots(): void {
  for (const activeRun of activeRuns.values()) {
    try {
      snapshotActiveRun(activeRun)
    }
 catch {
      // best-effort on shutdown
    }
  }
}

function readChunkTraceToolCallId(chunk: UIMessageChunk): string | null {
  const value = (chunk as { toolCallId?: unknown }).toolCallId
  return typeof value === 'string' ? value : null
}

function createFinalMessageProjectionState(): FinalMessageProjectionState {
  return {
    activeTextParts: new Map(),
    activeReasoningParts: new Map(),
    partialToolCalls: new Map(),
  }
}

function publishRuntimeChunk(activeRun: ActiveRun, chunk: UIMessageChunk): void {
  const pending = activeRun.pendingDeltaChunk
  if (!pending) {
    if (readRunDeltaCoalesceKey(chunk)) {
      activeRun.pendingDeltaChunk = chunk
      schedulePendingRunDeltaFlush(activeRun)
      return
    }
    publishUIMessageChunk(activeRun, chunk, false)
    return
  }

  const merged = mergeRuntimeDeltaChunk(pending, chunk)
  if (merged) {
    activeRun.pendingDeltaChunk = merged
    if (readDeltaChunkTextLength(merged) >= runDeltaFlushChars()) {
      flushPendingRunDelta(activeRun)
      return
    }
    schedulePendingRunDeltaFlush(activeRun)
    return
  }

  flushPendingRunDelta(activeRun)
  if (readRunDeltaCoalesceKey(chunk)) {
    activeRun.pendingDeltaChunk = chunk
    schedulePendingRunDeltaFlush(activeRun)
    return
  }
  publishUIMessageChunk(activeRun, chunk, false)
}

function schedulePendingRunDeltaFlush(activeRun: ActiveRun): void {
  if (activeRun.pendingDeltaFlushTimer) {
    return
  }
  activeRun.pendingDeltaFlushTimer = setTimeout(() => {
    activeRun.pendingDeltaFlushTimer = null
    flushPendingRunDelta(activeRun)
  }, runDeltaFlushMs())
}

function flushPendingRunDelta(activeRun: ActiveRun): void {
  if (activeRun.pendingDeltaFlushTimer) {
    clearTimeout(activeRun.pendingDeltaFlushTimer)
    activeRun.pendingDeltaFlushTimer = null
  }
  const chunk = activeRun.pendingDeltaChunk
  activeRun.pendingDeltaChunk = null
  if (chunk && !activeRun.terminalStatus) {
    publishUIMessageChunk(activeRun, chunk, false)
  }
}

function readRunDeltaCoalesceKey(chunk: UIMessageChunk): string | null {
  switch (chunk.type) {
    case 'text-delta':
      return `text-delta:${chunk.id}`
    case 'reasoning-delta':
      return `reasoning-delta:${chunk.id}`
    case 'tool-input-delta':
      return `tool-input-delta:${chunk.toolCallId}`
    default:
      return null
  }
}

function mergeRuntimeDeltaChunk(existing: UIMessageChunk, next: UIMessageChunk): UIMessageChunk | null {
  if (existing.type === 'text-delta' && next.type === 'text-delta' && existing.id === next.id) {
    return {
      ...next,
      delta: `${existing.delta}${next.delta}`,
      providerMetadata: next.providerMetadata ?? existing.providerMetadata,
    }
  }
  if (existing.type === 'reasoning-delta' && next.type === 'reasoning-delta' && existing.id === next.id) {
    return {
      ...next,
      delta: `${existing.delta}${next.delta}`,
      providerMetadata: next.providerMetadata ?? existing.providerMetadata,
    }
  }
  if (existing.type === 'tool-input-delta' && next.type === 'tool-input-delta' && existing.toolCallId === next.toolCallId) {
    return {
      ...next,
      inputTextDelta: `${existing.inputTextDelta}${next.inputTextDelta}`,
    }
  }
  return null
}

function readDeltaChunkTextLength(chunk: UIMessageChunk): number {
  switch (chunk.type) {
    case 'text-delta':
    case 'reasoning-delta':
      return chunk.delta.length
    case 'tool-input-delta':
      return chunk.inputTextDelta.length
    default:
      return 0
  }
}

function publishUIMessageChunk(activeRun: ActiveRun, chunk: UIMessageChunk, terminal: boolean): void {
  if (chunk.type === 'start') {
    activeRun.startChunkPublished = true
  }

  if (isChatStreamTraceEnabled()) {
    recordChatStreamTrace({
      chatSessionId: activeRun.sessionId,
      runId: activeRun.runId,
      messageId: activeRun.messageId,
      runtimeKind: activeRun.runtimeSession.runtimeKind,
      providerSessionId: activeRun.runtimeSession.providerSessionId,
      toolCallId: readChunkTraceToolCallId(chunk),
      phase: 'sse_emit',
      payload: {
        chunk,
        terminal,
        subscriberCount: runSubscribers.get(activeRun.runId)?.size ?? 0,
      },
    })
  }

  if (!terminal) {
    projectFinalMessageChunk(activeRun, chunk)
  }
  bufferReplayChunk(activeRun, chunk)

  const subscribers = runSubscribers.get(activeRun.runId)
  if (!subscribers) {
    return
  }

  const dead: RunSubscriber[] = []
  for (const subscriber of subscribers) {
    try {
      subscriber(chunk, terminal)
    }
 catch {
      dead.push(subscriber)
    }
  }
  for (const subscriber of dead) {
    subscribers.delete(subscriber)
  }
  if (terminal || subscribers.size === 0) {
    runSubscribers.delete(activeRun.runId)
  }
}

function projectFinalMessageChunk(activeRun: ActiveRun, chunk: UIMessageChunk): void {
  const message = activeRun.finalMessage
  const projection = activeRun.finalProjection

  switch (chunk.type) {
    case 'text-start': {
      const part = {
        type: 'text',
        text: '',
        state: 'streaming',
        ...(chunk.providerMetadata ? { providerMetadata: chunk.providerMetadata } : {}),
      } satisfies MutableTextPart
      projection.activeTextParts.set(chunk.id, { part, deltas: [] })
      message.parts.push(part)
      break
    }
    case 'text-delta': {
      const activePart = projection.activeTextParts.get(chunk.id)
      if (activePart) {
        activePart.deltas.push(chunk.delta)
        activePart.part.providerMetadata = chunk.providerMetadata ?? activePart.part.providerMetadata
      }
      break
    }
    case 'text-end': {
      const activePart = projection.activeTextParts.get(chunk.id)
      if (activePart) {
        flushProjectedTextPart(activePart)
        activePart.part.state = 'done'
        activePart.part.providerMetadata = chunk.providerMetadata ?? activePart.part.providerMetadata
        projection.activeTextParts.delete(chunk.id)
      }
      break
    }
    case 'reasoning-start': {
      const part = {
        type: 'reasoning',
        text: '',
        state: 'streaming',
        ...(chunk.providerMetadata ? { providerMetadata: chunk.providerMetadata } : {}),
      } satisfies MutableReasoningPart
      projection.activeReasoningParts.set(chunk.id, { part, deltas: [] })
      message.parts.push(part)
      break
    }
    case 'reasoning-delta': {
      const activePart = projection.activeReasoningParts.get(chunk.id)
      if (activePart) {
        activePart.deltas.push(chunk.delta)
        activePart.part.providerMetadata = chunk.providerMetadata ?? activePart.part.providerMetadata
      }
      break
    }
    case 'reasoning-end': {
      const activePart = projection.activeReasoningParts.get(chunk.id)
      if (activePart) {
        flushProjectedTextPart(activePart)
        activePart.part.state = 'done'
        activePart.part.providerMetadata = chunk.providerMetadata ?? activePart.part.providerMetadata
        projection.activeReasoningParts.delete(chunk.id)
      }
      break
    }
    case 'tool-input-start': {
      projection.partialToolCalls.set(chunk.toolCallId, {
        deltas: [],
        toolName: chunk.toolName,
        dynamic: chunk.dynamic,
        title: chunk.title,
      })
      upsertProjectedToolPart(message, {
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        state: 'input-streaming',
        input: undefined,
        providerExecuted: chunk.providerExecuted,
        providerMetadata: chunk.providerMetadata,
        dynamic: chunk.dynamic,
        title: chunk.title,
      })
      break
    }
    case 'tool-input-delta': {
      const partialToolCall = projection.partialToolCalls.get(chunk.toolCallId)
      if (partialToolCall) {
        partialToolCall.deltas.push(chunk.inputTextDelta)
        upsertProjectedToolPart(message, {
          toolCallId: chunk.toolCallId,
          toolName: partialToolCall.toolName,
          state: 'input-streaming',
          input: undefined,
          dynamic: partialToolCall.dynamic,
          title: partialToolCall.title,
        })
      }
      break
    }
    case 'tool-input-available':
      projection.partialToolCalls.delete(chunk.toolCallId)
      upsertProjectedToolPart(message, {
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        state: 'input-available',
        input: chunk.input,
        providerExecuted: chunk.providerExecuted,
        providerMetadata: chunk.providerMetadata,
        dynamic: chunk.dynamic,
        title: chunk.title,
      })
      break
    case 'tool-output-available':
      updateProjectedToolOutput(message, chunk.toolCallId, {
        state: 'output-available',
        output: chunk.output,
        providerExecuted: chunk.providerExecuted,
        providerMetadata: chunk.providerMetadata,
        preliminary: chunk.preliminary,
        dynamic: chunk.dynamic,
      })
      break
    case 'tool-output-error':
      updateProjectedToolOutput(message, chunk.toolCallId, {
        state: 'output-error',
        errorText: chunk.errorText,
        providerExecuted: chunk.providerExecuted,
        providerMetadata: chunk.providerMetadata,
        dynamic: chunk.dynamic,
      })
      break
    case 'tool-output-denied':
      updateProjectedToolOutput(message, chunk.toolCallId, { state: 'output-denied' })
      break
    case 'start-step':
      message.parts.push({ type: 'step-start' })
      break
    case 'finish-step':
      flushFinalMessageProjection(activeRun)
      break
    case 'file':
      message.parts.push({
        type: 'file',
        mediaType: chunk.mediaType,
        url: chunk.url,
        ...(chunk.providerMetadata ? { providerMetadata: chunk.providerMetadata } : {}),
      })
      break
    case 'source-url':
      message.parts.push({
        type: 'source-url',
        sourceId: chunk.sourceId,
        url: chunk.url,
        title: chunk.title,
        providerMetadata: chunk.providerMetadata,
      })
      break
    case 'source-document':
      message.parts.push({
        type: 'source-document',
        sourceId: chunk.sourceId,
        mediaType: chunk.mediaType,
        title: chunk.title,
        filename: chunk.filename,
        providerMetadata: chunk.providerMetadata,
      })
      break
  }
}

function flushFinalMessageProjection(activeRun: ActiveRun): void {
  for (const activePart of activeRun.finalProjection.activeTextParts.values()) {
    flushProjectedTextPart(activePart)
  }
  for (const activePart of activeRun.finalProjection.activeReasoningParts.values()) {
    flushProjectedTextPart(activePart)
  }
}

function flushProjectedTextPart<TPart extends MutableTextPart | MutableReasoningPart>(
  activePart: ProjectedTextPart<TPart>,
): void {
  if (activePart.deltas.length === 0) {
    return
  }
  activePart.part.text += activePart.deltas.join('')
  activePart.deltas = []
}

function upsertProjectedToolPart(
  message: UIMessage,
  options: {
    toolCallId: string
    toolName: string
    state: 'input-streaming' | 'input-available'
    input: unknown
    providerExecuted?: boolean
    providerMetadata?: ProviderMetadata
    dynamic?: boolean
    title?: string
  },
): void {
  const part = findProjectedToolPart(message, options.toolCallId)
  if (part) {
    assignProjectedToolPart(part, {
      state: options.state,
      input: options.input,
      providerExecuted: options.providerExecuted,
      title: options.title,
      providerMetadata: options.providerMetadata,
      isResultMetadata: false,
    })
    return
  }

  if (options.dynamic) {
    message.parts.push({
      type: 'dynamic-tool',
      toolName: options.toolName,
      toolCallId: options.toolCallId,
      state: options.state,
      input: options.input,
      providerExecuted: options.providerExecuted,
      title: options.title,
      ...(options.providerMetadata ? { callProviderMetadata: options.providerMetadata } : {}),
    } as UIMessage['parts'][number])
    return
  }

  message.parts.push({
    type: `tool-${options.toolName}`,
    toolCallId: options.toolCallId,
    state: options.state,
    input: options.input,
    providerExecuted: options.providerExecuted,
    title: options.title,
    ...(options.providerMetadata ? { callProviderMetadata: options.providerMetadata } : {}),
  } as UIMessage['parts'][number])
}

function updateProjectedToolOutput(
  message: UIMessage,
  toolCallId: string,
  options: {
    state: 'output-available' | 'output-error' | 'output-denied'
    output?: unknown
    errorText?: string
    providerExecuted?: boolean
    providerMetadata?: ProviderMetadata
    preliminary?: boolean
    dynamic?: boolean
  },
): void {
  const part = findProjectedToolPart(message, toolCallId)
  if (!part) {
    return
  }

  assignProjectedToolPart(part, {
    state: options.state,
    output: options.output,
    errorText: options.errorText,
    providerExecuted: options.providerExecuted,
    preliminary: options.preliminary,
    providerMetadata: options.providerMetadata,
    isResultMetadata: true,
  })
}

function findProjectedToolPart(message: UIMessage, toolCallId: string): MutableToolPart | undefined {
  return message.parts.find((part): part is MutableToolPart => 'toolCallId' in part && part.toolCallId === toolCallId)
}

function assignProjectedToolPart(
  part: MutableToolPart,
  values: {
    state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error' | 'output-denied'
    input?: unknown
    output?: unknown
    errorText?: string
    providerExecuted?: boolean
    preliminary?: boolean
    title?: string
    providerMetadata?: ProviderMetadata
    isResultMetadata: boolean
  },
): void {
  const target = part as MutableToolPart & Record<string, unknown>
  target.state = values.state
  if ('input' in values) {
    target.input = values.input
  }
  if ('output' in values) {
    target.output = values.output
  }
  if ('errorText' in values) {
    target.errorText = values.errorText
  }
  if (values.providerExecuted !== undefined) {
    target.providerExecuted = values.providerExecuted
  }
  if (values.preliminary !== undefined) {
    target.preliminary = values.preliminary
  }
  if (values.title !== undefined) {
    target.title = values.title
  }
  if (values.providerMetadata !== undefined) {
    target[values.isResultMetadata ? 'resultProviderMetadata' : 'callProviderMetadata'] = values.providerMetadata
  }
}

function bufferReplayChunk(activeRun: ActiveRun, chunk: UIMessageChunk): void {
  const coalesced = coalesceReplayChunk(activeRun, chunk)
  if (coalesced) {
    return
  }

  activeRun.chunkBuffer.push(chunk)
}

function coalesceReplayChunk(activeRun: ActiveRun, chunk: UIMessageChunk): boolean {
  const key = readReplayCoalesceKey(chunk)
  if (!key) {
    return false
  }

  const existingIndex = activeRun.chunkBufferIndexByKey.get(key)
  if (existingIndex === undefined) {
    activeRun.chunkBufferIndexByKey.set(key, activeRun.chunkBuffer.length)
    return false
  }

  const existing = activeRun.chunkBuffer[existingIndex]
  const merged = mergeReplayChunk(existing, chunk)
  if (!merged) {
    activeRun.chunkBufferIndexByKey.set(key, activeRun.chunkBuffer.length)
    return false
  }
  activeRun.chunkBuffer[existingIndex] = merged
  return true
}

function readReplayCoalesceKey(chunk: UIMessageChunk): string | null {
  switch (chunk.type) {
    case 'text-delta':
      return `text-delta:${chunk.id}`
    case 'reasoning-delta':
      return `reasoning-delta:${chunk.id}`
    case 'tool-input-delta':
      return `tool-input-delta:${chunk.toolCallId}`
    case 'tool-output-available':
      return `tool-output-available:${chunk.toolCallId}`
    default:
      return null
  }
}

function mergeReplayChunk(existing: UIMessageChunk, next: UIMessageChunk): UIMessageChunk | null {
  if (existing.type === 'text-delta' && next.type === 'text-delta' && existing.id === next.id) {
    if (existing.delta.length + next.delta.length > runDeltaFlushChars()) {
      return null
    }
    return {
      ...next,
      delta: `${existing.delta}${next.delta}`,
      providerMetadata: next.providerMetadata ?? existing.providerMetadata,
    }
  }
  if (existing.type === 'reasoning-delta' && next.type === 'reasoning-delta' && existing.id === next.id) {
    if (existing.delta.length + next.delta.length > runDeltaFlushChars()) {
      return null
    }
    return {
      ...next,
      delta: `${existing.delta}${next.delta}`,
      providerMetadata: next.providerMetadata ?? existing.providerMetadata,
    }
  }
  if (existing.type === 'tool-input-delta' && next.type === 'tool-input-delta' && existing.toolCallId === next.toolCallId) {
    if (existing.inputTextDelta.length + next.inputTextDelta.length > runDeltaFlushChars()) {
      return null
    }
    return {
      ...next,
      inputTextDelta: `${existing.inputTextDelta}${next.inputTextDelta}`,
    }
  }
  return null
}

function publishRunStartChunk(activeRun: ActiveRun): void {
  if (activeRun.startChunkPublished) {
    return
  }
  flushPendingRunDelta(activeRun)
  publishUIMessageChunk(activeRun, { type: 'start', messageId: activeRun.messageId }, false)
}

async function publishTerminalChunk(activeRun: ActiveRun, chunk: UIMessageChunk, profile?: ChatRuntimeProfile): Promise<void> {
  publishRunStartChunk(activeRun)
  flushPendingRunDelta(activeRun)
  const status = readTerminalStatus(chunk)
  const errorText = chunk.type === 'error' ? chunk.errorText : null
  await finalizeActiveRun(activeRun, status, errorText, chunk, profile)
  publishUIMessageChunk(activeRun, chunk, true)
}

function readTerminalStatus(chunk: UIMessageChunk): TerminalChatMessageStatus {
  if (chunk.type === 'abort') {
    return 'aborted'
  }
  if (chunk.type === 'error') {
    return 'failed'
  }
  return 'complete'
}

function isTerminalUIMessageChunk(chunk: UIMessageChunk): boolean {
  return chunk.type === 'finish' || chunk.type === 'abort' || chunk.type === 'error'
}

async function finalizeActiveRun(
  activeRun: ActiveRun,
  status: ChatMessageStatus,
  errorText: string | null,
  terminalChunk: UIMessageChunk,
  profile?: ChatRuntimeProfile,
): Promise<void> {
  if (status === 'streaming' || activeRun.terminalStatus) {
    return
  }

  activeRun.terminalStatus = status
  if (profile) {
    profile.finalizeStartedAtMs = performance.now()
  }
  flushFinalMessageProjection(activeRun)
  flushProjectedToolInputs(activeRun)

  const snapshotResult = persistMessageSnapshot({
    sessionId: activeRun.sessionId,
    messageId: activeRun.messageId,
    message: activeRun.finalMessage,
    messageStatus: status,
    errorText,
  })
  if (profile) {
    profile.finalMessageJsonBytes = snapshotResult.messageJsonBytes
  }

  finalizeRun(activeRun, status, errorText)
  if (profile) {
    profile.finalizeFinishedAtMs = performance.now()
    profile.memoryFinished = profile.enabled ? process.memoryUsage() : null
  }
  if (isChatStreamTraceEnabled()) {
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
        message: activeRun.finalMessage,
      },
    })
  }
}

function flushProjectedToolInputs(activeRun: ActiveRun): void {
  const message = activeRun.finalMessage
  for (const [toolCallId, partialToolCall] of activeRun.finalProjection.partialToolCalls) {
    upsertProjectedToolPart(message, {
      toolCallId,
      toolName: partialToolCall.toolName,
      state: 'input-streaming',
      input: parsePartialToolInputText(partialToolCall.deltas.join('')),
      dynamic: partialToolCall.dynamic,
      title: partialToolCall.title,
    })
  }
}

function recordChatRuntimeProfile(
  activeRun: ActiveRun,
  diagnostics: TurnOutputDiagnostics,
  profile: ChatRuntimeProfile,
): void {
  if (!profile.enabled) {
    return
  }

  const streamFinishedAtMs = profile.streamFinishedAtMs ?? performance.now()
  const finalizeStartedAtMs = profile.finalizeStartedAtMs ?? streamFinishedAtMs
  const finalizeFinishedAtMs = profile.finalizeFinishedAtMs ?? performance.now()
  const memoryFinished = profile.memoryFinished ?? process.memoryUsage()
  const memoryStarted = profile.memoryStarted
  chatLogger.info('chat runtime profile', {
    chatSessionId: activeRun.sessionId,
    runId: activeRun.runId,
    messageId: activeRun.messageId,
    runtimeKind: activeRun.runtimeSession.runtimeKind,
    providerTargetId: activeRun.providerTargetId,
    modelId: activeRun.modelId,
    status: activeRun.terminalStatus ?? 'streaming',
    timingsMs: {
      stream: Math.round(streamFinishedAtMs - profile.streamStartedAtMs),
      finalize: Math.round(finalizeFinishedAtMs - finalizeStartedAtMs),
      total: Math.round(finalizeFinishedAtMs - profile.startedAtMs),
    },
    memory: {
      startHeapUsed: memoryStarted?.heapUsed ?? null,
      endHeapUsed: memoryFinished.heapUsed,
      deltaHeapUsed: memoryStarted ? memoryFinished.heapUsed - memoryStarted.heapUsed : null,
      startRss: memoryStarted?.rss ?? null,
      endRss: memoryFinished.rss,
      deltaRss: memoryStarted ? memoryFinished.rss - memoryStarted.rss : null,
    },
    activeRun: {
      replayChunks: activeRun.chunkBuffer.length,
      finalParts: activeRun.finalMessage.parts.length,
      finalMessageJsonBytes: profile.finalMessageJsonBytes,
    },
    diagnostics,
  })
}

async function settleActiveRun(
  activeRun: ActiveRun,
  status: TerminalChatMessageStatus,
  errorText: string | null,
): Promise<void> {
  if (activeRun.terminalStatus) {
    return
  }
  if (status === 'aborted') {
    activeRun.cancelRequested = true
  }
  const terminalChunk: UIMessageChunk
    = status === 'complete'
      ? { type: 'finish', finishReason: 'stop' }
      : status === 'aborted'
        ? { type: 'abort', reason: 'user' }
        : { type: 'error', errorText: errorText ?? 'Chat run failed' }
  await publishTerminalChunk(activeRun, terminalChunk)
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
    await activeRun.runtime.cancelTurn({
      runtimeSession: activeRun.runtimeSession,
      profile: context.profile,
    })
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

    tx.update(chatSessionQueueItems)
      .set({
        status: 'cancelled',
        errorText: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(chatSessionQueueItems.startedRunId, run.id),
          eq(chatSessionQueueItems.status, 'running'),
        ),
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
        updatedAt: now,
      })
      .where(and(eq(messages.sessionId, sessionId), eq(messages.status, 'streaming')))
      .run()

    tx.update(sessions).set({ updatedAt: now }).where(eq(sessions.id, sessionId)).run()
  })
}

function releaseActiveRun(activeRun: ActiveRun): void {
  stopSnapshotTimer(activeRun)
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
            eq(chatSessionQueueItems.status, 'pending'),
          ),
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
          contextParts: parseQueueContextParts(claimed.contextPartsJson),
          providerTargetId: claimed.providerTargetId ?? undefined,
          modelId: claimed.modelId ?? undefined,
          thinkingEffort: claimed.thinkingEffort as 'low' | 'medium' | 'high' | undefined,
          permissionMode: normalizeChatPermissionMode(claimed.permissionMode) ?? undefined,
          continuationMode: claimed.mode,
          queueItemId: claimed.id,
        })
        db()
          .update(chatSessionQueueItems)
          .set({
            startedRunId: run.runId,
            updatedAt: currentUnixSeconds(),
          })
          .where(
            and(
              eq(chatSessionQueueItems.id, claimed.id),
              eq(chatSessionQueueItems.sessionId, sessionId),
              eq(chatSessionQueueItems.status, 'running'),
            ),
          )
          .run()
        normalizePendingQueuePositions(sessionId)
        return
      }
 catch (error) {
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
              updatedAt: currentUnixSeconds(),
            })
            .where(
              and(
                eq(chatSessionQueueItems.id, claimed.id),
                eq(chatSessionQueueItems.sessionId, sessionId),
                eq(chatSessionQueueItems.status, 'running'),
              ),
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
            updatedAt: currentUnixSeconds(),
          })
          .where(
            and(
              eq(chatSessionQueueItems.id, claimed.id),
              eq(chatSessionQueueItems.sessionId, sessionId),
              eq(chatSessionQueueItems.status, 'running'),
            ),
          )
          .run()
        normalizePendingQueuePositions(sessionId)
      }
    }
  }
 finally {
    drainingQueueSessionIds.delete(sessionId)
    if (
      requestedQueueDrainSessionIds.delete(sessionId)
      || (!activeRunIdsBySession.has(sessionId)
        && !pendingRunSessions.has(sessionId)
        && listPendingQueueRows(sessionId).length > 0)
    ) {
      scheduleSessionQueueDrain(sessionId)
    }
  }
}

function finalizeRun(
  activeRun: ActiveRun,
  status: ChatMessageStatus,
  errorText: string | null,
): void {
  const stopReason
    = status === 'complete'
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
      finishedAt: currentUnixSeconds(),
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
        updatedAt: currentUnixSeconds(),
      })
      .where(
        and(
          eq(chatSessionQueueItems.id, activeRun.queueItemId),
          eq(chatSessionQueueItems.sessionId, activeRun.sessionId),
          eq(chatSessionQueueItems.status, 'running'),
        ),
      )
      .run()
  }
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

interface TurnOutputValidationResult {
  ok: boolean
  errorText: string | null
}

function validateTurnOutput(
  diagnostics: TurnOutputDiagnostics,
  options: { allowEmptyAssistantOutput?: boolean } = {},
): TurnOutputValidationResult {
  const hasTextOutput
    = diagnostics.assistantTextCharCount > 0 || diagnostics.reasoningTextCharCount > 0
  const hasToolOutput = diagnostics.toolEventCount > 0
  const hasCommandOutput
    = diagnostics.commandEventCount > 0 || diagnostics.commandOutputCharCount > 0
  const hasFileChangeOutput = diagnostics.fileChangeEventCount > 0

  if (hasTextOutput || hasToolOutput || hasCommandOutput || hasFileChangeOutput || options.allowEmptyAssistantOutput) {
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
  options: { allowEmptyAssistantOutput?: boolean } = {},
): UIMessageChunk {
  if (chunk.type !== 'finish') {
    return chunk
  }

  const validation = validateTurnOutput(diagnostics, options)
  if (validation.ok) {
    return chunk
  }

  const errorText = validation.errorText ?? 'Provider finished without assistant output events'
  return { type: 'error', errorText }
}

function isProviderNativeNoOutputCommandTurn(activeRun: ActiveRun, message: UIMessage): boolean {
  if (activeRun.runtimeSession.runtimeKind !== 'codex') {
    return false
  }
  const text = extractMessageText(message)
  return readGoalMessageObjective(message) !== null || isCodexGoalCommandText(text) || isCodexCompactCommandText(text)
}

function isCodexGoalCommandText(text: string): boolean {
  return readCodexGoalCommandObjective(text) !== null
}

function readCodexGoalCommandObjective(text: string): string | null {
  const normalized = text.trimStart()
  if (!normalized.startsWith('/goal')) {
    return null
  }
  const nextChar = normalized.charAt('/goal'.length)
  if (nextChar && nextChar !== ' ' && nextChar !== '\t') {
    return null
  }
  const objective = normalized.slice('/goal'.length).trim()
  return objective.length > 0 ? objective : null
}

function isCodexCompactCommandText(text: string): boolean {
  const normalized = text.trim()
  if (!normalized.startsWith('/compact')) {
    return false
  }
  const nextChar = normalized.charAt('/compact'.length)
  return !nextChar || nextChar === ' ' || nextChar === '\t'
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

function serializeChatError(error: unknown): SerializedChatError {
  const payload: SerializedChatError['payload'] = {
    message: error instanceof Error ? error.message : String(error),
  }

  if (error instanceof Error) {
    payload.name = error.name
    payload.stack = error.stack
  }

  if (error && typeof error === 'object') {
    const candidate = error as { code?: unknown, data?: unknown }
    if (typeof candidate.code === 'string' || typeof candidate.code === 'number') {
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
    return stringifyErrorValue((data as { details: unknown }).details)
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
