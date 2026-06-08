import { randomUUID } from 'node:crypto'

import type { BackendRun, BackendSessionBinding, Message, Session } from '@cradle/db'
import {
  agents,
  backendRuns,
  backendRunSnapshots,
  chatSessionQueueItems,
  messages,
  sessions,
  stepUsage as stepUsageTable,
  usageLogs,
  workspaces
} from '@cradle/db'
import type { FileUIPart, UIMessage, UIMessageChunk } from 'ai'
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import { createChildLogger } from '../../logging/logger'
import { readBuiltinToolCallInputPayload } from '../chat-runtime-providers/tools/tool-call-payload'
import { readProviderStateSnapshot } from '../chat-runtime-providers/provider-state-snapshot'
import * as ModelRegistry from '../model-registry/service'
import { createDedupeKey, OBSERVABILITY_CODES } from '../observability/contract'
import * as Observability from '../observability/service'
import { runtimeSupportsProviderKind } from '../provider-contracts/runtime-compatibility'
import type { RuntimeKind } from '../provider-contracts/types'
import {
  listChatSessionIdsByDurableProviderSession,
  persistProviderRuntimeResolution,
  readDurableProviderRuntimeBinding,
  readReusableDurableProviderRuntimeBinding,
  resolveExistingProviderRuntimeSession,
  resolveProviderRuntimeSession
} from '../provider-runtime/service'
import {
  appendSideConversationHistory,
  readSideConversation,
  registerSideConversation,
  releaseSideConversation,
  releaseSideConversationsByParentSessionId,
  reserveSideConversationHostLease
} from '../provider-runtime/side-conversation-registry'
import { getProviderTarget, resolveProviderTarget } from '../provider-targets/service'
import * as SessionService from '../session/service'
import { listSkillInventory } from '../skills/skills.store'
import { estimateCost } from '../usage/pricing'
import type { BangCommandExecutionResult } from './bang-command'
import { executeLocalBangCommand, persistBangCommandMessages } from './bang-command'
import {
  getRuntimeRegistry,
  listRuntimeCatalog,
  listRuntimeHealth
} from './chat-runtime-provider-registry'
import type { ChatTurnContext } from './chat-turn-context'
import { resolveSessionSystemPrompt, resolveTurnContext } from './chat-turn-context'
import type { ChatContextPart } from './context-parts'
import { readChatSkillContextPart } from './context-parts'
import {
  annotateCodexGoalContinuationMessage,
  annotateGoalMessage,
  createAssistantMessage,
  createUserMessage,
  extractMessageText,
  isCodexGoalContinuationMessage,
  normalizeMessageSnapshot,
  parseStoredMessageSnapshot as parseTrustedStoredMessageSnapshot,
  readGoalMessageObjective
} from './message-snapshots'
import {
  listPendingRuntimeUserInputStates,
  rejectPendingUserInputsForRun,
  setRuntimeUserInputPublisher
} from './pending-user-input'
import type { ProviderThreadSubscriber } from './provider-thread-streams'
import {
  createProviderThreadStreamStore,
  providerThreadStreamKey,
  publishProviderThreadEvent
} from './provider-thread-streams'
import type { ChatRunSnapshot } from './run-snapshot'
import {
  appendRunSnapshotEvent,
  finalizeRunSnapshot,
  getRunSnapshot,
  getRunSnapshots,
  startRunSnapshot
} from './run-snapshot'
import type {
  FinalMessageProjectionRun,
  FinalMessageProjectionState
} from './run-final-message-projection'
import {
  createFinalMessageProjectionState,
  flushFinalMessageProjection,
  flushProjectedToolInputs,
  projectFinalMessageChunk
} from './run-final-message-projection'
import type {
  ChatRuntime,
  ChatRuntimeSettings,
  ChatRuntimeSettingsPatch,
  ChatThinkingEffort,
  GenerateSessionTitleInput,
  ProviderNativeAppServerCapabilityManifest,
  ProviderNativeAppServerInvokeResponse,
  ProviderThreadEvent,
  ProviderThreadListInput,
  ProviderThreadListResult,
  ProviderThreadReadResult,
  ProviderThreadSourceKind,
  ProviderThreadTurnsResult,
  RuntimeContextUsage,
  RuntimePresentationCapabilities,
  RuntimeProviderTargetProfile,
  RuntimeSession,
  RuntimeUiSlotState,
  TokenUsage
} from './runtime-provider-types'
import { ProviderRuntimeError } from './runtime-provider-types'
import {
  areRuntimeSettingsEqual,
  DEFAULT_RUNTIME_SETTINGS,
  mergeRuntimeSettings,
  normalizeRuntimeAccessMode,
  normalizeRuntimeInteractionMode,
  normalizeRuntimeSettingsPatch,
  readSessionRuntimeSettings,
  writeSessionRuntimeSettingsConfigJson
} from './runtime-settings'
import type {
  ChatSessionContinuationMode,
  ChatSessionQueueItemDto,
  ChatSessionQueueMode,
  ChatSessionQueueStatus,
  EnqueueSessionQueueItemInput,
  PersistedThinkingEffort,
  SessionSteerTurnDto,
  SubmitSessionSteerTurnInput
} from './session-queue'
import {
  compareQueueRows,
  parseQueueContextParts,
  parseQueueFiles,
  readPersistedThinkingEffort,
  readQueueItemRuntimeSettings,
  serializeQueueContextParts,
  serializeQueueFiles,
  toQueueItemDto
} from './session-queue'
import type { SerializedChatError } from './runtime-errors'
import {
  createSessionTitleGenerationError,
  resolveTurnFailureObservabilityCode,
  serializeChatError
} from './runtime-errors'
import type { ChatStreamTraceRecord } from './stream-trace'
import { isChatStreamTraceEnabled, readChatRunTrace, recordChatStreamTrace } from './stream-trace'
import type { CradleTurnTranscript } from './transcript'

export { submitRuntimeUserInput } from './pending-user-input'
export type {
  ChatSessionContinuationMode,
  ChatSessionQueueItemDto,
  ChatSessionQueueMode,
  ChatSessionQueueStatus,
  EnqueueSessionQueueItemInput,
  PersistedThinkingEffort,
  SessionSteerTurnDto,
  SubmitSessionSteerTurnInput
} from './session-queue'

const chatLogger = createChildLogger({ module: 'chat-runtime' })
const DEFAULT_STORED_MESSAGE_TEXT_MAX_CHARS = 256_000
const DEFAULT_STORED_MESSAGE_REASONING_MAX_CHARS = 64_000
const DEFAULT_STORED_TOOL_PAYLOAD_MAX_CHARS = 128_000
const DEFAULT_STORED_MESSAGE_REPAIR_MIN_CHARS = 512 * 1024
const DEFAULT_RUN_DELTA_FLUSH_MS = 16
const DEFAULT_RUN_DELTA_FLUSH_CHARS = 8_192
const DEFAULT_SNAPSHOT_INTERVAL_MS = 10_000
const CODEX_GOAL_CONTINUATION_DELAY_MS = 250
const CODEX_GOAL_CONTINUATION_PROMPT = '[internal] Continue the active Codex goal.'
const ORPHANED_STREAMING_RUN_STOP_REASON = 'response.interrupted'
const ORPHANED_STREAMING_RUN_ERROR_TEXT =
  'Response interrupted because the Cradle server process exited while the run was streaming.'
const CODEX_BASELINE_SKILL_NAMES = [] as const

const pendingCodexGoalContinuationTimers = new Map<string, ReturnType<typeof setTimeout>>()

SessionService.onSessionArchived(releaseSideConversationsByParentSessionId)
SessionService.onSessionCleanup(releaseSideConversationsByParentSessionId)

function parseTrustedJsonObject(json: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(json)
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {}
}

function readUnknownRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function publishRunChunk(runId: string, chunk: UIMessageChunk): void {
  const activeRun = activeRuns.get(runId)
  if (!activeRun || activeRun.terminalStatus) {
    return
  }
  publishUIMessageChunk(activeRun, chunk, isTerminalUIMessageChunk(chunk))
  recordActiveRunSnapshotEvent(activeRun, {
    phase: 'runtime_user_input',
    chunk
  })
}

setRuntimeUserInputPublisher(publishRunChunk)

function readCodexBaselineSkillParts(existingSkillNames: Set<string>): ChatContextPart[] {
  if (CODEX_BASELINE_SKILL_NAMES.every((name) => existingSkillNames.has(name))) {
    return []
  }

  const builtinSkills = listSkillInventory({})
  return CODEX_BASELINE_SKILL_NAMES.flatMap((name) => {
    if (existingSkillNames.has(name)) {
      return []
    }
    const skill = builtinSkills.find((entry) => entry.scope === 'builtin' && entry.name === name)
    return skill
      ? [
          {
            type: 'data-cradle-skill' as const,
            name: skill.name,
            path: skill.location,
            scope: skill.scope,
            description: skill.description
          }
        ]
      : []
  })
}

function withCodexBaselineSkillContextParts(contextParts: ChatContextPart[]): ChatContextPart[] {
  const existingSkillNames = new Set(
    contextParts.flatMap((part) => (part.type === 'data-cradle-skill' ? [part.name] : []))
  )
  const baselineParts = readCodexBaselineSkillParts(existingSkillNames)
  return baselineParts.length > 0 ? [...contextParts, ...baselineParts] : contextParts
}

function withCodexBaselineSkillUserMessage(message: UIMessage): UIMessage {
  if (message.role !== 'user') {
    return message
  }

  const existingSkillNames = new Set(
    message.parts
      .map((part) => readChatSkillContextPart(part)?.name)
      .filter((name): name is string => typeof name === 'string')
  )
  const baselineParts = readCodexBaselineSkillParts(existingSkillNames)
  if (baselineParts.length === 0) {
    return message
  }

  return {
    ...message,
    parts: [
      ...message.parts,
      ...baselineParts.map(
        (part) =>
          ({
            type: part.type,
            data: part
          }) as UIMessage['parts'][number]
      )
    ]
  }
}

function replaceLastRequestMessage(
  messagesInput: UIMessage[] | undefined,
  message: UIMessage | undefined
): UIMessage[] | undefined {
  if (!messagesInput || !message) {
    return messagesInput
  }
  return [...messagesInput.slice(0, -1), message]
}

function readRuntimeSettingsApplied(
  sessionId: string,
  runtimeSettings: ChatRuntimeSettings
): boolean {
  if (pendingRunSessions.has(sessionId)) {
    return false
  }
  const activeRunId = activeRunIdsBySession.get(sessionId)
  const activeRun = activeRunId ? activeRuns.get(activeRunId) : null
  return !activeRun || areRuntimeSettingsEqual(activeRun.runtimeSettings, runtimeSettings)
}

// ── types ──

export type ChatMessageStatus = 'streaming' | 'complete' | 'aborted' | 'failed'
type TerminalChatMessageStatus = Exclude<ChatMessageStatus, 'streaming'>
type TerminalRunProjectionStatus = TerminalChatMessageStatus
interface TerminalRunProjectionRepairOptions {
  persistBackendRun?: boolean
}
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
  chunkBuffer: UIMessageChunk[]
  chunkBufferIndexByKey: Map<string, number>
  pendingDeltaChunk: UIMessageChunk | null
  pendingDeltaFlushTimer: StreamFlushTimer | null
  streamedToolInputStartIds: Set<string>
  snapshotTimer: ReturnType<typeof setInterval> | null
  finalMessage: UIMessage
  finalProjection: FinalMessageProjectionState
  startChunkPublished?: boolean
  terminalStatus?: TerminalChatMessageStatus
  cancelRequested?: boolean
  queueItemId?: string
  runtimeSettings: ChatRuntimeSettings
  internalContinuation?: 'codexGoal'
  runSnapshotId?: string | null
  runSnapshotSeq: number
}

