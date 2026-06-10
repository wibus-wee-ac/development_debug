import { randomUUID } from 'node:crypto'

import type { BackendRun, BackendSessionBinding, Message, Session } from '@cradle/db'
import {
  agents,
  backendRuns,
  chatRuntimeEvents,
  chatSessionQueueItems,
  messages,
  sessions,
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
  releaseSideConversation,
  releaseSideConversationsByParentSessionId
} from '../provider-runtime/side-conversation-registry'
import { getProviderTarget, resolveProviderTarget } from '../provider-targets/service'
import * as SessionService from '../session/service'
import { listSkillInventory } from '../skills/skills.store'
import type { BangCommandExecutionResult } from './bang-command'
import { executeLocalBangCommand, persistBangCommandMessages } from './bang-command'
import {
  getRuntimeRegistry,
  listRuntimeCatalog,
  listRuntimeHealth
} from './chat-runtime-provider-registry'
import type { ChatTurnContext } from './context/turn-context'
import { resolveSessionSystemPrompt, resolveTurnContext } from './context/turn-context'
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
  setRuntimeUserInputEventSink,
  setRuntimeUserInputPublisher
} from './pending-user-input'
import type { ProviderThreadSubscriber } from './provider-threads/live-streams'
import {
  createProviderThreadStreamStore,
  providerThreadStreamKey,
  publishProviderThreadEvent
} from './provider-threads/live-streams'
import type { ChatRunSnapshot } from './run-snapshot'
import {
  appendRunSnapshotEvent,
  finalizeRunSnapshot,
  getRunSnapshot,
  getRunSnapshots,
  startRunSnapshot
} from './run-snapshot'
import { readEventDerivedRuntimeState } from './runtime-state'
import type {
  FinalMessageProjectionRun,
  FinalMessageProjectionState
} from './run/final-message-projection'
import {
  cancelPendingCodexGoalContinuation,
  hasActiveCodexGoal,
  scheduleCodexGoalContinuation,
  shouldScheduleCodexGoalContinuation,
  updateCodexGoalContinuationBackoff
} from './run/codex-goal-continuation'
import type { CodexGoalContinuationSchedulerDeps } from './run/codex-goal-continuation'
import {
  isCodexCompactCommandText,
  isCodexGoalCommandText,
  readCodexGoalCommandObjective
} from './run/codex-commands'
import {
  accumulateDiagnostics,
  createTurnOutputDiagnostics,
  resolveTerminalChunkWithDiagnostics
} from './run/output-diagnostics'
import type { TurnOutputDiagnostics } from './run/output-diagnostics'
import {
  recordChatRuntimeProfile,
  startChatRuntimeProfile
} from './run/profile'
import type { ChatRuntimeProfile } from './run/profile'
import {
  estimateRunUsageCost,
  insertRunUsage,
  insertRuntimeStepUsages
} from './run/usage'
import type { RuntimeStepUsageInput } from './run/usage'
import {
  createFinalMessageProjectionState,
  finalizeFinalMessageProjection,
  flushFinalMessageProjection,
  flushProjectedToolInputs,
  projectFinalMessageChunk
} from './run/final-message-projection'
import {
  isTerminalUIMessageChunk,
  mergeBufferedStreamChunk,
  mergeRuntimeDeltaChunk,
  readDeltaChunkTextLength,
  readReplayCoalesceKey,
  readRunDeltaCoalesceKey,
  readTerminalStatus
} from './run/stream-chunks'
import {
  finalizeActiveRunSnapshot as finalizeRunSnapshotEvent,
  readChunkTraceToolCallId,
  readHarnessSnapshotPhase,
  recordActiveRunSnapshotEvent as appendActiveRunSnapshotEvent,
  shouldRecordHarnessSnapshotChunk,
  summarizeSnapshotChunk
} from './run/snapshot-events'
import {
  failLegacyOrphanedPersistedRun,
  failLegacyOrphanedPersistedStreamingSession,
  readLegacyTerminalRunProjectionStatus,
  repairLegacyTerminalRunProjection,
  repairLegacyTerminalRunProjections,
} from './run/legacy-recovery'
import { appendChatRuntimeEvents, readChatRuntimeEvents } from './event-store'
import type { NewChatRuntimeEvent } from './events'
import { projectChatRuntimeReadModels } from './projector'
import type { ChunkSubscriber } from './stream/sse'
import { openBufferedChunkStream } from './stream/sse'
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
  RuntimeUserInputRequest,
  RuntimeUserInputResolution,
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
} from './queue/session-queue'
import { scheduleSessionQueueDrain } from './queue/drain'
import type { QueueDrainDeps } from './queue/drain'
import {
  compareQueueRows,
  listPendingQueueRows,
  readPersistedThinkingEffort,
  serializeQueueContextParts,
  serializeQueueFiles,
  toQueueItemDto
} from './queue/session-queue'
import type { SerializedChatError } from './run/errors'
import {
  createSessionTitleGenerationError,
  resolveTurnFailureObservabilityCode,
  serializeChatError
} from './run/errors'
import type { ChatStreamTraceRecord } from './stream-trace'
import { isChatStreamTraceEnabled, readChatRunTrace, recordChatStreamTrace } from './stream-trace'
import { createSideChat as createSideChatSession } from './side-chat/create'
import type {
  ActiveParentRuntimeSession,
  CreateSideChatDeps,
  CreateSideChatInput,
  SideChatSessionDto
} from './side-chat/create'
import { createLiveSideConversationStream } from './side-chat/live-stream'
import { openDirectChunkStream } from './stream/direct'
import type { CradleTurnTranscript } from './transcript'

export { submitRuntimeUserInput } from './pending-user-input'
export type { CreateSideChatInput, SideChatSessionDto } from './side-chat/create'
export type {
  ChatSessionContinuationMode,
  ChatSessionQueueItemDto,
  ChatSessionQueueMode,
  ChatSessionQueueStatus,
  EnqueueSessionQueueItemInput,
  PersistedThinkingEffort,
  SessionSteerTurnDto,
  SubmitSessionSteerTurnInput
} from './queue/session-queue'