interface ResolvedRuntimeSessionContext {
  context: SessionRunContext
  runtimeKind: RuntimeKind
  runtime: ChatRuntime
  runtimeSession: RuntimeSession
  modelId: string | undefined
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

type MutableToolPart = Extract<UIMessage['parts'][number], { toolCallId: string }>
type MutableApprovalToolPart = MutableToolPart & {
  approval?: {
    id?: unknown
    approved?: unknown
    reason?: unknown
  }
  input?: unknown
  state?: string
  toolName?: string
  type: string
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

export type ChatRunSnapshotDto = ChatRunSnapshot

export interface ChatSessionRunSnapshotsDto {
  sessionId: string
  snapshots: ChatRunSnapshotDto[]
}

export interface CompletedChatRunDto {
  runId: string
  sessionId: string
  sessionTitle: string
  messageId: string | null
  responseBody: string | null
  messagePreview: string | null
  startedAt: number
  finishedAt: number
}

export interface CompletedChatRunsDto {
  runs: CompletedChatRunDto[]
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
  runtimeSettings: ChatRuntimeSettings
}

export interface ChatRuntimeSessionStatusDto {
  sessionId: string
  status: RuntimeSessionStatusKind
  runtimeKind: RuntimeKind
  providerTargetId: string | null
  providerSessionId: string | null
  modelId: string | null
  runtimeSettings: ChatRuntimeSettings
  pendingQueueItemId: string | null
  hasActiveGoal: boolean
  activeRun: RuntimeSessionRunDto | null
  latestRun: RuntimeSessionRunDto | null
  queue: {
    pending: number
    running: number
  }
}

export interface ChatRuntimeSettingsDto {
  sessionId: string
  runtimeSettings: ChatRuntimeSettings
  applied: boolean
}

type RunSubscriber = (chunk: UIMessageChunk, terminal: boolean) => void
type StreamFlushTimer = ReturnType<typeof setTimeout>

interface TurnOutputDiagnostics {
  emittedEventCount: number
  assistantBoundaryCount: number
  assistantTextCharCount: number
  reasoningTextCharCount: number
  toolInputDeltaCharCount: number
  toolEventCount: number
  commandEventCount: number
  commandOutputCharCount: number
  fileChangeEventCount: number
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

export interface CreateSideChatInput {
  parentSessionId: string
  providerTargetId?: string
  modelId?: string
}

export interface QuickQuestionInput {
  sessionId: string
  question: string
}

export interface SideChatSessionDto {
  sideConversationId: string
  parentSessionId: string
  runtimeKind: RuntimeKind
  providerTargetId: string | null
  providerSessionId: string | null
  title: string
  expiresAt: number
}

export interface ChatSessionContextUsageDto {
  sessionId: string
  runtimeKind: RuntimeKind
  providerSessionId: string | null
  usage: RuntimeContextUsage | null
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
const providerThreadStreamStore = createProviderThreadStreamStore()
const drainingQueueSessionIds = new Set<string>()
const requestedQueueDrainSessionIds = new Set<string>()
const codexGoalContinuationFailures = new Map<string, number>()
const messageInsertOrder = sql`messages.rowid`

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
  const profileConfig = parseTrustedJsonObject(resolvedTarget.configJson)
  const targetModelRegistryConfig = {
    modelRegistryMappings: ModelRegistry.listMappingEntries()
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
  return readDurableProviderRuntimeBinding(sessionId)
}

function isProviderTargetAvailable(providerTargetId: string | null | undefined): boolean {
  if (!providerTargetId) {
    return false
  }
  return getProviderTarget(providerTargetId)?.enabled === true
}

function canPersistRuntimeSessionForProviderTarget(input: {
  sessionId: string
  providerTargetId: string
}): boolean {
  const session = db()
    .select({ providerTargetId: sessions.providerTargetId })
    .from(sessions)
    .where(eq(sessions.id, input.sessionId))
    .get()
  return (
    session?.providerTargetId === input.providerTargetId &&
    isProviderTargetAvailable(input.providerTargetId)
  )
}

export function listChatSessionIdsByBackendSessionId(backendSessionId: string): string[] {
  return listChatSessionIdsByDurableProviderSession(backendSessionId)
}

function attachBinding(input: {
  sessionId: string
  providerTargetId: string
  runtimeKind: RuntimeKind
  runtimeSession: RuntimeSession
  requestedModelId: string | null
}): BackendSessionBinding | undefined {
  return persistProviderRuntimeResolution({
    chatSessionId: input.sessionId,
    providerTargetId: input.providerTargetId,
    runtimeKind: input.runtimeKind,
    runtimeSession: input.runtimeSession,
    requestedModelId: input.requestedModelId,
    durable: true
  })
}

function linkRunToRuntimeBinding(input: {
  runId: string
  binding: BackendSessionBinding | undefined
}): void {
  if (!input.binding) {
    return
  }
  db()
    .update(backendRuns)
    .set({ bindingId: input.binding.id })
    .where(eq(backendRuns.id, input.runId))
    .run()
}

async function resolveExistingRuntimeSessionForContext(input: {
  sessionId: string
  context: SessionRunContext
  runtimeKind: RuntimeKind
  runtime: ChatRuntime
  modelId?: string
}): Promise<{
  runtimeSession: RuntimeSession
  requestedModelId: string | null
} | null> {
  const resolution = await resolveExistingProviderRuntimeSession({
    chatSessionId: input.sessionId,
    providerTargetId: input.context.providerTarget.id,
    runtimeKind: input.runtimeKind,
    runtime: input.runtime,
    profile: input.context.profile,
    workspacePath: input.context.workspacePath,
    agentId: input.context.session.agentId,
    modelId: input.modelId
  })
  return resolution
    ? {
        runtimeSession: resolution.runtimeSession,
        requestedModelId: resolution.requestedModelId
      }
    : null
}

async function resolveRuntimeSessionForContext(input: {
  sessionId: string
  context: SessionRunContext
  runtimeKind: RuntimeKind
  runtime: ChatRuntime
  modelId?: string
  requestedProviderTargetId?: string
}): Promise<{
  runtimeSession: RuntimeSession
  requestedModelId: string | null
}> {
  const resolution = await resolveProviderRuntimeSession({
    chatSessionId: input.sessionId,
    providerTargetId: input.context.providerTarget.id,
    runtimeKind: input.runtimeKind,
    runtime: input.runtime,
    profile: input.context.profile,
    workspacePath: input.context.workspacePath,
    agentId: input.context.session.agentId,
    modelId: input.modelId
  })
  try {
    validateResolvedRuntimeSessionContext({
      sessionId: input.sessionId,
      originalContext: input.context,
      requestedProviderTargetId: input.requestedProviderTargetId,
      runtimeKind: input.runtimeKind
    })
  } catch (error) {
    try {
      await input.runtime.cancelTurn({
        runtimeSession: resolution.runtimeSession,
        profile: input.context.profile
      })
    } catch (cancelError) {
      chatLogger.warn('runtime session cancellation failed after context invalidation', {
        error: cancelError,
        sessionId: input.sessionId,
        providerTargetId: input.context.providerTarget.id
      })
    }
    throw error
  }
  return {
    runtimeSession: resolution.runtimeSession,
    requestedModelId: resolution.requestedModelId
  }
}

function validateResolvedRuntimeSessionContext(input: {
  sessionId: string
  originalContext: SessionRunContext
  requestedProviderTargetId?: string
  runtimeKind: RuntimeKind
}): void {
  const latestSession = db().select().from(sessions).where(eq(sessions.id, input.sessionId)).get()
  if (!latestSession) {
    throw new AppError({
      code: 'chat_session_not_found',
      status: 404,
      message: 'Chat session not found',
      details: { sessionId: input.sessionId }
    })
  }
  const latestContext = getSessionRunContext(input.sessionId, {
    providerTargetId: input.requestedProviderTargetId
  })
  if (!latestContext) {
    throw new AppError({
      code: 'chat_provider_target_not_available',
      status: 409,
      message: 'Provider target is no longer available',
      details: {
        sessionId: input.sessionId,
        providerTargetId: input.requestedProviderTargetId ?? input.originalContext.providerTarget.id
      }
    })
  }
  assertRuntimeCompatibleTarget(latestContext, input.requestedProviderTargetId)
  if (!latestContext.profile.enabled) {
    throw new AppError({
      code: 'chat_provider_target_not_available',
      status: 409,
      message: 'Provider target is disabled',
      details: {
        providerTargetId: latestContext.providerTarget.id
      }
    })
  }
  if (
    input.requestedProviderTargetId === undefined &&
    latestContext.session.providerTargetId !== input.originalContext.providerTarget.id
  ) {
    throw new AppError({
      code: 'chat_provider_target_changed',
      status: 409,
      message: 'Chat session provider target changed before the run started',
      details: {
        sessionId: input.sessionId,
        previousProviderTargetId: input.originalContext.providerTarget.id,
        providerTargetId: latestContext.session.providerTargetId
      }
    })
  }
}

export function reportRuntimeSessionTitle(input: {
  sessionId: string
  title: string
  overwriteUserTitle?: boolean
}): void {
  const title = normalizeRuntimeSessionTitle(input.title)
  if (!title) {
    return
  }

  const session = db()
    .select({ title: sessions.title, titleSource: sessions.titleSource })
    .from(sessions)
    .where(eq(sessions.id, input.sessionId))
    .get()
  if (!session) {
    return
  }
  if (
    session.title === title &&
    (!input.overwriteUserTitle || session.titleSource === 'provider')
  ) {
    return
  }

  // Don't overwrite user-set titles
  if (session.titleSource === 'user' && !input.overwriteUserTitle) {
    return
  }
  if (!input.overwriteUserTitle && isTrivialContinuationTitle(title)) {
    return
  }

  db()
    .update(sessions)
    .set({
      title,
      titleSource: 'provider',
      updatedAt: currentUnixSeconds()
    })
    .where(eq(sessions.id, input.sessionId))
    .run()
}

function normalizeRuntimeSessionTitle(title: string): string | null {
  const normalized = title.replace(/\s+/g, ' ').trim()
  return normalized.length > 0 ? normalized : null
}

function isTrivialContinuationTitle(title: string): boolean {
  const normalized = title
    .toLocaleLowerCase()
    .replace(/[.!?。！？]+$/g, '')
    .trim()
  return (
    normalized === 'continue' ||
    normalized === '继续' ||
    normalized === '接着' ||
    normalized === '继续执行' ||
    normalized === '继续吧'
  )
}

function readFirstUserPromptText(sessionId: string): string | null {
  const rows = db()
    .select({
      messageJson: messages.messageJson,
      content: messages.content
    })
    .from(messages)
    .where(
      and(
        eq(messages.sessionId, sessionId),
        eq(messages.role, 'user'),
        or(
          eq(messages.status, 'complete'),
          eq(messages.status, 'aborted'),
          eq(messages.status, 'failed')
        ),
        isNull(messages.parentMessageId)
      )
    )
    .orderBy(messages.createdAt, messageInsertOrder)
    .all()

  for (const row of rows) {
    try {
      const text = extractMessageText(parseTrustedStoredMessageSnapshot(row.messageJson)).trim()
      if (text && !isTrivialContinuationTitle(text)) {
        return text
      }
    } catch {
      // Fall back to the denormalized content column for old or malformed snapshots.
    }

    const fallback = row.content.trim()
    if (fallback && !isTrivialContinuationTitle(fallback)) {
      return fallback
    }
  }

  return null
}

function readSessionRequestedModelId(input: {
  session: Session
  requestedProviderTargetId?: string
}): string | undefined {
  if (
    input.requestedProviderTargetId &&
    input.requestedProviderTargetId !== input.session.providerTargetId
  ) {
    return undefined
  }
  return SessionService.readSessionModelPreference(input.session.configJson) ?? undefined
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
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

function readStoredToolPayloadLimit(): number {
  return readPositiveIntegerEnv(
    'CRADLE_CHAT_STORED_TOOL_PAYLOAD_MAX_CHARS',
    DEFAULT_STORED_TOOL_PAYLOAD_MAX_CHARS
  )
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
    finalMessageJsonBytes: null
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
      preview: json.slice(0, maxChars)
    }
  } catch {
    const text = String(value)
    if (text.length <= maxChars) {
      return text
    }
    return {
      type: 'cradle.truncated-text-payload.v1',
      originalChars: text.length,
      preview: text.slice(0, maxChars)
    }
  }
}

function parsePartialToolInputText(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function cloneUiMessageParts(parts: UIMessage['parts']): UIMessage['parts'] {
  return JSON.parse(JSON.stringify(parts)) as UIMessage['parts']
}

function annotateContinuationMessage(
  message: UIMessage,
  continuation: {
    mode: ChatSessionContinuationMode
    queueItemId?: string
    sourceMessageId?: string
    splitParts?: UIMessage['parts']
  } | null
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
          ...(continuation.sourceMessageId
            ? { sourceMessageId: continuation.sourceMessageId }
            : {}),
          ...(continuation.splitParts !== undefined ? { splitParts: continuation.splitParts } : {})
        }
      }
    }
  } as UIMessage
}

function createDraftTurn(input: {
  sessionId: string
  runtimeKind: RuntimeKind
  userText: string
  files: FileUIPart[]
  contextParts: ChatContextPart[]
  continuation?: { mode: ChatSessionContinuationMode; queueItemId?: string }
}): {
  userMessageId: string
  assistantMessageId: string
  userMessage: UIMessage
} {
  const userMessageId = randomUUID()
  const assistantMessageId = randomUUID()
  const now = currentUnixSeconds()
  const goalObjective =
    input.runtimeKind === 'codex' ? readCodexGoalCommandObjective(input.userText) : null
  const userText = goalObjective ?? input.userText
  const userMessage = annotateContinuationMessage(
    goalObjective
      ? annotateGoalMessage(
          createUserMessage(userMessageId, userText, input.files, input.contextParts),
          goalObjective
        )
      : createUserMessage(userMessageId, userText, input.files, input.contextParts),
    input.continuation ?? null
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

function createDraftTurnFromUserMessage(input: {
  sessionId: string
  userMessage: UIMessage
  continuation?: { mode: ChatSessionContinuationMode; queueItemId?: string }
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

  return { userMessageId: userMessage.id, assistantMessageId, userMessage }
}

function createCodexGoalContinuationDraft(input: { sessionId: string }): {
  userMessageId: string
  assistantMessageId: string
  userMessage: UIMessage
} {
  const assistantMessageId = randomUUID()
  const now = currentUnixSeconds()
  const userMessage = annotateCodexGoalContinuationMessage(
    createUserMessage(randomUUID(), CODEX_GOAL_CONTINUATION_PROMPT)
  )
  const assistantMessage = createAssistantMessage(assistantMessageId)

  db().transaction((tx) => {
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

  return { userMessageId: '', assistantMessageId, userMessage }
}

function startAssistantContinuation(input: { sessionId: string; message: UIMessage }): void {
  const now = currentUnixSeconds()
  const updated = db().transaction((tx) => {
    const result = tx
      .update(messages)
      .set({
        status: 'streaming',
        errorText: null,
        content: extractMessageText(input.message),
        messageJson: JSON.stringify(input.message),
        updatedAt: now
      })
      .where(
        and(
          eq(messages.id, input.message.id),
          eq(messages.sessionId, input.sessionId),
          eq(messages.role, 'assistant')
        )
      )
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
        messageId: input.message.id
      }
    })
  }
}

function insertCompletedUserMessage(input: {
  sessionId: string
  message: UIMessage
  parentMessageId?: string | null
}): void {
  const now = currentUnixSeconds()
  db().transaction((tx) => {
    tx.insert(messages)
      .values({
        id: input.message.id,
        sessionId: input.sessionId,
        parentMessageId: input.parentMessageId ?? null,
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
  return db()
    .insert(backendRuns)
    .values({
      id: randomUUID(),
      bindingId: binding?.id ?? null,
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

export function getRunSnapshotDto(runId: string): ChatRunSnapshotDto {
  const run = getRun(runId)
  if (!run) {
    throw new AppError({
      code: 'chat_run_not_found',
      status: 404,
      message: 'Chat run not found',
      details: { runId }
    })
  }
  const snapshot = getRunSnapshot(runId)
  if (!snapshot) {
    throw new AppError({
      code: 'chat_run_snapshot_not_found',
      status: 404,
      message: 'Chat run snapshot not found',
      details: { runId }
    })
  }
  return snapshot
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

export function getSessionRunSnapshots(sessionId: string): ChatSessionRunSnapshotsDto {
  return {
    sessionId,
    snapshots: getRunSnapshots({ chatSessionId: sessionId, limit: 200 })
  }
}

export function listCompletedRuns(input: {
  since?: number | null
  limit?: number | null
}): CompletedChatRunsDto {
  const since = Math.max(0, Math.floor(input.since ?? 0))
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 50), 1), 200)
  const rows = db()
    .select({
      runId: backendRuns.id,
      sessionId: backendRuns.chatSessionId,
      sessionTitle: sessions.title,
      messageId: backendRuns.messageId,
      messageContent: messages.content,
      startedAt: backendRuns.startedAt,
      finishedAt: backendRuns.finishedAt
    })
    .from(backendRuns)
    .innerJoin(sessions, eq(sessions.id, backendRuns.chatSessionId))
    .leftJoin(messages, eq(messages.id, backendRuns.messageId))
    .where(
      and(
        eq(backendRuns.status, 'complete'),
        sql`${backendRuns.finishedAt} IS NOT NULL`,
        sql`${backendRuns.finishedAt} > ${since}`
      )
    )
    .orderBy(desc(backendRuns.finishedAt), desc(backendRuns.startedAt))
    .limit(limit)
    .all()

  return {
    runs: rows
      .filter((row) => row.finishedAt !== null)
      .map((row) => ({
        runId: row.runId,
        sessionId: row.sessionId,
        sessionTitle: row.sessionTitle,
        messageId: row.messageId,
        responseBody: row.messageContent || null,
        messagePreview: row.messageContent ? row.messageContent.slice(0, 200) : null,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt ?? row.startedAt
      }))
  }
}

export function listRunSnapshotsForObservability(filter: {
  chatSessionId?: string
  runId?: string
  since?: number
  limit?: number
}): ChatRunSnapshotDto[] {
  return getRunSnapshots(filter)
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

export function getActiveRunReplayBufferSummary(
  runId: string
): ActiveRunReplayBufferSummary | null {
  const run = activeRuns.get(runId)
  if (!run) {
    return null
  }
  return {
    runId,
    chunkCount: run.chunkBuffer.length,
    textDeltaCount: run.chunkBuffer.filter((chunk) => chunk.type === 'text-delta').length,
    reasoningDeltaCount: run.chunkBuffer.filter((chunk) => chunk.type === 'reasoning-delta').length,
    toolInputDeltaCount: run.chunkBuffer.filter((chunk) => chunk.type === 'tool-input-delta')
      .length,
    toolOutputCount: run.chunkBuffer.filter((chunk) => chunk.type === 'tool-output-available')
      .length,
    maxDeltaChars: run.chunkBuffer.reduce(
      (max, chunk) => Math.max(max, readDeltaChunkTextLength(chunk)),
      0
    )
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
        modelId: run.modelId
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
      details: { sessionId }
    })
  }

  releaseTerminalPersistedActiveRunForSession(sessionId)
  if (!activeRunIdsBySession.has(sessionId) && !pendingRunSessions.has(sessionId)) {
    failOrphanedPersistedStreamingSession(sessionId)
  }

  const binding = session.providerTargetId
    ? readReusableDurableProviderRuntimeBinding({
        chatSessionId: sessionId,
        providerTargetId: session.providerTargetId,
        runtimeKind: session.runtimeKind as RuntimeKind
      })
    : undefined
  const activeRunId = activeRunIdsBySession.get(sessionId)
  const activeRun = activeRunId ? activeRuns.get(activeRunId) : undefined
  const pendingState = pendingRunSessions.get(sessionId)
  const latestRun = db()
    .select()
    .from(backendRuns)
    .where(eq(backendRuns.chatSessionId, sessionId))
    .orderBy(desc(backendRuns.startedAt), desc(sql`backend_runs.rowid`))
    .get()
  const queueRows = db()
    .select({
      status: chatSessionQueueItems.status
    })
    .from(chatSessionQueueItems)
    .where(
      and(eq(chatSessionQueueItems.sessionId, sessionId), eq(chatSessionQueueItems.mode, 'queue'))
    )
    .all()
  const queue = queueRows.reduce(
    (counts, row) => {
      if (row.status === 'pending') {
        return { ...counts, pending: counts.pending + 1 }
      }
      if (row.status === 'running') {
        return { ...counts, running: counts.running + 1 }
      }
      return counts
    },
    { pending: 0, running: 0 }
  )

  const runtimeKind =
    activeRun?.runtimeSession.runtimeKind ??
    (binding?.runtimeKind as RuntimeKind | undefined) ??
    session.runtimeKind
  const providerTargetId =
    activeRun?.providerTargetId ?? binding?.providerTargetId ?? session.providerTargetId
  const providerSessionId =
    activeRun?.runtimeSession.providerSessionId ?? binding?.backendSessionId ?? null
  const modelId = activeRun?.modelId ?? binding?.requestedModelId ?? null
  const runtimeSettings =
    activeRun?.runtimeSettings ?? readSessionRuntimeSettings(session.configJson)
  const providerTargetAvailable = activeRun ? true : isProviderTargetAvailable(providerTargetId)
  const hasActiveGoal =
    binding?.runtimeKind === 'codex' &&
    hasActiveCodexGoal(binding.backendStateSnapshot) &&
    providerTargetAvailable
  const status: RuntimeSessionStatusKind = activeRun
    ? activeRun.cancelRequested
      ? 'cancelling'
      : 'streaming'
    : pendingState
      ? 'pending'
      : 'idle'
  if (status === 'idle' && hasActiveGoal && binding && queue.pending === 0 && queue.running === 0) {
    scheduleCodexGoalContinuation({
      sessionId,
      providerTargetId: providerTargetId ?? undefined,
      modelId: modelId ?? undefined
    })
  }

  return {
    sessionId,
    status,
    runtimeKind,
    providerTargetId,
    providerSessionId,
    modelId,
    runtimeSettings,
    pendingQueueItemId: pendingState?.queueItemId ?? null,
    hasActiveGoal,
    activeRun: activeRun
      ? toRuntimeSessionRunDto(activeRun, getRun(activeRun.runId), { runtimeSettings })
      : null,
    latestRun: latestRun
      ? toRuntimeSessionRunDto(null, latestRun, {
          modelId: binding?.requestedModelId ?? null,
          providerSessionId: binding?.backendSessionId ?? null,
          runtimeSettings
        })
      : null,
    queue
  }
}

function toRuntimeSessionRunDto(
  activeRun: ActiveRun | null,
  run: BackendRun | undefined,
  fallback: {
    modelId?: string | null
    providerSessionId?: string | null
    runtimeSettings?: ChatRuntimeSettings
  } = {}
): RuntimeSessionRunDto {
  return {
    runId: activeRun?.runId ?? run?.id ?? '',
    messageId: activeRun?.messageId ?? run?.messageId ?? null,
    status:
      activeRun?.terminalStatus ?? (run?.status as ChatMessageStatus | undefined) ?? 'streaming',
    startedAt: run?.startedAt ?? currentUnixSeconds(),
    finishedAt: run?.finishedAt ?? null,
    modelId: activeRun?.modelId ?? fallback.modelId ?? null,
    providerSessionId:
      activeRun?.runtimeSession.providerSessionId ?? fallback.providerSessionId ?? null,
    queueItemId: activeRun?.queueItemId ?? null,
    runtimeSettings:
      activeRun?.runtimeSettings ?? fallback.runtimeSettings ?? DEFAULT_RUNTIME_SETTINGS
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
    records: trace.records
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
        updatedAt: now
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
  const repairMinChars = readPositiveIntegerEnv(
    'CRADLE_CHAT_STORED_MESSAGE_REPAIR_MIN_CHARS',
    DEFAULT_STORED_MESSAGE_REPAIR_MIN_CHARS
  )
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
      updatedAt: now
    })
    .where(eq(messages.id, input.row.id))
    .run()
  return compactedMessage as ChatMessageSnapshotRow['message']
}

function compactStoredMessageSnapshot(message: UIMessage): UIMessage {
  const textLimit = readPositiveIntegerEnv(
    'CRADLE_CHAT_STORED_TEXT_MAX_CHARS',
    DEFAULT_STORED_MESSAGE_TEXT_MAX_CHARS
  )
  const reasoningLimit = readPositiveIntegerEnv(
    'CRADLE_CHAT_STORED_REASONING_MAX_CHARS',
    DEFAULT_STORED_MESSAGE_REASONING_MAX_CHARS
  )
  const toolPayloadLimit = readPositiveIntegerEnv(
    'CRADLE_CHAT_STORED_TOOL_PAYLOAD_MAX_CHARS',
    DEFAULT_STORED_TOOL_PAYLOAD_MAX_CHARS
  )
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
              ...readRecord(
                readRecord((part as { providerMetadata?: unknown }).providerMetadata).cradle
              ),
              truncated: true,
              originalChars: part.text.length
            }
          }
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
              ...readRecord(
                readRecord((part as { providerMetadata?: unknown }).providerMetadata).cradle
              ),
              truncated: true,
              originalChars: part.text.length
            }
          }
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
      createdAt: currentUnixSeconds()
    })
    .run()
}

function canApplyLiveSteerWithRequest(input: {
  activeRun: ActiveRun
  providerTargetId: string | null
}): boolean {
  return !input.providerTargetId || input.providerTargetId === input.activeRun.providerTargetId
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

function assertStoredSession(sessionId: string): Session {
  const session = db().select().from(sessions).where(eq(sessions.id, sessionId)).get()
  if (!session) {
    throw new AppError({
      code: 'chat_session_not_found',
      status: 404,
      message: 'Chat session not found',
      details: { sessionId }
    })
  }
  return session
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

function normalizeBangCommandOrThrow(commandText: string): string {
  const command = commandText.trim()
  if (!command) {
    throw new AppError({
      code: 'chat_bang_command_empty',
      status: 400,
      message: 'Bang command must not be empty'
    })
  }
  if (command.includes('\n') || command.includes('\r')) {
    throw new AppError({
      code: 'chat_bang_command_multiline_unsupported',
      status: 400,
      message: 'Bang command must be a single line'
    })
  }
  return command
}

async function resolveRuntimeSessionForBangCommand(input: {
  sessionId: string
  context: SessionRunContext
  runtimeKind: RuntimeKind
  runtime: ChatRuntime
}): Promise<{
  runtimeSession: RuntimeSession
  requestedModelId: string | null
}> {
  return await resolveRuntimeSessionForContext(input)
}

async function resolveParentRuntimeSessionForSide(input: {
  parentSessionId: string
  context: SessionRunContext
  runtimeKind: RuntimeKind
  runtime: ChatRuntime
  modelId?: string
}): Promise<{
  runtimeSession: RuntimeSession | null
  requestedModelId: string | null
  reusableBinding: BackendSessionBinding | undefined
}> {
  const activeRunId = activeRunIdsBySession.get(input.parentSessionId)
  const activeRun = activeRunId ? activeRuns.get(activeRunId) : undefined
  if (
    activeRun &&
    activeRun.providerTargetId === input.context.providerTarget.id &&
    activeRun.runtimeSession.runtimeKind === input.runtimeKind &&
    activeRun.runtimeSession.providerSessionId
  ) {
    return {
      runtimeSession: activeRun.runtimeSession,
      reusableBinding: undefined,
      requestedModelId:
        input.modelId ??
        activeRun.modelId ??
        readProviderStateSnapshot(activeRun.runtimeSession.providerStateSnapshot).models
          .currentModelId ??
        null
    }
  }

  const reusableBinding = readReusableDurableProviderRuntimeBinding({
    chatSessionId: input.parentSessionId,
    providerTargetId: input.context.providerTarget.id,
    runtimeKind: input.runtimeKind
  })

  if (!reusableBinding) {
    return {
      runtimeSession: null,
      reusableBinding: undefined,
      requestedModelId: input.modelId ?? null
    }
  }

  const requestedModelId =
    input.modelId ??
    reusableBinding.requestedModelId ??
    readProviderStateSnapshot(reusableBinding.backendStateSnapshot).models.currentModelId ??
    null

  let runtimeSession: RuntimeSession
  try {
    runtimeSession = await input.runtime.resumeChatSession({
      runtimeSession: {
        id: input.parentSessionId,
        chatSessionId: input.parentSessionId,
        providerTargetId: input.context.providerTarget.id,
        runtimeKind: input.runtimeKind,
        providerSessionId: reusableBinding.backendSessionId,
        providerStateSnapshot: reusableBinding.backendStateSnapshot
      },
      profile: input.context.profile,
      workspacePath: input.context.workspacePath,
      agentId: input.context.session.agentId,
      modelId: requestedModelId ?? undefined
    })
  } catch (error) {
    chatLogger.warn(
      'parent runtime resume failed for side chat; falling back to Cradle side context',
      {
        error,
        parentSessionId: input.parentSessionId,
        runtimeKind: input.runtimeKind
      }
    )
    return {
      runtimeSession: null,
      reusableBinding,
      requestedModelId
    }
  }

  return {
    runtimeSession,
    reusableBinding,
    requestedModelId:
      requestedModelId ??
      readProviderStateSnapshot(runtimeSession.providerStateSnapshot).models.currentModelId
  }
}

function createSideSessionTitle(parentTitle: string): string {
  const title = normalizeRuntimeSessionTitle(parentTitle) ?? 'Untitled'
  return `Side from ${title}`
}

export async function createSideChat(input: CreateSideChatInput): Promise<SideChatSessionDto> {
  const parentSession = assertStoredSession(input.parentSessionId)
  const context = assertRuntimeCompatibleTarget(
    assertRunnableSession(input.parentSessionId),
    input.providerTargetId
  )
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

  const runtimeKind = context.session.runtimeKind ?? 'standard'
  const runtime = getRuntimeRegistry().get(runtimeKind)
  if (!runtime) {
    throw new AppError({
      code: 'chat_runtime_not_available',
      status: 501,
      message: `Runtime is not available: ${runtimeKind}`
    })
  }

  const parentRuntime = await resolveParentRuntimeSessionForSide({
    parentSessionId: input.parentSessionId,
    context,
    runtimeKind,
    runtime,
    modelId: input.modelId
  })

  const sideConversationId = randomUUID()
  const childAgentId =
    context.session.agentId && context.session.providerTargetId === context.providerTarget.id
      ? context.session.agentId
      : null
  const transcript = await readSessionTranscript(input.parentSessionId)
  const requestedModelId = parentRuntime.requestedModelId ?? input.modelId ?? undefined
  const sideHostLease = reserveSideConversationHostLease({
    sideConversationId,
    runtimeKind,
    providerTargetId: context.providerTarget.id
  })
  let sideRegistered = false
  try {
    const childRuntimeSession =
      runtime.forkRuntimeSession && parentRuntime.runtimeSession?.providerSessionId
        ? await runtime.forkRuntimeSession({
            sourceRuntimeSession: parentRuntime.runtimeSession,
            childChatSessionId: sideConversationId,
            profile: context.profile,
            workspaceId: context.session.workspaceId,
            workspacePath: context.workspacePath,
            agentId: childAgentId,
            modelId: requestedModelId,
            systemPrompt: resolveSessionSystemPrompt(context.session)
          })
        : await runtime.startChatSession({
            chatSessionId: sideConversationId,
            profile: context.profile,
            workspacePath: context.workspacePath,
            agentId: childAgentId,
            modelId: requestedModelId
          })

    const record = registerSideConversation({
      sideConversationId,
      parentSessionId: input.parentSessionId,
      runtimeKind: childRuntimeSession.runtimeKind,
      providerTargetId: context.providerTarget.id,
      runtimeSession: childRuntimeSession,
      requestedModelId:
        parentRuntime.requestedModelId ??
        input.modelId ??
        readProviderStateSnapshot(childRuntimeSession.providerStateSnapshot).models.currentModelId,
      history: transcript,
      hostLease: sideHostLease
    })
    sideRegistered = true

    return {
      sideConversationId,
      parentSessionId: input.parentSessionId,
      runtimeKind: childRuntimeSession.runtimeKind,
      providerTargetId: context.providerTarget.id,
      providerSessionId: childRuntimeSession.providerSessionId,
      title: createSideSessionTitle(parentSession.title),
      expiresAt: record.expiresAt
    }
  } finally {
    if (!sideRegistered) {
      sideHostLease.lease.release()
    }
  }
}

export async function executeBangCommand(input: {
  sessionId: string
  command: string
  signal?: AbortSignal
}): Promise<BangCommandExecutionResult> {
  const command = normalizeBangCommandOrThrow(input.command)
  const session = assertStoredSession(input.sessionId)
  const runtimeKind = session.runtimeKind ?? 'standard'

  if (runtimeKind !== 'codex') {
    return await executeLocalBangCommand({ ...input, command })
  }

  const context = assertRuntimeCompatibleTarget(assertRunnableSession(input.sessionId))
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

  const activeRunId = activeRunIdsBySession.get(input.sessionId)
  if (activeRunId && activeRuns.get(activeRunId)?.runtimeSession.runtimeKind === 'codex') {
    throw new AppError({
      code: 'chat_bang_command_runtime_busy',
      status: 409,
      message: 'Codex bang commands cannot run while a Codex response is streaming',
      details: { sessionId: input.sessionId }
    })
  }

  const runtime = getRuntimeRegistry().get('codex')
  if (!runtime?.capabilities.supportsShellExecution || !runtime.executeShellCommand) {
    throw new AppError({
      code: 'chat_runtime_shell_command_unavailable',
      status: 501,
      message: 'Codex runtime does not support shell command execution'
    })
  }

  const { runtimeSession, requestedModelId } = await resolveRuntimeSessionForBangCommand({
    sessionId: input.sessionId,
    context,
    runtimeKind,
    runtime
  })

  const output = await runtime.executeShellCommand({
    runtimeSession,
    profile: context.profile,
    workspaceId: context.session.workspaceId,
    workspacePath: context.workspacePath,
    agentId: context.session.agentId,
    modelId: requestedModelId ?? undefined,
    command,
    signal: input.signal
  })

  attachBinding({
    sessionId: input.sessionId,
    providerTargetId: context.providerTarget.id,
    runtimeKind: runtimeSession.runtimeKind,
    runtimeSession,
    requestedModelId
  })

  return {
    ...output,
    ...persistBangCommandMessages({
      sessionId: input.sessionId,
      ...output
    })
  }
}

function listPendingQueueRows(sessionId: string): Array<typeof chatSessionQueueItems.$inferSelect> {
  return db()
    .select()
    .from(chatSessionQueueItems)
    .where(
      and(
        eq(chatSessionQueueItems.sessionId, sessionId),
        eq(chatSessionQueueItems.mode, 'queue'),
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
        eq(chatSessionQueueItems.mode, 'queue'),
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

// ── public service functions ──

export function getMessageGroups(sessionId: string): ChatMessageSnapshotRow[] {
  assertStoredSession(sessionId)

  if (!activeRunIdsBySession.has(sessionId) && !pendingRunSessions.has(sessionId)) {
    failOrphanedPersistedStreamingSession(sessionId)
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
      message: parsedMessage
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

export function resolvePlanImplementationApproval(input: {
  sessionId: string
  messageId: string
  approvalId: string
  approved: boolean
}): { message: UIMessage } {
  assertStoredSession(input.sessionId)
  if (!input.approvalId.startsWith('implement-plan:')) {
    throw new AppError({
      code: 'chat_plan_implementation_approval_invalid',
      status: 400,
      message: 'Plan implementation approval id is invalid',
      details: { approvalId: input.approvalId }
    })
  }

  const row = db()
    .select()
    .from(messages)
    .where(and(eq(messages.id, input.messageId), eq(messages.sessionId, input.sessionId)))
    .get()
  if (!row) {
    throw new AppError({
      code: 'chat_message_not_found',
      status: 404,
      message: 'Chat message was not found',
      details: {
        sessionId: input.sessionId,
        messageId: input.messageId
      }
    })
  }
  if (row.role !== 'assistant') {
    throw new AppError({
      code: 'chat_plan_implementation_approval_invalid',
      status: 400,
      message: 'Plan implementation approval must target an assistant message',
      details: {
        sessionId: input.sessionId,
        messageId: input.messageId,
        role: row.role
      }
    })
  }

  const message = parseStoredMessageSnapshot(row, 'assistant')
  const part = findPlanImplementationApprovalPart(message, input.approvalId)
  if (!part) {
    throw new AppError({
      code: 'chat_plan_implementation_approval_not_found',
      status: 404,
      message: 'Plan implementation approval was not found',
      details: {
        sessionId: input.sessionId,
        messageId: input.messageId,
        approvalId: input.approvalId
      }
    })
  }

  part.state = 'approval-responded'
  part.approval = {
    id: input.approvalId,
    approved: input.approved
  }
  persistMessageSnapshot({
    sessionId: input.sessionId,
    messageId: input.messageId,
    message,
    messageStatus: row.status as ChatMessageStatus,
    errorText: row.errorText
  })

  return { message }
}

function parseStoredMessageSnapshot(
  row: typeof messages.$inferSelect,
  role: 'user' | 'assistant'
): ChatMessageSnapshotRow['message'] {
  try {
    return parseTrustedStoredMessageSnapshot(row.messageJson) as ChatMessageSnapshotRow['message']
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

function findPlanImplementationApprovalPart(
  message: UIMessage,
  approvalId: string
): MutableApprovalToolPart | null {
  for (const part of message.parts) {
    if (!isToolPartWithApproval(part, approvalId)) {
      continue
    }
    if (part.toolCallId !== approvalId) {
      continue
    }
    if (readToolPartApiName(part) !== 'plan_implementation') {
      continue
    }
    if (!readPlanImplementationContent(part)) {
      continue
    }
    return part
  }
  return null
}

function isToolPartWithApproval(
  part: UIMessage['parts'][number],
  approvalId: string
): part is MutableApprovalToolPart {
  if (!('toolCallId' in part) || typeof part.toolCallId !== 'string') {
    return false
  }
  if (part.type !== 'dynamic-tool' && !part.type.startsWith('tool-')) {
    return false
  }
  const approval = (part as MutableApprovalToolPart).approval
  return typeof approval?.id === 'string' && approval.id === approvalId
}

function readToolPartApiName(part: MutableApprovalToolPart): string | null {
  const inputPayload = readBuiltinToolCallInputPayload(part.input)
  if (inputPayload) {
    return inputPayload.apiName
  }
  if (typeof part.toolName === 'string') {
    return part.toolName
  }
  return part.type.startsWith('tool-') ? part.type.slice('tool-'.length) : null
}

function readPlanImplementationContent(part: MutableApprovalToolPart): string | null {
  const inputPayload = readBuiltinToolCallInputPayload(part.input)
  const args = readUnknownRecord(inputPayload?.args ?? part.input)
  const planContent = args.planContent
  return typeof planContent === 'string' && planContent.trim().length > 0 ? planContent : null
}

function emptyRuntimePresentation(runtimeKind: RuntimeKind): RuntimePresentationCapabilities {
  return {
    runtimeKind,
    slashCommands: [],
    uiSlots: [],
    skills: []
  }
}

export async function getCapabilities(sessionId: string): Promise<RuntimePresentationCapabilities> {
  const context = getSessionRunContext(sessionId)
  if (!context) {
    const session = assertStoredSession(sessionId)
    return emptyRuntimePresentation(session.runtimeKind ?? 'standard')
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

  if (!runtime.getPresentation) {
    return emptyRuntimePresentation(runtimeKind)
  }

  const activeRunId = activeRunIdsBySession.get(sessionId)
  const activeRun = activeRunId ? activeRuns.get(activeRunId) : undefined
  if (activeRun?.runtimeSession.runtimeKind === runtimeKind) {
    return runtime.getPresentation({
      runtimeSession: activeRun.runtimeSession,
      profile: context.profile,
      workspaceId: context.session.workspaceId,
      workspacePath: context.workspacePath,
      agentId: context.session.agentId,
      modelId:
        activeRun.modelId ??
        readProviderStateSnapshot(activeRun.runtimeSession.providerStateSnapshot).models
          .currentModelId ??
        undefined,
      systemPrompt: resolveSessionSystemPrompt(context.session)
    })
  }

  const resolved = await resolveExistingRuntimeSessionForContext({
    sessionId,
    context,
    runtimeKind,
    runtime
  })
  if (!resolved) {
    return emptyRuntimePresentation(runtimeKind)
  }

  return runtime.getPresentation({
    runtimeSession: resolved.runtimeSession,
    profile: context.profile,
    workspaceId: context.session.workspaceId,
    workspacePath: context.workspacePath,
    agentId: context.session.agentId,
    modelId:
      resolved.requestedModelId ??
      readProviderStateSnapshot(resolved.runtimeSession.providerStateSnapshot).models
        .currentModelId ??
      undefined,
    systemPrompt: resolveSessionSystemPrompt(context.session)
  })
}

export async function getDraftRuntimeCapabilities(
  runtimeKind: RuntimeKind
): Promise<RuntimePresentationCapabilities> {
  const registry = getRuntimeRegistry()
  const runtime = registry.get(runtimeKind)
  if (!runtime) {
    throw new AppError({
      code: 'chat_runtime_not_available',
      status: 501,
      message: `Runtime is not available: ${runtimeKind}`
    })
  }

  if (!runtime.getDraftPresentation) {
    return emptyRuntimePresentation(runtimeKind)
  }

  return await runtime.getDraftPresentation()
}

export function listRuntimes() {
  return { items: listRuntimeCatalog() }
}

export async function listRuntimeHealthStatuses() {
  return { items: await listRuntimeHealth() }
}

export async function getUiSlotStates(
  sessionId: string
): Promise<{ runtimeKind: RuntimeKind; states: RuntimeUiSlotState[] }> {
  const context = getSessionRunContext(sessionId)
  if (!context) {
    const session = assertStoredSession(sessionId)
    return {
      runtimeKind: session.runtimeKind ?? 'standard',
      states: []
    }
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

  const activeRunId = activeRunIdsBySession.get(sessionId)
  const activeRun = activeRunId ? activeRuns.get(activeRunId) : undefined
  if (activeRun?.runtimeSession.runtimeKind === runtimeKind) {
    const providerStates =
      runtime.capabilities.supportsUiSlotStates && runtime.getUiSlotStates
        ? await runtime.getUiSlotStates({
            runtimeSession: activeRun.runtimeSession,
            profile: context.profile,
            workspaceId: context.session.workspaceId,
            workspacePath: context.workspacePath,
            agentId: context.session.agentId,
            modelId:
              readProviderStateSnapshot(activeRun.runtimeSession.providerStateSnapshot).models
                .currentModelId ?? undefined,
            systemPrompt: resolveSessionSystemPrompt(context.session)
          })
        : []
    return {
      runtimeKind,
      states: appendPendingUserInputSlotStates(providerStates, {
        sessionId,
        runtimeKind,
        threadId: activeRun.runtimeSession.providerSessionId
      })
    }
  }

  if (!runtime.capabilities.supportsUiSlotStates || !runtime.getUiSlotStates) {
    return {
      runtimeKind,
      states: appendPendingUserInputSlotStates([], {
        sessionId,
        runtimeKind,
        threadId: null
      })
    }
  }

  const resolved = await resolveExistingRuntimeSessionForContext({
    sessionId,
    context,
    runtimeKind,
    runtime
  })
  if (!resolved) {
    return {
      runtimeKind,
      states: appendPendingUserInputSlotStates([], {
        sessionId,
        runtimeKind,
        threadId: null
      })
    }
  }

  const states = await runtime.getUiSlotStates({
    runtimeSession: resolved.runtimeSession,
    profile: context.profile,
    workspaceId: context.session.workspaceId,
    workspacePath: context.workspacePath,
    agentId: context.session.agentId,
    modelId:
      resolved.requestedModelId ??
      readProviderStateSnapshot(resolved.runtimeSession.providerStateSnapshot).models
        .currentModelId ??
      undefined,
    systemPrompt: resolveSessionSystemPrompt(context.session)
  })
  return {
    runtimeKind,
    states: appendPendingUserInputSlotStates(states, {
      sessionId,
      runtimeKind,
      threadId: resolved.runtimeSession.providerSessionId
    })
  }
}

function appendPendingUserInputSlotStates(
  states: RuntimeUiSlotState[],
  input: {
    sessionId: string
    runtimeKind: RuntimeKind
    threadId: string | null
  }
): RuntimeUiSlotState[] {
  const pendingStates = listPendingRuntimeUserInputStates({
    sessionId: input.sessionId,
    slotId: `${input.runtimeKind}:user-input`,
    threadId: input.threadId
  })
  return pendingStates.length > 0 ? [...states, ...pendingStates] : states
}

export async function regenerateSessionTitle(
  sessionId: string
): Promise<SessionService.SessionView> {
  const context = assertRuntimeCompatibleTarget(assertRunnableSession(sessionId))
  const promptText = readFirstUserPromptText(sessionId)
  if (!promptText) {
    throw new AppError({
      code: 'chat_session_title_prompt_not_found',
      status: 400,
      message: 'Chat session does not have a user prompt to name',
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
  if (!runtime.generateSessionTitle) {
    throw new AppError({
      code: 'chat_runtime_title_generation_not_supported',
      status: 501,
      message: 'Runtime does not support session title generation',
      details: { sessionId, runtimeKind }
    })
  }

  let resolved: ResolvedRuntimeSessionContext
  const activeRunId = activeRunIdsBySession.get(sessionId)
  const activeRun = activeRunId ? activeRuns.get(activeRunId) : undefined
  if (activeRun?.runtimeSession.runtimeKind === runtimeKind) {
    resolved = {
      context,
      runtimeKind,
      runtime: activeRun.runtime,
      runtimeSession: activeRun.runtimeSession,
      modelId:
        activeRun.modelId ??
        readProviderStateSnapshot(activeRun.runtimeSession.providerStateSnapshot).models
          .currentModelId ??
        undefined
    }
  } else {
    const runtimeResolution = await resolveRuntimeSessionForContext({
      sessionId,
      context,
      runtimeKind,
      runtime
    })
    resolved = {
      context,
      runtimeKind,
      runtime,
      runtimeSession: runtimeResolution.runtimeSession,
      modelId:
        runtimeResolution.requestedModelId ??
        readProviderStateSnapshot(runtimeResolution.runtimeSession.providerStateSnapshot).models
          .currentModelId ??
        undefined
    }
  }

  let title: string | null
  try {
    title = await runtime.generateSessionTitle({
      ...buildRuntimeProviderInput(resolved),
      promptText
    } satisfies GenerateSessionTitleInput)
  } catch (error) {
    throw createSessionTitleGenerationError({
      sessionId,
      runtimeKind: resolved.runtimeKind,
      providerTargetId: resolved.context.providerTarget.id,
      error
    })
  }
  if (!title) {
    throw createSessionTitleGenerationError({
      sessionId,
      runtimeKind: resolved.runtimeKind,
      providerTargetId: resolved.context.providerTarget.id,
      reason: 'empty_title'
    })
  }

  reportRuntimeSessionTitle({
    sessionId,
    title,
    overwriteUserTitle: true
  })
  attachBinding({
    sessionId,
    providerTargetId: resolved.context.providerTarget.id,
    runtimeKind: resolved.runtimeSession.runtimeKind,
    runtimeSession: resolved.runtimeSession,
    requestedModelId: resolved.modelId ?? null
  })

  const updated = SessionService.get(sessionId)
  if (!updated) {
    throw new AppError({
      code: 'chat_session_not_found',
      status: 404,
      message: 'Chat session not found',
      details: { sessionId }
    })
  }
  return updated
}

export async function listProviderThreads(
  sessionId: string,
  query: {
    cursor?: string | null
    limit?: number | null
    sortKey?: 'created_at' | 'updated_at' | null
    sortDirection?: 'asc' | 'desc' | null
    sourceKinds?: ProviderThreadSourceKind[] | null
    archived?: boolean | null
    searchTerm?: string | null
  } = {}
): Promise<ProviderThreadListResult> {
  const resolved = await resolveRuntimeSessionContext(sessionId)
  if (!resolved.runtime.listProviderThreads) {
    return {
      runtimeKind: resolved.runtimeKind,
      providerSessionId: resolved.runtimeSession.providerSessionId,
      threads: [],
      nextCursor: null,
      backwardsCursor: null
    }
  }
  return await resolved.runtime.listProviderThreads({
    ...buildRuntimeProviderInput(resolved),
    ...query
  } satisfies ProviderThreadListInput)
}

export async function readProviderThread(
  sessionId: string,
  threadId: string
): Promise<ProviderThreadReadResult> {
  const resolved = await resolveRuntimeSessionContext(sessionId)
  if (!resolved.runtime.readProviderThread) {
    throw new AppError({
      code: 'chat_provider_threads_not_supported',
      status: 501,
      message: 'Runtime does not support provider thread reads',
      details: { sessionId, runtimeKind: resolved.runtimeKind }
    })
  }
  return await resolved.runtime.readProviderThread({
    ...buildRuntimeProviderInput(resolved),
    threadId,
    includeTurns: false
  })
}

export async function listProviderThreadTurns(
  sessionId: string,
  threadId: string,
  query: {
    cursor?: string | null
    limit?: number | null
    sortDirection?: 'asc' | 'desc' | null
  } = {}
): Promise<ProviderThreadTurnsResult> {
  const resolved = await resolveRuntimeSessionContext(sessionId)
  if (!resolved.runtime.listProviderThreadTurns) {
    throw new AppError({
      code: 'chat_provider_threads_not_supported',
      status: 501,
      message: 'Runtime does not support provider thread turns',
      details: { sessionId, runtimeKind: resolved.runtimeKind }
    })
  }
  return await resolved.runtime.listProviderThreadTurns({
    ...buildRuntimeProviderInput(resolved),
    threadId,
    ...query
  })
}

export async function readContextUsage(sessionId: string): Promise<ChatSessionContextUsageDto> {
  const resolved = await resolveRuntimeSessionContext(sessionId)
  if (!resolved.runtime.getContextUsage) {
    return {
      sessionId,
      runtimeKind: resolved.runtimeKind,
      providerSessionId: resolved.runtimeSession.providerSessionId,
      usage: null
    }
  }

  return {
    sessionId,
    runtimeKind: resolved.runtimeKind,
    providerSessionId: resolved.runtimeSession.providerSessionId,
    usage: await resolved.runtime.getContextUsage(buildRuntimeProviderInput(resolved))
  }
}

async function resolveRuntimeSessionContext(
  sessionId: string
): Promise<ResolvedRuntimeSessionContext> {
  const context = getSessionRunContext(sessionId)
  if (!context) {
    assertStoredSession(sessionId)
    throw new AppError({
      code: 'chat_session_not_runnable',
      status: 404,
      message: 'Chat session runtime context was not found',
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

  const activeRunId = activeRunIdsBySession.get(sessionId)
  const activeRun = activeRunId ? activeRuns.get(activeRunId) : undefined
  if (activeRun?.runtimeSession.runtimeKind === runtimeKind) {
    return {
      context,
      runtimeKind,
      runtime: activeRun.runtime,
      runtimeSession: activeRun.runtimeSession,
      modelId:
        readProviderStateSnapshot(activeRun.runtimeSession.providerStateSnapshot).models
          .currentModelId ?? undefined
    }
  }

  const resolved = await resolveExistingRuntimeSessionForContext({
    sessionId,
    context,
    runtimeKind,
    runtime
  })
  if (!resolved) {
    throw new AppError({
      code: 'chat_runtime_session_not_started',
      status: 404,
      message: 'Chat session has no provider runtime session',
      details: { sessionId, runtimeKind }
    })
  }

  const modelId =
    resolved.requestedModelId ??
    readProviderStateSnapshot(resolved.runtimeSession.providerStateSnapshot).models
      .currentModelId ??
    undefined

  return {
    context,
    runtimeKind,
    runtime,
    runtimeSession: resolved.runtimeSession,
    modelId
  }
}

function buildRuntimeProviderInput(resolved: ResolvedRuntimeSessionContext) {
  return {
    runtimeSession: resolved.runtimeSession,
    profile: resolved.context.profile,
    workspaceId: resolved.context.session.workspaceId,
    workspacePath: resolved.context.workspacePath,
    agentId: resolved.context.session.agentId,
    modelId: resolved.modelId,
    systemPrompt: resolveSessionSystemPrompt(resolved.context.session)
  }
}

export function getCodexAppServerCapabilityManifest(): ProviderNativeAppServerCapabilityManifest {
  const runtime = getRuntimeRegistry().get('codex')
  if (!runtime?.getProviderNativeAppServerCapabilities) {
    throw new AppError({
      code: 'chat_runtime_not_available',
      status: 501,
      message: 'Codex app-server capabilities are not available'
    })
  }
  return runtime.getProviderNativeAppServerCapabilities()
}

export async function invokeCodexAppServer(
  input: CodexAppServerInvokeInput
): Promise<ProviderNativeAppServerInvokeResponse> {
  const context = await resolveCodexProviderNativeAppServerContext(input)
  if (!context.runtime.invokeProviderNativeAppServer) {
    throw new AppError({
      code: 'chat_runtime_not_available',
      status: 501,
      message: 'Codex app-server invoke is not available'
    })
  }
  const response = await context.runtime.invokeProviderNativeAppServer({
    ...context,
    method: input.method,
    params: input.params
  })
  persistProviderNativeAppServerRuntimeSession({
    sessionId: input.sessionId,
    runtimeSession: context.runtimeSession,
    providerTargetId: context.runtimeSession.providerTargetId,
    requestedModelId:
      input.modelId ??
      readProviderStateSnapshot(context.runtimeSession.providerStateSnapshot).models.currentModelId
  })
  return response
}

function persistProviderNativeAppServerRuntimeSession(input: {
  sessionId: string
  runtimeSession: RuntimeSession
  providerTargetId: string
  requestedModelId: string | null
}): void {
  if (!canPersistRuntimeSessionForProviderTarget(input)) {
    chatLogger.warn(
      'skipped app-server runtime session persistence after provider target changed',
      {
        sessionId: input.sessionId,
        providerTargetId: input.providerTargetId
      }
    )
    return
  }
  attachBinding({
    sessionId: input.sessionId,
    providerTargetId: input.providerTargetId,
    runtimeKind: input.runtimeSession.runtimeKind,
    runtimeSession: input.runtimeSession,
    requestedModelId: input.requestedModelId
  })
}

export async function openCodexAppServerStream(
  input: CodexAppServerStreamInput
): Promise<ReadableStream<Uint8Array>> {
  const context = await resolveCodexProviderNativeAppServerContext(input)
  if (!context.runtime.openProviderNativeAppServerStream) {
    throw new AppError({
      code: 'chat_runtime_not_available',
      status: 501,
      message: 'Codex app-server streaming is not available'
    })
  }
  const stream = context.runtime.openProviderNativeAppServerStream({
    ...context,
    method: input.method,
    params: input.params,
    closeOnMethods: input.closeOnMethods
  })
  return persistCodexAppServerRuntimeSessionAfterStream({
    stream,
    sessionId: input.sessionId,
    runtimeSession: context.runtimeSession,
    providerTargetId: context.runtimeSession.providerTargetId,
    modelId: input.modelId
  })
}

function persistCodexAppServerRuntimeSessionAfterStream(input: {
  stream: ReadableStream<Uint8Array>
  sessionId: string
  runtimeSession: RuntimeSession
  providerTargetId: string
  modelId?: string
}): ReadableStream<Uint8Array> {
  const reader = input.stream.getReader()
  let persisted = false
  let released = false

  const releaseReader = () => {
    if (released) {
      return
    }
    released = true
    reader.releaseLock()
  }

  const persist = () => {
    if (persisted) {
      return
    }
    persisted = true
    persistProviderNativeAppServerRuntimeSession({
      sessionId: input.sessionId,
      runtimeSession: input.runtimeSession,
      providerTargetId: input.providerTargetId,
      requestedModelId:
        input.modelId ??
        readProviderStateSnapshot(input.runtimeSession.providerStateSnapshot).models.currentModelId
    })
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read()
        if (chunk.done) {
          persist()
          releaseReader()
          controller.close()
          return
        }
        controller.enqueue(chunk.value)
      } catch (error) {
        persist()
        releaseReader()
        controller.error(error)
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason)
      } finally {
        persist()
        releaseReader()
      }
    }
  })
}

async function resolveCodexProviderNativeAppServerContext(input: {
  sessionId: string
  providerTargetId?: string
  modelId?: string
}) {
  const context = getSessionRunContext(input.sessionId, {
    providerTargetId: input.providerTargetId
  })
  if (!context) {
    throw new AppError({
      code: 'chat_session_not_found',
      status: 404,
      message: 'Chat session not found',
      details: { sessionId: input.sessionId }
    })
  }
  if ((context.session.runtimeKind ?? 'standard') !== 'codex') {
    throw new AppError({
      code: 'chat_runtime_not_codex',
      status: 400,
      message: 'Codex app-server calls require a Codex chat runtime session',
      details: {
        sessionId: input.sessionId,
        runtimeKind: context.session.runtimeKind ?? 'standard'
      }
    })
  }
  assertRuntimeCompatibleTarget(context, input.providerTargetId)

  const runtime = getRuntimeRegistry().get('codex')
  if (!runtime) {
    throw new AppError({
      code: 'chat_runtime_not_available',
      status: 501,
      message: 'Runtime is not available: codex'
    })
  }

  const requestedModelId =
    input.modelId ??
    readSessionRequestedModelId({
      session: context.session,
      requestedProviderTargetId: input.providerTargetId
    })
  const { runtimeSession, requestedModelId: resolvedModelId } =
    await resolveRuntimeSessionForContext({
      sessionId: input.sessionId,
      context,
      runtimeKind: 'codex',
      runtime,
      modelId: requestedModelId,
      requestedProviderTargetId: input.providerTargetId
    })

  attachBinding({
    sessionId: input.sessionId,
    providerTargetId: context.providerTarget.id,
    runtimeKind: runtimeSession.runtimeKind,
    runtimeSession,
    requestedModelId:
      requestedModelId ??
      resolvedModelId ??
      readProviderStateSnapshot(runtimeSession.providerStateSnapshot).models.currentModelId
  })

  return {
    runtime,
    runtimeSession,
    profile: context.profile,
    workspaceId: context.session.workspaceId,
    workspacePath: context.workspacePath,
    agentId: context.session.agentId,
    modelId: requestedModelId ?? resolvedModelId ?? undefined
  }
}

export async function createRun(input: {
  sessionId: string
  text?: string
  files?: FileUIPart[]
  contextParts?: ChatContextPart[]
  messages?: UIMessage[]
  providerTargetId?: string
  modelId?: string
  thinkingEffort?: ChatThinkingEffort
  runtimeSettings?: ChatRuntimeSettingsPatch
  continuationMode?: ChatSessionQueueMode
  queueItemId?: string
  internalContinuation?: 'codexGoal'
}) {
  failOrphanedPersistedStreamingSessionIfIdle(input.sessionId)
  if (activeRunIdsBySession.has(input.sessionId) || pendingRunSessions.has(input.sessionId)) {
    throw new AppError({
      code: 'chat_run_in_progress',
      status: 409,
      message: 'Chat session already has an active run',
      details: { sessionId: input.sessionId }
    })
  }
  if (input.internalContinuation !== 'codexGoal') {
    cancelPendingCodexGoalContinuation(input.sessionId)
  }
  const pendingState: PendingRunState = { cancelled: false, queueItemId: input.queueItemId }
  pendingRunSessions.set(input.sessionId, pendingState)

  try {
    const userText = input.text ?? ''
    const files = input.files ?? []
    const contextParts = input.contextParts ?? []
    const requestMessages = input.messages
    const lastRequestMessage = requestMessages?.at(-1)
    if (
      !input.internalContinuation &&
      !requestMessages &&
      !userText.trim() &&
      files.length === 0 &&
      contextParts.length === 0
    ) {
      throw new AppError({
        code: 'chat_message_empty',
        status: 400,
        message: 'Chat message requires text or at least one file attachment',
        details: { sessionId: input.sessionId }
      })
    }
    if (requestMessages && !lastRequestMessage) {
      throw new AppError({
        code: 'chat_message_empty',
        status: 400,
        message: 'Chat message history cannot be empty',
        details: { sessionId: input.sessionId }
      })
    }
    if (
      lastRequestMessage &&
      lastRequestMessage.role !== 'user' &&
      lastRequestMessage.role !== 'assistant'
    ) {
      throw new AppError({
        code: 'chat_message_invalid',
        status: 400,
        message: 'Chat message history must end with a user or assistant message',
        details: {
          sessionId: input.sessionId,
          role: lastRequestMessage.role
        }
      })
    }

    const requestedProviderTargetId = input.providerTargetId
    const context = getSessionRunContext(input.sessionId, {
      providerTargetId: requestedProviderTargetId
    })
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
    const runtimeContextParts =
      runtimeKind === 'codex' ? withCodexBaselineSkillContextParts(contextParts) : contextParts
    const runtimeLastRequestMessage =
      runtimeKind === 'codex' && lastRequestMessage?.role === 'user'
        ? withCodexBaselineSkillUserMessage(lastRequestMessage)
        : lastRequestMessage
    const runtimeRequestMessages = replaceLastRequestMessage(
      requestMessages,
      runtimeLastRequestMessage
    )

    const sessionRuntimeSettings = readSessionRuntimeSettings(context.session.configJson)
    const runtimeSettings = mergeRuntimeSettings(
      sessionRuntimeSettings,
      normalizeRuntimeSettingsPatch(input.runtimeSettings)
    )
    const requestedModelId =
      input.modelId ??
      readSessionRequestedModelId({
        session: context.session,
        requestedProviderTargetId
      })
    const runtimeResolution = await resolveRuntimeSessionForContext({
      sessionId: input.sessionId,
      context,
      runtimeKind,
      runtime,
      modelId: requestedModelId,
      requestedProviderTargetId
    })
    const runtimeSession = runtimeResolution.runtimeSession

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
      requestedModelId: runtimeResolution.requestedModelId
    })

    const draft =
      input.internalContinuation === 'codexGoal'
        ? createCodexGoalContinuationDraft({ sessionId: input.sessionId })
        : runtimeLastRequestMessage?.role === 'assistant'
          ? {
              userMessageId: '',
              assistantMessageId: runtimeLastRequestMessage.id,
              userMessage: runtimeLastRequestMessage
            }
          : runtimeLastRequestMessage?.role === 'user'
            ? createDraftTurnFromUserMessage({
                sessionId: input.sessionId,
                userMessage: runtimeLastRequestMessage,
                continuation: input.continuationMode
                  ? { mode: input.continuationMode, queueItemId: input.queueItemId }
                  : undefined
              })
            : createDraftTurn({
                sessionId: input.sessionId,
                runtimeKind,
                userText,
                files,
                contextParts: runtimeContextParts,
                continuation: input.continuationMode
                  ? { mode: input.continuationMode, queueItemId: input.queueItemId }
                  : undefined
              })

    if (lastRequestMessage?.role === 'assistant') {
      startAssistantContinuation({
        sessionId: input.sessionId,
        message: lastRequestMessage
      })
    }

    const run = startRun({
      sessionId: input.sessionId,
      messageId: draft.assistantMessageId,
      origin: input.internalContinuation ? 'system' : 'user'
    })
    const activeRun: ActiveRun = {
      runId: run.id,
      sessionId: input.sessionId,
      messageId: draft.assistantMessageId,
      providerTargetKind: context.providerTarget.kind,
      providerTargetId: context.providerTarget.id,
      runtime,
      runtimeSession,
      modelId: runtimeResolution.requestedModelId,
      chunkBuffer: [],
      chunkBufferIndexByKey: new Map(),
      pendingDeltaChunk: null,
      pendingDeltaFlushTimer: null,
      streamedToolInputStartIds: new Set(),
      snapshotTimer: null,
      finalMessage:
        lastRequestMessage?.role === 'assistant'
          ? lastRequestMessage
          : createAssistantMessage(draft.assistantMessageId),
      finalProjection: createFinalMessageProjectionState(),
      queueItemId: input.queueItemId,
      runtimeSettings,
      internalContinuation: input.internalContinuation,
      runSnapshotId: null,
      runSnapshotSeq: 0
    }
    activeRuns.set(run.id, activeRun)
    startActiveRunSnapshot(activeRun, {
      workspaceId: context.session.workspaceId,
      agentId: context.session.agentId
    })
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
          runtimeSettings: activeRun.runtimeSettings
        }
      })
    }
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

    const turnContext = requestMessages
      ? {
          systemPrompt: resolveSessionSystemPrompt(context.session),
          history: requestMessages.slice(0, -1)
        }
      : resolveTurnContext({
          sessionId: input.sessionId,
          draftMessageId: draft.assistantMessageId,
          draftUserMessageId: draft.userMessageId
        })

    void executeRun(activeRun, {
      message: draft.userMessage,
      profile: context.profile,
      modelId: requestedModelId ?? runtimeResolution.requestedModelId ?? undefined,
      thinkingEffort: input.thinkingEffort,
      runtimeSettings,
      systemPrompt: turnContext.systemPrompt,
      transcript: turnContext.transcript,
      history: turnContext.history?.length ? turnContext.history : undefined,
      originalMessages: runtimeRequestMessages,
      workspaceId: context.session.workspaceId,
      workspacePath: context.workspacePath,
      agentId: context.session.agentId
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
  contextParts?: ChatContextPart[]
  messages?: UIMessage[]
  providerTargetId?: string
  modelId?: string
  thinkingEffort?: ChatThinkingEffort
  runtimeSettings?: ChatRuntimeSettingsPatch
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

export async function streamSideConversationResponse(input: {
  sideConversationId: string
  text?: string
  files?: FileUIPart[]
  contextParts?: ChatContextPart[]
  modelId?: string
  thinkingEffort?: ChatThinkingEffort
  runtimeSettings?: ChatRuntimeSettingsPatch
}): Promise<{
  runId: string
  assistantMessageId: string
  userMessageId: string
  stream: ReadableStream<Uint8Array>
}> {
  const record = readSideConversation(input.sideConversationId)
  if (!record) {
    throw new AppError({
      code: 'side_chat_expired',
      status: 410,
      message: 'Side conversation is no longer attached to its live provider thread',
      details: { sideConversationId: input.sideConversationId }
    })
  }
  const parentContext = assertRuntimeCompatibleTarget(assertRunnableSession(record.parentSessionId))
  if (parentContext.providerTarget.id !== record.providerTargetId) {
    throw new AppError({
      code: 'side_chat_provider_target_changed',
      status: 409,
      message: 'Parent session provider target changed after the side conversation was created',
      details: {
        sideConversationId: input.sideConversationId,
        parentSessionId: record.parentSessionId,
        providerTargetId: parentContext.providerTarget.id,
        sideProviderTargetId: record.providerTargetId
      }
    })
  }
  const runtime = getRuntimeRegistry().get(record.runtimeKind)
  if (!runtime) {
    throw new AppError({
      code: 'chat_runtime_not_available',
      status: 501,
      message: `Runtime is not available: ${record.runtimeKind}`
    })
  }

  const userText = input.text ?? ''
  const files = input.files ?? []
  const contextParts = input.contextParts ?? []
  if (!userText.trim() && files.length === 0 && contextParts.length === 0) {
    throw new AppError({
      code: 'chat_message_empty',
      status: 400,
      message: 'Side conversation message requires text, context, or at least one file attachment',
      details: { sideConversationId: input.sideConversationId }
    })
  }

  const runId = randomUUID()
  const assistantMessageId = randomUUID()
  const userMessageId = randomUUID()
  const parentRuntimeSettings = readSessionRuntimeSettings(parentContext.session.configJson)
  const runtimeSettings = mergeRuntimeSettings(
    parentRuntimeSettings,
    normalizeRuntimeSettingsPatch(input.runtimeSettings)
  )
  const message = createUserMessage(userMessageId, userText, files, contextParts)
  const modelId =
    input.modelId ??
    record.requestedModelId ??
    readProviderStateSnapshot(record.runtimeSession.providerStateSnapshot).models.currentModelId ??
    undefined
  return {
    runId,
    assistantMessageId,
    userMessageId,
    stream: createLiveSideConversationStream({
      runId,
      runtime,
      runtimeSession: record.runtimeSession,
      profile: parentContext.profile,
      message,
      responseMessageId: assistantMessageId,
      modelId,
      thinkingEffort: input.thinkingEffort,
      runtimeSettings,
      systemPrompt: resolveSessionSystemPrompt(parentContext.session),
      history: record.history,
      onComplete: (assistantMessage) =>
        appendSideConversationHistory(input.sideConversationId, [message, assistantMessage]),
      workspaceId: parentContext.session.workspaceId,
      workspacePath: parentContext.workspacePath,
      agentId: parentContext.session.agentId
    })
  }
}

export function releaseSideConversationById(sideConversationId: string): void {
  releaseSideConversation(sideConversationId)
}

export async function streamQuickQuestion(
  input: QuickQuestionInput
): Promise<ReadableStream<Uint8Array>> {
  const context = assertRuntimeCompatibleTarget(assertRunnableSession(input.sessionId))
  const runtimeKind = context.session.runtimeKind ?? 'standard'
  const runtime = getRuntimeRegistry().get(runtimeKind)

  if (!runtime) {
    throw new AppError({
      code: 'chat_runtime_not_available',
      status: 501,
      message: `Runtime is not available: ${runtimeKind}`
    })
  }

  if (!runtime.quickQuestion) {
    throw new AppError({
      code: 'quick_question_not_supported',
      status: 409,
      message: 'This provider does not support quick questions',
      details: { runtimeKind }
    })
  }

  const question = input.question.trim()
  if (!question) {
    throw new AppError({
      code: 'chat_message_empty',
      status: 400,
      message: 'Quick question requires non-empty text'
    })
  }

  const resolved = await resolveRuntimeSessionForContext({
    sessionId: input.sessionId,
    context,
    runtimeKind,
    runtime
  })

  // Read the full session transcript so the provider can reuse prompt cache.
  const transcript = await readSessionTranscript(input.sessionId)

  const chunkStream = runtime.quickQuestion({
    runtimeSession: resolved.runtimeSession,
    profile: context.profile,
    question,
    transcript,
    workspaceId: context.session.workspaceId,
    workspacePath: context.workspacePath
  })

  return new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      let terminalPublished = false
      const publish = (chunk: UIMessageChunk, terminal = isTerminalUIMessageChunk(chunk)) => {
        if (terminalPublished) {
          return
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
        if (terminal) {
          terminalPublished = true
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        }
      }

      try {
        for await (const chunk of chunkStream) {
          publish(chunk)
        }
        if (!terminalPublished) {
          publish({ type: 'finish', finishReason: 'stop' }, true)
        }
      } catch (error) {
        publish({ type: 'error', errorText: serializeChatError(error).text }, true)
      } finally {
        controller.close()
      }
    }
  })
}

async function readSessionTranscript(sessionId: string): Promise<UIMessage[]> {
  const rows = db()
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt)
    .all()

  return rows
    .map((row) => parseTrustedStoredMessageSnapshot(row.messageJson))
    .filter((msg): msg is UIMessage => msg !== null)
}

export function openSessionRunStream(sessionId: string): ReadableStream<Uint8Array> {
  assertStoredSession(sessionId)
  releaseTerminalPersistedActiveRunForSession(sessionId)

  const runId = activeRunIdsBySession.get(sessionId)
  if (!runId) {
    return openIdleRunStream()
  }

  return openRunEventStream(runId)
}

export function openProviderThreadStream(
  sessionId: string,
  threadId: string
): ReadableStream<Uint8Array> {
  assertStoredSession(sessionId)
  return openProviderThreadEventStream(sessionId, threadId)
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

  await settleActiveRun(active, 'aborted', null)
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
  if (releaseTerminalPersistedActiveRunForSession(sessionId)) {
    return
  }
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
    const active = activeRuns.get(runId)
    if (!active) {
      continue
    }
    try {
      await settleActiveRun(active, 'aborted', null)
      await requestRuntimeCancel(active)
    } catch {
      /* best-effort */
    } finally {
      releaseActiveRun(active)
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
      details: { runId }
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
    }
  })
}

function openProviderThreadEventStream(
  sessionId: string,
  threadId: string
): ReadableStream<Uint8Array> {
  const key = providerThreadStreamKey(sessionId, threadId)
  const state = providerThreadStreamStore.streams.get(key)
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

      for (const chunk of state?.chunks ?? []) {
        const terminal = isTerminalUIMessageChunk(chunk)
        writeChunk(chunk, terminal)
        if (terminal) {
          return
        }
      }

      if (state?.terminal) {
        closeStream(true)
        return
      }
      if (!state && !activeRunIdsBySession.has(sessionId)) {
        closeStream(true)
        return
      }

      const subscribers =
        providerThreadStreamStore.subscribers.get(key) ?? new Set<ProviderThreadSubscriber>()
      const subscriber: ProviderThreadSubscriber = (chunk, terminal) => writeChunk(chunk, terminal)
      subscribers.add(subscriber)
      providerThreadStreamStore.subscribers.set(key, subscribers)

      unsubscribe = () => {
        const current = providerThreadStreamStore.subscribers.get(key)
        if (!current) {
          return
        }
        current.delete(subscriber)
        if (current.size === 0) {
          providerThreadStreamStore.subscribers.delete(key)
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
    }
  })
}

function createLiveSideConversationStream(input: {
  runId: string
  runtime: ChatRuntime
  runtimeSession: RuntimeSession
  profile: RuntimeProviderTargetProfile
  message: UIMessage
  responseMessageId: string
  modelId?: string
  thinkingEffort?: ChatThinkingEffort
  runtimeSettings: ChatRuntimeSettings
  systemPrompt?: string
  history?: UIMessage[]
  onComplete?: (assistantMessage: UIMessage) => void
  workspaceId?: string | null
  workspacePath?: string
  agentId?: string | null
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const controller = new AbortController()

  return new ReadableStream<Uint8Array>({
    async start(streamController) {
      let terminalPublished = false
      const publish = (chunk: UIMessageChunk, terminal = isTerminalUIMessageChunk(chunk)) => {
        if (terminalPublished) {
          return
        }
        streamController.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
        if (terminal) {
          terminalPublished = true
          streamController.enqueue(encoder.encode('data: [DONE]\n\n'))
        }
      }

      try {
        publish({ type: 'start', messageId: input.responseMessageId }, false)
        const sideProjection = createSideMessageProjection(input.runId, input.responseMessageId)
        let completed = false
        for await (const chunk of input.runtime.streamTurn({
          runId: input.runId,
          runtimeSession: input.runtimeSession,
          profile: input.profile,
          message: input.message,
          responseMessageId: input.responseMessageId,
          modelId: input.modelId,
          history: input.history,
          workspaceId: input.workspaceId,
          workspacePath: input.workspacePath,
          agentId: input.agentId,
          providerOptions:
            input.thinkingEffort || input.runtimeSettings
              ? {
                  ...(input.thinkingEffort ? { thinkingEffort: input.thinkingEffort } : {}),
                  runtimeSettings: input.runtimeSettings
                }
              : undefined,
          systemPrompt: input.systemPrompt
        })) {
          if (controller.signal.aborted) {
            publish({ type: 'abort', reason: 'user' }, true)
            break
          }
          if (chunk.type === 'start') {
            continue
          }
          projectFinalMessageChunk(sideProjection, chunk)
          if (isTerminalUIMessageChunk(chunk)) {
            completed = chunk.type === 'finish'
          }
          publish(chunk)
        }
        if (!terminalPublished) {
          publish({ type: 'finish', finishReason: 'stop' }, true)
          completed = true
        }
        flushFinalMessageProjection(sideProjection)
        if (completed) {
          input.onComplete?.(sideProjection.finalMessage)
        }
      } catch (error) {
        if (controller.signal.aborted) {
          publish({ type: 'abort', reason: 'user' }, true)
        } else {
          publish({ type: 'error', errorText: serializeChatError(error).text }, true)
        }
      } finally {
        streamController.close()
      }
    },
    async cancel() {
      controller.abort()
      try {
        await input.runtime.cancelTurn({
          runtimeSession: input.runtimeSession,
          profile: input.profile
        })
      } catch {
        /* best-effort live side cancellation */
      }
    }
  })
}

function createSideMessageProjection(_runId: string, messageId: string): FinalMessageProjectionRun {
  return {
    finalMessage: createAssistantMessage(messageId),
    finalProjection: createFinalMessageProjectionState()
  }
}

function mergeSseStreamChunk(
  existing: UIMessageChunk,
  next: UIMessageChunk
): UIMessageChunk | null {
  if (existing.type === 'text-delta' && next.type === 'text-delta' && existing.id === next.id) {
    if (existing.delta.length + next.delta.length > runDeltaFlushChars()) {
      return null
    }
    return {
      ...next,
      delta: `${existing.delta}${next.delta}`,
      providerMetadata: next.providerMetadata ?? existing.providerMetadata
    }
  }
  if (
    existing.type === 'reasoning-delta' &&
    next.type === 'reasoning-delta' &&
    existing.id === next.id
  ) {
    if (existing.delta.length + next.delta.length > runDeltaFlushChars()) {
      return null
    }
    return {
      ...next,
      delta: `${existing.delta}${next.delta}`,
      providerMetadata: next.providerMetadata ?? existing.providerMetadata
    }
  }
  if (
    existing.type === 'tool-input-delta' &&
    next.type === 'tool-input-delta' &&
    existing.toolCallId === next.toolCallId
  ) {
    if (existing.inputTextDelta.length + next.inputTextDelta.length > runDeltaFlushChars()) {
      return null
    }
    return {
      ...next,
      inputTextDelta: `${existing.inputTextDelta}${next.inputTextDelta}`
    }
  }
  return null
}

function openIdleRunStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.close()
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
    .orderBy(messages.createdAt, messageInsertOrder)
    .all()
}

export function listSessionQueueItems(sessionId: string): ChatSessionQueueItemDto[] {
  const session = assertStoredSession(sessionId)
  const runtimeSettings = readSessionRuntimeSettings(session.configJson)
  return db()
    .select()
    .from(chatSessionQueueItems)
    .where(
      and(eq(chatSessionQueueItems.sessionId, sessionId), eq(chatSessionQueueItems.mode, 'queue'))
    )
    .all()
    .sort(compareQueueRows)
    .map((row) => toQueueItemDto(row, runtimeSettings))
}

export async function enqueueSessionQueueItem(
  input: EnqueueSessionQueueItemInput
): Promise<ChatSessionQueueItemDto> {
  failOrphanedPersistedStreamingSessionIfIdle(input.sessionId)
  const context = getSessionRunContext(input.sessionId, {
    providerTargetId: input.providerTargetId
  })
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
  const contextParts = input.contextParts ?? []
  if (!text && files.length === 0 && contextParts.length === 0) {
    throw new AppError({
      code: 'chat_queue_item_empty',
      status: 400,
      message: 'Chat queue item requires text, context, or at least one file attachment',
      details: { sessionId: input.sessionId }
    })
  }

  const pendingRows = listPendingQueueRows(input.sessionId)
  const position =
    pendingRows.reduce((maxPosition, row) => Math.max(maxPosition, row.position), 0) + 1
  const now = currentUnixSeconds()
  const baseRuntimeSettings = readSessionRuntimeSettings(context.session.configJson)
  const runtimeSettings = mergeRuntimeSettings(
    baseRuntimeSettings,
    normalizeRuntimeSettingsPatch(input.runtimeSettings)
  )
  const row = db()
    .insert(chatSessionQueueItems)
    .values({
      id: randomUUID(),
      sessionId: input.sessionId,
      mode: 'queue',
      status: 'pending',
      text,
      filesJson: serializeQueueFiles(files),
      contextPartsJson: serializeQueueContextParts(contextParts),
      providerTargetId: input.providerTargetId?.trim() || null,
      modelId: input.modelId?.trim() || null,
      thinkingEffort: readPersistedThinkingEffort(input.thinkingEffort),
      permissionMode: null,
      runtimeAccessMode: runtimeSettings.accessMode,
      runtimeInteractionMode: runtimeSettings.interactionMode,
      position,
      sourceRunId: getSourceRunId(input.sessionId),
      startedRunId: null,
      errorText: null,
      createdAt: now,
      updatedAt: now
    })
    .returning()
    .get()

  scheduleSessionQueueDrain(input.sessionId)
  return toQueueItemDto(row, runtimeSettings)
}

export async function submitSessionSteerTurn(
  input: SubmitSessionSteerTurnInput
): Promise<SessionSteerTurnDto> {
  const text = input.text?.trim() ?? ''
  const files = input.files ?? []
  const contextParts = input.contextParts ?? []
  if (!text && files.length === 0 && contextParts.length === 0) {
    throw new AppError({
      code: 'chat_steer_empty',
      status: 400,
      message: 'Chat steer requires text, context, or at least one file attachment',
      details: { sessionId: input.sessionId }
    })
  }

  failOrphanedPersistedStreamingSessionIfIdle(input.sessionId)
  const runId = activeRunIdsBySession.get(input.sessionId)
  if (!runId) {
    throw new AppError({
      code: 'chat_steer_no_active_run',
      status: 409,
      message: 'Chat steer requires an active run',
      details: { sessionId: input.sessionId }
    })
  }

  const activeRun = activeRuns.get(runId)
  if (
    !activeRun?.runtime.capabilities.supportsSteerTurn ||
    !activeRun.runtime.steerTurn ||
    activeRun.terminalStatus
  ) {
    throw new AppError({
      code: 'chat_steer_not_supported',
      status: 409,
      message: 'Active chat run does not support live steering',
      details: { sessionId: input.sessionId, runId }
    })
  }

  const context = getSessionRunContext(input.sessionId, {
    providerTargetId: input.providerTargetId
  })
  if (!context) {
    throw new AppError({
      code: 'chat_session_not_found',
      status: 404,
      message: 'Chat session not found',
      details: { sessionId: input.sessionId }
    })
  }
  assertRuntimeCompatibleTarget(context, input.providerTargetId)

  if (
    !canApplyLiveSteerWithRequest({
      activeRun,
      providerTargetId: input.providerTargetId?.trim() || null
    })
  ) {
    throw new AppError({
      code: 'chat_steer_context_mismatch',
      status: 409,
      message: 'Live steer request does not match the active run context',
      details: { sessionId: input.sessionId, runId }
    })
  }

  const sourceMessageId = activeRun.messageId
  const splitParts = cloneUiMessageParts(activeRun.finalMessage.parts)
  const steerMessage = annotateContinuationMessage(
    createUserMessage(`steer-${randomUUID()}`, text, files, contextParts),
    { mode: 'steer', sourceMessageId, splitParts }
  )
  try {
    await activeRun.runtime.steerTurn({
      runtimeSession: activeRun.runtimeSession,
      profile: context.profile,
      message: steerMessage
    })
  } catch (error) {
    chatLogger.warn('runtime live steer failed', {
      error,
      sessionId: input.sessionId,
      runId,
      runtimeKind: activeRun.runtimeSession.runtimeKind
    })
    throw new AppError({
      code: 'chat_steer_rejected',
      status: 409,
      message: 'Runtime rejected live steer',
      details: { sessionId: input.sessionId, runId, error: serializeChatError(error).text }
    })
  }

  try {
    insertCompletedUserMessage({
      sessionId: input.sessionId,
      message: steerMessage,
      parentMessageId: sourceMessageId
    })
  } catch (error) {
    chatLogger.warn('runtime live steer was applied but history persistence failed', {
      error,
      sessionId: input.sessionId,
      runId,
      runtimeKind: activeRun.runtimeSession.runtimeKind
    })
    throw error
  }

  return {
    ok: true,
    sessionId: input.sessionId,
    runId,
    sourceMessageId,
    message: steerMessage
  }
}

export function getSessionRuntimeSettings(sessionId: string): ChatRuntimeSettingsDto {
  const session = assertStoredSession(sessionId)
  const runtimeSettings = readSessionRuntimeSettings(session.configJson)
  return {
    sessionId,
    runtimeSettings,
    applied: readRuntimeSettingsApplied(sessionId, runtimeSettings)
  }
}

export async function updateSessionRuntimeSettings(input: {
  sessionId: string
  patch: ChatRuntimeSettingsPatch
}): Promise<ChatRuntimeSettingsDto> {
  const session = assertStoredSession(input.sessionId)
  const runtimeSettings = mergeRuntimeSettings(
    readSessionRuntimeSettings(session.configJson),
    normalizeRuntimeSettingsPatch(input.patch)
  )
  db()
    .update(sessions)
    .set({
      configJson: writeSessionRuntimeSettingsConfigJson(session.configJson, runtimeSettings),
      updatedAt: currentUnixSeconds()
    })
    .where(eq(sessions.id, input.sessionId))
    .run()

  const runId = activeRunIdsBySession.get(input.sessionId)
  let applied = true
  if (!runId) {
    return {
      sessionId: input.sessionId,
      runtimeSettings,
      applied: readRuntimeSettingsApplied(input.sessionId, runtimeSettings)
    }
  }
  const activeRun = activeRuns.get(runId)
  applied = readRuntimeSettingsApplied(input.sessionId, runtimeSettings)
  if (
    !applied &&
    activeRun?.runtime.capabilities.supportsRuntimeSettings &&
    activeRun.runtime.updateRuntimeSettings &&
    !activeRun.terminalStatus
  ) {
    const context = getSessionRunContext(input.sessionId)
    if (context) {
      try {
        await activeRun.runtime.updateRuntimeSettings({
          runtimeSession: activeRun.runtimeSession,
          profile: context.profile,
          settings: runtimeSettings
        })
        activeRun.runtimeSettings = runtimeSettings
        applied = true
      } catch (error) {
        chatLogger.warn('update runtime settings failed', {
          error,
          sessionId: input.sessionId,
          runId,
          runtimeSettings
        })
      }
    }
  }

  return {
    sessionId: input.sessionId,
    runtimeSettings,
    applied
  }
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
      and(
        eq(chatSessionQueueItems.id, queueItemId),
        eq(chatSessionQueueItems.sessionId, sessionId),
        eq(chatSessionQueueItems.mode, 'queue')
      )
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
        eq(chatSessionQueueItems.mode, 'queue'),
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
          eq(chatSessionQueueItems.sessionId, sessionId),
          eq(chatSessionQueueItems.mode, 'queue')
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
            eq(chatSessionQueueItems.mode, 'queue'),
            eq(chatSessionQueueItems.status, 'pending')
          )
        )
        .run()
    })
  })

  const session = assertStoredSession(sessionId)
  const runtimeSettings = readSessionRuntimeSettings(session.configJson)
  return listPendingQueueRows(sessionId).map((row) => toQueueItemDto(row, runtimeSettings))
}