const chatLogger = createChildLogger({ module: 'chat-runtime' })
const DEFAULT_STORED_MESSAGE_TEXT_MAX_CHARS = 256_000
const DEFAULT_STORED_MESSAGE_REASONING_MAX_CHARS = 64_000
const DEFAULT_STORED_TOOL_PAYLOAD_MAX_CHARS = 128_000
const DEFAULT_STORED_MESSAGE_REPAIR_MIN_CHARS = 512 * 1024
const DEFAULT_RUN_DELTA_FLUSH_MS = 16
const DEFAULT_RUN_DELTA_FLUSH_CHARS = 8_192
const DEFAULT_SNAPSHOT_INTERVAL_MS = 10_000
const CODEX_GOAL_CONTINUATION_PROMPT = '[internal] Continue the active Codex goal.'
const CODEX_BASELINE_SKILL_NAMES = ['cradle-cli'] as const

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
setRuntimeUserInputEventSink({
  requested: (input) => {
    appendRuntimeUserInputRequestedEvent(input)
  },
  answered: (input) => {
    appendRuntimeUserInputAnsweredEvent(input)
  },
})

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

export interface QuickQuestionInput {
  sessionId: string
  question: string
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
const messageInsertOrder = sql`messages.rowid`
const sideChatDeps: CreateSideChatDeps = {
  getParentSession: (parentSessionId) => assertStoredSession(parentSessionId),
  getParentContext: (parentSessionId, providerTargetId) =>
    assertRuntimeCompatibleTarget(assertRunnableSession(parentSessionId), providerTargetId),
  getRuntime: (runtimeKind) => getRuntimeRegistry().get(runtimeKind),
  getActiveParentRuntimeSession: (parentSessionId): ActiveParentRuntimeSession | undefined => {
    const activeRunId = activeRunIdsBySession.get(parentSessionId)
    const activeRun = activeRunId ? activeRuns.get(activeRunId) : undefined
    return activeRun
      ? {
          providerTargetId: activeRun.providerTargetId,
          runtimeSession: activeRun.runtimeSession,
          modelId: activeRun.modelId
        }
      : undefined
  },
  readReusableBinding: (input) =>
    readReusableDurableProviderRuntimeBinding({
      chatSessionId: input.parentSessionId,
      providerTargetId: input.providerTargetId,
      runtimeKind: input.runtimeKind
    }),
  readTranscript: (parentSessionId) => readSessionTranscript(parentSessionId),
  resolveSystemPrompt: (session) => resolveSessionSystemPrompt(session),
  normalizeTitle: (title) => normalizeRuntimeSessionTitle(title)
}
const queueDrainDeps: QueueDrainDeps = {
  hasActiveOrPendingRun: (sessionId) =>
    activeRunIdsBySession.has(sessionId) || pendingRunSessions.has(sessionId),
  readSessionRuntimeSettings: (sessionId) => {
    const session = assertStoredSession(sessionId)
    return readSessionRuntimeSettings(session.configJson)
  },
  onQueueItemClaimed: ({ sessionId, row }) => {
    appendQueueItemClaimedEvent({ sessionId, row })
    return readQueueItemRow({ sessionId, queueItemId: row.id })
  },
  onQueueItemReleased: ({ sessionId, row }) => {
    appendQueueItemReleasedEvent({ sessionId, row })
    return readQueueItemRow({ sessionId, queueItemId: row.id })
  },
  onQueueItemFailed: ({ sessionId, row }) => {
    appendQueueItemFailedEvent({ sessionId, row })
    return readQueueItemRow({ sessionId, queueItemId: row.id })
  },
  createQueuedRun: async (input) => {
    const run = await createRun({
      sessionId: input.sessionId,
      text: input.text,
      files: input.files,
      contextParts: input.contextParts,
      providerTargetId: input.providerTargetId,
      modelId: input.modelId,
      thinkingEffort: input.thinkingEffort,
      runtimeSettings: input.runtimeSettings,
      continuationMode: 'queue',
      queueItemId: input.queueItemId
    })
    return { runId: run.runId }
  },
  serializeError: (error) => serializeChatError(error)
}
const codexGoalContinuationDeps: CodexGoalContinuationSchedulerDeps = {
  hasActiveOrPendingRun: (sessionId) =>
    activeRunIdsBySession.has(sessionId) || pendingRunSessions.has(sessionId),
  pendingQueueItemCount: (sessionId) => listPendingQueueRows(sessionId).length,
  scheduleQueueDrain: (sessionId) => scheduleSessionQueueDrain(sessionId, queueDrainDeps),
  getBinding: (sessionId) => getBinding(sessionId),
  isProviderTargetAvailable: (providerTargetId) => isProviderTargetAvailable(providerTargetId),
  onContinuationScheduled: (input) => {
    appendCodexGoalContinuationScheduledEvent(input)
  },
  onContinuationStarted: (input) => {
    appendCodexGoalContinuationStartedEvent(input)
  },
  createContinuationRun: async (input) => {
    await createRun({
      sessionId: input.sessionId,
      providerTargetId: input.providerTargetId,
      modelId: input.modelId,
      internalContinuation: 'codexGoal'
    })
  }
}

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

function readStoredToolPayloadLimit(): number {
  return readPositiveIntegerEnv(
    'CRADLE_CHAT_STORED_TOOL_PAYLOAD_MAX_CHARS',
    DEFAULT_STORED_TOOL_PAYLOAD_MAX_CHARS
  )
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

function truncateSnapshotPayload(value: unknown): unknown {
  return truncateJsonPayload(value, readStoredToolPayloadLimit())
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
  const userMessage = annotateContinuationMessage(input.userMessage, input.continuation ?? null)

  return { userMessageId: userMessage.id, assistantMessageId, userMessage }
}

function createCodexGoalContinuationDraft(input: { sessionId: string }): {
  userMessageId: string
  assistantMessageId: string
  userMessage: UIMessage
} {
  const assistantMessageId = randomUUID()
  const userMessage = annotateCodexGoalContinuationMessage(
    createUserMessage(randomUUID(), CODEX_GOAL_CONTINUATION_PROMPT)
  )

  return { userMessageId: '', assistantMessageId, userMessage }
}

function startAssistantContinuation(input: { sessionId: string; message: UIMessage }): void {
  const row = db()
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.id, input.message.id),
        eq(messages.sessionId, input.sessionId),
        eq(messages.role, 'assistant')
      )
    )
    .get()

  if (!row) {
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

function startRun(input: {
  sessionId: string
  messageId: string
  origin: 'user' | 'issue-agent' | 'system'
}): BackendRun {
  const binding = getBinding(input.sessionId)
  return {
    id: randomUUID(),
    bindingId: binding?.id ?? null,
    chatSessionId: input.sessionId,
    messageId: input.messageId,
    origin: input.origin,
    status: 'streaming',
    stopReason: null,
    errorText: null,
    startedAt: currentUnixSeconds(),
    finishedAt: null,
  }
}

function appendRunStartedEvents(input: {
  sessionId: string
  runId: string
  userMessageId: string | null
  assistantMessageId: string
  userMessage: UIMessage
  providerTargetId: string
  runtimeKind: RuntimeKind
  runtimeSession: RuntimeSession
  requestedModelId: string | null
  modelId: string | null
  origin: 'user' | 'issue-agent' | 'system'
  queueItemId: string | null
  runtimeSettings: ChatRuntimeSettings
  workspaceId: string | null
  agentId: string | null
}): void {
  const queueRow = input.queueItemId
    ? db()
        .select()
        .from(chatSessionQueueItems)
        .where(eq(chatSessionQueueItems.id, input.queueItemId))
        .get()
    : undefined
  const events = [
    {
      type: 'run.provider_context_recorded' as const,
      actorKind: 'runtime' as const,
      runId: input.runId,
      payload: {
        providerTargetId: input.providerTargetId,
        runtimeKind: input.runtimeKind,
        backendSessionId: input.runtimeSession.providerSessionId,
        requestedModelId: input.requestedModelId,
        backendStateSnapshot: readJsonRecord(input.runtimeSession.providerStateSnapshot),
      },
    },
    ...(input.userMessageId
      ? [{
          type: 'user_message.appended' as const,
          actorKind: 'user' as const,
          runId: input.runId,
          messageId: input.userMessageId,
          queueItemId: input.queueItemId,
          payload: {
            text: extractMessageText(input.userMessage),
            message: input.userMessage,
          },
        }]
      : []),
    {
      type: 'assistant_message.created' as const,
      actorKind: 'runtime' as const,
      runId: input.runId,
      messageId: input.assistantMessageId,
      queueItemId: input.queueItemId,
      payload: {
        message: createAssistantMessage(input.assistantMessageId),
      },
    },
    ...(input.queueItemId
      ? [{
          type: 'queue.item_claimed' as const,
          actorKind: 'runtime' as const,
          runId: input.runId,
          queueItemId: input.queueItemId,
          payload: queueRow ? readQueueEventPayload(queueRow) : {},
        }]
      : []),
    {
      type: 'run.started' as const,
      actorKind: 'runtime' as const,
      runId: input.runId,
      messageId: input.assistantMessageId,
      queueItemId: input.queueItemId,
      payload: {
        origin: input.origin,
        runtimeKind: input.runtimeKind,
        providerTargetId: input.providerTargetId,
        providerSessionId: input.runtimeSession.providerSessionId,
        modelId: input.modelId,
        runtimeSettings: input.runtimeSettings,
        workspaceId: input.workspaceId,
        agentId: input.agentId,
      },
    },
  ]

  appendAndProjectChatRuntimeEvents({
    sessionId: input.sessionId,
    commandId: `run-start:${input.runId}`,
    events,
  })
}

function appendRunTerminalEvents(input: {
  activeRun: ActiveRun
  status: TerminalChatMessageStatus
  errorText: string | null
  terminalChunk: UIMessageChunk
}): void {
  const snapshot = buildStoredMessageSnapshot(input.activeRun.finalMessage)
  const terminalType = input.status === 'complete'
    ? 'run.completed'
    : input.status === 'aborted'
      ? 'run.aborted'
      : 'run.failed'
  appendAndProjectChatRuntimeEvents({
    sessionId: input.activeRun.sessionId,
    commandId: `run-terminal:${input.activeRun.runId}`,
    events: [
      {
        type: 'assistant_message.snapshot_recorded',
        actorKind: 'runtime',
        runId: input.activeRun.runId,
        messageId: input.activeRun.messageId,
        queueItemId: input.activeRun.queueItemId,
        payload: {
          status: input.status,
          text: snapshot.text,
          snapshot: snapshot.message,
          errorText: input.errorText,
        },
      },
      {
        type: terminalType,
        actorKind: 'runtime',
        runId: input.activeRun.runId,
        messageId: input.activeRun.messageId,
        queueItemId: input.activeRun.queueItemId,
        payload: {
          errorText: input.errorText,
          stopReason: readStopReasonForTerminalStatus(input.status),
          terminalChunk: input.terminalChunk,
        },
      },
    ],
  })
}

const ORPHANED_EVENT_RUN_ERROR_TEXT =
  'Response interrupted because the Cradle server process exited while the run was streaming.'

function appendRunInterruptedEvent(input: {
  sessionId: string
  runId: string
  messageId: string | null
  queueItemId: string | null
  errorText: string
}): void {
  appendAndProjectChatRuntimeEvents({
    sessionId: input.sessionId,
    commandId: `run-interrupted:${input.runId}`,
    events: [
      ...(input.messageId
        ? [{
            type: 'assistant_message.snapshot_recorded' as const,
            actorKind: 'runtime' as const,
            runId: input.runId,
            messageId: input.messageId,
            queueItemId: input.queueItemId,
            payload: {
              status: 'failed',
              errorText: input.errorText,
            },
          }]
        : []),
      {
        type: 'run.interrupted',
        actorKind: 'runtime',
        runId: input.runId,
        messageId: input.messageId,
        queueItemId: input.queueItemId,
        payload: {
          errorText: input.errorText,
          stopReason: 'response.interrupted',
        },
      },
    ],
  })
}

function interruptOrphanedEventRunIfIdle(sessionId: string): boolean {
  let eventState = readEventDerivedRuntimeState(sessionId)
  if (!eventState.hasEvents || !eventState.activeRunId) {
    return false
  }
  if (activeRuns.has(eventState.activeRunId) || activeRunIdsBySession.has(sessionId)) {
    return false
  }
  const events = readChatRuntimeEvents(sessionId)
  const activeRunStartedEvent = events.findLast(
    event => event.runId === eventState.activeRunId && event.type === 'run.started'
  )
  appendRunInterruptedEvent({
    sessionId,
    runId: eventState.activeRunId,
    messageId: activeRunStartedEvent?.messageId ?? null,
    queueItemId: activeRunStartedEvent?.queueItemId ?? null,
    errorText: ORPHANED_EVENT_RUN_ERROR_TEXT,
  })
  return true
}

function assertSessionCanStartRun(sessionId: string): void {
  interruptOrphanedEventRunIfIdle(sessionId)
  const eventState = readEventDerivedRuntimeState(sessionId)

  if (eventState.hasEvents) {
    if (eventState.activeRunId) {
      throwChatRunInProgress(sessionId)
    }
    releaseStaleActiveHandleForIdleEventState(sessionId, eventState.latestRunStatus)
    if (pendingRunSessions.has(sessionId)) {
      throwChatRunInProgress(sessionId)
    }
    return
  }

  releaseTerminalActiveHandleForSession(sessionId)
  if (activeRunIdsBySession.has(sessionId) || pendingRunSessions.has(sessionId)) {
    throwChatRunInProgress(sessionId)
  }
}

function throwChatRunInProgress(sessionId: string): never {
  throw new AppError({
    code: 'chat_run_in_progress',
    status: 409,
    message: 'Chat session already has an active run',
    details: { sessionId }
  })
}

function releaseStaleActiveHandleForIdleEventState(
  sessionId: string,
  latestRunStatus: ReturnType<typeof readEventDerivedRuntimeState>['latestRunStatus'],
): void {
  const runId = activeRunIdsBySession.get(sessionId)
  if (!runId) {
    return
  }
  const activeRun = activeRuns.get(runId)
  if (!activeRun) {
    activeRunIdsBySession.delete(sessionId)
    return
  }
  const terminalStatus = latestRunStatus ? readTerminalActiveHandleStatus(latestRunStatus) : null
  if (terminalStatus) {
    activeRun.terminalStatus ??= terminalStatus
  }
  releaseActiveRun(activeRun)
}

function appendQueueItemEnqueuedEvent(input: {
  sessionId: string
  row: typeof chatSessionQueueItems.$inferSelect
  files: FileUIPart[]
  contextParts: ChatContextPart[]
}): void {
  appendAndProjectChatRuntimeEvents({
    sessionId: input.sessionId,
    commandId: `queue-enqueue:${input.row.id}`,
    events: [
      {
        type: 'queue.item_enqueued',
        actorKind: 'user',
        queueItemId: input.row.id,
        payload: {
          ...readQueueEventPayload(input.row),
          files: input.files,
          contextParts: input.contextParts,
        },
      },
    ],
  })
}

function appendQueueItemCancelledEvent(input: {
  sessionId: string
  row: typeof chatSessionQueueItems.$inferSelect
  occurredAt?: number
}): void {
  appendAndProjectChatRuntimeEvents({
    sessionId: input.sessionId,
    commandId: `queue-cancel:${input.row.id}`,
    events: [
      {
        type: 'queue.item_cancelled',
        actorKind: 'user',
        queueItemId: input.row.id,
        occurredAt: input.occurredAt,
        payload: {
          ...readQueueEventPayload(input.row),
          errorText: null,
          updatedAt: input.occurredAt ?? input.row.updatedAt,
        },
      },
    ],
  })
}

function readQueueItemRow(input: {
  sessionId: string
  queueItemId: string
}): typeof chatSessionQueueItems.$inferSelect | undefined {
  return db()
    .select()
    .from(chatSessionQueueItems)
    .where(
      and(
        eq(chatSessionQueueItems.id, input.queueItemId),
        eq(chatSessionQueueItems.sessionId, input.sessionId),
        eq(chatSessionQueueItems.mode, 'queue')
      )
    )
    .get()
}

function appendQueueItemClaimedEvent(input: {
  sessionId: string
  row: typeof chatSessionQueueItems.$inferSelect
}): void {
  appendAndProjectChatRuntimeEvents({
    sessionId: input.sessionId,
    commandId: `queue-claim:${input.row.id}`,
    events: [
      {
        type: 'queue.item_claimed',
        actorKind: 'runtime',
        queueItemId: input.row.id,
        occurredAt: input.row.updatedAt,
        payload: readQueueEventPayload(input.row),
      },
    ],
  })
}

function appendQueueItemReleasedEvent(input: {
  sessionId: string
  row: typeof chatSessionQueueItems.$inferSelect
}): void {
  appendAndProjectChatRuntimeEvents({
    sessionId: input.sessionId,
    commandId: null,
    events: [
      {
        type: 'queue.item_enqueued',
        actorKind: 'runtime',
        queueItemId: input.row.id,
        occurredAt: input.row.updatedAt,
        payload: readQueueEventPayload(input.row),
      },
    ],
  })
}

function appendQueueItemFailedEvent(input: {
  sessionId: string
  row: typeof chatSessionQueueItems.$inferSelect
}): void {
  appendAndProjectChatRuntimeEvents({
    sessionId: input.sessionId,
    commandId: `queue-fail:${input.row.id}:${input.row.updatedAt}`,
    events: [
      {
        type: 'queue.item_failed',
        actorKind: 'runtime',
        queueItemId: input.row.id,
        occurredAt: input.row.updatedAt,
        payload: readQueueEventPayload(input.row),
      },
    ],
  })
}

function appendQueueItemsReorderedEvent(input: {
  sessionId: string
  queueItemIds: string[]
  occurredAt: number
}): void {
  appendAndProjectChatRuntimeEvents({
    sessionId: input.sessionId,
    commandId: null,
    events: [
      {
        type: 'queue.item_reordered',
        actorKind: 'user',
        occurredAt: input.occurredAt,
        payload: {
          updatedAt: input.occurredAt,
          positions: input.queueItemIds.map((queueItemId, index) => ({
            queueItemId,
            position: index + 1,
          })),
        },
      },
    ],
  })
}

function appendSteerMessageEvent(input: {
  sessionId: string
  runId: string
  message: UIMessage
  parentMessageId: string
}): void {
  appendAndProjectChatRuntimeEvents({
    sessionId: input.sessionId,
    commandId: `steer:${input.message.id}`,
    events: [
      {
        type: 'user_message.appended',
        actorKind: 'user',
        runId: input.runId,
        messageId: input.message.id,
        payload: {
          text: extractMessageText(input.message),
          message: input.message,
          parentMessageId: input.parentMessageId,
          continuationMode: 'steer',
        },
      },
    ],
  })
}

function appendRuntimeUserInputRequestedEvent(
  input: RuntimeUserInputRequest & { createdAt: number }
): void {
  appendAndProjectChatRuntimeEvents({
    sessionId: input.sessionId,
    commandId: `user-input-request:${input.providerRequestId}`,
    events: [
      {
        type: 'tool_call.user_input_requested',
        actorKind: 'runtime',
        runId: input.runId,
        occurredAt: input.createdAt,
        payload: {
          requestId: input.providerRequestId,
          providerKind: input.providerKind,
          runtimeKind: input.runtimeKind,
          providerMethod: input.providerMethod,
          toolCallId: input.toolCallId,
          apiName: 'tool.request_user_input',
          questions: input.questions,
        },
      },
    ],
  })
}

function appendRuntimeUserInputAnsweredEvent(input: {
  request: RuntimeUserInputRequest
  resolution: RuntimeUserInputResolution
  acceptedAt: number
}): void {
  appendAndProjectChatRuntimeEvents({
    sessionId: input.request.sessionId,
    commandId: `user-input-answer:${input.resolution.requestId}`,
    events: [
      {
        type: 'tool_call.user_input_answered',
        actorKind: 'user',
        runId: input.request.runId,
        occurredAt: input.acceptedAt,
        payload: {
          requestId: input.resolution.requestId,
          providerKind: input.request.providerKind,
          runtimeKind: input.request.runtimeKind,
          providerMethod: input.request.providerMethod,
          toolCallId: input.request.toolCallId,
          apiName: 'tool.request_user_input',
          answers: input.resolution.answers,
        },
      },
    ],
  })
}

function appendCodexGoalContinuationScheduledEvent(input: {
  sessionId: string
  providerTargetId?: string
  modelId?: string
  delayMs: number
}): void {
  appendAndProjectChatRuntimeEvents({
    sessionId: input.sessionId,
    commandId: null,
    events: [
      {
        type: 'codex.goal_continuation_scheduled',
        actorKind: 'system',
        payload: {
          providerTargetId: input.providerTargetId ?? null,
          modelId: input.modelId ?? null,
          delayMs: input.delayMs,
        },
      },
    ],
  })
}

function appendCodexGoalContinuationStartedEvent(input: {
  sessionId: string
  providerTargetId?: string
  modelId?: string
}): void {
  appendAndProjectChatRuntimeEvents({
    sessionId: input.sessionId,
    commandId: null,
    events: [
      {
        type: 'codex.goal_continuation_started',
        actorKind: 'system',
        payload: {
          providerTargetId: input.providerTargetId ?? null,
          modelId: input.modelId ?? null,
        },
      },
    ],
  })
}

function appendAndProjectChatRuntimeEvents(input: {
  sessionId: string
  commandId?: string | null
  events: NewChatRuntimeEvent[]
}): void {
  const existingEvents = readChatRuntimeEvents(input.sessionId)
  appendChatRuntimeEvents({
    streamId: input.sessionId,
    expectedSeq: existingEvents.at(-1)?.seq ?? 0,
    commandId: input.commandId,
    events: input.events,
  })
  projectChatRuntimeReadModels({
    streamId: input.sessionId,
    events: readChatRuntimeEvents(input.sessionId),
  })
}

function readQueueEventPayload(row: typeof chatSessionQueueItems.$inferSelect): Record<string, unknown> {
  return {
    text: row.text,
    files: parseJsonArray(row.filesJson),
    contextParts: parseJsonArray(row.contextPartsJson),
    providerTargetId: row.providerTargetId,
    modelId: row.modelId,
    thinkingEffort: row.thinkingEffort,
    permissionMode: row.permissionMode,
    runtimeAccessMode: row.runtimeAccessMode,
    runtimeInteractionMode: row.runtimeInteractionMode,
    position: row.position,
    sourceRunId: row.sourceRunId,
    errorText: row.errorText,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function parseJsonArray(raw: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  }
  catch {
    return []
  }
}

function readStopReasonForTerminalStatus(status: TerminalChatMessageStatus): string {
  return status === 'complete'
    ? 'response.completed'
    : status === 'aborted'
      ? 'response.cancelled'
      : 'response.failed'
}

function readJsonRecord(raw: string | null | undefined): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  }
  catch {
    return {}
  }
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

  releaseTerminalActiveHandleForSession(sessionId)
  let eventState = readEventDerivedRuntimeState(sessionId)
  if (eventState.hasEvents && !activeRunIdsBySession.has(sessionId) && !pendingRunSessions.has(sessionId)) {
    if (interruptOrphanedEventRunIfIdle(sessionId)) {
      eventState = readEventDerivedRuntimeState(sessionId)
    }
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
  const eventVisibleActiveRun = eventState.hasEvents
    ? eventState.activeRunId && activeRun?.runId === eventState.activeRunId
      ? activeRun
      : undefined
    : activeRun
  const pendingState = pendingRunSessions.get(sessionId)
  const latestRun = db()
    .select()
    .from(backendRuns)
    .where(eq(backendRuns.chatSessionId, sessionId))
    .orderBy(desc(backendRuns.startedAt), desc(sql`backend_runs.rowid`))
    .get()
  const queue = eventState.hasEvents ? eventState.queue : readLegacyQueueCounts(sessionId)

  const runtimeKind =
    eventVisibleActiveRun?.runtimeSession.runtimeKind ??
    (binding?.runtimeKind as RuntimeKind | undefined) ??
    session.runtimeKind
  const providerTargetId =
    eventVisibleActiveRun?.providerTargetId ?? binding?.providerTargetId ?? session.providerTargetId
  const providerSessionId =
    eventVisibleActiveRun?.runtimeSession.providerSessionId ?? binding?.backendSessionId ?? null
  const modelId = eventVisibleActiveRun?.modelId ?? binding?.requestedModelId ?? null
  const runtimeSettings =
    eventVisibleActiveRun?.runtimeSettings ?? readSessionRuntimeSettings(session.configJson)
  const providerTargetAvailable = eventVisibleActiveRun ? true : isProviderTargetAvailable(providerTargetId)
  const hasActiveGoal =
    binding?.runtimeKind === 'codex' &&
    hasActiveCodexGoal(binding.backendStateSnapshot) &&
    providerTargetAvailable
  const status: RuntimeSessionStatusKind = pendingState
    ? 'pending'
    : eventState.hasEvents
      ? eventState.status === 'streaming'
        ? eventVisibleActiveRun?.cancelRequested
          ? 'cancelling'
          : 'streaming'
        : 'idle'
      : eventVisibleActiveRun
        ? eventVisibleActiveRun.cancelRequested
          ? 'cancelling'
          : 'streaming'
        : 'idle'
  if (status === 'idle' && hasActiveGoal && binding && queue.pending === 0 && queue.running === 0) {
    scheduleCodexGoalContinuation({
      sessionId,
      providerTargetId: providerTargetId ?? undefined,
      modelId: modelId ?? undefined
    }, codexGoalContinuationDeps)
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
    activeRun: eventVisibleActiveRun
      ? toRuntimeSessionRunDto(eventVisibleActiveRun, getRun(eventVisibleActiveRun.runId), { runtimeSettings })
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

function readLegacyQueueCounts(sessionId: string): { pending: number, running: number } {
  const queueRows = db()
    .select({
      status: chatSessionQueueItems.status
    })
    .from(chatSessionQueueItems)
    .where(
      and(eq(chatSessionQueueItems.sessionId, sessionId), eq(chatSessionQueueItems.mode, 'queue'))
    )
    .all()
  return queueRows.reduce(
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

interface StoredMessageSnapshotBuild {
  message: UIMessage
  text: string
  messageJsonBytes: number
}

function buildStoredMessageSnapshot(message: UIMessage): StoredMessageSnapshotBuild {
  const storedMessage = compactStoredMessageSnapshot(normalizeMessageSnapshot(message))
  const messageJson = JSON.stringify(storedMessage)
  return {
    message: storedMessage,
    text: extractMessageText(storedMessage),
    messageJsonBytes: Buffer.byteLength(messageJson),
  }
}

function persistMessageSnapshot(input: {
  sessionId: string
  messageId: string
  message: UIMessage
  messageStatus: ChatMessageStatus
  errorText: string | null
  runId?: string | null
  queueItemId?: string | null
}): { messageJsonBytes: number } {
  const snapshot = buildStoredMessageSnapshot(input.message)
  appendAndProjectChatRuntimeEvents({
    sessionId: input.sessionId,
    commandId: null,
    events: [
      {
        type: 'assistant_message.snapshot_recorded',
        actorKind: 'runtime',
        runId: input.runId ?? null,
        messageId: input.messageId,
        queueItemId: input.queueItemId ?? null,
        payload: {
          status: input.messageStatus,
          text: snapshot.text,
          snapshot: snapshot.message,
          errorText: input.errorText,
        },
      },
    ],
  })
  return { messageJsonBytes: snapshot.messageJsonBytes }
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

export async function createSideChat(input: CreateSideChatInput): Promise<SideChatSessionDto> {
  return createSideChatSession(input, sideChatDeps)
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

function getSourceRunId(sessionId: string): string | null {
  return activeRunIdsBySession.get(sessionId) ?? null
}

// ── public service functions ──

export function getMessageGroups(sessionId: string): ChatMessageSnapshotRow[] {
  assertStoredSession(sessionId)

  const eventState = readEventDerivedRuntimeState(sessionId)
  if (
    eventState.hasEvents
    && !activeRunIdsBySession.has(sessionId)
    && !pendingRunSessions.has(sessionId)
  ) {
    interruptOrphanedEventRunIfIdle(sessionId)
  }
  else if (
    !eventState.hasEvents
    && !activeRunIdsBySession.has(sessionId)
    && !pendingRunSessions.has(sessionId)
  ) {
    failLegacyOrphanedPersistedStreamingSession(sessionId)
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
  assertSessionCanStartRun(input.sessionId)
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
        const queueItem = readQueueItemRow({
          sessionId: input.sessionId,
          queueItemId: input.queueItemId,
        })
        if (queueItem) {
          const now = currentUnixSeconds()
          appendQueueItemCancelledEvent({
            sessionId: input.sessionId,
            row: {
              ...queueItem,
              status: 'cancelled',
              errorText: null,
              updatedAt: now,
            },
            occurredAt: now,
          })
        }
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
    appendRunStartedEvents({
      sessionId: input.sessionId,
      runId: run.id,
      userMessageId: draft.userMessageId || null,
      assistantMessageId: draft.assistantMessageId,
      userMessage: draft.userMessage,
      providerTargetId: context.providerTarget.id,
      runtimeKind: runtimeSession.runtimeKind,
      runtimeSession,
      requestedModelId: runtimeResolution.requestedModelId,
      modelId: requestedModelId ?? runtimeResolution.requestedModelId ?? null,
      origin: input.internalContinuation ? 'system' : 'user',
      queueItemId: input.queueItemId ?? null,
      runtimeSettings,
      workspaceId: context.session.workspaceId,
      agentId: context.session.agentId
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
      scheduleSessionQueueDrain(input.sessionId, queueDrainDeps)
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

  return openDirectChunkStream(
    runtime.quickQuestion({
      runtimeSession: resolved.runtimeSession,
      profile: context.profile,
      question,
      transcript,
      workspaceId: context.session.workspaceId,
      workspacePath: context.workspacePath
    })
  )
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
  releaseTerminalActiveHandleForSession(sessionId)

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
  releaseTerminalActiveHandleForSession(sessionId)
  const runId = activeRunIdsBySession.get(sessionId)
  if (!runId) {
    const pendingState = pendingRunSessions.get(sessionId)
    if (pendingState) {
      pendingState.cancelled = true
      if (pendingState.queueItemId) {
        const queueItem = readQueueItemRow({
          sessionId,
          queueItemId: pendingState.queueItemId,
        })
        if (queueItem) {
          const now = currentUnixSeconds()
          appendQueueItemCancelledEvent({
            sessionId,
            row: {
              ...queueItem,
              status: 'cancelled',
              errorText: null,
              updatedAt: now,
            },
            occurredAt: now,
          })
        }
      }
      return
    }
    interruptOrphanedEventRunIfIdle(sessionId)
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

  return openBufferedChunkStream({
    replayChunks: active?.chunkBuffer ?? [],
    terminal: run.status !== 'streaming' || !active,
    coalesceMaxChars: runDeltaFlushChars(),
    subscribe: (subscriber: ChunkSubscriber) => {
      const subscribers = runSubscribers.get(runId) ?? new Set<RunSubscriber>()
      subscribers.add(subscriber as RunSubscriber)
      runSubscribers.set(runId, subscribers)

      return () => {
        const current = runSubscribers.get(runId)
        if (!current) {
          return
        }
        current.delete(subscriber as RunSubscriber)
        if (current.size === 0) {
          runSubscribers.delete(runId)
        }
      }
    }
  })
}

function openProviderThreadEventStream(
  sessionId: string,
  threadId: string
): ReadableStream<Uint8Array> {
  const key = providerThreadStreamKey(sessionId, threadId)
  const state = providerThreadStreamStore.streams.get(key)
  return openBufferedChunkStream({
    replayChunks: state?.chunks ?? [],
    terminal: state?.terminal,
    shouldCloseWithoutSubscriber: !state && !activeRunIdsBySession.has(sessionId),
    coalesceMaxChars: runDeltaFlushChars(),
    subscribe: (subscriber: ChunkSubscriber) => {
      const subscribers =
        providerThreadStreamStore.subscribers.get(key) ?? new Set<ProviderThreadSubscriber>()
      subscribers.add(subscriber as ProviderThreadSubscriber)
      providerThreadStreamStore.subscribers.set(key, subscribers)

      return () => {
        const current = providerThreadStreamStore.subscribers.get(key)
        if (!current) {
          return
        }
        current.delete(subscriber as ProviderThreadSubscriber)
        if (current.size === 0) {
          providerThreadStreamStore.subscribers.delete(key)
        }
      }
    }
  })
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
  interruptOrphanedEventRunIfIdle(input.sessionId)
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
  const row: typeof chatSessionQueueItems.$inferSelect = {
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
  }

  appendQueueItemEnqueuedEvent({
    sessionId: input.sessionId,
    row,
    files,
    contextParts,
  })
  scheduleSessionQueueDrain(input.sessionId, queueDrainDeps)
  const projected = db()
    .select()
    .from(chatSessionQueueItems)
    .where(eq(chatSessionQueueItems.id, row.id))
    .get()
  return toQueueItemDto(projected ?? row, runtimeSettings)
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

  interruptOrphanedEventRunIfIdle(input.sessionId)
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
    appendSteerMessageEvent({
      sessionId: input.sessionId,
      runId,
      message: steerMessage,
      parentMessageId: sourceMessageId,
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
  const updated: typeof chatSessionQueueItems.$inferSelect = {
    ...row,
    status: 'cancelled',
    updatedAt: now,
  }
  appendQueueItemCancelledEvent({
    sessionId,
    row: updated,
    occurredAt: now,
  })
  const projected = db()
    .select()
    .from(chatSessionQueueItems)
    .where(eq(chatSessionQueueItems.id, queueItemId))
    .get()
  return toQueueItemDto(projected ?? updated)
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
  appendQueueItemsReorderedEvent({
    sessionId,
    queueItemIds,
    occurredAt: now,
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
  const diagnostics = createTurnOutputDiagnostics()
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
        terminalChunk: summarizeSnapshotChunk(finalChunk, truncateSnapshotPayload),
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
        terminalChunk: summarizeSnapshotChunk(finalChunk, truncateSnapshotPayload),
        diagnostics,
        ...(failurePayload ? { payload: failurePayload } : {})
      }
    })
  }

  try {
    if (!activeRun.cancelRequested) {
      try {
        const usage = activeRun.runtime?.totalUsage ?? activeRun.runtime?.lastUsage
        actualModelId = activeRun.runtime?.lastModelId ?? activeRun.modelId
        if (usage) {
          insertRunUsage({
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
            estimatedCostUsd: estimateRunUsageCost(actualModelId, usage),
            payload: {
              source: activeRun.runtime?.totalUsage ? 'runtime.totalUsage' : 'runtime.lastUsage'
            }
          })
        }

        // Write per-step usage if the runtime supports it
        const runtimeWithSteps = activeRun.runtime as {
          lastStepUsages?: RuntimeStepUsageInput[]
        }
        const steps = runtimeWithSteps.lastStepUsages ?? []
        if (steps.length > 0) {
          const fallbackModelId = actualModelId ?? 'gpt-4o'
          const recordedSteps = insertRuntimeStepUsages({
            runId: activeRun.runId,
            sessionId: activeRun.sessionId,
            fallbackModelId,
            steps
          })
          for (const step of recordedSteps) {
            recordActiveRunSnapshotEvent(activeRun, {
              phase: 'step_usage',
              modelId: step.modelId,
              usage: step.usage,
              estimatedCostUsd: step.estimatedCostUsd,
              payload: {
                stepNumber: step.stepNumber,
                stepType: step.stepType
              }
            })
          }
        }
      } catch (error) {
        chatLogger.error('failed to persist run usage', {
          error,
          sessionId: activeRun.sessionId,
          runId: activeRun.runId
        })
      }

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
    updateCodexGoalContinuationBackoff(
      {
        sessionId: activeRun.sessionId,
        runtimeKind: activeRun.runtimeSession.runtimeKind,
        cancelRequested: activeRun.cancelRequested === true,
        internalContinuation: activeRun.internalContinuation
      },
      finalChunk
    )
    const binding = getBinding(activeRun.sessionId)
    const shouldContinueCodexGoal = shouldScheduleCodexGoalContinuation({
      run: {
        sessionId: activeRun.sessionId,
        runtimeKind: activeRun.runtimeSession.runtimeKind,
        cancelRequested: activeRun.cancelRequested === true,
        internalContinuation: activeRun.internalContinuation
      },
      finalChunk,
      binding,
      providerTargetAvailable: Boolean(binding && isProviderTargetAvailable(binding.providerTargetId)),
      pendingQueueItemCount: listPendingQueueRows(activeRun.sessionId).length
    })
    finalizeActiveRunSnapshot(activeRun, finalChunk, {
      modelId: actualModelId,
      diagnostics,
      profile
    })
    recordChatRuntimeProfile({
      run: {
        sessionId: activeRun.sessionId,
        runId: activeRun.runId,
        messageId: activeRun.messageId,
        runtimeKind: activeRun.runtimeSession.runtimeKind,
        providerTargetId: activeRun.providerTargetId,
        modelId: activeRun.modelId,
        terminalStatus: activeRun.terminalStatus,
        replayChunkCount: activeRun.chunkBuffer.length,
        finalPartCount: activeRun.finalMessage.parts.length
      },
      diagnostics,
      profile
    })
    releaseActiveRun(activeRun)
    scheduleSessionQueueDrain(activeRun.sessionId, queueDrainDeps)
    if (shouldContinueCodexGoal) {
      scheduleCodexGoalContinuation({
        sessionId: activeRun.sessionId,
        providerTargetId: activeRun.providerTargetId,
        modelId: actualModelId ?? undefined
      }, codexGoalContinuationDeps)
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
  try {
    flushPendingRunDelta(activeRun)
    flushFinalMessageProjection(activeRun)
    persistMessageSnapshot({
      sessionId: activeRun.sessionId,
      messageId: activeRun.messageId,
      message: activeRun.finalMessage,
      messageStatus: 'streaming',
      errorText: null,
      runId: activeRun.runId,
      queueItemId: activeRun.queueItemId ?? null,
    })
  } catch (error) {
    chatLogger.warn('failed to persist active message snapshot', {
      error,
      sessionId: activeRun.sessionId,
      runId: activeRun.runId,
      messageId: activeRun.messageId,
    })
  }
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
  const recovered = recoverOrphanedEventRuns() + recoverLegacyRunProjections()
  if (recovered > 0) {
    chatLogger.warn('recovered persisted run projections', { recovered })
  }

  return recovered
}

function recoverOrphanedEventRuns(): number {
  const streamIds = db()
    .select({ streamId: chatRuntimeEvents.streamId })
    .from(chatRuntimeEvents)
    .groupBy(chatRuntimeEvents.streamId)
    .all()
    .map(row => row.streamId)

  let recovered = 0
  for (const sessionId of streamIds) {
    if (activeRunIdsBySession.has(sessionId) || pendingRunSessions.has(sessionId)) {
      continue
    }
    if (interruptOrphanedEventRunIfIdle(sessionId)) {
      recovered += 1
    }
  }
  return recovered
}

function recoverLegacyRunProjections(): number {
  const eventStreamIds = new Set(
    db()
      .select({ streamId: chatRuntimeEvents.streamId })
      .from(chatRuntimeEvents)
      .groupBy(chatRuntimeEvents.streamId)
      .all()
      .map(row => row.streamId)
  )
  const streamingRuns = db()
    .select()
    .from(backendRuns)
    .where(eq(backendRuns.status, 'streaming'))
    .all()

  let recovered = 0
  for (const run of streamingRuns) {
    if (
      eventStreamIds.has(run.chatSessionId) ||
      activeRuns.has(run.id) ||
      activeRunIdsBySession.has(run.chatSessionId) ||
      pendingRunSessions.has(run.chatSessionId)
    ) {
      continue
    }
    failLegacyOrphanedPersistedRun(run)
    recovered += 1
  }

  const terminalRuns = db()
    .select({ chatSessionId: backendRuns.chatSessionId })
    .from(backendRuns)
    .where(or(
      eq(backendRuns.status, 'complete'),
      eq(backendRuns.status, 'aborted'),
      eq(backendRuns.status, 'failed'),
    ))
    .all()
  const legacyTerminalSessionIds = new Set(
    terminalRuns
      .map(run => run.chatSessionId)
      .filter(sessionId => !eventStreamIds.has(sessionId))
  )
  for (const sessionId of legacyTerminalSessionIds) {
    recovered += repairLegacyTerminalRunProjections({ sessionId })
  }
  return recovered
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
  appendActiveRunSnapshotEvent(activeRun, {
    ...input,
    truncatePayload: truncateSnapshotPayload
  })
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
  finalizeRunSnapshotEvent(activeRun, finalChunk, {
    ...input,
    diagnostics: input.diagnostics as unknown as Record<string, unknown>,
    replayBuffer: getActiveRunReplayBufferSummary(activeRun.runId) as unknown as Record<string, unknown>,
    truncatePayload: truncateSnapshotPayload
  })
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
  const merged = mergeBufferedStreamChunk(existing, chunk, runDeltaFlushChars())
  if (!merged) {
    activeRun.chunkBufferIndexByKey.set(key, activeRun.chunkBuffer.length)
    return false
  }
  activeRun.chunkBuffer[existingIndex] = merged
  return true
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
  finalizeFinalMessageProjection(activeRun)
  flushProjectedToolInputs(activeRun, parsePartialToolInputText)

  const snapshotResult = measureTerminalMessageSnapshot(activeRun, status, errorText)
  if (profile) {
    profile.finalMessageJsonBytes = snapshotResult?.messageJsonBytes ?? null
  }

  appendRunTerminalEvents({
    activeRun,
    status,
    errorText,
    terminalChunk
  })
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

function measureTerminalMessageSnapshot(
  activeRun: ActiveRun,
  status: ChatMessageStatus,
  errorText: string | null
): { messageJsonBytes: number } | null {
  try {
    const snapshot = buildStoredMessageSnapshot(activeRun.finalMessage)
    return { messageJsonBytes: snapshot.messageJsonBytes }
  } catch (error) {
    chatLogger.error('failed to measure final message snapshot', {
      error,
      sessionId: activeRun.sessionId,
      runId: activeRun.runId,
      messageId: activeRun.messageId,
      status,
      errorText
    })
    return null
  }
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
      attachBinding({
        sessionId: activeRun.sessionId,
        providerTargetId: activeRun.providerTargetId,
        runtimeKind: activeRun.runtimeSession.runtimeKind,
        runtimeSession: activeRun.runtimeSession,
        requestedModelId: activeRun.modelId
      })
    } catch (error) {
      chatLogger.warn('failed to persist runtime session after cancellation', {
        error,
        sessionId: activeRun.sessionId,
        runId: activeRun.runId
      })
    }
  }
}

function releaseTerminalActiveHandleForSession(sessionId: string): boolean {
  const runId = activeRunIdsBySession.get(sessionId)
  if (!runId) {
    return false
  }

  const run = getRun(runId)
  if (!run) {
    return false
  }
  const status = readTerminalActiveHandleStatus(run.status)
  if (!status) {
    return false
  }

  const activeRun = activeRuns.get(runId)
  if (activeRun) {
    const eventState = readEventDerivedRuntimeState(sessionId)
    if (eventState.hasEvents && eventState.activeRunId === run.id) {
      appendRunTerminalEvents({
        activeRun,
        status,
        errorText: run.errorText,
        terminalChunk: createTerminalChunkFromPersistedRun(run, status),
      })
    }
    activeRun.terminalStatus ??= status
    releaseActiveRun(activeRun)
  } else {
    activeRunIdsBySession.delete(sessionId)
  }
  return true
}

function createTerminalChunkFromPersistedRun(
  run: BackendRun,
  status: TerminalChatMessageStatus,
): UIMessageChunk {
  if (status === 'complete') {
    return { type: 'finish', finishReason: 'stop' }
  }
  if (status === 'aborted') {
    return { type: 'abort' }
  }
  return { type: 'error', errorText: run.errorText ?? 'Chat run failed' }
}

function readTerminalActiveHandleStatus(status: BackendRun['status']): TerminalChatMessageStatus | null {
  return status === 'complete' || status === 'aborted' || status === 'failed' ? status : null
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

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'))
  )
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