function startActiveRunSnapshot(
  activeRun: ActiveRun,
  input: { workspaceId?: string | null; agentId?: string | null }
): void {
  const snapshot = startRunSnapshot({
    chatSessionId: activeRun.sessionId,
    runId: activeRun.runId,
    messageId: activeRun.messageId,
    providerTargetId: activeRun.providerTargetId,
    runtimeKind: activeRun.runtimeSession.runtimeKind,
    providerSessionId: activeRun.runtimeSession.providerSessionId,
    modelId: activeRun.modelId,
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    summary: {
      providerTargetKind: activeRun.providerTargetKind,
      queueItemId: activeRun.queueItemId ?? null,
      runtimeSettings: activeRun.runtimeSettings,
      internalContinuation: activeRun.internalContinuation ?? null
    }
  })
  activeRun.runSnapshotId = snapshot?.id ?? null
  recordActiveRunSnapshotEvent(activeRun, {
    phase: 'run_started',
    payload: {
      providerTargetKind: activeRun.providerTargetKind,
      providerTargetId: activeRun.providerTargetId,
      modelId: activeRun.modelId,
      queueItemId: activeRun.queueItemId ?? null
    }
  })
}

// ── run execution (private) ──

async function executeRun(
  activeRun: ActiveRun,
  input: {
    message: UIMessage
    profile: RuntimeProviderTargetProfile
    modelId?: string
    thinkingEffort?: ChatThinkingEffort
    runtimeSettings?: ChatRuntimeSettings
    systemPrompt?: string
    transcript?: CradleTurnTranscript
    history?: UIMessage[]
    originalMessages?: UIMessage[]
    workspaceId?: string | null
    workspacePath?: string
    agentId?: string | null
  }
): Promise<void> {
  const diagnostics: TurnOutputDiagnostics = {
    emittedEventCount: 0,
    assistantBoundaryCount: 0,
    assistantTextCharCount: 0,
    reasoningTextCharCount: 0,
    toolInputDeltaCharCount: 0,
    toolEventCount: 0,
    commandEventCount: 0,
    commandOutputCharCount: 0,
    fileChangeEventCount: 0
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
      agentId: input.agentId,
      providerOptions:
        input.thinkingEffort || input.runtimeSettings
          ? {
              ...(input.thinkingEffort ? { thinkingEffort: input.thinkingEffort } : {}),
              ...(input.runtimeSettings ? { runtimeSettings: input.runtimeSettings } : {})
            }
          : undefined,
      systemPrompt: input.systemPrompt,
      history: input.history,
      originalMessages: input.originalMessages,
      reportSessionTitle: (title) =>
        reportRuntimeSessionTitle({ sessionId: activeRun.sessionId, title }),
      onProviderThreadEvent: (event) =>
        publishProviderThreadEvent({
          store: providerThreadStreamStore,
          sessionId: activeRun.sessionId,
          event,
          isTerminalChunk: isTerminalUIMessageChunk
        })
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
          payload: chunk
        })
      }
      accumulateDiagnostics(diagnostics, chunk)
      if (shouldRecordHarnessSnapshotChunk(chunk)) {
        recordActiveRunSnapshotEvent(activeRun, {
          phase: readHarnessSnapshotPhase(chunk),
          chunk
        })
      }
      if (isTerminalUIMessageChunk(chunk)) {
        finalChunk = chunk
        break
      } else {
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
      allowEmptyAssistantOutput: isProviderNativeNoOutputCommandTurn(activeRun, input.message)
    })
    recordActiveRunSnapshotEvent(activeRun, {
      phase: 'stream_finished',
      chunk: finalChunk,
      payload: {
        terminalChunk: summarizeSnapshotChunk(finalChunk),
        diagnostics
      }
    })
    profile.streamFinishedAtMs = performance.now()
  } catch (error) {
    flushPendingRunDelta(activeRun)
    profile.streamFinishedAtMs = performance.now()
    if (isAbortError(error)) {
      finalChunk = { type: 'abort', reason: 'user' }
    } else {
      const serializedError = serializeChatError(error)
      failurePayload = serializedError.payload
      finalChunk = { type: 'error', errorText: serializedError.text }
    }
    recordActiveRunSnapshotEvent(activeRun, {
      phase: 'stream_failed',
      chunk: finalChunk,
      payload: {
        terminalChunk: summarizeSnapshotChunk(finalChunk),
        diagnostics,
        ...(failurePayload ? { payload: failurePayload } : {})
      }
    })
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

      const usage = activeRun.runtime?.totalUsage ?? activeRun.runtime?.lastUsage
      actualModelId = activeRun.runtime?.lastModelId ?? activeRun.modelId
      if (usage) {
        insertUsage({
          sessionId: activeRun.sessionId,
          messageId: activeRun.messageId,
          providerTargetId: activeRun.providerTargetId,
          modelId: actualModelId,
          usage
        })
        recordActiveRunSnapshotEvent(activeRun, {
          phase: 'usage',
          modelId: actualModelId,
          usage,
          estimatedCostUsd: estimateCost(actualModelId ?? 'gpt-4o', usage),
          payload: {
            source: activeRun.runtime?.totalUsage ? 'runtime.totalUsage' : 'runtime.lastUsage'
          }
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
          recordActiveRunSnapshotEvent(activeRun, {
            phase: 'step_usage',
            modelId: effectiveModelId,
            usage: step.usage,
            estimatedCostUsd: estimateCost(effectiveModelId, step.usage),
            payload: {
              stepNumber: step.stepNumber,
              stepType: step.stepType
            }
          })
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
      const binding = attachBinding({
        sessionId: activeRun.sessionId,
        providerTargetId: activeRun.providerTargetId,
        runtimeKind: activeRun.runtimeSession.runtimeKind,
        runtimeSession: activeRun.runtimeSession,
        requestedModelId: actualModelId
      })
      linkRunToRuntimeBinding({ runId: activeRun.runId, binding })
    } catch {
      // session may have been deleted during the run
    }
    updateCodexGoalContinuationBackoff(activeRun, finalChunk)
    const shouldContinueCodexGoal = shouldScheduleCodexGoalContinuation(activeRun, finalChunk)
    finalizeActiveRunSnapshot(activeRun, finalChunk, {
      modelId: actualModelId,
      diagnostics,
      profile
    })
    recordChatRuntimeProfile(activeRun, diagnostics, profile)
    releaseActiveRun(activeRun)
    scheduleSessionQueueDrain(activeRun.sessionId)
    if (shouldContinueCodexGoal) {
      scheduleCodexGoalContinuation({
        sessionId: activeRun.sessionId,
        providerTargetId: activeRun.providerTargetId,
        modelId: actualModelId ?? undefined
      })
    }
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
    errorText: null
  })
}

function startSnapshotTimer(activeRun: ActiveRun): void {
  stopSnapshotTimer(activeRun)
  activeRun.snapshotTimer = setInterval(snapshotActiveRun, snapshotIntervalMs(), activeRun)
}

function stopSnapshotTimer(activeRun: ActiveRun): void {
  if (activeRun.snapshotTimer) {
    clearInterval(activeRun.snapshotTimer)
    activeRun.snapshotTimer = null
  }
}

function stopPendingRunDeltaFlush(activeRun: ActiveRun): void {
  if (activeRun.pendingDeltaFlushTimer) {
    clearTimeout(activeRun.pendingDeltaFlushTimer)
    activeRun.pendingDeltaFlushTimer = null
  }
}

export function flushAllActiveRunSnapshots(): void {
  for (const activeRun of activeRuns.values()) {
    try {
      snapshotActiveRun(activeRun)
    } catch {
      // best-effort on shutdown
    }
  }
}

export function recoverPersistedRunProjections(): number {
  const streamingRuns = db()
    .select()
    .from(backendRuns)
    .where(eq(backendRuns.status, 'streaming'))
    .all()

  let recovered = 0
  for (const run of streamingRuns) {
    if (
      activeRuns.has(run.id) ||
      activeRunIdsBySession.has(run.chatSessionId) ||
      pendingRunSessions.has(run.chatSessionId)
    ) {
      continue
    }
    failOrphanedPersistedRun(run)
    recovered += 1
  }
  recovered += repairTerminalRunProjections()

  if (recovered > 0) {
    chatLogger.warn('recovered persisted run projections', { recovered })
  }

  return recovered
}

function readChunkTraceToolCallId(chunk: UIMessageChunk): string | null {
  const value = (chunk as { toolCallId?: unknown }).toolCallId
  return typeof value === 'string' ? value : null
}

function readChunkTraceToolName(chunk: UIMessageChunk): string | null {
  const value = (chunk as { toolName?: unknown }).toolName
  return typeof value === 'string' ? value : null
}

function readHarnessSnapshotPhase(chunk: UIMessageChunk): string {
  switch (chunk.type) {
    case 'start':
      return 'model_stream_started'
    case 'text-start':
      return 'model_text_started'
    case 'text-delta':
      return 'model_text_delta'
    case 'text-end':
      return 'model_text_completed'
    case 'reasoning-start':
      return 'model_reasoning_started'
    case 'reasoning-delta':
      return 'model_reasoning_delta'
    case 'reasoning-end':
      return 'model_reasoning_completed'
    case 'tool-input-start':
      return 'tool_call_started'
    case 'tool-input-delta':
      return 'tool_call_input_delta'
    case 'tool-input-available':
      return 'tool_call_input_available'
    case 'tool-input-error':
      return 'tool_call_input_failed'
    case 'tool-output-available':
      return 'tool_call_output_available'
    case 'tool-output-error':
      return 'tool_call_output_failed'
    case 'tool-output-denied':
      return 'tool_call_denied'
    case 'finish':
      return 'model_stream_finished'
    case 'abort':
      return 'run_aborted'
    case 'error':
      return 'run_failed'
    default:
      return `runtime_chunk:${chunk.type}`
  }
}

function shouldRecordHarnessSnapshotChunk(chunk: UIMessageChunk): boolean {
  switch (chunk.type) {
    case 'text-delta':
    case 'reasoning-delta':
    case 'tool-input-delta':
      return false
    default:
      return true
  }
}

function recordActiveRunSnapshotEvent(
  activeRun: ActiveRun,
  input: {
    phase: string
    chunk?: UIMessageChunk
    modelId?: string | null
    usage?: TokenUsage
    estimatedCostUsd?: number | null
    durationMs?: number | null
    payload?: Record<string, unknown>
  }
): void {
  if (!activeRun.runSnapshotId) {
    return
  }
  const chunk = input.chunk
  appendRunSnapshotEvent({
    snapshotId: activeRun.runSnapshotId,
    chatSessionId: activeRun.sessionId,
    runId: activeRun.runId,
    seq: activeRun.runSnapshotSeq,
    phase: input.phase,
    chunkType: chunk?.type,
    toolCallId: chunk ? readChunkTraceToolCallId(chunk) : null,
    toolName: chunk ? readChunkTraceToolName(chunk) : null,
    modelId: input.modelId ?? activeRun.modelId,
    promptTokens: input.usage?.promptTokens,
    completionTokens: input.usage?.completionTokens,
    totalTokens: input.usage?.totalTokens,
    estimatedCostUsd: input.estimatedCostUsd,
    durationMs: input.durationMs,
    payload: input.payload ?? (chunk ? summarizeSnapshotChunk(chunk) : {})
  })
  activeRun.runSnapshotSeq += 1
}

function finalizeActiveRunSnapshot(
  activeRun: ActiveRun,
  finalChunk: UIMessageChunk,
  input: {
    modelId: string | null
    diagnostics: TurnOutputDiagnostics
    profile: ChatRuntimeProfile
  }
): void {
  if (!activeRun.runSnapshotId) {
    return
  }
  const terminalStatus = readTerminalStatus(finalChunk)
  const status: 'complete' | 'failed' | 'aborted' =
    terminalStatus === 'complete' ? 'complete' : terminalStatus === 'aborted' ? 'aborted' : 'failed'
  const profileSummary = {
    enabled: input.profile.enabled,
    streamMs: input.profile.streamFinishedAtMs
      ? Math.round(input.profile.streamFinishedAtMs - input.profile.streamStartedAtMs)
      : null,
    finalizeMs:
      input.profile.finalizeFinishedAtMs && input.profile.finalizeStartedAtMs
        ? Math.round(input.profile.finalizeFinishedAtMs - input.profile.finalizeStartedAtMs)
        : null,
    finalMessageJsonBytes: input.profile.finalMessageJsonBytes
  }
  recordActiveRunSnapshotEvent(activeRun, {
    phase: 'run_finalized',
    chunk: finalChunk,
    modelId: input.modelId,
    payload: {
      status,
      terminalChunk: summarizeSnapshotChunk(finalChunk),
      replayBuffer: getActiveRunReplayBufferSummary(activeRun.runId),
      diagnostics: input.diagnostics,
      profile: profileSummary
    }
  })
  finalizeRunSnapshot({
    snapshotId: activeRun.runSnapshotId,
    status,
    completionReason: readSnapshotCompletionReason(finalChunk),
    errorText: finalChunk.type === 'error' ? finalChunk.errorText : null,
    modelId: input.modelId,
    providerSessionId: activeRun.runtimeSession.providerSessionId,
    summary: {
      diagnostics: input.diagnostics,
      profile: profileSummary,
      replayBuffer: getActiveRunReplayBufferSummary(activeRun.runId)
    }
  })
}

function readSnapshotCompletionReason(chunk: UIMessageChunk): string {
  if (chunk.type === 'finish') {
    return chunk.finishReason ?? 'stop'
  }
  if (chunk.type === 'abort') {
    return chunk.reason ?? 'abort'
  }
  if (chunk.type === 'error') {
    return 'error'
  }
  return chunk.type
}

function summarizeSnapshotChunk(chunk: UIMessageChunk): Record<string, unknown> {
  switch (chunk.type) {
    case 'text-delta':
    case 'reasoning-delta':
      return {
        id: chunk.id,
        deltaChars: chunk.delta.length,
        providerMetadata: chunk.providerMetadata ?? null
      }
    case 'tool-input-delta':
      return {
        toolCallId: chunk.toolCallId,
        inputDeltaChars: chunk.inputTextDelta.length
      }
    case 'tool-input-available':
      return {
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        input: truncateJsonPayload(chunk.input, readStoredToolPayloadLimit())
      }
    case 'tool-output-available':
      return {
        toolCallId: chunk.toolCallId,
        output: truncateJsonPayload(chunk.output, readStoredToolPayloadLimit())
      }
    case 'error':
      return {
        errorText: chunk.errorText
      }
    case 'finish':
      return {
        finishReason: chunk.finishReason
      }
    case 'abort':
      return {
        reason: chunk.reason
      }
    default:
      return truncateJsonPayload(chunk, readStoredToolPayloadLimit()) as Record<string, unknown>
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

function mergeRuntimeDeltaChunk(
  existing: UIMessageChunk,
  next: UIMessageChunk
): UIMessageChunk | null {
  if (existing.type === 'text-delta' && next.type === 'text-delta' && existing.id === next.id) {
    return {
      ...next,
      delta: `${existing.delta}${next.delta}`,
      providerMetadata: next.providerMetadata ?? existing.providerMetadata
    }
  }
  if (
    existing.type === 'reasoning-delta' &&
    next.type === 'reasoning-delta' &&
    existing.id === next.id
  ) {
    return {
      ...next,
      delta: `${existing.delta}${next.delta}`,
      providerMetadata: next.providerMetadata ?? existing.providerMetadata
    }
  }
  if (
    existing.type === 'tool-input-delta' &&
    next.type === 'tool-input-delta' &&
    existing.toolCallId === next.toolCallId
  ) {
    return {
      ...next,
      inputTextDelta: `${existing.inputTextDelta}${next.inputTextDelta}`
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

function normalizeToolInputStreamChunk(
  activeRun: ActiveRun,
  chunk: UIMessageChunk,
  terminal: boolean
): UIMessageChunk | null {
  if (terminal) {
    return chunk
  }

  if (chunk.type === 'tool-input-start') {
    if (activeRun.streamedToolInputStartIds.has(chunk.toolCallId)) {
      return null
    }
    activeRun.streamedToolInputStartIds.add(chunk.toolCallId)
    return chunk
  }

  if (chunk.type !== 'tool-input-delta') {
    return chunk
  }

  if (activeRun.streamedToolInputStartIds.has(chunk.toolCallId)) {
    return chunk
  }

  // Providers occasionally surface progress deltas before the matching
  // tool-input-start reaches the runtime, especially during reconnects or
  // live stream replay. AI SDK treats that ordering as a hard protocol error,
  // so synthesize the minimal start chunk here to keep the stream renderable.
  // Provider mappers should still emit the real tool metadata when they have
  // it; this is the runtime-level last line of defense against a broken UI.
  publishUIMessageChunk(
    activeRun,
    {
      type: 'tool-input-start',
      toolCallId: chunk.toolCallId,
      toolName: 'unknown_tool'
    },
    false
  )
  return chunk
}

function publishUIMessageChunk(
  activeRun: ActiveRun,
  chunk: UIMessageChunk,
  terminal: boolean
): void {
  const normalizedChunk = normalizeToolInputStreamChunk(activeRun, chunk, terminal)
  if (!normalizedChunk) {
    return
  }
  chunk = normalizedChunk

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
        subscriberCount: runSubscribers.get(activeRun.runId)?.size ?? 0
      }
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
    } catch {
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
      providerMetadata: next.providerMetadata ?? existing.providerMetadata
    }
  }
  if (
    existing.type === 'reasoning-delta' &&
    next.type === 'reasoning-delta' &&
    existing.id === next.id
  ) {
    if (existing.delta.length + next.delta.length > runDeltaFlushChars()) {
      return null
    }
    return {
      ...next,
      delta: `${existing.delta}${next.delta}`,
      providerMetadata: next.providerMetadata ?? existing.providerMetadata
    }
  }
  if (
    existing.type === 'tool-input-delta' &&
    next.type === 'tool-input-delta' &&
    existing.toolCallId === next.toolCallId
  ) {
    if (existing.inputTextDelta.length + next.inputTextDelta.length > runDeltaFlushChars()) {
      return null
    }
    return {
      ...next,
      inputTextDelta: `${existing.inputTextDelta}${next.inputTextDelta}`
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

async function publishTerminalChunk(
  activeRun: ActiveRun,
  chunk: UIMessageChunk,
  profile?: ChatRuntimeProfile
): Promise<void> {
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
  profile?: ChatRuntimeProfile
): Promise<void> {
  if (status === 'streaming' || activeRun.terminalStatus) {
    return
  }

  activeRun.terminalStatus = status
  if (profile) {
    profile.finalizeStartedAtMs = performance.now()
  }
  flushFinalMessageProjection(activeRun)
    flushProjectedToolInputs(activeRun, parsePartialToolInputText)

  const snapshotResult = persistTerminalMessageSnapshot(activeRun, status, errorText)
  if (profile) {
    profile.finalMessageJsonBytes = snapshotResult?.messageJsonBytes ?? null
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
        status === 'complete'
          ? 'run_completed'
          : status === 'aborted'
            ? 'run_aborted'
            : 'run_failed',
      payload: {
        status,
        errorText,
        message: activeRun.finalMessage
      }
    })
  }
}

function persistTerminalMessageSnapshot(
  activeRun: ActiveRun,
  status: ChatMessageStatus,
  errorText: string | null
): { messageJsonBytes: number } | null {
  try {
    return persistMessageSnapshot({
      sessionId: activeRun.sessionId,
      messageId: activeRun.messageId,
      message: activeRun.finalMessage,
      messageStatus: status,
      errorText
    })
  } catch (error) {
    chatLogger.error('failed to persist final message snapshot', {
      error,
      sessionId: activeRun.sessionId,
      runId: activeRun.runId,
      messageId: activeRun.messageId,
      status
    })
    return null
  }
}

function recordChatRuntimeProfile(
  activeRun: ActiveRun,
  diagnostics: TurnOutputDiagnostics,
  profile: ChatRuntimeProfile
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
      total: Math.round(finalizeFinishedAtMs - profile.startedAtMs)
    },
    memory: {
      startHeapUsed: memoryStarted?.heapUsed ?? null,
      endHeapUsed: memoryFinished.heapUsed,
      deltaHeapUsed: memoryStarted ? memoryFinished.heapUsed - memoryStarted.heapUsed : null,
      startRss: memoryStarted?.rss ?? null,
      endRss: memoryFinished.rss,
      deltaRss: memoryStarted ? memoryFinished.rss - memoryStarted.rss : null
    },
    activeRun: {
      replayChunks: activeRun.chunkBuffer.length,
      finalParts: activeRun.finalMessage.parts.length,
      finalMessageJsonBytes: profile.finalMessageJsonBytes
    },
    diagnostics
  })
}

async function settleActiveRun(
  activeRun: ActiveRun,
  status: TerminalChatMessageStatus,
  errorText: string | null
): Promise<void> {
  if (activeRun.terminalStatus) {
    return
  }
  if (status === 'aborted') {
    activeRun.cancelRequested = true
  }
  const terminalChunk: UIMessageChunk =
    status === 'complete'
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
  } finally {
    try {
      const binding = attachBinding({
        sessionId: activeRun.sessionId,
        providerTargetId: activeRun.providerTargetId,
        runtimeKind: activeRun.runtimeSession.runtimeKind,
        runtimeSession: activeRun.runtimeSession,
        requestedModelId: activeRun.modelId
      })
      linkRunToRuntimeBinding({ runId: activeRun.runId, binding })
    } catch (error) {
      chatLogger.warn('failed to persist runtime session after cancellation', {
        error,
        sessionId: activeRun.sessionId,
        runId: activeRun.runId
      })
    }
  }
}

function abortPersistedRun(run: BackendRun): void {
  if (run.status !== 'streaming') {
    repairTerminalRunProjection(run)
    return
  }

  const now = currentUnixSeconds()
  const abortedRun: BackendRun = {
    ...run,
    status: 'aborted',
    stopReason: 'response.cancelled',
    errorText: null,
    finishedAt: now
  }
  repairTerminalRunProjection(abortedRun, { persistBackendRun: true })
}

function failOrphanedPersistedRun(run: BackendRun): void {
  if (run.status !== 'streaming') {
    repairTerminalRunProjection(run)
    return
  }

  const now = currentUnixSeconds()
  const failedRun: BackendRun = {
    ...run,
    status: 'failed',
    stopReason: ORPHANED_STREAMING_RUN_STOP_REASON,
    errorText: ORPHANED_STREAMING_RUN_ERROR_TEXT,
    finishedAt: now
  }
  repairTerminalRunProjection(failedRun, { persistBackendRun: true })
}

function abortPersistedStreamingSession(sessionId: string): void {
  repairTerminalRunProjectionsForSession(sessionId)

  const streamingRuns = db()
    .select()
    .from(backendRuns)
    .where(and(eq(backendRuns.chatSessionId, sessionId), eq(backendRuns.status, 'streaming')))
    .all()

  if (streamingRuns.length > 0) {
    for (const run of streamingRuns) {
      abortPersistedRun(run)
    }
    markPersistedStreamingMessages(sessionId, 'aborted', null)
    return
  }

  markPersistedStreamingMessages(sessionId, 'aborted', null)
}

function failOrphanedPersistedStreamingSession(sessionId: string): void {
  repairTerminalRunProjectionsForSession(sessionId)

  const streamingRuns = db()
    .select()
    .from(backendRuns)
    .where(and(eq(backendRuns.chatSessionId, sessionId), eq(backendRuns.status, 'streaming')))
    .all()

  if (streamingRuns.length > 0) {
    for (const run of streamingRuns) {
      failOrphanedPersistedRun(run)
    }
    markPersistedStreamingMessages(sessionId, 'failed', ORPHANED_STREAMING_RUN_ERROR_TEXT)
    return
  }

  markPersistedStreamingMessages(sessionId, 'failed', ORPHANED_STREAMING_RUN_ERROR_TEXT)
}

function repairTerminalRunProjectionsForSession(sessionId: string): number {
  return repairTerminalRunProjections({ sessionId })
}

function repairTerminalRunProjections(input: { sessionId?: string } = {}): number {
  const terminalStatusPredicate = or(
    eq(backendRuns.status, 'complete'),
    eq(backendRuns.status, 'aborted'),
    eq(backendRuns.status, 'failed')
  )
  const terminalRuns = db()
    .select()
    .from(backendRuns)
    .where(
      input.sessionId
        ? and(eq(backendRuns.chatSessionId, input.sessionId), terminalStatusPredicate)
        : terminalStatusPredicate
    )
    .all()

  return terminalRuns.reduce(
    (count, run) => (repairTerminalRunProjection(run) ? count + 1 : count),
    0
  )
}

function repairTerminalRunProjection(
  run: BackendRun,
  options: TerminalRunProjectionRepairOptions = {}
): boolean {
  const status = readTerminalRunProjectionStatus(run.status)
  if (!status) {
    return false
  }

  const now = currentUnixSeconds()
  const finishedAt = run.finishedAt ?? now
  let changed = false
  const messagePredicate = run.messageId
    ? and(
        eq(messages.sessionId, run.chatSessionId),
        eq(messages.status, 'streaming'),
        or(eq(messages.id, run.messageId), eq(messages.parentMessageId, run.messageId))
      )
    : and(eq(messages.sessionId, run.chatSessionId), eq(messages.status, 'streaming'))

  db().transaction((tx) => {
    if (options.persistBackendRun) {
      const runResult = tx
        .update(backendRuns)
        .set({
          status,
          stopReason: readTerminalRunCompletionReason(run, status),
          errorText: run.errorText,
          finishedAt
        })
        .where(eq(backendRuns.id, run.id))
        .run()
      changed = changed || runResult.changes > 0
    }

    const messageResult = tx
      .update(messages)
      .set({
        status,
        errorText: run.errorText,
        updatedAt: now
      })
      .where(messagePredicate)
      .run()
    changed = changed || messageResult.changes > 0

    const queueResult = tx
      .update(chatSessionQueueItems)
      .set({
        status: toQueueTerminalStatus(status),
        errorText: run.errorText,
        updatedAt: now
      })
      .where(
        and(
          eq(chatSessionQueueItems.startedRunId, run.id),
          eq(chatSessionQueueItems.mode, 'queue'),
          eq(chatSessionQueueItems.status, 'running')
        )
      )
      .run()
    changed = changed || queueResult.changes > 0

    const snapshotResult = tx
      .update(backendRunSnapshots)
      .set({
        status,
        completedAt: finishedAt * 1000,
        completionReason: readTerminalRunCompletionReason(run, status),
        errorText: run.errorText
      })
      .where(and(eq(backendRunSnapshots.runId, run.id), eq(backendRunSnapshots.status, 'running')))
      .run()
    changed = changed || snapshotResult.changes > 0

    if (changed) {
      tx.update(sessions).set({ updatedAt: now }).where(eq(sessions.id, run.chatSessionId)).run()
    }
  })

  return changed
}

function readTerminalRunProjectionStatus(
  status: BackendRun['status']
): TerminalRunProjectionStatus | null {
  return status === 'complete' || status === 'aborted' || status === 'failed' ? status : null
}

function toQueueTerminalStatus(status: TerminalRunProjectionStatus): ChatSessionQueueStatus {
  return status === 'complete' ? 'completed' : status === 'aborted' ? 'cancelled' : 'failed'
}

function readTerminalRunCompletionReason(
  run: BackendRun,
  status: TerminalRunProjectionStatus
): string {
  if (run.stopReason) {
    return run.stopReason
  }
  return status === 'complete'
    ? 'response.completed'
    : status === 'aborted'
      ? 'response.cancelled'
      : 'response.failed'
}

function markPersistedStreamingMessages(
  sessionId: string,
  status: TerminalChatMessageStatus,
  errorText: string | null
): void {
  const now = currentUnixSeconds()
  db().transaction((tx) => {
    tx.update(messages)
      .set({
        status,
        errorText,
        updatedAt: now
      })
      .where(and(eq(messages.sessionId, sessionId), eq(messages.status, 'streaming')))
      .run()

    tx.update(sessions).set({ updatedAt: now }).where(eq(sessions.id, sessionId)).run()
  })
}

function releaseTerminalPersistedActiveRunForSession(sessionId: string): boolean {
  const runId = activeRunIdsBySession.get(sessionId)
  if (!runId) {
    return false
  }

  const run = getRun(runId)
  if (!run) {
    return false
  }
  const status = readTerminalRunProjectionStatus(run.status)
  if (!status) {
    return false
  }

  const activeRun = activeRuns.get(runId)
  if (activeRun) {
    activeRun.terminalStatus ??= status
    releaseActiveRun(activeRun)
  } else {
    activeRunIdsBySession.delete(sessionId)
  }
  repairTerminalRunProjection(run)
  return true
}

function failOrphanedPersistedStreamingSessionIfIdle(sessionId: string): void {
  releaseTerminalPersistedActiveRunForSession(sessionId)
  if (!activeRunIdsBySession.has(sessionId) && !pendingRunSessions.has(sessionId)) {
    failOrphanedPersistedStreamingSession(sessionId)
  }
}

function releaseActiveRun(activeRun: ActiveRun): void {
  stopSnapshotTimer(activeRun)
  stopPendingRunDeltaFlush(activeRun)
  rejectPendingUserInputsForRun(
    activeRun.runId,
    new Error('Chat run ended before pending user input was submitted')
  )
  activeRuns.delete(activeRun.runId)
  runSubscribers.delete(activeRun.runId)
  if (activeRunIdsBySession.get(activeRun.sessionId) === activeRun.runId) {
    activeRunIdsBySession.delete(activeRun.sessionId)
  }
  activeRun.pendingDeltaChunk = null
  activeRun.chunkBuffer = []
  activeRun.chunkBufferIndexByKey.clear()
  activeRun.streamedToolInputStartIds.clear()
  activeRun.finalMessage.parts = []
  activeRun.finalProjection.activeTextParts.clear()
  activeRun.finalProjection.activeReasoningParts.clear()
  activeRun.finalProjection.partialToolCalls.clear()
}

function hasActiveCodexGoal(rawProviderStateSnapshot: string | null | undefined): boolean {
  try {
    const snapshot = readProviderStateSnapshot(rawProviderStateSnapshot)
    const codex = readUnknownRecord(snapshot.codex)
    const goal = readUnknownRecord(codex.goal)
    return (
      goal.status === 'active' &&
      typeof goal.objective === 'string' &&
      goal.objective.trim().length > 0
    )
  } catch {
    return false
  }
}

function cancelPendingCodexGoalContinuation(sessionId: string): void {
  const timer = pendingCodexGoalContinuationTimers.get(sessionId)
  if (!timer) {
    return
  }
  clearTimeout(timer)
  pendingCodexGoalContinuationTimers.delete(sessionId)
}

function updateCodexGoalContinuationBackoff(
  activeRun: ActiveRun,
  finalChunk: UIMessageChunk
): void {
  if (activeRun.internalContinuation !== 'codexGoal') {
    return
  }
  if (finalChunk.type === 'error') {
    codexGoalContinuationFailures.set(
      activeRun.sessionId,
      (codexGoalContinuationFailures.get(activeRun.sessionId) ?? 0) + 1
    )
    return
  }
  codexGoalContinuationFailures.delete(activeRun.sessionId)
}

function shouldScheduleCodexGoalContinuation(
  activeRun: ActiveRun,
  finalChunk: UIMessageChunk
): boolean {
  if (activeRun.runtimeSession.runtimeKind !== 'codex') {
    return false
  }
  if (activeRun.cancelRequested || finalChunk.type === 'abort') {
    return false
  }
  const binding = getBinding(activeRun.sessionId)
  if (binding?.runtimeKind !== 'codex' || !hasActiveCodexGoal(binding.backendStateSnapshot)) {
    return false
  }
  if (!isProviderTargetAvailable(binding.providerTargetId)) {
    return false
  }
  if (listPendingQueueRows(activeRun.sessionId).length > 0) {
    return false
  }
  return true
}

function scheduleCodexGoalContinuation(input: {
  sessionId: string
  providerTargetId?: string
  modelId?: string
}): void {
  if (pendingCodexGoalContinuationTimers.has(input.sessionId)) {
    return
  }

  const failureCount = codexGoalContinuationFailures.get(input.sessionId) ?? 0
  const delayMs = Math.min(
    CODEX_GOAL_CONTINUATION_DELAY_MS * 2 ** Math.min(failureCount, 7),
    30_000
  )

  const timer = setTimeout(() => {
    pendingCodexGoalContinuationTimers.delete(input.sessionId)
    void startScheduledCodexGoalContinuation(input)
  }, delayMs)
  pendingCodexGoalContinuationTimers.set(input.sessionId, timer)
}

async function startScheduledCodexGoalContinuation(input: {
  sessionId: string
  providerTargetId?: string
  modelId?: string
}): Promise<void> {
  if (activeRunIdsBySession.has(input.sessionId) || pendingRunSessions.has(input.sessionId)) {
    return
  }
  if (listPendingQueueRows(input.sessionId).length > 0) {
    scheduleSessionQueueDrain(input.sessionId)
    return
  }
  const binding = getBinding(input.sessionId)
  if (binding?.runtimeKind !== 'codex' || !hasActiveCodexGoal(binding.backendStateSnapshot)) {
    return
  }
  if (!isProviderTargetAvailable(input.providerTargetId ?? binding.providerTargetId)) {
    return
  }

  try {
    await createRun({
      sessionId: input.sessionId,
      providerTargetId: input.providerTargetId,
      modelId: input.modelId,
      internalContinuation: 'codexGoal'
    })
  } catch (error) {
    codexGoalContinuationFailures.set(
      input.sessionId,
      (codexGoalContinuationFailures.get(input.sessionId) ?? 0) + 1
    )
    chatLogger.warn('failed to start Codex goal continuation run', {
      error,
      sessionId: input.sessionId
    })
    const latestBinding = getBinding(input.sessionId)
    if (
      !activeRunIdsBySession.has(input.sessionId) &&
      !pendingRunSessions.has(input.sessionId) &&
      latestBinding?.runtimeKind === 'codex' &&
      hasActiveCodexGoal(latestBinding.backendStateSnapshot) &&
      isProviderTargetAvailable(input.providerTargetId ?? latestBinding.providerTargetId) &&
      listPendingQueueRows(input.sessionId).length === 0
    ) {
      scheduleCodexGoalContinuation(input)
    }
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
      const next = listPendingQueueRows(sessionId).sort(compareQueueRows)[0]
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
            eq(chatSessionQueueItems.mode, 'queue'),
            eq(chatSessionQueueItems.status, 'pending')
          )
        )
        .returning()
        .get()
      if (!claimed) {
        continue
      }

      try {
        const session = assertStoredSession(sessionId)
        const runtimeSettings = readQueueItemRuntimeSettings(
          claimed,
          readSessionRuntimeSettings(session.configJson)
        )
        const run = await createRun({
          sessionId,
          text: claimed.text,
          files: parseQueueFiles(claimed.filesJson),
          contextParts: parseQueueContextParts(claimed.contextPartsJson),
          providerTargetId: claimed.providerTargetId ?? undefined,
          modelId: claimed.modelId ?? undefined,
          thinkingEffort: readPersistedThinkingEffort(claimed.thinkingEffort) ?? undefined,
          runtimeSettings,
          continuationMode: 'queue',
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
              eq(chatSessionQueueItems.mode, 'queue'),
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
                eq(chatSessionQueueItems.mode, 'queue'),
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
              eq(chatSessionQueueItems.mode, 'queue'),
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
    case 'tool-input-delta':
      diagnostics.toolInputDeltaCharCount += chunk.inputTextDelta.length
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
  options: { allowEmptyAssistantOutput?: boolean } = {}
): TurnOutputValidationResult {
  const hasTextOutput =
    diagnostics.assistantTextCharCount > 0 || diagnostics.reasoningTextCharCount > 0
  const hasToolOutput = diagnostics.toolEventCount > 0
  const hasCommandOutput =
    diagnostics.commandEventCount > 0 || diagnostics.commandOutputCharCount > 0
  const hasFileChangeOutput = diagnostics.fileChangeEventCount > 0

  if (
    hasTextOutput ||
    hasToolOutput ||
    hasCommandOutput ||
    hasFileChangeOutput ||
    options.allowEmptyAssistantOutput
  ) {
    return { ok: true, errorText: null }
  }

  return {
    ok: false,
    errorText: `Provider finished without any assistant output events (events=${diagnostics.emittedEventCount}, assistant_boundaries=${diagnostics.assistantBoundaryCount}, assistant_text_chars=${diagnostics.assistantTextCharCount}, reasoning_chars=${diagnostics.reasoningTextCharCount}, tool_events=${diagnostics.toolEventCount}, command_events=${diagnostics.commandEventCount}, command_output_chars=${diagnostics.commandOutputCharCount}, file_change_events=${diagnostics.fileChangeEventCount})`
  }
}

function resolveTerminalChunkWithDiagnostics(
  chunk: UIMessageChunk,
  diagnostics: TurnOutputDiagnostics,
  options: { allowEmptyAssistantOutput?: boolean } = {}
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
  if (activeRun.internalContinuation === 'codexGoal' || isCodexGoalContinuationMessage(message)) {
    return true
  }
  const text = extractMessageText(message)
  return (
    readGoalMessageObjective(message) !== null ||
    isCodexGoalCommandText(text) ||
    isCodexCompactCommandText(text)
  )
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
