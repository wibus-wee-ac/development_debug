import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { LangfuseGeneration } from '@langfuse/tracing'
import { startObservation } from '@langfuse/tracing'
import type { UIMessage, UIMessageChunk } from 'ai'

import { langfuseEnabled } from '../../../langfuse'
import { getRegisteredMcpServers } from '../../../plugins'
import { readChatSkillContextPart } from '../../chat-runtime/context-parts'
import { isCodexGoalContinuationMessage, readGoalMessageObjective } from '../../chat-runtime/message-snapshots'
import { ProviderErrors, ProviderRuntimeError } from '../../chat-runtime/runtime-provider-types'
import type {
  CancelTurnInput,
  ChatRuntime,
  ChatRuntimeCapabilities,
  ChatRuntimeMetadata,
  GetCapabilitiesInput,
  GetUiSlotStatesInput,
  ProviderContext,
  ProviderThread,
  ProviderThreadListInput,
  ProviderThreadListResult,
  ProviderThreadReadInput,
  ProviderThreadReadResult,
  ProviderThreadSourceKind,
  ProviderThreadTurnsInput,
  ProviderThreadTurnsResult,
  ProviderThreadTurn,
  ProviderThreadEvent,
  ResumeChatSessionInput,
  RuntimePresentationCapabilities,
  RuntimeAlertSeverity,
  RuntimeAlertUiSlotState,
  RuntimeApprovalStatus,
  RuntimeApprovalsUiSlotState,
  RuntimeCompactUiSlotState,
  RuntimeConfigUiSlotState,
  RuntimeCrewAgentItem,
  RuntimeCrewCallItem,
  RuntimeCrewUiSlotState,
  RuntimeDiffUiSlotState,
  ExecuteShellCommandInput,
  ExecuteShellCommandResult,
  RuntimeFilesystemUiSlotState,
  RuntimeGoalStatus,
  RuntimeMcpAuthStatus,
  RuntimeMcpServerStatus,
  RuntimeMcpUiSlotState,
  RuntimeModelUiSlotState,
  RuntimePlanStepStatus,
  RuntimePlanUiSlotState,
  RuntimePluginUiSlotState,
  RuntimeReasoningUiSlotState,
  RuntimeSearchUiSlotState,
  RuntimeSession,
  RuntimeSkillsUiSlotState,
  RuntimeStatusUiSlotState,
  RuntimeTerminalUiSlotState,
  RuntimeTokenUsageBreakdown,
  RuntimeToolActivityStatus,
  RuntimeToolActivityUiSlotState,
  RuntimeUiSlotState,
  RuntimeUsageUiSlotState,
  StartChatSessionInput,
  SteerTurnInput,
  StreamTurnInput,
} from '../../chat-runtime/runtime-provider-types'
import { extractUiMessageText } from '../../chat-runtime/ui-message-input'
import type { TokenUsage } from '../../chat-runtime-engine/ai-sdk-engine'
import { createDedupeKey, OBSERVABILITY_CODES } from '../../observability/contract'
import type { CodexConfig } from '../../provider-contracts/provider-base'
import { readTrustedCodexConfig } from '../../provider-contracts/provider-base'
import type { RuntimeKind } from '../../provider-contracts/types'
import { createBoundedTextCollector } from '../bounded-text-collector'
import { readWorkspaceProviderStateSnapshot } from '../provider-state-snapshot'
import { buildDefaultCodexAppServerRequestResult } from './app-server-bridge'
import { CODEX_APP_SERVER_CAPABILITIES } from './app-server-capabilities'
import type { CodexAppServerClientOptions, CodexAppServerMessage } from './app-server-client'
import { buildCradleCodexAppServerEnv, CodexAppServerClient } from './app-server-client'
import {
  buildCodexChatgptAuthLoginParams,
  ensureCodexChatgptAuthAccessToken,
  resolveCodexAppServerAuth,
  type CodexChatgptAuthCredential,
} from './chatgpt-auth'
import {
  closeOpenCodexAppServerReasoning,
  closeOpenCodexAppServerText,
  createCodexAppServerMapperState,
  mapCodexAppServerNotificationToChunks,
} from './app-server-mapper'
import type { Thread } from './app-server-protocol/v2/Thread'
import type { ThreadInjectItemsParams } from './app-server-protocol/v2/ThreadInjectItemsParams'
import type { ThreadListParams } from './app-server-protocol/v2/ThreadListParams'
import type { ThreadListResponse } from './app-server-protocol/v2/ThreadListResponse'
import type { ThreadReadResponse } from './app-server-protocol/v2/ThreadReadResponse'
import type { ThreadTurnsListResponse } from './app-server-protocol/v2/ThreadTurnsListResponse'
import type { ThreadSourceKind } from './app-server-protocol/v2/ThreadSourceKind'
import type { Turn } from './app-server-protocol/v2/Turn'
import type { UserInput } from './app-server-protocol/v2/UserInput'
import { projectCodexNativeTurnsToCodexItems } from './native-history-projector'
import { resolveCodexRuntimeContext } from './runtime-context'
import { buildCodexToolInput, buildCodexToolOutput, readCodexToolError, readCodexToolName, type CodexAppServerItem } from './tools/mapper'
import { projectCradleTranscriptToCodexItems } from './transcript-projector'
import { projectCodexUiSlots } from './ui-slots'

interface CodexProviderConfig {
  createAppServerClient?: (options: CodexAppServerClientOptions) => CodexAppServerClientLike
}

type CodexProviderDeps = ProviderContext & CodexProviderConfig

interface CodexAppServerClientLike {
  initialize: () => Promise<void>
  request: (method: string, params?: unknown) => Promise<unknown>
  nextNotification: (signal?: AbortSignal) => Promise<CodexAppServerMessage | null>
  close: () => void
}

interface ActiveCodexTurn {
  client: CodexAppServerClientLike
  abortController: AbortController
  threadId: string
  turnId: string | null
}

interface CodexStreamDiagnostics {
  totalEvents: number
  mappedEvents: number
  completedTurnEvents: number
  retryableErrorEvents: number
  eventTypeCounts: Record<string, number>
  itemTypeCounts: Record<string, number>
  sampleEvents: Array<Record<string, unknown>>
  errorEvents: Array<Record<string, unknown>>
}

interface CodexThreadStatus {
  type?: string
  activeFlags?: string[]
}

interface CodexNativeHistorySnapshot {
  threadId: string
  itemsView: 'full'
  fetchedAt: number
  complete: boolean
  turns: Turn[]
  turnCount: number
  itemCount: number
  nextCursor: string | null
  error: string | null
}

interface CodexThreadSettings {
  model?: string | null
  modelProvider?: string | null
  serviceTier?: string | null
  effort?: string | null
  summary?: string | null
}

interface CodexThreadMetadata {
  id: string
  name: string | null
  preview: string | null
  modelProvider: string | null
  agentNickname: string | null
  agentRole: string | null
}

interface ThreadResponse {
  thread?: {
    id?: string
    name?: string | null
    title?: string | null
    preview?: string | null
    status?: CodexThreadStatus
    modelProvider?: string | null
    agentNickname?: string | null
    agentRole?: string | null
  }
  model?: string | null
  modelProvider?: string | null
  serviceTier?: string | null
  reasoningEffort?: string | null
}

interface TurnResponse {
  turn?: { id?: string, status?: string, error?: { message?: string } | null }
  turnId?: string
}

interface TurnNotificationParams {
  threadId?: string
  turn?: { id?: string, status?: string, error?: { message?: string } | null }
}

interface ThreadGoalGetResponse {
  goal?: {
    threadId?: string
    objective?: string
    status?: string
    tokenBudget?: number | null
    tokensUsed?: number
    timeUsedSeconds?: number
    createdAt?: number
    updatedAt?: number
  } | null
}

interface CodexTokenUsageBreakdown {
  totalTokens?: number
  inputTokens?: number
  cachedInputTokens?: number
  outputTokens?: number
  reasoningOutputTokens?: number
}

interface CodexThreadTokenUsage {
  total?: CodexTokenUsageBreakdown
  last?: CodexTokenUsageBreakdown
  modelContextWindow?: number | null
}

interface ThreadTokenUsageUpdatedNotificationParams {
  threadId?: string
  turnId?: string
  tokenUsage?: CodexThreadTokenUsage
}

interface ContextCompactedNotificationParams {
  threadId?: string
  turnId?: string
}

interface ItemNotificationParams {
  item?: CodexThreadItem
  threadId?: string
  turnId?: string
  startedAtMs?: number
  completedAtMs?: number
}

interface TurnPlanUpdatedNotificationParams {
  threadId?: string
  turnId?: string
  explanation?: string | null
  plan?: Array<{ step?: string, status?: string }>
}

interface McpToolCallProgressNotificationParams {
  threadId?: string
  turnId?: string
  itemId?: string
  message?: string
}

interface TurnDiffUpdatedNotificationParams {
  threadId?: string
  turnId?: string
  diff?: string
}

interface FileChangePatchUpdatedNotificationParams {
  threadId?: string
  turnId?: string
  changes?: Array<{ path?: string, diff?: string }>
}

interface CommandExecutionOutputDeltaNotificationParams {
  threadId?: string
  turnId?: string
  itemId?: string
  delta?: string
}

interface ProcessOutputDeltaNotificationParams {
  processHandle?: string
  deltaBase64?: string
}

interface ProcessExitedNotificationParams {
  processHandle?: string
  exitCode?: number
  stdout?: string
  stderr?: string
}

interface TerminalInteractionNotificationParams {
  threadId?: string
  turnId?: string
  itemId?: string
  processId?: string
  stdin?: string
}

interface GuardianApprovalReviewNotificationParams {
  threadId?: string
  turnId?: string
  startedAtMs?: number
  completedAtMs?: number
  reviewId?: string
  targetItemId?: string | null
  review?: {
    status?: string
    riskLevel?: string | null
    rationale?: string | null
  }
  action?: { type?: string } | string
}

interface WarningNotificationParams {
  threadId?: string | null
  message?: string
  summary?: string
  details?: string | null
}

interface ServerRequestResolvedNotificationParams {
  threadId?: string
  requestId?: string
}

interface FsChangedNotificationParams {
  changedPaths?: string[]
}

interface AccountRateLimitsUpdatedNotificationParams {
  rateLimits?: CodexRateLimitSnapshot
}

interface FuzzyFileSearchSessionNotificationParams {
  threadId?: string
  query?: string
  resultCount?: number
  results?: unknown[]
}

interface ErrorNotificationParams {
  message?: string
  willRetry?: boolean
  error?: {
    message?: string
    additionalDetails?: string | null
    codexErrorInfo?: unknown
  }
  code?: string
  details?: unknown
  threadId?: string | null
  turnId?: string | null
}

interface ThreadNameUpdatedNotificationParams {
  threadId?: string
  threadName?: string
}

interface ThreadStatusChangedNotificationParams {
  threadId?: string
  status?: CodexThreadStatus
}

interface ThreadSettingsUpdatedNotificationParams {
  threadId?: string
  threadSettings?: CodexThreadSettings
}

interface CodexConfigReadResponse {
  config?: {
    model?: string | null
    model_provider?: string | null
    model_context_window?: number | bigint | null
    model_auto_compact_token_limit?: number | bigint | null
    model_reasoning_effort?: string | null
    model_reasoning_summary?: string | null
    service_tier?: string | null
    approval_policy?: string | null
    sandbox_mode?: string | null
  } | null
}

interface CodexConfigRequirementsReadResponse {
  requirements?: {
    allowedApprovalPolicies?: string[] | null
    allowedSandboxModes?: string[] | null
    allowedWebSearchModes?: string[] | null
    featureRequirements?: Record<string, boolean> | null
  } | null
}

interface CodexRateLimitsResponse {
  rateLimits?: CodexRateLimitSnapshot | null
  rateLimitsByLimitId?: Record<string, CodexRateLimitSnapshot | undefined> | null
}

interface CodexRateLimitSnapshot {
  limitId?: string | null
  limitName?: string | null
  primary?: { usedPercent?: number | null, windowDurationMins?: number | null, resetsAt?: number | null } | null
  secondary?: { usedPercent?: number | null, windowDurationMins?: number | null, resetsAt?: number | null } | null
  credits?: { hasCredits?: boolean, unlimited?: boolean, balance?: string | null } | null
  planType?: string | null
  rateLimitReachedType?: string | null
}

interface CodexModelProviderCapabilitiesReadResponse {
  namespaceTools?: boolean
  imageGeneration?: boolean
  webSearch?: boolean
}

interface CodexModelListResponse {
  data?: Array<{
    id?: string
    model?: string
    displayName?: string
    supportedReasoningEfforts?: Array<{ reasoningEffort?: string, description?: string }>
    defaultReasoningEffort?: string
    hidden?: boolean
  }>
}

interface CodexThreadItem {
  type?: string
  id?: string
  text?: string
  command?: string
  aggregatedOutput?: string | null
  exitCode?: number | null
  durationMs?: number | null
  source?: string
  server?: string
  tool?: string
  status?: string
  senderThreadId?: string
  receiverThreadIds?: string[]
  prompt?: string | null
  model?: string | null
  reasoningEffort?: string | null
  agentsStates?: Record<string, { status?: string | null, message?: string | null } | undefined>
  error?: { message?: string } | string | null
  result?: unknown
  changes?: Array<{ path?: string }>
  query?: string
}

interface CodexCompactSnapshot {
  threadId: string
  turnId: string | null
  tokenUsage: CodexThreadTokenUsage
  updatedAt: number
  status?: RuntimeCompactUiSlotState['status']
  compactionStartedAt?: number | null
  lastCompactedAt?: number | null
  compactionItemId?: string | null
  completedCompactionItemIds?: string[]
}

interface CodexPlanSnapshot {
  threadId: string
  turnId: string | null
  explanation: string | null
  steps: Array<{ step: string, status: RuntimePlanStepStatus }>
  updatedAt: number
}

interface CodexToolActivitySnapshot {
  threadId: string
  turnId: string | null
  items: Array<{
    id: string
    type: string
    label: string
    status: RuntimeToolActivityStatus
    startedAt: number | null
    completedAt: number | null
    senderThreadId?: string | null
    receiverThreadIds?: string[]
    prompt?: string | null
    model?: string | null
    reasoningEffort?: string | null
    agentsStates?: Record<string, { status?: string | null, message?: string | null } | undefined>
  }>
  updatedAt: number
}

interface CodexMcpServerSnapshot {
  name: string
  status: RuntimeMcpServerStatus
  authStatus: RuntimeMcpAuthStatus
  toolCount: number
  resourceCount: number
  error: string | null
}

interface CodexMcpSnapshot {
  threadId: string
  servers: CodexMcpServerSnapshot[]
  recentProgress: string | null
  updatedAt: number
}

interface CodexDiffSnapshot {
  threadId: string
  turnId: string | null
  files: Array<{
    path: string
    addedLines: number
    removedLines: number
  }>
  updatedAt: number
}

interface CodexTerminalSnapshot {
  threadId: string
  turnId: string | null
  commands: Array<{
    id: string
    command: string | null
    status: RuntimeToolActivityStatus
    outputPreview: string | null
    updatedAt: number
  }>
  updatedAt: number
}

interface CodexApprovalsSnapshot {
  threadId: string
  turnId: string | null
  items: Array<{
    id: string
    targetItemId: string | null
    status: RuntimeApprovalStatus
    label: string
    riskLevel: string | null
    rationale: string | null
    startedAt: number | null
    completedAt: number | null
  }>
  updatedAt: number
}

interface CodexAlertSnapshot {
  threadId: string | null
  items: Array<{
    id: string
    severity: RuntimeAlertSeverity
    message: string
    source: string
    updatedAt: number
  }>
  updatedAt: number
}

interface CodexFilesystemSnapshot {
  threadId: string
  recentPaths: string[]
  updatedAt: number
}

interface CodexSearchSnapshot {
  threadId: string
  recentResultCount: number
  recentQuery: string | null
  fuzzySessionActive: boolean
  updatedAt: number
}

interface CodexUsageSnapshot {
  threadId: string
  rateLimits: CodexRateLimitSnapshot
  updatedAt: number
}

interface CodexListMcpServerStatusResponse {
  data?: Array<{
    name?: string
    tools?: Record<string, unknown>
    resources?: unknown[]
    resourceTemplates?: unknown[]
    authStatus?: string
  }>
  nextCursor?: string | null
}

interface CodexSkillsListResponse {
  data?: Array<{
    cwd?: string
    skills?: Array<{ name?: string, enabled?: boolean }>
    errors?: unknown[]
  }>
}

interface CodexPluginListResponse {
  marketplaces?: Array<{
    name?: string
    plugins?: Array<{ installed?: boolean, enabled?: boolean }>
  }>
  marketplaceLoadErrors?: unknown[]
}

interface CodexAppsListResponse {
  data?: Array<{ id?: string, isAccessible?: boolean, isEnabled?: boolean }>
}

interface CodexCollaborationModeListResponse {
  data?: Array<{ id?: string, name?: string, mode?: string | null, model?: string | null, reasoning_effort?: string | null }>
}

interface McpServerStatusUpdatedNotificationParams {
  name?: string
  status?: string
  error?: string | null
}

interface McpServerOauthLoginCompletedNotificationParams {
  name?: string
  success?: boolean
  error?: string
}

interface CodexProviderSnapshot {
  workspacePath?: string
  agentId?: string | null
  agentHome?: string | null
  models?: {
    currentModelId?: string | null
    [key: string]: unknown
  }
  codex?: {
    compact?: CodexCompactSnapshot
    goal?: CodexGoalSnapshot | null
    nativeHistory?: CodexNativeHistorySnapshot
    previousNativeHistory?: CodexNativeHistorySnapshot
    model?: {
      threadId: string
      modelId: string | null
      modelProvider: string | null
      serviceTier: string | null
      updatedAt: number
    }
    reasoning?: {
      threadId: string
      effort: string | null
      summary: string | null
      updatedAt: number
    }
    status?: {
      threadId: string
      status: CodexThreadStatus
      updatedAt: number
    }
    plan?: CodexPlanSnapshot
    toolActivity?: CodexToolActivitySnapshot
    mcp?: CodexMcpSnapshot
    diff?: CodexDiffSnapshot
    terminal?: CodexTerminalSnapshot
    approvals?: CodexApprovalsSnapshot
    alert?: CodexAlertSnapshot
    filesystem?: CodexFilesystemSnapshot
    search?: CodexSearchSnapshot
    usage?: CodexUsageSnapshot
    [key: string]: unknown
  }
  [key: string]: unknown
}

interface CodexGoalSnapshot {
  threadId: string
  objective: string
  status: RuntimeGoalStatus
  tokenBudget: number | null
  tokensUsed: number
  timeUsedSeconds: number
  createdAt: number
  updatedAt: number
}

interface CodexGoalUpdatedNotificationParams {
  threadId?: string
  turnId?: string | null
  goal?: ThreadGoalGetResponse['goal']
}

interface CodexProviderErrorData {
  details?: string | null
  runtimeKind?: RuntimeKind
  diagnostics?: CodexStreamDiagnostics
  notification?: Record<string, unknown>
  threadId?: string
  command?: string
  timeoutMs?: number
}

type RuntimeMessageInput = UIMessage | string
type MessagePart = UIMessage['parts'][number]
type CodexUserInput = { type: 'text', text: string, text_elements: [] }
  | { type: 'image', detail?: 'high' | 'original', url: string }
  | { type: 'localImage', detail?: 'high' | 'original', path: string }
  | { type: 'skill', name: string, path: string }

const RUNTIME_KIND: RuntimeKind = 'codex'
const CRADLE_CODEX_MODEL_PROVIDER = 'cradle-openai-compatible'
const CRADLE_CODEX_API_KEY_ENV = 'CRADLE_CODEX_API_KEY'
const MAX_EVENT_SAMPLES = 20
const MAX_DIAGNOSTIC_STRING_LENGTH = 2_000
const MAX_DIAGNOSTIC_ARRAY_ITEMS = 20
const MAX_DIAGNOSTIC_OBJECT_KEYS = 40
const MAX_DIAGNOSTIC_DEPTH = 4
const ACTIVE_GOAL_CONTINUATION_DELAY_MS = 250
const CODEX_THREAD_TURNS_LIST_LIMIT = 100
const CODEX_CREW_TURNS_LIST_LIMIT = 50
const CODEX_SHELL_COMMAND_RESULT_TIMEOUT_MS = 60_000

function createCodexRuntimePresentation(): RuntimePresentationCapabilities {
  return {
    runtimeKind: RUNTIME_KIND,
    slashCommands: [],
    uiSlots: projectCodexUiSlots(CODEX_APP_SERVER_CAPABILITIES),
    skills: [],
  }
}

const CODEX_RUNTIME_METADATA = {
  label: 'Codex',
  description: 'Codex app-server runtime',
  providerKinds: ['openai-compatible', 'universal'],
  iconKey: 'codex',
  surfaces: ['chat', 'jarvis'],
  sortOrder: 20,
} satisfies ChatRuntimeMetadata

const CODEX_RUNTIME_CAPABILITIES = {
  supportsSteerTurn: true,
  supportsShellExecution: true,
  supportsPermissionMode: false,
  supportsUiSlotStates: true,
  supportsDynamicCapabilities: false,
  sessionModelSwitch: 'in-session',
} satisfies ChatRuntimeCapabilities

function codexRequestError(method: string, detail: string): ProviderRuntimeError {
  return new ProviderRuntimeError(ProviderErrors.requestFailed(RUNTIME_KIND, method, detail))
}

export function createCodexProvider(ctx: ProviderContext, config: CodexProviderConfig = {}): ChatRuntime {
  return new CodexProvider({ ...ctx, ...config })
}

class CodexProviderError extends Error {
  readonly code: string
  readonly data: CodexProviderErrorData

  constructor(code: string, message: string, data: CodexProviderErrorData) {
    super(message)
    this.name = 'CodexProviderError'
    this.code = code
    this.data = data
  }
}

export class CodexProvider implements ChatRuntime {
  readonly runtimeKind = RUNTIME_KIND
  readonly metadata = CODEX_RUNTIME_METADATA
  readonly capabilities = CODEX_RUNTIME_CAPABILITIES

  private readonly activeTurns = new Map<string, ActiveCodexTurn>()
  private _lastUsage: TokenUsage | null = null
  private _lastModelId: string | null = null

  get lastUsage(): TokenUsage | null {
    return this._lastUsage
  }

  get lastModelId(): string | null {
    return this._lastModelId
  }

  constructor(private readonly deps: CodexProviderDeps) {}

  private readonly resolveSkillPaths = (workspacePath: string): string[] => {
    if (!this.deps.resolveSkillPaths) {
      throw codexRequestError('resolveSkillPaths', 'Codex provider requires resolveSkillPaths in ProviderContext')
    }
    return this.deps.resolveSkillPaths(workspacePath)
  }

  private recordObservability(input: Parameters<NonNullable<ProviderContext['recordObservability']>>[0]): void {
    if (!this.deps.recordObservability) {
      return
    }
    this.deps.recordObservability(input)
  }

  private releaseTurn(sessionId: string, entry: ActiveCodexTurn): void {
    if (this.activeTurns.get(sessionId) === entry) {
      this.activeTurns.delete(sessionId)
    }
  }

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    const previousNativeHistory = readRestorableCodexNativeHistory(input.previousProviderStateSnapshot)
    const runtimeContext = resolveCodexRuntimeContext(input.workspacePath, input.agentId)
    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      providerTargetId: input.profile.providerTargetId,
      runtimeKind: RUNTIME_KIND,
      providerSessionId: null,
      providerStateSnapshot: JSON.stringify({
        workspacePath: input.workspacePath,
        agentId: input.agentId ?? null,
        agentHome: runtimeContext.agentHome,
        models: { currentModelId: input.modelId },
        ...(previousNativeHistory
          ? {
              codex: {
                previousNativeHistory,
              },
            }
          : {}),
      }),
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const agentId = input.agentId ?? snapshot.agentId ?? null
    const runtimeContext = resolveCodexRuntimeContext(input.workspacePath, agentId)
    return {
      ...input.runtimeSession,
      providerStateSnapshot: JSON.stringify({
        ...snapshot,
        workspacePath: input.workspacePath,
        agentId,
        agentHome: runtimeContext.agentHome,
        models: {
          currentModelId: input.modelId ?? snapshot.models.currentModelId,
        },
      }),
    }
  }

  async getPresentation(_input: GetCapabilitiesInput): Promise<RuntimePresentationCapabilities> {
    return createCodexRuntimePresentation()
  }

  getDraftPresentation(): RuntimePresentationCapabilities {
    return createCodexRuntimePresentation()
  }

  async getUiSlotStates(input: GetUiSlotStatesInput): Promise<RuntimeUiSlotState[]> {
    const config = readTrustedCodexConfig(input.profile.configJson)
    const auth = resolveCodexAppServerAuth(input.profile, config.apiKey, 'OPENAI_API_KEY', this.deps)
    if (config.baseUrl && !auth.apiKey) {
      return []
    }

    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const workspacePath = snapshot.workspacePath ?? input.workspacePath
    const runtimeContext = resolveCodexRuntimeContext(workspacePath, input.agentId ?? snapshot.agentId ?? null)
    const runtimeSession = input.runtimeSession.providerSessionId
      ? input.runtimeSession
      : await this.resumeChatSession({
          runtimeSession: {
            ...input.runtimeSession,
            providerSessionId: null,
          },
          profile: input.profile,
          workspacePath: input.workspacePath,
          agentId: input.agentId,
          modelId: input.modelId,
        })
    if (!runtimeSession.providerSessionId) {
      return []
    }
    const client = this.createAppServerClient({
      apiKey: auth.apiKey ?? undefined,
      config: buildCodexConfig(config, workspacePath, this.resolveSkillPaths, null, input.modelId ?? snapshot.models.currentModelId),
      env: buildCradleCodexAppServerEnv({
        chatSessionId: input.runtimeSession.chatSessionId,
        workspaceId: input.workspaceId,
        workspacePath,
        agentId: input.agentId ?? snapshot.agentId ?? null,
        agentHome: runtimeContext.agentHome,
      }),
      serverRequestHandler: request => buildDefaultCodexAppServerRequestResult(request, {
        chatgptAuth: auth.chatgptAuth,
        updateSecretValue: this.deps.updateSecret,
      }),
    })

    try {
      await this.initializeAppServerClient(client, auth.chatgptAuth)
      const [goalResult, configResult, providerCapabilitiesResult, modelListResult, mcpStatusResult, rateLimitsResult, configRequirementsResult, skillsResult, pluginResult, appsResult, collaborationModesResult] = await Promise.allSettled([
        client.request('thread/goal/get', {
          threadId: runtimeSession.providerSessionId,
        }) as Promise<ThreadGoalGetResponse>,
        client.request('config/read', {
          cwd: runtimeContext.cwd,
          includeLayers: false,
        }) as Promise<CodexConfigReadResponse>,
        client.request('modelProvider/capabilities/read', {}) as Promise<CodexModelProviderCapabilitiesReadResponse>,
        client.request('model/list', {
          includeHidden: true,
          limit: 100,
        }) as Promise<CodexModelListResponse>,
        client.request('mcpServerStatus/list', {
          threadId: runtimeSession.providerSessionId,
          limit: 100,
          detail: 'toolsAndAuthOnly',
        }) as Promise<CodexListMcpServerStatusResponse>,
        client.request('account/rateLimits/read', {}) as Promise<CodexRateLimitsResponse>,
        client.request('configRequirements/read', {}) as Promise<CodexConfigRequirementsReadResponse>,
        client.request('skills/list', {
          cwd: runtimeContext.cwd,
        }) as Promise<CodexSkillsListResponse>,
        client.request('plugin/list', {}) as Promise<CodexPluginListResponse>,
        client.request('app/list', {
          limit: 100,
        }) as Promise<CodexAppsListResponse>,
        client.request('collaborationMode/list', {}) as Promise<CodexCollaborationModeListResponse>,
      ])
      const states: RuntimeUiSlotState[] = []
      const configResponse = configResult.status === 'fulfilled' ? configResult.value : null
      const providerCapabilities = providerCapabilitiesResult.status === 'fulfilled' ? providerCapabilitiesResult.value : null
      const modelList = modelListResult.status === 'fulfilled' ? modelListResult.value : null
      const mcpStatus = mcpStatusResult.status === 'fulfilled' ? mcpStatusResult.value : null
      const rateLimits = rateLimitsResult.status === 'fulfilled' ? rateLimitsResult.value : null
      const configRequirements = configRequirementsResult.status === 'fulfilled' ? configRequirementsResult.value : null
      const skills = skillsResult.status === 'fulfilled' ? skillsResult.value : null
      const plugins = pluginResult.status === 'fulfilled' ? pluginResult.value : null
      const apps = appsResult.status === 'fulfilled' ? appsResult.value : null
      const collaborationModes = collaborationModesResult.status === 'fulfilled' ? collaborationModesResult.value : null
      const crewState = await readCodexCrewState(
        client,
        runtimeSession.providerSessionId,
        readCodexProviderSnapshot(runtimeSession.providerStateSnapshot),
        collaborationModes,
      )
      const statusState = projectCodexStatusState(
        runtimeSession.providerSessionId,
        readCodexProviderSnapshot(runtimeSession.providerStateSnapshot),
      )
      if (statusState) {
        states.push(statusState)
      }
      const modelState = projectCodexModelState(
        runtimeSession.providerSessionId,
        readCodexProviderSnapshot(runtimeSession.providerStateSnapshot),
        configResponse,
        providerCapabilities,
        modelList,
      )
      if (modelState) {
        states.push(modelState)
      }
      const reasoningState = projectCodexReasoningState(
        runtimeSession.providerSessionId,
        readCodexProviderSnapshot(runtimeSession.providerStateSnapshot),
        configResponse,
        modelList,
      )
      if (reasoningState) {
        states.push(reasoningState)
      }
      const compactState = projectCodexCompactState(
        runtimeSession.providerSessionId,
        readCodexCompactSnapshot(runtimeSession.providerStateSnapshot),
        configResponse,
      )
      if (compactState) {
        states.push(compactState)
      }
      const planState = projectCodexPlanState(
        runtimeSession.providerSessionId,
        readCodexProviderSnapshot(runtimeSession.providerStateSnapshot),
      )
      if (planState) {
        states.push(planState)
      }
      const toolActivityState = projectCodexToolActivityState(
        runtimeSession.providerSessionId,
        readCodexProviderSnapshot(runtimeSession.providerStateSnapshot),
      )
      if (toolActivityState) {
        states.push(toolActivityState)
      }
      const mcpState = projectCodexMcpState(
        runtimeSession.providerSessionId,
        readCodexProviderSnapshot(runtimeSession.providerStateSnapshot),
        mcpStatus,
      )
      if (mcpState) {
        states.push(mcpState)
      }
      const diffState = projectCodexDiffState(
        runtimeSession.providerSessionId,
        readCodexProviderSnapshot(runtimeSession.providerStateSnapshot),
      )
      if (diffState) {
        states.push(diffState)
      }
      const terminalState = projectCodexTerminalState(
        runtimeSession.providerSessionId,
        readCodexProviderSnapshot(runtimeSession.providerStateSnapshot),
      )
      if (terminalState) {
        states.push(terminalState)
      }
      const approvalsState = projectCodexApprovalsState(
        runtimeSession.providerSessionId,
        readCodexProviderSnapshot(runtimeSession.providerStateSnapshot),
      )
      if (approvalsState) {
        states.push(approvalsState)
      }
      const alertState = projectCodexAlertState(
        runtimeSession.providerSessionId,
        readCodexProviderSnapshot(runtimeSession.providerStateSnapshot),
      )
      if (alertState) {
        states.push(alertState)
      }
      const filesystemState = projectCodexFilesystemState(
        runtimeSession.providerSessionId,
        readCodexProviderSnapshot(runtimeSession.providerStateSnapshot),
      )
      if (filesystemState) {
        states.push(filesystemState)
      }
      const skillsState = projectCodexSkillsState(runtimeSession.providerSessionId, skills)
      if (skillsState) {
        states.push(skillsState)
      }
      const pluginState = projectCodexPluginState(runtimeSession.providerSessionId, plugins, apps)
      if (pluginState) {
        states.push(pluginState)
      }
      const searchState = projectCodexSearchState(
        runtimeSession.providerSessionId,
        readCodexProviderSnapshot(runtimeSession.providerStateSnapshot),
      )
      if (searchState) {
        states.push(searchState)
      }
      if (crewState) {
        states.push(crewState)
      }
      const usageState = projectCodexUsageState(
        runtimeSession.providerSessionId,
        readCodexProviderSnapshot(runtimeSession.providerStateSnapshot),
        rateLimits,
      )
      if (usageState) {
        states.push(usageState)
      }
      const configState = projectCodexConfigState(runtimeSession.providerSessionId, configResponse, configRequirements)
      if (configState) {
        states.push(configState)
      }
      const goalState = projectCodexGoalState(readCodexGoalStateSource(
        goalResult.status === 'fulfilled' ? goalResult.value.goal : undefined,
        readCodexProviderSnapshot(runtimeSession.providerStateSnapshot).codex?.goal ?? null,
      ))
      if (goalState) {
        states.push(goalState)
      }
      return states
    }
    catch {
      return []
    }
    finally {
      client.close()
    }
  }

  async listProviderThreads(input: ProviderThreadListInput): Promise<ProviderThreadListResult> {
    const context = await this.createProviderThreadClient(input)
    const parentThreadId = context.runtimeSession.providerSessionId
    if (!parentThreadId) {
      context.client.close()
      return {
        runtimeKind: this.runtimeKind,
        providerSessionId: null,
        threads: [],
        nextCursor: null,
        backwardsCursor: null,
      }
    }

    try {
      const parent = await context.client.request('thread/read', {
        threadId: parentThreadId,
        includeTurns: false,
      }) as ThreadReadResponse
      const parentTreeId = parent.thread.sessionId
      const params: ThreadListParams = {
        cursor: input.cursor ?? null,
        limit: input.limit ?? 50,
        sortKey: input.sortKey ?? 'updated_at',
        sortDirection: input.sortDirection ?? 'desc',
        sourceKinds: input.sourceKinds?.map(toCodexThreadSourceKind) ?? ['subAgentThreadSpawn'],
        archived: input.archived ?? false,
        cwd: context.workspacePath,
        searchTerm: input.searchTerm ?? null,
      }
      const response = await context.client.request('thread/list', params) as ThreadListResponse
      return {
        runtimeKind: this.runtimeKind,
        providerSessionId: parentThreadId,
        threads: (response.data ?? [])
          .filter(thread => thread.sessionId === parentTreeId)
          .map(projectCodexThread),
        nextCursor: response.nextCursor ?? null,
        backwardsCursor: response.backwardsCursor ?? null,
      }
    }
    finally {
      context.client.close()
    }
  }

  async readProviderThread(input: ProviderThreadReadInput): Promise<ProviderThreadReadResult> {
    const context = await this.createProviderThreadClient(input)
    try {
      const response = await context.client.request('thread/read', {
        threadId: input.threadId,
        includeTurns: input.includeTurns ?? false,
      }) as ThreadReadResponse
      await assertCodexThreadBelongsToRuntimeSession(context.client, context.runtimeSession.providerSessionId, response.thread)
      return {
        runtimeKind: this.runtimeKind,
        providerSessionId: context.runtimeSession.providerSessionId,
        thread: projectCodexThread(response.thread),
      }
    }
    finally {
      context.client.close()
    }
  }

  async listProviderThreadTurns(input: ProviderThreadTurnsInput): Promise<ProviderThreadTurnsResult> {
    const context = await this.createProviderThreadClient(input)
    try {
      const threadResponse = await context.client.request('thread/read', {
        threadId: input.threadId,
        includeTurns: false,
      }) as ThreadReadResponse
      await assertCodexThreadBelongsToRuntimeSession(context.client, context.runtimeSession.providerSessionId, threadResponse.thread)
      const response = await context.client.request('thread/turns/list', {
        threadId: input.threadId,
        cursor: input.cursor ?? null,
        limit: input.limit ?? 50,
        sortDirection: input.sortDirection ?? 'asc',
        itemsView: 'full',
      }) as ThreadTurnsListResponse
      const turns = response.data ?? []
      return {
        runtimeKind: this.runtimeKind,
        providerSessionId: context.runtimeSession.providerSessionId,
        threadId: input.threadId,
        turns: turns.map(projectCodexTurn),
        messages: projectCodexTurnsToUiMessages(input.threadId, turns),
        nextCursor: response.nextCursor ?? null,
        backwardsCursor: response.backwardsCursor ?? null,
      }
    }
    finally {
      context.client.close()
    }
  }

  private async createProviderThreadClient(input: GetCapabilitiesInput): Promise<{
    client: CodexAppServerClientLike
    runtimeSession: RuntimeSession
    workspacePath: string
  }> {
    const config = readTrustedCodexConfig(input.profile.configJson)
    const auth = resolveCodexAppServerAuth(input.profile, config.apiKey, 'OPENAI_API_KEY', this.deps)
    if (config.baseUrl && !auth.apiKey) {
      throw new ProviderRuntimeError(ProviderErrors.authFailed(this.runtimeKind))
    }

    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const workspacePath = snapshot.workspacePath ?? input.workspacePath
    const agentId = input.agentId ?? snapshot.agentId ?? null
    const runtimeContext = resolveCodexRuntimeContext(workspacePath, agentId)
    const runtimeSession = input.runtimeSession.providerSessionId
      ? input.runtimeSession
      : await this.resumeChatSession({
          runtimeSession: input.runtimeSession,
          profile: input.profile,
          workspacePath,
          agentId,
          modelId: input.modelId,
        })

    const client = this.createAppServerClient({
      apiKey: auth.apiKey ?? undefined,
      config: buildCodexConfig(config, workspacePath, this.resolveSkillPaths, null, input.modelId ?? snapshot.models.currentModelId),
      env: buildCradleCodexAppServerEnv({
        chatSessionId: input.runtimeSession.chatSessionId,
        workspaceId: input.workspaceId,
        workspacePath,
        agentId,
        agentHome: runtimeContext.agentHome,
      }),
      serverRequestHandler: request => buildDefaultCodexAppServerRequestResult(request, {
        chatgptAuth: auth.chatgptAuth,
        updateSecretValue: this.deps.updateSecret,
      }),
    })
    await this.initializeAppServerClient(client, auth.chatgptAuth)
    return { client, runtimeSession, workspacePath }
  }

  async executeShellCommand(input: ExecuteShellCommandInput): Promise<ExecuteShellCommandResult> {
    const command = input.command.trim()
    if (!command) {
      throw new ProviderRuntimeError(ProviderErrors.requestFailed(this.runtimeKind, 'executeShellCommand', 'Codex shell command must not be empty'))
    }

    const config = readTrustedCodexConfig(input.profile.configJson)
    const auth = resolveCodexAppServerAuth(input.profile, config.apiKey, 'OPENAI_API_KEY', this.deps)
    if (config.baseUrl && !auth.apiKey) {
      throw new ProviderRuntimeError(ProviderErrors.authFailed(this.runtimeKind))
    }

    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const workspacePath = snapshot.workspacePath ?? input.workspacePath
    const agentId = input.agentId ?? snapshot.agentId ?? null
    const runtimeContext = resolveCodexRuntimeContext(workspacePath, agentId)
    const effectiveModel = input.modelId ?? snapshot.models.currentModelId ?? config.model
    const client = this.createAppServerClient({
      apiKey: auth.apiKey ?? undefined,
      config: buildCodexConfig(config, workspacePath, this.resolveSkillPaths, null, effectiveModel),
      env: buildCradleCodexAppServerEnv({
        chatSessionId: input.runtimeSession.chatSessionId,
        workspaceId: input.workspaceId,
        workspacePath,
        agentId,
        agentHome: runtimeContext.agentHome,
      }),
      serverRequestHandler: request => buildDefaultCodexAppServerRequestResult(request, {
        chatgptAuth: auth.chatgptAuth,
        updateSecretValue: this.deps.updateSecret,
      }),
    })
    const startedAt = Date.now()

    try {
      await this.initializeAppServerClient(client, auth.chatgptAuth)
      const threadStart = await startOrResumeThread(client, input.runtimeSession, {
        model: effectiveModel,
        cwd: runtimeContext.cwd,
        runtimeWorkspaceRoots: runtimeContext.runtimeWorkspaceRoots,
        approvalPolicy: config.approvalPolicy,
        sandbox: config.sandboxMode,
        config: buildCodexConfig(config, workspacePath, this.resolveSkillPaths, null, effectiveModel),
      })
      const threadId = threadStart.threadId
      input.runtimeSession.providerSessionId = threadId
      this._lastModelId = threadStart.modelId ?? effectiveModel ?? null
      writeCodexThreadSnapshot(input.runtimeSession, threadStart)

      await client.request('thread/shellCommand', { threadId, command })
      const result = await waitForCodexShellCommandCompletion(client, {
        threadId,
        command,
        signal: input.signal,
      })
      await hydrateCodexNativeHistory(client, input.runtimeSession, threadId)

      const output = result.item.aggregatedOutput ?? result.output ?? ''
      return {
        command: result.item.command ?? command,
        stdout: output,
        stderr: '',
        exitCode: result.item.exitCode ?? null,
        durationMs: result.item.durationMs ?? Math.max(0, Date.now() - startedAt),
        timedOut: false,
        truncated: output.endsWith('...<truncated>'),
      }
    }
    finally {
      client.close()
    }
  }

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    const config = readTrustedCodexConfig(input.profile.configJson)
    const auth = resolveCodexAppServerAuth(input.profile, config.apiKey, 'OPENAI_API_KEY', this.deps)
    const effectiveModel = input.modelId ?? config.model
    const userInput = projectCodexUserInput(input.message, 'Codex provider')
    const userPromptText = extractUiMessageText(input.message).trim()
    const goalContinuationRequested = typeof input.message !== 'string' && isCodexGoalContinuationMessage(input.message)
    const goalCommandObjective = readCodexGoalCommandObjective(input.message)
    const compactCommandRequested = isCodexCompactCommand(input.message)
    if (config.baseUrl && !auth.apiKey) {
      throw new ProviderRuntimeError(ProviderErrors.authFailed(this.runtimeKind))
    }

    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const workspacePath = snapshot.workspacePath ?? '.'
    const runtimeContext = resolveCodexRuntimeContext(workspacePath, input.agentId ?? snapshot.agentId ?? null)
    const systemPromptFile = writeSystemPromptFile(input.systemPrompt)
    const codexConfig = buildCodexConfig(config, workspacePath, this.resolveSkillPaths, systemPromptFile, effectiveModel)
    const client = this.createAppServerClient({
      apiKey: auth.apiKey ?? undefined,
      config: codexConfig,
      env: buildCradleCodexAppServerEnv({
        chatSessionId: input.runtimeSession.chatSessionId,
        workspaceId: input.workspaceId,
        workspacePath,
        agentId: input.agentId ?? snapshot.agentId ?? null,
        agentHome: runtimeContext.agentHome,
      }),
      serverRequestHandler: request => buildDefaultCodexAppServerRequestResult(request, {
        chatgptAuth: auth.chatgptAuth,
        updateSecretValue: this.deps.updateSecret,
      }),
    })
    const abortController = new AbortController()
    const sessionId = input.runtimeSession.chatSessionId
    const shouldInjectReconstructedHistory = !input.runtimeSession.providerSessionId
    this._lastUsage = null
    this._lastModelId = effectiveModel ?? null

    const textItemId = randomUUID()
    const mapperState = createCodexAppServerMapperState(textItemId)
    const providerThreadMapperStates = new Map<string, ReturnType<typeof createCodexAppServerMapperState>>()
    const diagnostics = createDiagnostics()
    let activeEntry: ActiveCodexTurn | null = null

    let generation: LangfuseGeneration | null = null
    if (langfuseEnabled) {
      generation = startObservation('codex-generation', {
        model: effectiveModel ?? 'codex',
        input: input.systemPrompt
          ? [{ role: 'system', content: input.systemPrompt }, { role: 'user', content: describeCodexUserInput(userInput, userPromptText) }]
          : [{ role: 'user', content: describeCodexUserInput(userInput, userPromptText) }],
      }, { asType: 'generation' }) as LangfuseGeneration
      const span = generation.otelSpan
      span.setAttribute('langfuse.session.id', input.runtimeSession.chatSessionId)
      span.setAttribute('langfuse.trace.name', 'codex-chat')
    }
    const outputTextCollector = createBoundedTextCollector()

    try {
      await this.initializeAppServerClient(client, auth.chatgptAuth)
      const threadStart = await startOrResumeThread(client, input.runtimeSession, {
        model: effectiveModel,
        cwd: runtimeContext.cwd,
        runtimeWorkspaceRoots: runtimeContext.runtimeWorkspaceRoots,
        approvalPolicy: config.approvalPolicy,
        sandbox: config.sandboxMode,
        config: codexConfig,
      })
      const threadId = threadStart.threadId
      input.runtimeSession.providerSessionId = threadId
      this._lastModelId = threadStart.modelId ?? effectiveModel ?? null
      writeCodexThreadSnapshot(input.runtimeSession, threadStart)
      if (threadStart.title) {
        input.reportSessionTitle?.(threadStart.title)
      }
      if (shouldInjectReconstructedHistory) {
        await injectCodexNativeHistory(client, threadId, readCodexProviderSnapshot(input.runtimeSession.providerStateSnapshot).codex?.previousNativeHistory)
        await injectCradleTranscriptHistory(client, threadId, input.transcript?.history ?? input.history)
      }
      else {
        await hydrateCodexNativeHistory(client, input.runtimeSession, threadId)
      }

      let turnId: string | null = null
      if (goalContinuationRequested) {
        if (!hasActiveGoal(readCodexProviderSnapshot(input.runtimeSession.providerStateSnapshot).codex?.goal)) {
          return
        }
        activeEntry = { client, abortController, threadId, turnId }
        this.activeTurns.set(sessionId, activeEntry)
        if (!await continueActiveGoal(client, threadId, abortController.signal)) {
          return
        }
      }
      else if (goalCommandObjective) {
        const goal = await setCodexThreadGoal(client, input.runtimeSession, threadId, goalCommandObjective)
        if (!hasActiveGoal(goal)) {
          return
        }
        activeEntry = { client, abortController, threadId, turnId }
        this.activeTurns.set(sessionId, activeEntry)
        if (!await continueActiveGoal(client, threadId, abortController.signal)) {
          return
        }
      }
      else if (compactCommandRequested) {
        await client.request('thread/compact/start', { threadId })
      }
      else {
        const turnResponse = await client.request('turn/start', {
          threadId,
          input: userInput,
          cwd: runtimeContext.cwd,
          runtimeWorkspaceRoots: runtimeContext.runtimeWorkspaceRoots,
          approvalPolicy: config.approvalPolicy,
          sandboxPolicy: toSandboxPolicy(config.sandboxMode, runtimeContext.runtimeWorkspaceRoots, config.additionalDirectories),
          model: effectiveModel,
          effort: config.reasoningEffort,
        }) as TurnResponse
        turnId = turnResponse.turn?.id ?? turnResponse.turnId ?? null
      }
      if (!activeEntry) {
        activeEntry = { client, abortController, threadId, turnId }
        this.activeTurns.set(sessionId, activeEntry)
      }

      for await (const notification of readTurnNotifications(
        client,
        threadId,
        turnId,
        abortController.signal,
        () => readCodexProviderSnapshot(input.runtimeSession.providerStateSnapshot).codex?.goal ?? null,
        providerNotification => publishProviderThreadEvent(input.onProviderThreadEvent, providerNotification, providerThreadMapperStates),
      )) {
        if (abortController.signal.aborted) {
          break
        }
        collectCodexStreamDiagnostics(diagnostics, notification)
        const chunks = mapCodexAppServerNotificationToChunks(notification, mapperState)
        diagnostics.mappedEvents += chunks.length
        for (const chunk of chunks) {
          if (generation && chunk.type === 'text-delta' && 'delta' in chunk) {
            outputTextCollector.append((chunk as { delta: string }).delta)
          }
          yield chunk
        }

        if (notification.method === 'turn/started') {
          activeEntry.turnId = getTurnId(notification) ?? activeEntry.turnId
        }
        if (notification.method === 'thread/name/updated') {
          const title = readThreadNameUpdate(notification, threadId)
          if (title) {
            input.reportSessionTitle?.(title)
          }
        }
        projectCodexThreadSnapshot(input.runtimeSession, notification, threadId)
        projectCodexCompactSnapshot(input.runtimeSession, notification, threadId)
        projectCodexPlanSnapshot(input.runtimeSession, notification, threadId)
        projectCodexToolActivitySnapshot(input.runtimeSession, notification, threadId)
        projectCodexMcpSnapshot(input.runtimeSession, notification, threadId)
        projectCodexDiffSnapshot(input.runtimeSession, notification, threadId)
        projectCodexTerminalSnapshot(input.runtimeSession, notification, threadId)
        projectCodexApprovalsSnapshot(input.runtimeSession, notification, threadId)
        projectCodexAlertSnapshot(input.runtimeSession, notification, threadId)
        projectCodexFilesystemSnapshot(input.runtimeSession, notification, threadId)
        projectCodexSearchSnapshot(input.runtimeSession, notification, threadId)
        projectCodexUsageSnapshot(input.runtimeSession, notification, threadId)
        this.captureLastTokenUsage(notification)
        projectCodexGoalSnapshot(input.runtimeSession, notification)
        if (isCompletedGoalUpdate(notification)) {
          await client.request('thread/goal/clear', { threadId }).catch(() => undefined)
        }
        if (notification.method === 'turn/completed') {
          const turn = (notification.params as TurnNotificationParams | undefined)?.turn
          if (turn?.status === 'failed') {
            throw createCodexTurnFailureError(turn.error?.message, diagnostics, notification)
          }
        }
        if (notification.method === 'error') {
          if (isRetryableCodexAppServerError(notification)) {
            continue
          }
          throw createCodexAppServerError(notification, diagnostics)
        }
      }
      const finalTitle = await readLatestThreadTitle(client, threadId)
      if (finalTitle) {
        input.reportSessionTitle?.(finalTitle)
      }
      await hydrateCodexNativeHistory(client, input.runtimeSession, threadId)

      for (const chunk of closeOpenCodexAppServerReasoning(mapperState)) {
        diagnostics.mappedEvents += 1
        yield chunk
      }
      for (const chunk of closeOpenCodexAppServerText(mapperState)) {
        diagnostics.mappedEvents += 1
        yield chunk
      }

      const validation = validateCodexStreamOutput(diagnostics)
      if (!validation.ok) {
        const errorText = validation.errorText ?? 'Codex app-server stream produced no timeline output events'
        this.recordObservability({
          source: 'provider',
          code: OBSERVABILITY_CODES.providerEmptyEventStream,
          severity: 'error',
          category: 'provider',
          message: errorText,
          chatSessionId: input.runtimeSession.chatSessionId,
          dedupeKey: createDedupeKey({
            code: OBSERVABILITY_CODES.providerEmptyEventStream,
            chatSessionId: input.runtimeSession.chatSessionId,
            runId: null,
          }),
          attrs: { runtimeKind: RUNTIME_KIND, diagnostics, model: effectiveModel, baseUrl: config.baseUrl },
        })
        throw createCodexEmptyStreamError(errorText, diagnostics)
      }

      if (generation) {
        const update: Parameters<LangfuseGeneration['update']>[0] = {
          output: outputTextCollector.read(),
        }
        generation.update(update)
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
      if (activeEntry) {
        this.releaseTurn(sessionId, activeEntry)
      }
      client.close()
      if (systemPromptFile) {
        try {
          unlinkSync(systemPromptFile)
        }
        catch { /* ignore */ }
      }
    }
  }

  async steerTurn(input: SteerTurnInput): Promise<void> {
    const entry = this.activeTurns.get(input.runtimeSession.chatSessionId)
    if (!entry?.turnId) {
      throw new ProviderRuntimeError(ProviderErrors.sessionNotFound(this.runtimeKind, input.runtimeSession.chatSessionId))
    }
    const userInput = projectCodexUserInput(input.message, 'Codex provider live steer')
    await entry.client.request('turn/steer', {
      threadId: entry.threadId,
      expectedTurnId: entry.turnId,
      input: userInput,
    })
  }

  async cancelTurn(input: CancelTurnInput): Promise<void> {
    const sessionId = input.runtimeSession.chatSessionId
    const entry = this.activeTurns.get(sessionId)
    if (!entry) {
      return
    }
    if (hasActiveGoal(readCodexProviderSnapshot(input.runtimeSession.providerStateSnapshot).codex?.goal)) {
      await entry.client.request('thread/goal/set', {
        threadId: entry.threadId,
        status: 'paused',
      }).catch(() => undefined)
      pauseCodexGoalSnapshot(input.runtimeSession)
    }
    entry.abortController.abort()
    if (entry.turnId) {
      await entry.client.request('turn/interrupt', {
        threadId: entry.threadId,
        turnId: entry.turnId,
      }).catch(() => undefined)
    }
    this.releaseTurn(sessionId, entry)
    entry.client.close()
  }

  private createAppServerClient(options: CodexAppServerClientOptions): CodexAppServerClientLike {
    return this.deps.createAppServerClient?.(options) ?? new CodexAppServerClient(options)
  }

  private async initializeAppServerClient(
    client: CodexAppServerClientLike,
    chatgptAuth: CodexChatgptAuthCredential | null,
  ): Promise<void> {
    await client.initialize()
    if (!chatgptAuth) {
      return
    }
    const credential = await ensureCodexChatgptAuthAccessToken(chatgptAuth, {
      updateSecretValue: this.deps.updateSecret,
    })
    await client.request('account/login/start', buildCodexChatgptAuthLoginParams(credential))
  }

  private captureLastTokenUsage(notification: CodexAppServerMessage): void {
    if (notification.method !== 'thread/tokenUsage/updated') {
      return
    }
    const params = notification.params as ThreadTokenUsageUpdatedNotificationParams | undefined
    const usage = readCodexLastTokenUsage(params?.tokenUsage)
    if (usage) {
      this._lastUsage = usage
    }
  }
}

async function waitForCodexShellCommandCompletion(
  client: CodexAppServerClientLike,
  input: {
    threadId: string
    command: string
    signal?: AbortSignal
  },
): Promise<{ item: CodexThreadItem, output: string }> {
  const output = createBoundedTextCollector()
  const controller = new AbortController()
  let timedOut = false
  let commandItemId: string | null = null

  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, CODEX_SHELL_COMMAND_RESULT_TIMEOUT_MS)
  const abort = () => controller.abort()
  input.signal?.addEventListener('abort', abort, { once: true })

  try {
    while (true) {
      const notification = await readCodexShellCommandNotification(client, controller.signal, () => {
        if (input.signal?.aborted) {
          throw new DOMException('Codex shell command aborted', 'AbortError')
        }
        if (timedOut) {
          throw new CodexProviderError('codex_shell_command_timeout', 'Timed out waiting for Codex shell command completion', {
            threadId: input.threadId,
            command: input.command,
            timeoutMs: CODEX_SHELL_COMMAND_RESULT_TIMEOUT_MS,
          })
        }
      })
      if (!notification) {
        throw new CodexProviderError('codex_shell_command_stream_closed', 'Codex app-server stream closed before shell command completed', {
          threadId: input.threadId,
          command: input.command,
        })
      }
      if (notification.method === 'item/started') {
        const params = notification.params as ItemNotificationParams | undefined
        const item = params?.item
        if (params?.threadId === input.threadId && isMatchingUserShellCommandItem(item, input.command)) {
          commandItemId = item.id ?? null
        }
        continue
      }
      if (notification.method === 'item/commandExecution/outputDelta') {
        const params = notification.params as CommandExecutionOutputDeltaNotificationParams | undefined
        if (params?.threadId === input.threadId && params.itemId === commandItemId && params.delta) {
          output.append(params.delta)
        }
        continue
      }
      if (notification.method === 'item/completed') {
        const params = notification.params as ItemNotificationParams | undefined
        const item = params?.item
        if (
          params?.threadId === input.threadId
          && item?.type === 'commandExecution'
          && (
            (commandItemId !== null && item.id === commandItemId)
            || isMatchingUserShellCommandItem(item, input.command)
          )
        ) {
          return { item, output: output.read() ?? '' }
        }
      }
    }
  }
  finally {
    clearTimeout(timeout)
    input.signal?.removeEventListener('abort', abort)
  }
}

async function readCodexShellCommandNotification(
  client: CodexAppServerClientLike,
  signal: AbortSignal,
  onAbort: () => void,
): Promise<CodexAppServerMessage | null> {
  try {
    return await client.nextNotification(signal)
  }
  catch (error) {
    if (signal.aborted) {
      onAbort()
    }
    throw error
  }
}

function isMatchingUserShellCommandItem(item: CodexThreadItem | undefined, command: string): item is CodexThreadItem {
  return item?.type === 'commandExecution'
    && typeof item.id === 'string'
    && (item.source === 'userShell' || item.command === command)
}

function projectCodexGoalState(goal: ThreadGoalGetResponse['goal']): RuntimeUiSlotState | null {
  if (!goal?.threadId || !goal.objective || !isCodexGoalStatus(goal.status)) {
    return null
  }
  return {
    kind: 'goal',
    slotId: 'codex:goal',
    threadId: goal.threadId,
    objective: goal.objective,
    status: goal.status,
    tokenBudget: typeof goal.tokenBudget === 'number' ? goal.tokenBudget : null,
    tokensUsed: typeof goal.tokensUsed === 'number' ? goal.tokensUsed : 0,
    timeUsedSeconds: typeof goal.timeUsedSeconds === 'number' ? goal.timeUsedSeconds : 0,
    createdAt: typeof goal.createdAt === 'number' ? goal.createdAt : 0,
    updatedAt: typeof goal.updatedAt === 'number' ? goal.updatedAt : 0,
  }
}

function isCodexGoalStatus(value: unknown): value is RuntimeGoalStatus {
  return value === 'active'
    || value === 'paused'
    || value === 'blocked'
    || value === 'usageLimited'
    || value === 'budgetLimited'
    || value === 'complete'
}

function hasActiveGoal(goal: CodexGoalSnapshot | null | undefined): boolean {
  return goal?.status === 'active' && typeof goal.objective === 'string' && goal.objective.trim().length > 0
}

function readCodexGoalCommandObjective(message: RuntimeMessageInput): string | null {
  if (typeof message !== 'string') {
    const objective = readGoalMessageObjective(message)
    if (objective) {
      return objective
    }
  }
  const normalized = extractUiMessageText(message).trimStart()
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

function isCodexCompactCommand(message: RuntimeMessageInput): boolean {
  const normalized = extractUiMessageText(message).trim()
  if (!normalized.startsWith('/compact')) {
    return false
  }
  const nextChar = normalized.charAt('/compact'.length)
  return !nextChar || nextChar === ' ' || nextChar === '\t'
}

async function setCodexThreadGoal(
  client: CodexAppServerClientLike,
  runtimeSession: RuntimeSession,
  threadId: string,
  objective: string,
): Promise<CodexGoalSnapshot | null> {
  const response = await client.request('thread/goal/set', {
    threadId,
    objective,
  }) as ThreadGoalGetResponse
  const goalState = projectCodexGoalState(response.goal ?? null)
  if (!goalState) {
    return null
  }
  writeCodexGoalSnapshot(runtimeSession, goalState)
  return readCodexProviderSnapshot(runtimeSession.providerStateSnapshot).codex?.goal ?? null
}

function writeCodexGoalSnapshot(runtimeSession: RuntimeSession, state: RuntimeUiSlotState): void {
  if (state.kind !== 'goal') {
    return
  }
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      goal: {
        threadId: state.threadId,
        objective: state.objective,
        status: state.status,
        tokenBudget: state.tokenBudget,
        tokensUsed: state.tokensUsed,
        timeUsedSeconds: state.timeUsedSeconds,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
      },
    },
  })
}

function clearCodexGoalSnapshot(runtimeSession: RuntimeSession): void {
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  if (snapshot.codex?.goal?.status === 'complete') {
    return
  }
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      goal: null,
    },
  })
}

function pauseCodexGoalSnapshot(runtimeSession: RuntimeSession): void {
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  const goal = snapshot.codex?.goal
  if (!hasActiveGoal(goal)) {
    return
  }
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      goal: {
        ...goal,
        status: 'paused',
        updatedAt: Date.now(),
      },
    },
  })
}

function projectCodexGoalSnapshot(
  runtimeSession: RuntimeSession,
  notification: CodexAppServerMessage,
): void {
  if (notification.method === 'thread/goal/updated') {
    const goal = (notification.params as CodexGoalUpdatedNotificationParams | undefined)?.goal
    const goalState = projectCodexGoalState(goal ?? null)
    if (goalState) {
      writeCodexGoalSnapshot(runtimeSession, goalState)
    }
    return
  }

  if (notification.method === 'thread/goal/cleared') {
    clearCodexGoalSnapshot(runtimeSession)
  }
}

function readCodexGoalStateSource(
  appServerGoal: ThreadGoalGetResponse['goal'] | undefined,
  snapshotGoal: CodexGoalSnapshot | null,
): ThreadGoalGetResponse['goal'] {
  if (appServerGoal) {
    return appServerGoal
  }
  if (snapshotGoal?.status === 'complete') {
    return snapshotGoal
  }
  return appServerGoal ?? null
}

function isCompletedGoalUpdate(notification: CodexAppServerMessage): boolean {
  if (notification.method !== 'thread/goal/updated') {
    return false
  }
  const params = notification.params as CodexGoalUpdatedNotificationParams | undefined
  return params?.goal?.status === 'complete'
}

function isIdleThreadStatus(notification: CodexAppServerMessage): boolean {
  if (notification.method !== 'thread/status/changed') {
    return false
  }
  const params = notification.params as ThreadStatusChangedNotificationParams | undefined
  return params?.status?.type === 'idle'
}

function writeCodexThreadSnapshot(
  runtimeSession: RuntimeSession,
  thread: {
    threadId: string
    modelId: string | null
    modelProvider: string | null
    serviceTier: string | null
    reasoningEffort: string | null
    status: CodexThreadStatus | null
  },
): void {
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  const now = Date.now()
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      model: {
        ...snapshot.codex?.model,
        threadId: thread.threadId,
        modelId: thread.modelId,
        modelProvider: thread.modelProvider,
        serviceTier: thread.serviceTier,
        updatedAt: now,
      },
      reasoning: {
        ...snapshot.codex?.reasoning,
        threadId: thread.threadId,
        effort: thread.reasoningEffort,
        summary: snapshot.codex?.reasoning?.summary ?? null,
        updatedAt: now,
      },
      ...(thread.status
        ? {
            status: {
              threadId: thread.threadId,
              status: thread.status,
              updatedAt: now,
            },
          }
        : {}),
    },
  })
}

function projectCodexThreadSnapshot(
  runtimeSession: RuntimeSession,
  notification: CodexAppServerMessage,
  fallbackThreadId: string,
): void {
  if (notification.method === 'thread/status/changed') {
    const params = notification.params as ThreadStatusChangedNotificationParams | undefined
    if (!params?.status) {
      return
    }
    writeCodexStatusSnapshot(runtimeSession, {
      threadId: params.threadId ?? fallbackThreadId,
      status: params.status,
      updatedAt: Date.now(),
    })
    return
  }

  if (notification.method === 'thread/settings/updated') {
    const params = notification.params as ThreadSettingsUpdatedNotificationParams | undefined
    if (!params?.threadSettings) {
      return
    }
    writeCodexSettingsSnapshot(runtimeSession, params.threadId ?? fallbackThreadId, params.threadSettings)
  }
}

function writeCodexStatusSnapshot(
  runtimeSession: RuntimeSession,
  status: NonNullable<CodexProviderSnapshot['codex']>['status'],
): void {
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      status,
    },
  })
}

function writeCodexSettingsSnapshot(
  runtimeSession: RuntimeSession,
  threadId: string,
  settings: CodexThreadSettings,
): void {
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  const now = Date.now()
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      model: {
        ...snapshot.codex?.model,
        threadId,
        modelId: settings.model ?? snapshot.codex?.model?.modelId ?? null,
        modelProvider: settings.modelProvider ?? snapshot.codex?.model?.modelProvider ?? null,
        serviceTier: settings.serviceTier ?? snapshot.codex?.model?.serviceTier ?? null,
        updatedAt: now,
      },
      reasoning: {
        ...snapshot.codex?.reasoning,
        threadId,
        effort: settings.effort ?? snapshot.codex?.reasoning?.effort ?? null,
        summary: settings.summary ?? snapshot.codex?.reasoning?.summary ?? null,
        updatedAt: now,
      },
    },
  })
}

function projectCodexStatusState(
  threadId: string,
  snapshot: CodexProviderSnapshot,
): RuntimeStatusUiSlotState | null {
  const status = snapshot.codex?.status
  if (!status || status.threadId !== threadId) {
    return null
  }
  const statusType = normalizeCodexThreadStatus(status.status)
  if (!statusType) {
    return null
  }
  return {
    kind: 'status',
    slotId: 'codex:status',
    threadId,
    status: statusType,
    activeFlags: Array.isArray(status.status.activeFlags) ? status.status.activeFlags.filter(flag => typeof flag === 'string') : [],
    updatedAt: status.updatedAt,
  }
}

function projectCodexModelState(
  threadId: string,
  snapshot: CodexProviderSnapshot,
  configResponse: CodexConfigReadResponse | null,
  providerCapabilities: CodexModelProviderCapabilitiesReadResponse | null,
  modelList: CodexModelListResponse | null,
): RuntimeModelUiSlotState | null {
  const model = snapshot.codex?.model
  const modelId = model?.modelId ?? configResponse?.config?.model ?? snapshot.models?.currentModelId ?? null
  if (!model && !modelId) {
    return null
  }
  const modelInfo = findCodexModel(modelList, modelId)
  return {
    kind: 'model',
    slotId: 'codex:model',
    threadId,
    modelId,
    modelLabel: modelInfo?.displayName ?? modelInfo?.model ?? modelId,
    modelProvider: model?.modelProvider ?? configResponse?.config?.model_provider ?? null,
    serviceTier: model?.serviceTier ?? configResponse?.config?.service_tier ?? null,
    supportsImages: typeof providerCapabilities?.imageGeneration === 'boolean' ? providerCapabilities.imageGeneration : null,
    supportsWebSearch: typeof providerCapabilities?.webSearch === 'boolean' ? providerCapabilities.webSearch : null,
    supportsNamespaceTools: typeof providerCapabilities?.namespaceTools === 'boolean' ? providerCapabilities.namespaceTools : null,
    updatedAt: model?.updatedAt ?? 0,
  }
}

function projectCodexReasoningState(
  threadId: string,
  snapshot: CodexProviderSnapshot,
  configResponse: CodexConfigReadResponse | null,
  modelList: CodexModelListResponse | null,
): RuntimeReasoningUiSlotState | null {
  const reasoning = snapshot.codex?.reasoning
  const modelId = snapshot.codex?.model?.modelId ?? configResponse?.config?.model ?? snapshot.models?.currentModelId ?? null
  const modelInfo = findCodexModel(modelList, modelId)
  const supportedEfforts = (modelInfo?.supportedReasoningEfforts ?? [])
    .flatMap(option => typeof option.reasoningEffort === 'string'
      ? [{ id: option.reasoningEffort, description: typeof option.description === 'string' ? option.description : '' }]
      : [])
  const effort = reasoning?.effort ?? configResponse?.config?.model_reasoning_effort ?? modelInfo?.defaultReasoningEffort ?? null
  const summary = reasoning?.summary ?? configResponse?.config?.model_reasoning_summary ?? null
  if (!reasoning && !effort && !summary && supportedEfforts.length === 0) {
    return null
  }
  return {
    kind: 'reasoning',
    slotId: 'codex:reasoning',
    threadId,
    effort,
    summary,
    supportedEfforts,
    updatedAt: reasoning?.updatedAt ?? 0,
  }
}

function normalizeCodexThreadStatus(status: CodexThreadStatus): RuntimeStatusUiSlotState['status'] | null {
  switch (status.type) {
    case 'notLoaded':
    case 'idle':
    case 'systemError':
    case 'active':
      return status.type
    default:
      return null
  }
}

function findCodexModel(modelList: CodexModelListResponse | null, modelId: string | null | undefined) {
  if (!modelId) {
    return null
  }
  return modelList?.data?.find(model => model.id === modelId || model.model === modelId) ?? null
}

function projectCodexCompactSnapshot(
  runtimeSession: RuntimeSession,
  notification: CodexAppServerMessage,
  fallbackThreadId: string,
): void {
  if (notification.method === 'thread/tokenUsage/updated') {
    const params = notification.params as ThreadTokenUsageUpdatedNotificationParams | undefined
    if (!params?.tokenUsage) {
      return
    }
    writeCodexCompactSnapshot(runtimeSession, {
      threadId: params.threadId ?? fallbackThreadId,
      turnId: params.turnId ?? null,
      tokenUsage: params.tokenUsage,
      updatedAt: Date.now(),
    })
    return
  }

  if (notification.method === 'thread/compacted') {
    const params = notification.params as ContextCompactedNotificationParams | undefined
    mergeCodexCompactSnapshot(runtimeSession, {
      threadId: params?.threadId ?? fallbackThreadId,
      turnId: params?.turnId ?? null,
      status: 'compacted',
      lastCompactedAt: Date.now(),
    })
    return
  }

  if (notification.method === 'item/started') {
    const params = notification.params as ItemNotificationParams | undefined
    if (params?.item?.type !== 'contextCompaction') {
      return
    }
    mergeCodexCompactSnapshot(runtimeSession, {
      threadId: params.threadId ?? fallbackThreadId,
      turnId: params.turnId ?? null,
      status: 'running',
      compactionStartedAt: typeof params.startedAtMs === 'number' ? params.startedAtMs : Date.now(),
      compactionItemId: params.item.id ?? null,
    })
    return
  }

  if (notification.method === 'item/completed') {
    const params = notification.params as ItemNotificationParams | undefined
    if (params?.item?.type !== 'contextCompaction') {
      return
    }
    const compactionItemId = params.item.id ?? null
    const existing = readCodexCompactSnapshot(runtimeSession.providerStateSnapshot)
    mergeCodexCompactSnapshot(runtimeSession, {
      threadId: params.threadId ?? fallbackThreadId,
      turnId: params.turnId ?? null,
      status: 'compacted',
      lastCompactedAt: typeof params.completedAtMs === 'number' ? params.completedAtMs : Date.now(),
      compactionItemId,
      completedCompactionItemIds: compactionItemId
        ? [compactionItemId, ...(existing?.completedCompactionItemIds ?? []).filter(id => id !== compactionItemId)].slice(0, 6)
        : existing?.completedCompactionItemIds ?? [],
    })
  }
}

function writeCodexCompactSnapshot(runtimeSession: RuntimeSession, compact: CodexCompactSnapshot): void {
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      compact: {
        ...readCodexCompactSnapshot(runtimeSession.providerStateSnapshot),
        ...compact,
      },
    },
  })
}

function mergeCodexCompactSnapshot(
  runtimeSession: RuntimeSession,
  compact: Pick<CodexCompactSnapshot, 'threadId' | 'turnId'> & Partial<CodexCompactSnapshot>,
): void {
  const existing = readCodexCompactSnapshot(runtimeSession.providerStateSnapshot)
  const tokenUsage = existing?.tokenUsage ?? {
    total: createEmptyTokenUsageBreakdown(),
    last: createEmptyTokenUsageBreakdown(),
    modelContextWindow: null,
  }
  writeCodexCompactSnapshot(runtimeSession, {
    ...existing,
    threadId: compact.threadId,
    turnId: compact.turnId,
    tokenUsage,
    updatedAt: Date.now(),
    status: compact.status ?? existing?.status,
    compactionStartedAt: compact.compactionStartedAt ?? existing?.compactionStartedAt ?? null,
    lastCompactedAt: compact.lastCompactedAt ?? existing?.lastCompactedAt ?? null,
    compactionItemId: compact.compactionItemId ?? existing?.compactionItemId ?? null,
    completedCompactionItemIds: compact.completedCompactionItemIds ?? existing?.completedCompactionItemIds ?? [],
  })
}

function projectCodexCompactState(
  threadId: string,
  snapshot: CodexCompactSnapshot | null,
  configResponse: CodexConfigReadResponse | null,
): RuntimeCompactUiSlotState | null {
  if (!snapshot || snapshot.threadId !== threadId) {
    return null
  }

  const total = normalizeTokenUsageBreakdown(snapshot.tokenUsage.total)
  const last = normalizeTokenUsageBreakdown(snapshot.tokenUsage.last)
  const modelContextWindow = readPositiveNumber(snapshot.tokenUsage.modelContextWindow)
    ?? readConfigNumber(configResponse?.config?.model_context_window)
  const autoCompactTokenLimit = readConfigNumber(configResponse?.config?.model_auto_compact_token_limit)
  const usagePercent = modelContextWindow ? readPercent(total.totalTokens, modelContextWindow) : null
  const autoCompactPercent = autoCompactTokenLimit ? readPercent(total.totalTokens, autoCompactTokenLimit) : null
  const status = readCompactStatus({
    lifecycleStatus: snapshot.status ?? null,
    lastCompactedAt: snapshot.lastCompactedAt ?? null,
    usagePercent,
    autoCompactPercent,
  })

  return {
    kind: 'compact',
    slotId: 'codex:compact',
    threadId: snapshot.threadId,
    turnId: snapshot.turnId,
    status,
    isCompactRelevant: status !== 'idle' || last.totalTokens > 0,
    total,
    last,
    modelContextWindow,
    autoCompactTokenLimit,
    usagePercent,
    autoCompactPercent,
    lastCompactedAt: snapshot.lastCompactedAt ?? null,
    compactionItemId: snapshot.compactionItemId ?? null,
    updatedAt: snapshot.updatedAt,
  }
}

function projectCodexPlanSnapshot(
  runtimeSession: RuntimeSession,
  notification: CodexAppServerMessage,
  fallbackThreadId: string,
): void {
  if (notification.method !== 'turn/plan/updated') {
    return
  }
  const params = notification.params as TurnPlanUpdatedNotificationParams | undefined
  const steps = (params?.plan ?? [])
    .flatMap(step => typeof step.step === 'string' && isRuntimePlanStepStatus(step.status)
      ? [{ step: step.step, status: step.status }]
      : [])
  writeCodexPlanSnapshot(runtimeSession, {
    threadId: params?.threadId ?? fallbackThreadId,
    turnId: params?.turnId ?? null,
    explanation: typeof params?.explanation === 'string' ? params.explanation : null,
    steps,
    updatedAt: Date.now(),
  })
}

function writeCodexPlanSnapshot(runtimeSession: RuntimeSession, plan: CodexPlanSnapshot): void {
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      plan,
    },
  })
}

function projectCodexPlanState(
  threadId: string,
  snapshot: CodexProviderSnapshot,
): RuntimePlanUiSlotState | null {
  const plan = snapshot.codex?.plan
  if (!plan || plan.threadId !== threadId) {
    return null
  }
  const pendingCount = plan.steps.filter(step => step.status === 'pending').length
  const inProgressCount = plan.steps.filter(step => step.status === 'inProgress').length
  const completedCount = plan.steps.filter(step => step.status === 'completed').length
  return {
    kind: 'plan',
    slotId: 'codex:plan',
    threadId,
    turnId: plan.turnId,
    explanation: plan.explanation,
    steps: plan.steps,
    currentStep: plan.steps.find(step => step.status === 'inProgress')?.step
      ?? plan.steps.find(step => step.status === 'pending')?.step
      ?? null,
    pendingCount,
    inProgressCount,
    completedCount,
    updatedAt: plan.updatedAt,
  }
}

function projectCodexToolActivitySnapshot(
  runtimeSession: RuntimeSession,
  notification: CodexAppServerMessage,
  fallbackThreadId: string,
): void {
  if (notification.method !== 'item/started' && notification.method !== 'item/completed') {
    if (notification.method === 'item/plan/delta') {
      writeCodexToolActivityItem(runtimeSession, {
        threadId: (notification.params as { threadId?: string } | undefined)?.threadId ?? fallbackThreadId,
        turnId: (notification.params as { turnId?: string } | undefined)?.turnId ?? null,
        item: {
          id: (notification.params as { itemId?: string } | undefined)?.itemId ?? 'plan-delta',
          type: 'plan',
          text: 'Streaming plan',
        },
        status: 'running',
        startedAt: Date.now(),
        completedAt: null,
      })
    }
    return
  }
  const params = notification.params as ItemNotificationParams | undefined
  const item = params?.item
  if (!params || !item?.id || !item.type || !isToolActivityItem(item.type)) {
    return
  }
  writeCodexToolActivityItem(runtimeSession, {
    threadId: params.threadId ?? fallbackThreadId,
    turnId: params.turnId ?? null,
    item,
    status: notification.method === 'item/completed' ? readToolActivityCompletionStatus(item) : 'running',
    startedAt: notification.method === 'item/started' && typeof params.startedAtMs === 'number' ? params.startedAtMs : null,
    completedAt: notification.method === 'item/completed' && typeof params.completedAtMs === 'number' ? params.completedAtMs : null,
  })
}

function writeCodexToolActivityItem(
  runtimeSession: RuntimeSession,
  input: {
    threadId: string
    turnId: string | null
    item: CodexThreadItem
    status: RuntimeToolActivityStatus
    startedAt: number | null
    completedAt: number | null
  },
): void {
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  const existing = snapshot.codex?.toolActivity
  const existingItems = existing?.items ?? []
  const itemId = input.item.id ?? `${input.item.type ?? 'item'}-${Date.now()}`
  const current = existingItems.find(item => item.id === itemId)
  const nextItem = {
    id: itemId,
    type: input.item.type ?? 'unknown',
    label: readToolActivityLabel(input.item),
    status: input.status,
    startedAt: input.startedAt ?? current?.startedAt ?? null,
    completedAt: input.completedAt ?? current?.completedAt ?? null,
    ...(input.item.type === 'collabAgentToolCall'
      ? {
          senderThreadId: typeof input.item.senderThreadId === 'string' ? input.item.senderThreadId : current?.senderThreadId ?? null,
          receiverThreadIds: Array.isArray(input.item.receiverThreadIds) ? input.item.receiverThreadIds.filter(id => typeof id === 'string') : current?.receiverThreadIds ?? [],
          prompt: typeof input.item.prompt === 'string' ? input.item.prompt : current?.prompt ?? null,
          model: typeof input.item.model === 'string' ? input.item.model : current?.model ?? null,
          reasoningEffort: typeof input.item.reasoningEffort === 'string' ? input.item.reasoningEffort : current?.reasoningEffort ?? null,
          agentsStates: input.item.agentsStates ?? current?.agentsStates ?? {},
        }
      : {}),
  }
  const items = [
    nextItem,
    ...existingItems.filter(item => item.id !== itemId),
  ].slice(0, 12)
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      toolActivity: {
        threadId: input.threadId,
        turnId: input.turnId,
        items,
        updatedAt: Date.now(),
      },
    },
  })
}

function projectCodexToolActivityState(
  threadId: string,
  snapshot: CodexProviderSnapshot,
): RuntimeToolActivityUiSlotState | null {
  const activity = snapshot.codex?.toolActivity
  if (!activity || activity.threadId !== threadId || activity.items.length === 0) {
    return null
  }
  return {
    kind: 'toolActivity',
    slotId: 'codex:tool-activity',
    threadId,
    turnId: activity.turnId,
    activeCount: activity.items.filter(item => item.status === 'running').length,
    completedCount: activity.items.filter(item => item.status === 'completed').length,
    failedCount: activity.items.filter(item => item.status === 'failed').length,
    recentItems: activity.items,
    updatedAt: activity.updatedAt,
  }
}

function projectCodexMcpSnapshot(
  runtimeSession: RuntimeSession,
  notification: CodexAppServerMessage,
  fallbackThreadId: string,
): void {
  if (notification.method === 'mcpServer/startupStatus/updated') {
    const params = notification.params as McpServerStatusUpdatedNotificationParams | undefined
    if (!params?.name) {
      return
    }
    mergeCodexMcpServer(runtimeSession, fallbackThreadId, {
      name: params.name,
      status: normalizeMcpServerStatus(params.status),
      authStatus: 'unknown',
      toolCount: 0,
      resourceCount: 0,
      error: typeof params.error === 'string' ? params.error : null,
    })
    return
  }
  if (notification.method === 'mcpServer/oauthLogin/completed') {
    const params = notification.params as McpServerOauthLoginCompletedNotificationParams | undefined
    if (!params?.name) {
      return
    }
    mergeCodexMcpServer(runtimeSession, fallbackThreadId, {
      name: params.name,
      status: params.success === false ? 'failed' : 'ready',
      authStatus: params.success === false ? 'notLoggedIn' : 'oAuth',
      toolCount: 0,
      resourceCount: 0,
      error: typeof params.error === 'string' ? params.error : null,
    })
    return
  }
  if (notification.method === 'item/mcpToolCall/progress') {
    const params = notification.params as McpToolCallProgressNotificationParams | undefined
    mergeCodexMcpSnapshot(runtimeSession, {
      threadId: params?.threadId ?? fallbackThreadId,
      recentProgress: typeof params?.message === 'string' ? params.message : null,
    })
  }
}

function mergeCodexMcpServer(
  runtimeSession: RuntimeSession,
  threadId: string,
  server: CodexMcpServerSnapshot,
): void {
  const existing = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot).codex?.mcp
  mergeCodexMcpSnapshot(runtimeSession, {
    threadId,
    servers: [
      server,
      ...(existing?.servers ?? []).filter(candidate => candidate.name !== server.name),
    ],
  })
}

function mergeCodexMcpSnapshot(
  runtimeSession: RuntimeSession,
  patch: Partial<CodexMcpSnapshot> & { threadId: string },
): void {
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  const existing = snapshot.codex?.mcp
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      mcp: {
        threadId: patch.threadId,
        servers: patch.servers ?? existing?.servers ?? [],
        recentProgress: patch.recentProgress ?? existing?.recentProgress ?? null,
        updatedAt: Date.now(),
      },
    },
  })
}

function projectCodexMcpState(
  threadId: string,
  snapshot: CodexProviderSnapshot,
  mcpStatus: CodexListMcpServerStatusResponse | null,
): RuntimeMcpUiSlotState | null {
  const listedServers = projectMcpServersFromList(mcpStatus)
  const snapshotMcp = snapshot.codex?.mcp
  const serverMap = new Map<string, CodexMcpServerSnapshot>()
  for (const server of snapshotMcp?.servers ?? []) {
    serverMap.set(server.name, server)
  }
  for (const server of listedServers) {
    serverMap.set(server.name, mergeMcpListedServer(serverMap.get(server.name), server))
  }
  const servers = [...serverMap.values()]
  if (servers.length === 0 && !snapshotMcp?.recentProgress) {
    return null
  }
  return {
    kind: 'mcp',
    slotId: 'codex:mcp',
    threadId,
    serverCount: servers.length,
    readyCount: servers.filter(server => server.status === 'ready').length,
    failedCount: servers.filter(server => server.status === 'failed').length,
    needsLoginCount: servers.filter(server => server.authStatus === 'notLoggedIn').length,
    recentProgress: snapshotMcp?.recentProgress ?? null,
    servers,
    updatedAt: Math.max(snapshotMcp?.updatedAt ?? 0, listedServers.length > 0 ? Date.now() : 0),
  }
}

function projectCodexDiffSnapshot(
  runtimeSession: RuntimeSession,
  notification: CodexAppServerMessage,
  fallbackThreadId: string,
): void {
  if (notification.method === 'turn/diff/updated') {
    const params = notification.params as TurnDiffUpdatedNotificationParams | undefined
    writeCodexDiffSnapshot(runtimeSession, {
      threadId: params?.threadId ?? fallbackThreadId,
      turnId: params?.turnId ?? null,
      files: summarizeUnifiedDiff(params?.diff ?? ''),
      updatedAt: Date.now(),
    })
    return
  }

  if (notification.method === 'item/fileChange/patchUpdated') {
    const params = notification.params as FileChangePatchUpdatedNotificationParams | undefined
    const files = (params?.changes ?? [])
      .flatMap(change => typeof change.path === 'string'
        ? [{ path: change.path, ...countDiffLines(change.diff ?? '') }]
        : [])
    writeCodexDiffSnapshot(runtimeSession, {
      threadId: params?.threadId ?? fallbackThreadId,
      turnId: params?.turnId ?? null,
      files,
      updatedAt: Date.now(),
    })
  }
}

function writeCodexDiffSnapshot(runtimeSession: RuntimeSession, diff: CodexDiffSnapshot): void {
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      diff,
    },
  })
}

function projectCodexDiffState(
  threadId: string,
  snapshot: CodexProviderSnapshot,
): RuntimeDiffUiSlotState | null {
  const diff = snapshot.codex?.diff
  if (!diff || diff.threadId !== threadId || diff.files.length === 0) {
    return null
  }
  return {
    kind: 'diff',
    slotId: 'codex:diff',
    threadId,
    turnId: diff.turnId,
    fileCount: diff.files.length,
    addedLines: diff.files.reduce((count, file) => count + file.addedLines, 0),
    removedLines: diff.files.reduce((count, file) => count + file.removedLines, 0),
    hasDiff: diff.files.some(file => file.addedLines > 0 || file.removedLines > 0),
    updatedAt: diff.updatedAt,
  }
}

function projectCodexTerminalSnapshot(
  runtimeSession: RuntimeSession,
  notification: CodexAppServerMessage,
  fallbackThreadId: string,
): void {
  if (notification.method === 'item/started' || notification.method === 'item/completed') {
    const params = notification.params as ItemNotificationParams | undefined
    if (params?.item?.type !== 'commandExecution' || !params.item.id) {
      return
    }
    writeCodexTerminalCommand(runtimeSession, {
      threadId: params.threadId ?? fallbackThreadId,
      turnId: params.turnId ?? null,
      id: params.item.id,
      command: params.item.command ?? null,
      status: notification.method === 'item/completed' ? readToolActivityCompletionStatus(params.item) : 'running',
      outputPreview: null,
    })
    return
  }

  if (notification.method === 'item/commandExecution/outputDelta') {
    const params = notification.params as CommandExecutionOutputDeltaNotificationParams | undefined
    if (!params?.itemId || typeof params.delta !== 'string') {
      return
    }
    writeCodexTerminalCommand(runtimeSession, {
      threadId: params.threadId ?? fallbackThreadId,
      turnId: params.turnId ?? null,
      id: params.itemId,
      command: null,
      status: 'running',
      outputPreview: params.delta,
    })
    return
  }

  if (notification.method === 'item/commandExecution/terminalInteraction') {
    const params = notification.params as TerminalInteractionNotificationParams | undefined
    if (!params?.itemId || typeof params.stdin !== 'string') {
      return
    }
    writeCodexTerminalCommand(runtimeSession, {
      threadId: params.threadId ?? fallbackThreadId,
      turnId: params.turnId ?? null,
      id: params.itemId,
      command: null,
      status: 'running',
      outputPreview: params.stdin,
    })
    return
  }

  if (notification.method === 'process/outputDelta') {
    const params = notification.params as ProcessOutputDeltaNotificationParams | undefined
    if (!params?.processHandle || typeof params.deltaBase64 !== 'string') {
      return
    }
    writeCodexTerminalCommand(runtimeSession, {
      threadId: fallbackThreadId,
      turnId: null,
      id: params.processHandle,
      command: null,
      status: 'running',
      outputPreview: decodeBase64Preview(params.deltaBase64),
    })
    return
  }

  if (notification.method === 'process/exited') {
    const params = notification.params as ProcessExitedNotificationParams | undefined
    if (!params?.processHandle) {
      return
    }
    writeCodexTerminalCommand(runtimeSession, {
      threadId: fallbackThreadId,
      turnId: null,
      id: params.processHandle,
      command: null,
      status: params.exitCode === 0 ? 'completed' : 'failed',
      outputPreview: [params.stdout, params.stderr].filter(value => typeof value === 'string' && value.length > 0).join('\n') || null,
    })
  }
}

function writeCodexTerminalCommand(
  runtimeSession: RuntimeSession,
  input: {
    threadId: string
    turnId: string | null
    id: string
    command: string | null
    status: RuntimeToolActivityStatus
    outputPreview: string | null
  },
): void {
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  const existing = snapshot.codex?.terminal
  const existingCommands = existing?.commands ?? []
  const current = existingCommands.find(command => command.id === input.id)
  const nextCommand = {
    id: input.id,
    command: input.command ?? current?.command ?? null,
    status: input.status,
    outputPreview: trimPreview([current?.outputPreview, input.outputPreview].filter(Boolean).join('')),
    updatedAt: Date.now(),
  }
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      terminal: {
        threadId: input.threadId,
        turnId: input.turnId,
        commands: [
          nextCommand,
          ...existingCommands.filter(command => command.id !== input.id),
        ].slice(0, 8),
        updatedAt: Date.now(),
      },
    },
  })
}

function projectCodexTerminalState(
  threadId: string,
  snapshot: CodexProviderSnapshot,
): RuntimeTerminalUiSlotState | null {
  const terminal = snapshot.codex?.terminal
  if (!terminal || terminal.threadId !== threadId || terminal.commands.length === 0) {
    return null
  }
  const lastCommand = terminal.commands[0]
  return {
    kind: 'terminal',
    slotId: 'codex:terminal',
    threadId,
    turnId: terminal.turnId,
    activeCount: terminal.commands.filter(command => command.status === 'running').length,
    completedCount: terminal.commands.filter(command => command.status === 'completed').length,
    failedCount: terminal.commands.filter(command => command.status === 'failed').length,
    lastCommand: lastCommand?.command ?? null,
    lastOutputPreview: lastCommand?.outputPreview ?? null,
    updatedAt: terminal.updatedAt,
  }
}

function projectCodexApprovalsSnapshot(
  runtimeSession: RuntimeSession,
  notification: CodexAppServerMessage,
  fallbackThreadId: string,
): void {
  if (notification.method === 'item/autoApprovalReview/started' || notification.method === 'item/autoApprovalReview/completed') {
    const params = notification.params as GuardianApprovalReviewNotificationParams | undefined
    if (!params?.reviewId) {
      return
    }
    writeCodexApprovalItem(runtimeSession, {
      threadId: params.threadId ?? fallbackThreadId,
      turnId: params.turnId ?? null,
      item: {
        id: params.reviewId,
        targetItemId: params.targetItemId ?? null,
        status: normalizeApprovalStatus(params.review?.status) ?? (notification.method === 'item/autoApprovalReview/completed' ? 'approved' : 'pending'),
        label: readApprovalActionLabel(params.action),
        riskLevel: typeof params.review?.riskLevel === 'string' ? params.review.riskLevel : null,
        rationale: typeof params.review?.rationale === 'string' ? params.review.rationale : null,
        startedAt: typeof params.startedAtMs === 'number' ? params.startedAtMs : null,
        completedAt: typeof params.completedAtMs === 'number' ? params.completedAtMs : null,
      },
    })
    return
  }

  if (notification.method === 'serverRequest/resolved') {
    const params = notification.params as ServerRequestResolvedNotificationParams | undefined
    if (!params?.requestId) {
      return
    }
    updateResolvedApproval(runtimeSession, params.requestId)
  }
}

function writeCodexApprovalItem(
  runtimeSession: RuntimeSession,
  input: {
    threadId: string
    turnId: string | null
    item: CodexApprovalsSnapshot['items'][number]
  },
): void {
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  const existing = snapshot.codex?.approvals
  const existingItems = existing?.items ?? []
  const current = existingItems.find(item => item.id === input.item.id)
  const nextItem = {
    ...input.item,
    startedAt: input.item.startedAt ?? current?.startedAt ?? null,
    completedAt: input.item.completedAt ?? current?.completedAt ?? null,
  }
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      approvals: {
        threadId: input.threadId,
        turnId: input.turnId,
        items: [
          nextItem,
          ...existingItems.filter(item => item.id !== input.item.id),
        ].slice(0, 12),
        updatedAt: Date.now(),
      },
    },
  })
}

function updateResolvedApproval(runtimeSession: RuntimeSession, requestId: string): void {
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  const approvals = snapshot.codex?.approvals
  if (!approvals) {
    return
  }
  const items = approvals.items.map(item => item.id === requestId && item.status === 'pending'
    ? { ...item, status: 'approved' as const, completedAt: Date.now() }
    : item)
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      approvals: {
        ...approvals,
        items,
        updatedAt: Date.now(),
      },
    },
  })
}

function projectCodexApprovalsState(
  threadId: string,
  snapshot: CodexProviderSnapshot,
): RuntimeApprovalsUiSlotState | null {
  const approvals = snapshot.codex?.approvals
  if (!approvals || approvals.threadId !== threadId || approvals.items.length === 0) {
    return null
  }
  return {
    kind: 'approvals',
    slotId: 'codex:approvals',
    threadId,
    turnId: approvals.turnId,
    pendingCount: approvals.items.filter(item => item.status === 'pending').length,
    approvedCount: approvals.items.filter(item => item.status === 'approved').length,
    deniedCount: approvals.items.filter(item => item.status === 'denied').length,
    recentItems: approvals.items,
    updatedAt: approvals.updatedAt,
  }
}

function projectCodexAlertSnapshot(
  runtimeSession: RuntimeSession,
  notification: CodexAppServerMessage,
  fallbackThreadId: string,
): void {
  if (notification.method !== 'warning'
    && notification.method !== 'guardianWarning'
    && notification.method !== 'configWarning'
    && notification.method !== 'deprecationNotice'
    && notification.method !== 'error') {
    return
  }
  if (notification.method === 'error' && isRetryableCodexAppServerError(notification)) {
    return
  }
  const params = notification.params as WarningNotificationParams | ErrorNotificationParams | undefined
  const message = readAlertMessage(notification.method, params)
  if (!message) {
    return
  }
  writeCodexAlertItem(runtimeSession, {
    threadId: readAlertThreadId(notification.method, params, fallbackThreadId),
    item: {
      id: `${notification.method}:${Date.now()}`,
      severity: notification.method === 'error' ? 'error' : 'warning',
      message,
      source: notification.method,
      updatedAt: Date.now(),
    },
  })
}

function writeCodexAlertItem(
  runtimeSession: RuntimeSession,
  input: {
    threadId: string | null
    item: CodexAlertSnapshot['items'][number]
  },
): void {
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  const existing = snapshot.codex?.alert
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      alert: {
        threadId: input.threadId,
        items: [
          input.item,
          ...(existing?.items ?? []),
        ].slice(0, 8),
        updatedAt: Date.now(),
      },
    },
  })
}

function projectCodexAlertState(
  threadId: string,
  snapshot: CodexProviderSnapshot,
): RuntimeAlertUiSlotState | null {
  const alert = snapshot.codex?.alert
  if (!alert || (alert.threadId !== null && alert.threadId !== threadId) || alert.items.length === 0) {
    return null
  }
  return {
    kind: 'alert',
    slotId: 'codex:alerts',
    threadId: alert.threadId,
    warningCount: alert.items.filter(item => item.severity === 'warning').length,
    errorCount: alert.items.filter(item => item.severity === 'error').length,
    recentItems: alert.items,
    updatedAt: alert.updatedAt,
  }
}

function projectCodexFilesystemSnapshot(
  runtimeSession: RuntimeSession,
  notification: CodexAppServerMessage,
  fallbackThreadId: string,
): void {
  if (notification.method !== 'fs/changed') {
    return
  }
  const params = notification.params as FsChangedNotificationParams | undefined
  const changedPaths = (params?.changedPaths ?? []).filter(path => typeof path === 'string')
  if (changedPaths.length === 0) {
    return
  }
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  const existing = snapshot.codex?.filesystem
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      filesystem: {
        threadId: existing?.threadId ?? fallbackThreadId,
        recentPaths: [...changedPaths, ...(existing?.recentPaths ?? [])].filter((path, index, paths) => paths.indexOf(path) === index).slice(0, 12),
        updatedAt: Date.now(),
      },
    },
  })
}

function projectCodexFilesystemState(
  threadId: string,
  snapshot: CodexProviderSnapshot,
): RuntimeFilesystemUiSlotState | null {
  const filesystem = snapshot.codex?.filesystem
  if (!filesystem || filesystem.threadId !== threadId || filesystem.recentPaths.length === 0) {
    return null
  }
  return {
    kind: 'filesystem',
    slotId: 'codex:filesystem',
    threadId,
    changedPathCount: filesystem.recentPaths.length,
    recentPaths: filesystem.recentPaths,
    updatedAt: filesystem.updatedAt,
  }
}

function projectCodexSkillsState(
  threadId: string,
  response: CodexSkillsListResponse | null,
): RuntimeSkillsUiSlotState | null {
  const entries = response?.data ?? []
  if (entries.length === 0) {
    return null
  }
  const skills = entries.flatMap(entry => entry.skills ?? [])
  return {
    kind: 'skills',
    slotId: 'codex:skills',
    threadId,
    enabledCount: skills.filter(skill => skill.enabled !== false).length,
    disabledCount: skills.filter(skill => skill.enabled === false).length,
    errorCount: entries.reduce((count, entry) => count + (entry.errors?.length ?? 0), 0),
    roots: entries.flatMap(entry => typeof entry.cwd === 'string' ? [entry.cwd] : []),
    updatedAt: Date.now(),
  }
}

function projectCodexPluginState(
  threadId: string,
  pluginsResponse: CodexPluginListResponse | null,
  appsResponse: CodexAppsListResponse | null,
): RuntimePluginUiSlotState | null {
  const marketplaces = pluginsResponse?.marketplaces ?? []
  const plugins = marketplaces.flatMap(marketplace => marketplace.plugins ?? [])
  const apps = appsResponse?.data ?? []
  if (marketplaces.length === 0 && apps.length === 0) {
    return null
  }
  return {
    kind: 'plugin',
    slotId: 'codex:plugin',
    threadId,
    installedCount: plugins.filter(plugin => plugin.installed === true).length,
    enabledCount: plugins.filter(plugin => plugin.enabled === true).length,
    appCount: apps.filter(app => app.isAccessible !== false && app.isEnabled !== false).length,
    marketplaceCount: marketplaces.length,
    errorCount: pluginsResponse?.marketplaceLoadErrors?.length ?? 0,
    updatedAt: Date.now(),
  }
}

function projectCodexSearchSnapshot(
  runtimeSession: RuntimeSession,
  notification: CodexAppServerMessage,
  fallbackThreadId: string,
): void {
  if (notification.method !== 'fuzzyFileSearch/sessionUpdated' && notification.method !== 'fuzzyFileSearch/sessionCompleted') {
    return
  }
  const params = notification.params as FuzzyFileSearchSessionNotificationParams | undefined
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  const existing = snapshot.codex?.search
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      search: {
        threadId: params?.threadId ?? existing?.threadId ?? fallbackThreadId,
        recentResultCount: readNonNegativeNumber(params?.resultCount ?? params?.results?.length ?? existing?.recentResultCount),
        recentQuery: typeof params?.query === 'string' ? params.query : existing?.recentQuery ?? null,
        fuzzySessionActive: notification.method === 'fuzzyFileSearch/sessionUpdated',
        updatedAt: Date.now(),
      },
    },
  })
}

function projectCodexSearchState(
  threadId: string,
  snapshot: CodexProviderSnapshot,
): RuntimeSearchUiSlotState | null {
  const search = snapshot.codex?.search
  if (!search || search.threadId !== threadId) {
    return null
  }
  return {
    kind: 'search',
    slotId: 'codex:search',
    threadId,
    recentResultCount: search.recentResultCount,
    recentQuery: search.recentQuery,
    fuzzySessionActive: search.fuzzySessionActive,
    updatedAt: search.updatedAt,
  }
}

async function readCodexCrewState(
  client: CodexAppServerClientLike,
  parentThreadId: string,
  snapshot: CodexProviderSnapshot,
  collaborationModes: CodexCollaborationModeListResponse | null,
): Promise<RuntimeCrewUiSlotState | null> {
  try {
    const turns = await listRecentCodexCrewTurns(client, parentThreadId)
    const calls = mergeCodexCrewCalls(
      projectCodexCrewCallsFromTurns(parentThreadId, turns),
      projectCodexCrewCallsFromSnapshot(snapshot),
    )
    const threadMetadata = await readCrewThreadMetadata(client, readCrewReceiverThreadIdsFromCalls(parentThreadId, calls))
    return projectCodexCrewStateFromCalls(parentThreadId, calls, collaborationModes, threadMetadata)
  }
  catch {
    const threadMetadata = await readCrewThreadMetadata(client, readCrewReceiverThreadIdsFromSnapshot(parentThreadId, snapshot))
    return projectCodexCrewStateFromSnapshot(parentThreadId, snapshot, collaborationModes, threadMetadata)
  }
}

async function listRecentCodexCrewTurns(
  client: CodexAppServerClientLike,
  threadId: string,
): Promise<Turn[]> {
  const response = await client.request('thread/turns/list', {
    threadId,
    limit: CODEX_CREW_TURNS_LIST_LIMIT,
    sortDirection: 'desc',
    itemsView: 'full',
  }) as ThreadTurnsListResponse
  return Array.isArray(response.data) ? response.data : []
}

async function readCrewThreadMetadata(
  client: CodexAppServerClientLike,
  threadIds: string[],
): Promise<Map<string, CodexThreadMetadata>> {
  if (threadIds.length === 0) {
    return new Map()
  }

  const results = await Promise.allSettled(threadIds.map(async (threadId) => {
    const response = await client.request('thread/read', {
      threadId,
      includeTurns: false,
    }) as ThreadReadResponse
    return readCodexThreadMetadata(threadId, response)
  }))

  const metadata = new Map<string, CodexThreadMetadata>()
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      metadata.set(result.value.id, result.value)
    }
  }
  return metadata
}

function readCrewReceiverThreadIdsFromSnapshot(parentThreadId: string, snapshot: CodexProviderSnapshot): string[] {
  const ids = new Set<string>()
  for (const item of snapshot.codex?.toolActivity?.items ?? []) {
    if (item.type !== 'collabAgentToolCall') {
      continue
    }
    for (const threadId of item.receiverThreadIds ?? []) {
      if (threadId && threadId !== parentThreadId) {
        ids.add(threadId)
      }
    }
    for (const threadId of Object.keys(item.agentsStates ?? {})) {
      if (threadId && threadId !== parentThreadId) {
        ids.add(threadId)
      }
    }
  }
  return Array.from(ids).slice(0, 12)
}

function readCrewReceiverThreadIdsFromCalls(parentThreadId: string, calls: RuntimeCrewCallItem[]): string[] {
  const ids = new Set<string>()
  for (const call of calls) {
    for (const threadId of call.receiverThreadIds) {
      if (threadId && threadId !== parentThreadId) {
        ids.add(threadId)
      }
    }
    for (const agent of call.agents) {
      if (agent.threadId && agent.threadId !== parentThreadId) {
        ids.add(agent.threadId)
      }
    }
  }
  return Array.from(ids).slice(0, 24)
}

function readCodexThreadMetadata(fallbackThreadId: string, response: ThreadReadResponse): CodexThreadMetadata | null {
  const thread = response.thread as Partial<ThreadReadResponse['thread']> | undefined
  if (!thread) {
    return null
  }
  const id = typeof thread.id === 'string' ? thread.id : fallbackThreadId
  return {
    id,
    name: typeof thread.name === 'string' ? thread.name : null,
    preview: typeof thread.preview === 'string' ? thread.preview : null,
    modelProvider: typeof thread.modelProvider === 'string' ? thread.modelProvider : null,
    agentNickname: typeof thread.agentNickname === 'string' ? thread.agentNickname : null,
    agentRole: typeof thread.agentRole === 'string' ? thread.agentRole : null,
  }
}

function projectCodexCrewCallsFromTurns(parentThreadId: string, turns: Turn[]): RuntimeCrewCallItem[] {
  const calls: RuntimeCrewCallItem[] = []
  for (const turn of turns) {
    for (const item of turn.items ?? []) {
      if (item.type !== 'collabAgentToolCall') {
        continue
      }
      if (item.senderThreadId && item.senderThreadId !== parentThreadId) {
        continue
      }
      const receiverThreadIds = Array.isArray(item.receiverThreadIds)
        ? item.receiverThreadIds.filter(threadId => typeof threadId === 'string')
        : []
      const agentsStates = item.agentsStates ?? {}
      calls.push({
        id: item.id,
        tool: item.tool ?? 'Agent',
        status: normalizeCollabToolCallStatus(item.status),
        senderThreadId: item.senderThreadId ?? null,
        receiverThreadIds,
        prompt: typeof item.prompt === 'string' ? item.prompt : null,
        model: typeof item.model === 'string' ? item.model : null,
        reasoningEffort: typeof item.reasoningEffort === 'string' ? item.reasoningEffort : null,
        agents: readCrewAgents(receiverThreadIds, agentsStates, new Map()),
        startedAt: typeof turn.startedAt === 'number' ? turn.startedAt * 1000 : null,
        completedAt: typeof turn.completedAt === 'number' ? turn.completedAt * 1000 : null,
      })
    }
  }
  return calls.slice(0, 24)
}

function projectCodexCrewStateFromSnapshot(
  threadId: string,
  snapshot: CodexProviderSnapshot,
  collaborationModes: CodexCollaborationModeListResponse | null,
  threadMetadata: Map<string, CodexThreadMetadata>,
): RuntimeCrewUiSlotState | null {
  const activity = snapshot.codex?.toolActivity
  const calls = projectCodexCrewCallsFromSnapshot(snapshot)
  const recentItems = (activity?.items ?? []).filter(item => item.type === 'collabAgentToolCall')
  return projectCodexCrewStateFromCalls(threadId, calls, collaborationModes, threadMetadata, activity?.updatedAt ?? 0, recentItems)
}

function projectCodexCrewCallsFromSnapshot(snapshot: CodexProviderSnapshot): RuntimeCrewCallItem[] {
  return (snapshot.codex?.toolActivity?.items ?? []).filter(item => item.type === 'collabAgentToolCall').map(item => ({
    id: item.id,
    tool: item.label,
    status: item.status,
    senderThreadId: item.senderThreadId ?? null,
    receiverThreadIds: item.receiverThreadIds ?? [],
    prompt: item.prompt ?? null,
    model: item.model ?? null,
    reasoningEffort: item.reasoningEffort ?? null,
    agents: readCrewAgents(item.receiverThreadIds ?? [], item.agentsStates ?? {}, new Map()),
    startedAt: item.startedAt,
    completedAt: item.completedAt,
  }))
}

function mergeCodexCrewCalls(primaryCalls: RuntimeCrewCallItem[], fallbackCalls: RuntimeCrewCallItem[]): RuntimeCrewCallItem[] {
  const seen = new Set<string>()
  const calls: RuntimeCrewCallItem[] = []
  for (const call of [...primaryCalls, ...fallbackCalls]) {
    if (seen.has(call.id)) {
      continue
    }
    seen.add(call.id)
    calls.push(call)
  }
  return calls.slice(0, 24)
}

function projectCodexCrewStateFromCalls(
  threadId: string,
  calls: RuntimeCrewCallItem[],
  collaborationModes: CodexCollaborationModeListResponse | null,
  threadMetadata: Map<string, CodexThreadMetadata>,
  fallbackUpdatedAt = 0,
  recentItems = calls.map(call => ({
    id: call.id,
    type: 'collabAgentToolCall',
    label: call.tool,
    status: call.status,
    startedAt: call.startedAt,
    completedAt: call.completedAt,
  })),
): RuntimeCrewUiSlotState | null {
  const modes = projectCodexCrewCollaborationModes(collaborationModes)
  const hydratedCalls = calls.map(call => ({
    ...call,
    agents: readCrewAgents(call.receiverThreadIds, Object.fromEntries(
      call.agents.map(agent => [agent.threadId, { status: agent.status, message: agent.message }]),
    ), threadMetadata),
  }))
  if (calls.length === 0 && modes.length === 0) {
    return null
  }
  const agents = hydratedCalls.flatMap(call => call.agents)
  return {
    kind: 'crew',
    slotId: 'codex:crew',
    threadId,
    activeCount: agents.filter(agent => isActiveCrewAgentStatus(agent.status)).length,
    completedCount: agents.filter(agent => isCompletedCrewAgentStatus(agent.status)).length,
    failedCount: agents.filter(agent => isFailedCrewAgentStatus(agent.status)).length,
    recentItems: recentItems.slice(0, 12),
    collaborationModeCount: modes.length,
    collaborationModes: modes,
    calls: hydratedCalls,
    updatedAt: Math.max(fallbackUpdatedAt, modes.length > 0 || calls.length > 0 ? Date.now() : 0),
  }
}

function projectCodexCrewCollaborationModes(
  collaborationModes: CodexCollaborationModeListResponse | null,
): RuntimeCrewUiSlotState['collaborationModes'] {
  return (collaborationModes?.data ?? []).flatMap((mode) => {
    const name = mode.name ?? mode.id
    if (!name) {
      return []
    }
    return [{
      name,
      mode: mode.mode ?? null,
      model: mode.model ?? null,
      reasoningEffort: mode.reasoning_effort ?? null,
    }]
  })
}

function normalizeCollabToolCallStatus(status: unknown): RuntimeToolActivityStatus {
  if (status === 'failed') {
    return 'failed'
  }
  if (status === 'completed') {
    return 'completed'
  }
  return 'running'
}

function isActiveCrewAgentStatus(status: string | null): boolean {
  return status === 'pendingInit' || status === 'running'
}

function isCompletedCrewAgentStatus(status: string | null): boolean {
  return status === 'completed' || status === 'shutdown'
}

function isFailedCrewAgentStatus(status: string | null): boolean {
  return status === 'errored' || status === 'interrupted' || status === 'notFound'
}

function readCrewAgents(
  receiverThreadIds: string[],
  agentsStates: Record<string, { status?: string | null, message?: string | null } | undefined>,
  threadMetadata: Map<string, CodexThreadMetadata>,
): RuntimeCrewAgentItem[] {
  const ids = new Set([
    ...receiverThreadIds,
    ...Object.keys(agentsStates),
  ])
  return Array.from(ids, (threadId) => {
    const metadata = threadMetadata.get(threadId)
    return {
      threadId,
      status: agentsStates[threadId]?.status ?? null,
      message: agentsStates[threadId]?.message ?? null,
      name: metadata?.name ?? null,
      preview: metadata?.preview ?? null,
      modelProvider: metadata?.modelProvider ?? null,
      agentNickname: metadata?.agentNickname ?? null,
      agentRole: metadata?.agentRole ?? null,
    }
  })
}

function projectCodexUsageSnapshot(
  runtimeSession: RuntimeSession,
  notification: CodexAppServerMessage,
  fallbackThreadId: string,
): void {
  if (notification.method !== 'account/rateLimits/updated') {
    return
  }
  const params = notification.params as AccountRateLimitsUpdatedNotificationParams | undefined
  if (!params?.rateLimits) {
    return
  }
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      usage: {
        threadId: fallbackThreadId,
        rateLimits: params.rateLimits,
        updatedAt: Date.now(),
      },
    },
  })
}

function projectCodexUsageState(
  threadId: string,
  snapshot: CodexProviderSnapshot,
  response: CodexRateLimitsResponse | null,
): RuntimeUsageUiSlotState | null {
  const rateLimits = response?.rateLimits ?? snapshot.codex?.usage?.rateLimits ?? null
  if (!rateLimits) {
    return null
  }
  return {
    kind: 'usage',
    slotId: 'codex:usage',
    threadId,
    limitName: typeof rateLimits.limitName === 'string' ? rateLimits.limitName : null,
    usedPercent: readNullablePercent(rateLimits.primary?.usedPercent),
    primaryWindowDurationMins: readNullableNumber(rateLimits.primary?.windowDurationMins),
    primaryResetsAt: readNullableNumber(rateLimits.primary?.resetsAt),
    secondaryUsedPercent: readNullablePercent(rateLimits.secondary?.usedPercent),
    secondaryWindowDurationMins: readNullableNumber(rateLimits.secondary?.windowDurationMins),
    secondaryResetsAt: readNullableNumber(rateLimits.secondary?.resetsAt),
    creditsBalance: typeof rateLimits.credits?.balance === 'string' ? rateLimits.credits.balance : null,
    hasCredits: typeof rateLimits.credits?.hasCredits === 'boolean' ? rateLimits.credits.hasCredits : null,
    rateLimitReachedType: typeof rateLimits.rateLimitReachedType === 'string' ? rateLimits.rateLimitReachedType : null,
    planType: typeof rateLimits.planType === 'string' ? rateLimits.planType : null,
    updatedAt: snapshot.codex?.usage?.updatedAt ?? Date.now(),
  }
}

function projectCodexConfigState(
  threadId: string,
  configResponse: CodexConfigReadResponse | null,
  requirementsResponse: CodexConfigRequirementsReadResponse | null,
): RuntimeConfigUiSlotState | null {
  const config = configResponse?.config
  const requirements = requirementsResponse?.requirements
  if (!config && !requirements) {
    return null
  }
  return {
    kind: 'config',
    slotId: 'codex:config',
    threadId,
    modelId: config?.model ?? null,
    approvalPolicy: config?.approval_policy ?? null,
    sandboxMode: config?.sandbox_mode ?? null,
    allowedApprovalPolicyCount: Array.isArray(requirements?.allowedApprovalPolicies) ? requirements.allowedApprovalPolicies.length : null,
    allowedSandboxModeCount: Array.isArray(requirements?.allowedSandboxModes) ? requirements.allowedSandboxModes.length : null,
    featureRequirementCount: requirements?.featureRequirements ? Object.keys(requirements.featureRequirements).length : null,
    webSearchModeCount: Array.isArray(requirements?.allowedWebSearchModes) ? requirements.allowedWebSearchModes.length : null,
    updatedAt: Date.now(),
  }
}

function mergeMcpListedServer(
  existing: CodexMcpServerSnapshot | undefined,
  listed: CodexMcpServerSnapshot,
): CodexMcpServerSnapshot {
  if (!existing) {
    return listed
  }
  return {
    ...listed,
    status: existing.status !== 'unknown' ? existing.status : listed.status,
    authStatus: existing.authStatus !== 'unknown' ? existing.authStatus : listed.authStatus,
    error: existing.error ?? listed.error,
  }
}

function readCompactStatus(input: {
  lifecycleStatus: RuntimeCompactUiSlotState['status'] | null
  lastCompactedAt: number | null
  usagePercent: number | null
  autoCompactPercent: number | null
}): RuntimeCompactUiSlotState['status'] {
  if (input.lifecycleStatus === 'running') {
    return 'running'
  }
  if (input.lifecycleStatus === 'compacted') {
    return 'compacted'
  }
  if (input.lastCompactedAt) {
    return 'compacted'
  }
  const percent = input.autoCompactPercent ?? input.usagePercent
  if (percent === null) {
    return 'idle'
  }
  if (percent >= 100) {
    return 'overLimit'
  }
  if (percent >= 80) {
    return 'nearLimit'
  }
  return 'idle'
}

function summarizeUnifiedDiff(diff: string): CodexDiffSnapshot['files'] {
  const fileMap = new Map<string, { path: string, addedLines: number, removedLines: number }>()
  let currentPath: string | null = null
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/)
      currentPath = match?.[2] ?? null
      if (currentPath && !fileMap.has(currentPath)) {
        fileMap.set(currentPath, { path: currentPath, addedLines: 0, removedLines: 0 })
      }
      continue
    }
    if (line.startsWith('+++ b/')) {
      currentPath = line.slice('+++ b/'.length)
      if (!fileMap.has(currentPath)) {
        fileMap.set(currentPath, { path: currentPath, addedLines: 0, removedLines: 0 })
      }
      continue
    }
    if (!currentPath || line.startsWith('+++') || line.startsWith('---')) {
      continue
    }
    const file = fileMap.get(currentPath)
    if (!file) {
      continue
    }
    if (line.startsWith('+')) {
      file.addedLines += 1
    }
    else if (line.startsWith('-')) {
      file.removedLines += 1
    }
  }
  return [...fileMap.values()]
}

function countDiffLines(diff: string): { addedLines: number, removedLines: number } {
  return diff.split('\n').reduce((counts, line) => {
    if (line.startsWith('+++') || line.startsWith('---')) {
      return counts
    }
    if (line.startsWith('+')) {
      counts.addedLines += 1
    }
    else if (line.startsWith('-')) {
      counts.removedLines += 1
    }
    return counts
  }, { addedLines: 0, removedLines: 0 })
}

function trimPreview(value: string | null): string | null {
  if (!value) {
    return null
  }
  const normalized = value.replace(/\s+$/g, '')
  return normalized.length > 240 ? normalized.slice(-240) : normalized
}

function decodeBase64Preview(value: string): string | null {
  try {
    return Buffer.from(value, 'base64').toString('utf-8')
  }
  catch {
    return null
  }
}

function normalizeApprovalStatus(value: unknown): RuntimeApprovalStatus | null {
  switch (value) {
    case 'inProgress':
      return 'pending'
    case 'approved':
    case 'denied':
    case 'timedOut':
    case 'aborted':
      return value
    default:
      return null
  }
}

function readApprovalActionLabel(action: GuardianApprovalReviewNotificationParams['action']): string {
  if (typeof action === 'string') {
    return formatRuntimePhrase(action)
  }
  switch (action?.type) {
    case 'command':
      return 'Command'
    case 'execve':
      return 'Process'
    case 'applyPatch':
      return 'File change'
    case 'networkAccess':
      return 'Network'
    case 'mcpToolCall':
      return 'MCP tool'
    case 'requestPermissions':
      return 'Permissions'
    default:
      return 'Approval'
  }
}

function readAlertMessage(method: string, params: WarningNotificationParams | ErrorNotificationParams | undefined): string | null {
  if (method === 'configWarning') {
    const warning = params as WarningNotificationParams | undefined
    return [warning?.summary, warning?.details].filter(Boolean).join(': ') || null
  }
  if (method === 'error') {
    const error = params as ErrorNotificationParams | undefined
    return error?.message ?? error?.error?.message ?? null
  }
  const warning = params as WarningNotificationParams | undefined
  return warning?.message ?? warning?.summary ?? null
}

function readAlertThreadId(
  method: string,
  params: WarningNotificationParams | ErrorNotificationParams | undefined,
  fallbackThreadId: string,
): string | null {
  if (method === 'configWarning' || method === 'deprecationNotice') {
    return null
  }
  const warning = params as WarningNotificationParams | undefined
  return warning?.threadId ?? fallbackThreadId
}

function isRuntimePlanStepStatus(value: unknown): value is RuntimePlanStepStatus {
  return value === 'pending' || value === 'inProgress' || value === 'completed'
}

function isToolActivityItem(type: string): boolean {
  return type === 'plan'
    || type === 'commandExecution'
    || type === 'fileChange'
    || type === 'mcpToolCall'
    || type === 'dynamicToolCall'
    || type === 'collabAgentToolCall'
    || type === 'webSearch'
    || type === 'imageGeneration'
    || type === 'contextCompaction'
}

function readToolActivityCompletionStatus(item: CodexThreadItem): RuntimeToolActivityStatus {
  if (readCodexItemError(item)) {
    return 'failed'
  }
  if (item.status === 'failed') {
    return 'failed'
  }
  return 'completed'
}

function readToolActivityLabel(item: CodexThreadItem): string {
  switch (item.type) {
    case 'commandExecution':
      return item.command ?? 'Command'
    case 'fileChange':
      return item.changes?.flatMap(change => typeof change.path === 'string' ? [change.path] : []).join(', ') || 'File change'
    case 'mcpToolCall':
      return [item.server, item.tool].filter(Boolean).join('/') || 'MCP tool'
    case 'dynamicToolCall':
      return item.tool ?? 'Tool'
    case 'collabAgentToolCall':
      return item.tool ?? 'Agent'
    case 'webSearch':
      return item.query ?? 'Web search'
    case 'plan':
      return item.text ?? 'Plan'
    case 'imageGeneration':
      return 'Image generation'
    case 'contextCompaction':
      return 'Context compaction'
    default:
      return item.type ?? 'Activity'
  }
}

function formatRuntimePhrase(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
}

function readCodexItemError(item: CodexThreadItem): string | null {
  if (typeof item.error === 'string') {
    return item.error
  }
  if (typeof item.error?.message === 'string') {
    return item.error.message
  }
  return null
}

function projectMcpServersFromList(response: CodexListMcpServerStatusResponse | null): CodexMcpServerSnapshot[] {
  return (response?.data ?? []).flatMap((server) => {
    if (typeof server.name !== 'string') {
      return []
    }
    return [{
      name: server.name,
      status: 'ready',
      authStatus: normalizeMcpAuthStatus(server.authStatus),
      toolCount: server.tools ? Object.keys(server.tools).length : 0,
      resourceCount: (server.resources?.length ?? 0) + (server.resourceTemplates?.length ?? 0),
      error: null,
    }]
  })
}

function normalizeMcpServerStatus(value: unknown): RuntimeMcpServerStatus {
  switch (value) {
    case 'starting':
    case 'ready':
    case 'failed':
    case 'cancelled':
      return value
    default:
      return 'unknown'
  }
}

function normalizeMcpAuthStatus(value: unknown): RuntimeMcpAuthStatus {
  switch (value) {
    case 'unsupported':
    case 'notLoggedIn':
    case 'bearerToken':
    case 'oAuth':
      return value
    default:
      return 'unknown'
  }
}

function readCodexProviderSnapshot(raw: string | null | undefined): CodexProviderSnapshot {
  return readWorkspaceProviderStateSnapshot(raw) as CodexProviderSnapshot
}

function readCodexCompactSnapshot(raw: string | null | undefined): CodexCompactSnapshot | null {
  const compact = readCodexProviderSnapshot(raw).codex?.compact
  if (!compact || typeof compact.threadId !== 'string') {
    return null
  }
  return {
    threadId: compact.threadId,
    turnId: typeof compact.turnId === 'string' ? compact.turnId : null,
    tokenUsage: compact.tokenUsage ?? {
      total: createEmptyTokenUsageBreakdown(),
      last: createEmptyTokenUsageBreakdown(),
      modelContextWindow: null,
    },
    updatedAt: typeof compact.updatedAt === 'number' ? compact.updatedAt : 0,
    status: normalizeCompactLifecycleStatus(compact.status),
    compactionStartedAt: typeof compact.compactionStartedAt === 'number' ? compact.compactionStartedAt : null,
    lastCompactedAt: typeof compact.lastCompactedAt === 'number' ? compact.lastCompactedAt : null,
    compactionItemId: typeof compact.compactionItemId === 'string' ? compact.compactionItemId : null,
    completedCompactionItemIds: Array.isArray(compact.completedCompactionItemIds)
      ? compact.completedCompactionItemIds.filter(id => typeof id === 'string')
      : [],
  }
}

function normalizeCompactLifecycleStatus(value: unknown): RuntimeCompactUiSlotState['status'] | undefined {
  if (value === 'running' || value === 'compacted') {
    return value
  }
  return undefined
}

function normalizeTokenUsageBreakdown(value: CodexTokenUsageBreakdown | undefined): RuntimeTokenUsageBreakdown {
  return {
    totalTokens: readNonNegativeNumber(value?.totalTokens),
    inputTokens: readNonNegativeNumber(value?.inputTokens),
    cachedInputTokens: readNonNegativeNumber(value?.cachedInputTokens),
    outputTokens: readNonNegativeNumber(value?.outputTokens),
    reasoningOutputTokens: readNonNegativeNumber(value?.reasoningOutputTokens),
  }
}

function readCodexLastTokenUsage(value: CodexThreadTokenUsage | undefined): TokenUsage | null {
  const last = normalizeTokenUsageBreakdown(value?.last)
  if (last.totalTokens === 0 && last.inputTokens === 0 && last.outputTokens === 0) {
    return null
  }
  return {
    promptTokens: last.inputTokens,
    completionTokens: last.outputTokens,
    totalTokens: last.totalTokens || last.inputTokens + last.outputTokens,
  }
}

function createEmptyTokenUsageBreakdown(): RuntimeTokenUsageBreakdown {
  return {
    totalTokens: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  }
}

function readConfigNumber(value: number | bigint | null | undefined): number | null {
  if (typeof value === 'bigint') {
    return Number(value)
  }
  return readPositiveNumber(value)
}

function readPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function readNonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function readPercent(value: number, limit: number): number {
  return Math.min(100, Math.max(0, Math.round((value / limit) * 100)))
}

function readNullablePercent(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : null
}

function readNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

async function startOrResumeThread(
  client: CodexAppServerClientLike,
  runtimeSession: RuntimeSession,
  params: {
    model?: string | null
    cwd: string
    runtimeWorkspaceRoots: string[]
    approvalPolicy: CodexConfig['approvalPolicy']
    sandbox: CodexConfig['sandboxMode']
    config: Record<string, unknown>
  },
): Promise<{
  threadId: string
  title: string | null
  modelId: string | null
  modelProvider: string | null
  serviceTier: string | null
  reasoningEffort: string | null
  status: CodexThreadStatus | null
}> {
  const baseParams = {
    model: params.model,
    cwd: params.cwd,
    runtimeWorkspaceRoots: params.runtimeWorkspaceRoots,
    approvalPolicy: params.approvalPolicy,
    sandbox: params.sandbox,
    config: params.config,
  }
  const response = await client.request(
    runtimeSession.providerSessionId ? 'thread/resume' : 'thread/start',
    runtimeSession.providerSessionId
      ? { ...baseParams, threadId: runtimeSession.providerSessionId, excludeTurns: true }
      : baseParams,
  ) as ThreadResponse
  const threadId = response.thread?.id
  if (!threadId) {
    throw codexRequestError('startOrResumeCodexThread', 'Codex app-server did not return a thread id')
  }
  return {
    threadId,
    title: readCodexThreadDisplayTitle(response.thread),
    modelId: response.model ?? null,
    modelProvider: response.modelProvider ?? response.thread?.modelProvider ?? null,
    serviceTier: response.serviceTier ?? null,
    reasoningEffort: response.reasoningEffort ?? null,
    status: response.thread?.status ?? null,
  }
}

async function injectCradleTranscriptHistory(
  client: CodexAppServerClientLike,
  threadId: string,
  history: UIMessage[] | undefined,
): Promise<void> {
  if (!history?.length) {
    return
  }

  const items = projectCradleTranscriptToCodexItems(history)
  if (items.length === 0) {
    return
  }

  const params: ThreadInjectItemsParams = {
    threadId,
    items: items as ThreadInjectItemsParams['items'],
  }
  await client.request('thread/inject_items', params)
}

async function injectCodexNativeHistory(
  client: CodexAppServerClientLike,
  threadId: string,
  nativeHistory: CodexNativeHistorySnapshot | undefined,
): Promise<void> {
  if (!nativeHistory?.turns.length) {
    return
  }

  const items = projectCodexNativeTurnsToCodexItems(nativeHistory.turns)
  if (items.length === 0) {
    return
  }

  const params: ThreadInjectItemsParams = {
    threadId,
    items: items as ThreadInjectItemsParams['items'],
  }
  await client.request('thread/inject_items', params)
}

async function hydrateCodexNativeHistory(
  client: CodexAppServerClientLike,
  runtimeSession: RuntimeSession,
  threadId: string,
): Promise<void> {
  try {
    const turns = await listFullCodexTurns(client, threadId)
    writeCodexNativeHistorySnapshot(runtimeSession, {
      threadId,
      itemsView: 'full',
      fetchedAt: Date.now(),
      complete: true,
      turns,
      turnCount: turns.length,
      itemCount: countCodexTurnItems(turns),
      nextCursor: null,
      error: null,
    })
  }
  catch (error) {
    writeCodexNativeHistorySnapshot(runtimeSession, {
      threadId,
      itemsView: 'full',
      fetchedAt: Date.now(),
      complete: false,
      turns: [],
      turnCount: 0,
      itemCount: 0,
      nextCursor: null,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function listFullCodexTurns(
  client: CodexAppServerClientLike,
  threadId: string,
): Promise<Turn[]> {
  const turns: Turn[] = []
  let cursor: string | null = null
  const seenCursors = new Set<string>()
  do {
    const response = await client.request('thread/turns/list', {
      threadId,
      cursor,
      limit: CODEX_THREAD_TURNS_LIST_LIMIT,
      sortDirection: 'asc',
      itemsView: 'full',
    }) as ThreadTurnsListResponse
    turns.push(...(Array.isArray(response.data) ? response.data : []))
    const nextCursor = typeof response.nextCursor === 'string' && response.nextCursor.length > 0
      ? response.nextCursor
      : null
    if (nextCursor && seenCursors.has(nextCursor)) {
      throw codexRequestError('hydrateCodexNativeHistory', `Codex thread/turns/list returned a repeated cursor: ${nextCursor}`)
    }
    if (nextCursor) {
      seenCursors.add(nextCursor)
    }
    cursor = nextCursor
  } while (cursor)
  return turns
}

function writeCodexNativeHistorySnapshot(
  runtimeSession: RuntimeSession,
  nativeHistory: CodexNativeHistorySnapshot,
): void {
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    codex: {
      ...snapshot.codex,
      nativeHistory,
    },
  })
}

function countCodexTurnItems(turns: Turn[]): number {
  return turns.reduce((count, turn) => count + turn.items.length, 0)
}

function readRestorableCodexNativeHistory(raw: string | null | undefined): CodexNativeHistorySnapshot | undefined {
  if (!raw) {
    return undefined
  }
  try {
    const nativeHistory = readCodexProviderSnapshot(raw).codex?.nativeHistory
    if (!nativeHistory || nativeHistory.itemsView !== 'full' || !Array.isArray(nativeHistory.turns) || nativeHistory.turns.length === 0) {
      return undefined
    }
    return nativeHistory
  }
  catch {
    return undefined
  }
}

function toCodexThreadSourceKind(kind: ProviderThreadSourceKind): ThreadSourceKind {
  switch (kind) {
    case 'cli':
    case 'vscode':
    case 'exec':
    case 'appServer':
    case 'subAgent':
    case 'subAgentReview':
    case 'subAgentCompact':
    case 'subAgentThreadSpawn':
    case 'subAgentOther':
    case 'unknown':
      return kind
    default:
      return 'unknown'
  }
}

function projectCodexThread(thread: Thread): ProviderThread {
  return {
    id: thread.id,
    providerSessionTreeId: thread.sessionId ?? null,
    forkedFromId: thread.forkedFromId ?? null,
    preview: normalizeProviderTitle(thread.preview) ?? null,
    ephemeral: thread.ephemeral === true,
    modelProvider: normalizeProviderTitle(thread.modelProvider) ?? null,
    createdAt: typeof thread.createdAt === 'number' ? thread.createdAt : null,
    updatedAt: typeof thread.updatedAt === 'number' ? thread.updatedAt : null,
    status: readThreadStatusType(thread.status),
    sourceKind: readCodexThreadSourceKind(thread.source),
    source: thread.source,
    threadSource: thread.threadSource ?? null,
    agentNickname: normalizeProviderTitle(thread.agentNickname) ?? null,
    agentRole: normalizeProviderTitle(thread.agentRole) ?? null,
    name: normalizeProviderTitle(thread.name) ?? null,
    cwd: typeof thread.cwd === 'string' ? thread.cwd : null,
  }
}

function projectCodexTurn(turn: Turn): ProviderThreadTurn {
  return {
    id: turn.id,
    status: turn.status,
    startedAt: turn.startedAt ?? null,
    completedAt: turn.completedAt ?? null,
    durationMs: turn.durationMs ?? null,
    itemsView: turn.itemsView,
    items: turn.items,
  }
}

function projectCodexTurnsToUiMessages(threadId: string, turns: Turn[]): UIMessage[] {
  const messages: UIMessage[] = []
  for (const turn of turns) {
    let assistantParts: UIMessage['parts'] = []
    let assistantMessageIndex = 0
    const flushAssistant = () => {
      if (assistantParts.length === 0) {
        return
      }
      messages.push({
        id: `provider-thread:${threadId}:turn:${turn.id}:assistant:${assistantMessageIndex}`,
        role: 'assistant',
        parts: assistantParts,
      })
      assistantParts = []
      assistantMessageIndex += 1
    }

    for (const item of turn.items) {
      switch (item.type) {
        case 'userMessage':
          flushAssistant()
          messages.push({
            id: `provider-thread:${threadId}:turn:${turn.id}:user:${item.id}`,
            role: 'user',
            parts: projectCodexUserInputsToUiParts(item.content),
          })
          break
        case 'agentMessage':
          if (item.text) {
            assistantParts.push({
              type: 'text',
              text: item.text,
              state: 'done',
            })
          }
          break
        case 'reasoning': {
          const text = [...(item.summary ?? []), ...(item.content ?? [])].join('\n')
          if (text) {
            assistantParts.push({
              type: 'reasoning',
              text,
              state: 'done',
            })
          }
          break
        }
        case 'hookPrompt':
          break
        default:
          assistantParts.push(projectCodexToolItemToUiPart(item as CodexAppServerItem))
          break
      }
    }
    flushAssistant()
  }
  return messages
}

function projectCodexUserInputsToUiParts(inputs: UserInput[]): UIMessage['parts'] {
  const parts: UIMessage['parts'] = []
  for (const input of inputs) {
    switch (input.type) {
      case 'text':
        parts.push({ type: 'text', text: input.text, state: 'done' })
        break
      case 'image':
        parts.push({ type: 'file', mediaType: 'image/*', url: input.url })
        break
      case 'localImage':
        parts.push({ type: 'file', mediaType: 'image/*', url: `file://${input.path}` })
        break
      case 'skill':
      case 'mention':
        parts.push({ type: 'text', text: `@${input.name}`, state: 'done' })
        break
    }
  }
  return parts.length > 0 ? parts : [{ type: 'text', text: '', state: 'done' }]
}

function projectCodexToolItemToUiPart(item: CodexAppServerItem): UIMessage['parts'][number] {
  const errorText = readCodexToolError(item)
  const toolName = readCodexToolName(item)
  const input = buildCodexToolInput(item)
  if (errorText) {
    return {
      type: 'dynamic-tool',
      toolCallId: item.id,
      toolName,
      state: 'output-error',
      input,
      errorText,
    }
  }
  return {
    type: 'dynamic-tool',
    toolCallId: item.id,
    toolName,
    state: 'output-available',
    input,
    output: buildCodexToolOutput(item),
  }
}

function readThreadStatusType(status: Thread['status']): string {
  return typeof status === 'object' && status !== null && 'type' in status
    ? String(status.type)
    : 'unknown'
}

function readCodexThreadSourceKind(source: Thread['source']): ProviderThreadSourceKind {
  if (typeof source === 'string') {
    switch (source) {
      case 'cli':
      case 'vscode':
      case 'exec':
      case 'appServer':
      case 'unknown':
        return source
      default:
        return 'unknown'
    }
  }
  if (!source || typeof source !== 'object' || !('subAgent' in source)) {
    return 'unknown'
  }
  const subAgentSource = source.subAgent
  if (subAgentSource === 'review') {
    return 'subAgentReview'
  }
  if (subAgentSource === 'compact') {
    return 'subAgentCompact'
  }
  if (subAgentSource && typeof subAgentSource === 'object') {
    if ('thread_spawn' in subAgentSource) {
      return 'subAgentThreadSpawn'
    }
    if ('other' in subAgentSource) {
      return 'subAgentOther'
    }
  }
  return 'subAgent'
}

async function assertCodexThreadBelongsToRuntimeSession(
  client: CodexAppServerClientLike,
  parentThreadId: string | null,
  thread: Thread,
): Promise<void> {
  if (!parentThreadId) {
    throw codexRequestError('thread/read', 'Cannot read provider thread before the parent runtime thread exists')
  }
  const parent = await client.request('thread/read', {
    threadId: parentThreadId,
    includeTurns: false,
  }) as ThreadReadResponse
  if (parent.thread.sessionId !== thread.sessionId) {
    throw codexRequestError('thread/read', `Provider thread ${thread.id} does not belong to runtime thread ${parentThreadId}`)
  }
}

function publishProviderThreadEvent(
  onProviderThreadEvent: ((event: ProviderThreadEvent) => void) | undefined,
  notification: CodexAppServerMessage,
  mapperStates: Map<string, ReturnType<typeof createCodexAppServerMapperState>>,
): void {
  if (!onProviderThreadEvent) {
    return
  }
  const providerThreadId = getThreadId(notification)
  if (!providerThreadId) {
    return
  }
  try {
    let state = mapperStates.get(providerThreadId)
    if (!state) {
      state = createCodexAppServerMapperState(`provider-thread:${providerThreadId}`)
      mapperStates.set(providerThreadId, state)
    }
    const chunks = mapCodexAppServerNotificationToChunks(notification, state)
    if (notification.method === 'turn/completed') {
      chunks.push(...closeOpenCodexAppServerReasoning(state))
      chunks.push(...closeOpenCodexAppServerText(state))
      chunks.push({ type: 'finish', finishReason: 'stop' })
    }
    if (chunks.length === 0) {
      return
    }
    onProviderThreadEvent({
      providerThreadId,
      providerTurnId: getNotificationTurnId(notification),
      notification,
      chunks,
    })
  }
  catch {
    // Provider-thread subscribers must not affect the parent turn stream.
  }
}

async function* readTurnNotifications(
  client: CodexAppServerClientLike,
  threadId: string,
  initialTurnId: string | null,
  signal: AbortSignal,
  readGoal: () => CodexGoalSnapshot | null | undefined,
  onProviderNotification?: (notification: CodexAppServerMessage) => void,
): AsyncGenerator<CodexAppServerMessage, void, void> {
  let turnId = initialTurnId
  let turnCompleted = false
  while (!signal.aborted) {
    let notification: CodexAppServerMessage | null
    try {
      notification = await client.nextNotification(signal)
    }
    catch (error) {
      if (signal.aborted) {
        return
      }
      throw error
    }
    if (!notification) {
      return
    }
    onProviderNotification?.(notification)
    const notificationThreadId = getThreadId(notification)
    if (notificationThreadId && notificationThreadId !== threadId) {
      continue
    }
    if (notification.method === 'turn/started') {
      turnId = getTurnId(notification)
      turnCompleted = false
      yield notification
      continue
    }
    const notificationTurnId = getNotificationTurnId(notification)
    if (turnId && notificationTurnId && notificationTurnId !== turnId) {
      continue
    }
    yield notification
    if (notification.method === 'turn/completed') {
      turnCompleted = true
      if (!hasActiveGoal(readGoal())) {
        return
      }
      continue
    }
    if (turnCompleted && isIdleThreadStatus(notification)) {
      if (!hasActiveGoal(readGoal())) {
        return
      }
      if (!await continueActiveGoal(client, threadId, signal)) {
        return
      }
      turnId = null
      turnCompleted = false
    }
    if (turnCompleted) {
      if (!hasActiveGoal(readGoal())) {
        return
      }
    }
  }
}

async function continueActiveGoal(
  client: CodexAppServerClientLike,
  threadId: string,
  signal: AbortSignal,
): Promise<boolean> {
  if (!await waitForActiveGoalContinuationDelay(signal)) {
    return false
  }
  await client.request('thread/goal/set', { threadId, status: 'active' })
  return true
}

function waitForActiveGoalContinuationDelay(signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) {
    return Promise.resolve(false)
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, ACTIVE_GOAL_CONTINUATION_DELAY_MS)
    const onAbort = () => {
      clearTimeout(timer)
      resolve(false)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function buildCodexConfig(
  config: CodexConfig,
  workspacePath: string,
  resolveSkillPaths: (workspacePath: string) => string[],
  systemPromptFile: string | null,
  effectiveModel?: string | null,
): Record<string, unknown> {
  const skillPaths = config.skillPaths.length > 0
    ? config.skillPaths
    : resolveSkillPaths(workspacePath)
  const instructionPaths = [...skillPaths, ...(systemPromptFile ? [systemPromptFile] : [])]
  const codexConfig: Record<string, unknown> = {
    network_access: 'enabled',
    show_raw_agent_reasoning: true,
    disable_response_storage: true,
  }
  const mcpServers = buildCodexMcpServersConfig()
  codexConfig.approval_policy = config.approvalPolicy
  codexConfig.sandbox_mode = config.sandboxMode
  if (Object.keys(mcpServers).length > 0) {
    codexConfig.mcp_servers = mcpServers
  }
  if (instructionPaths.length > 0) {
    codexConfig.instructions_paths = instructionPaths
  }
  if (config.baseUrl) {
    codexConfig.model_provider = CRADLE_CODEX_MODEL_PROVIDER
    codexConfig.model_providers = {
      [CRADLE_CODEX_MODEL_PROVIDER]: {
        name: 'Cradle OpenAI Compatible',
        base_url: config.baseUrl,
        env_key: CRADLE_CODEX_API_KEY_ENV,
        wire_api: 'responses',
        requires_openai_auth: true,
      },
    }
  }
  if (effectiveModel) {
    codexConfig.model = effectiveModel
  }
  return codexConfig
}

function buildCodexMcpServersConfig(): Record<string, { command: string, args: string[], env?: Record<string, string> }> {
  return Object.fromEntries(
    Object.entries(getRegisteredMcpServers()).map(([name, config]) => {
      const server: { command: string, args: string[], env?: Record<string, string> } = {
        command: config.command,
        args: config.args,
      }
      if (config.env && Object.keys(config.env).length > 0) {
        server.env = config.env
      }
      return [name, server]
    }),
  )
}

function writeSystemPromptFile(systemPrompt: string | undefined): string | null {
  if (!systemPrompt) {
    return null
  }
  const filePath = join(tmpdir(), `cradle-codex-prompt-${randomUUID()}.md`)
  writeFileSync(filePath, systemPrompt, 'utf-8')
  return filePath
}

function projectCodexUserInput(message: RuntimeMessageInput, runtimeLabel: string): CodexUserInput[] {
  if (typeof message === 'string') {
    const text = message.trim()
    if (!text) {
      throw codexRequestError('projectInput', `${runtimeLabel} requires non-empty text or image input`)
    }
    return [toTextUserInput(text)]
  }

  const input: CodexUserInput[] = []
  const unsupportedParts: string[] = []
  for (const part of message.parts) {
    if (part.type === 'text') {
      const text = part.text.trim()
      if (text) {
        input.push(toTextUserInput(text))
      }
      continue
    }
    if (part.type === 'file') {
      if (part.mediaType.startsWith('image/')) {
        input.push(toCodexImageInput(part))
      }
      else {
        unsupportedParts.push(describeUnsupportedFilePart(part))
      }
      continue
    }
    const skillPart = readChatSkillContextPart(part)
    if (skillPart) {
      input.push({ type: 'skill', name: skillPart.name, path: skillPart.path })
      continue
    }
    unsupportedParts.push(part.type)
  }

  if (unsupportedParts.length > 0) {
    throw codexRequestError('projectInput', `${runtimeLabel} only supports text, image, and skill input; unsupported parts: ${unsupportedParts.join(', ')}`)
  }
  if (input.length === 0) {
    throw codexRequestError('projectInput', `${runtimeLabel} requires non-empty text or image input`)
  }
  return input
}

function toTextUserInput(text: string): CodexUserInput {
  return { type: 'text', text, text_elements: [] }
}

function toCodexImageInput(part: Extract<MessagePart, { type: 'file' }>): CodexUserInput {
  if (part.url.startsWith('file:')) {
    return { type: 'localImage', path: fileURLToPath(part.url) }
  }
  return { type: 'image', url: part.url }
}

function describeUnsupportedFilePart(part: Extract<MessagePart, { type: 'file' }>): string {
  const filename = part.filename ? ` (${part.filename})` : ''
  return `file${filename} (${part.mediaType})`
}

function describeCodexUserInput(input: CodexUserInput[], text: string): string {
  const imageCount = input.filter(item => item.type === 'image' || item.type === 'localImage').length
  const skillCount = input.filter(item => item.type === 'skill').length
  if (imageCount === 0 && skillCount === 0) {
    return text
  }
  const suffixParts = [
    imageCount > 0 ? `${imageCount} image${imageCount === 1 ? '' : 's'}` : '',
    skillCount > 0 ? `${skillCount} skill${skillCount === 1 ? '' : 's'}` : '',
  ].filter(Boolean)
  const suffix = `[${suffixParts.join(', ')}]`
  return text ? `${text}\n${suffix}` : suffix
}

function toSandboxPolicy(
  sandboxMode: CodexConfig['sandboxMode'],
  writableRoots: string[],
  additionalDirectories: string[],
): unknown {
  if (sandboxMode === 'danger-full-access') {
    return { type: 'dangerFullAccess' }
  }
  if (sandboxMode === 'read-only') {
    return { type: 'readOnly', networkAccess: false }
  }
  return {
    type: 'workspaceWrite',
    writableRoots: [...new Set([...writableRoots, ...additionalDirectories])],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  }
}

function createDiagnostics(): CodexStreamDiagnostics {
  return {
    totalEvents: 0,
    mappedEvents: 0,
    completedTurnEvents: 0,
    retryableErrorEvents: 0,
    eventTypeCounts: {},
    itemTypeCounts: {},
    sampleEvents: [],
    errorEvents: [],
  }
}

function collectCodexStreamDiagnostics(diagnostics: CodexStreamDiagnostics, notification: CodexAppServerMessage): void {
  const method = notification.method ?? 'response'
  diagnostics.totalEvents += 1
  incrementCount(diagnostics.eventTypeCounts, method)
  if (method === 'turn/completed') {
    diagnostics.completedTurnEvents += 1
  }
  if (notification.method === 'error' && isRetryableCodexAppServerError(notification)) {
    diagnostics.retryableErrorEvents += 1
  }
  const itemType = (notification.params as ItemNotificationParams | undefined)?.item?.type
  if (itemType) {
    incrementCount(diagnostics.itemTypeCounts, itemType)
  }
  if (diagnostics.sampleEvents.length < MAX_EVENT_SAMPLES) {
    diagnostics.sampleEvents.push(buildSampleEvent(notification))
  }
  if (notification.method === 'error' && diagnostics.errorEvents.length < MAX_EVENT_SAMPLES) {
    diagnostics.errorEvents.push(buildDiagnosticNotification(notification))
  }
}

function buildSampleEvent(notification: CodexAppServerMessage): Record<string, unknown> {
  const item = (notification.params as ItemNotificationParams | undefined)?.item
  const base = buildDiagnosticNotification(notification)
  if (!item) {
    return base
  }
  return { ...base, itemType: item.type, itemId: item.id }
}

function buildDiagnosticNotification(notification: CodexAppServerMessage): Record<string, unknown> {
  const sample: Record<string, unknown> = {
    method: notification.method,
  }
  if (notification.error) {
    sample.error = sanitizeDiagnosticValue(notification.error)
  }
  if (notification.params !== undefined) {
    sample.params = sanitizeDiagnosticValue(notification.params)
  }
  if (notification.result !== undefined) {
    sample.result = sanitizeDiagnosticValue(notification.result)
  }
  return sample
}

function getThreadId(notification: CodexAppServerMessage): string | null {
  return (notification.params as { threadId?: string } | undefined)?.threadId ?? null
}

function getTurnId(notification: CodexAppServerMessage): string | null {
  return (notification.params as TurnNotificationParams | undefined)?.turn?.id ?? null
}

function getNotificationTurnId(notification: CodexAppServerMessage): string | null {
  return (notification.params as { turnId?: string } | undefined)?.turnId ?? getTurnId(notification)
}

function readThreadNameUpdate(notification: CodexAppServerMessage, expectedThreadId: string): string | null {
  const params = notification.params as ThreadNameUpdatedNotificationParams | undefined
  if (!params || params.threadId !== expectedThreadId) {
    return null
  }
  return normalizeProviderTitle(params.threadName)
}

async function readLatestThreadTitle(client: CodexAppServerClientLike, threadId: string): Promise<string | null> {
  try {
    const response = await client.request('thread/read', { threadId, includeTurns: false }) as ThreadResponse
    return readCodexThreadDisplayTitle(response.thread)
  }
  catch {
    return null
  }
}

function readCodexThreadDisplayTitle(thread: ThreadResponse['thread'] | null | undefined): string | null {
  return normalizeProviderTitle(thread?.name)
    ?? normalizeProviderTitle(thread?.title)
    ?? normalizeProviderTitle(thread?.preview)
}

function normalizeProviderTitle(title: string | null | undefined): string | null {
  const normalized = title?.replace(/\s+/g, ' ').trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

function incrementCount(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1
}

function validateCodexStreamOutput(diagnostics: CodexStreamDiagnostics): { ok: boolean, errorText: string | null } {
  if (diagnostics.mappedEvents > 0 || diagnostics.completedTurnEvents > 0) {
    return { ok: true, errorText: null }
  }
  return {
    ok: false,
    errorText: 'Codex app-server stream completed without mapped timeline events',
  }
}

function createCodexTurnFailureError(
  message: string | undefined,
  diagnostics: CodexStreamDiagnostics,
  notification: CodexAppServerMessage,
): CodexProviderError {
  const summary = summarizeCodexFailureDetails(diagnostics)
  const failureMessage = normalizeProviderErrorMessage(message) ?? 'Codex turn failed'
  return createCodexProviderError(failureMessage, summary, diagnostics, notification)
}

function createCodexAppServerError(notification: CodexAppServerMessage, diagnostics: CodexStreamDiagnostics): CodexProviderError {
  const params = notification.params as ErrorNotificationParams | undefined
  const message = summarizeCodexErrorMessage(params) ?? 'Codex app-server error'
  const summary = summarizeCodexFailureDetails(diagnostics, notification)
  return createCodexProviderError(message, summary, diagnostics, notification)
}

function isRetryableCodexAppServerError(notification: CodexAppServerMessage): boolean {
  return (notification.params as ErrorNotificationParams | undefined)?.willRetry === true
}

function createCodexEmptyStreamError(errorText: string, diagnostics: CodexStreamDiagnostics): CodexProviderError {
  return createCodexProviderError(errorText, summarizeCodexFailureDetails(diagnostics), diagnostics)
}

function createCodexProviderError(
  message: string,
  details: string | null,
  diagnostics: CodexStreamDiagnostics,
  notification?: CodexAppServerMessage,
): CodexProviderError {
  return new CodexProviderError(OBSERVABILITY_CODES.turnStreamFailed, message, {
    details,
    runtimeKind: RUNTIME_KIND,
    diagnostics,
    ...(notification ? { notification: buildDiagnosticNotification(notification) } : {}),
  })
}

function normalizeProviderErrorMessage(message: string | null | undefined): string | null {
  const normalized = message?.replace(/\s+/g, ' ').trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

function summarizeCodexErrorMessage(params: ErrorNotificationParams | undefined): string | null {
  const message = normalizeProviderErrorMessage(params?.error?.message ?? params?.message)
  if (!message) {
    return null
  }
  if (/exceeded retry limit/i.test(message)) {
    return 'Codex app-server retry limit exceeded'
  }
  const statusText = readCodexStatusText(params)
  if (statusText) {
    return `Codex app-server request failed with ${statusText.replace(/^status:\s*/, '')}`
  }
  return message
}

function summarizeCodexFailureDetails(
  diagnostics: CodexStreamDiagnostics,
  notification?: CodexAppServerMessage,
): string | null {
  const parts: string[] = []
  const params = notification?.params as ErrorNotificationParams | TurnNotificationParams | undefined
  if (notification?.method === 'error') {
    const errorParams = params as ErrorNotificationParams | undefined
    const additionalDetails = normalizeProviderErrorMessage(errorParams?.error?.additionalDetails)
    if (additionalDetails) {
      parts.push(additionalDetails)
    }
    const statusText = readCodexStatusText(errorParams)
    if (statusText) {
      parts.push(statusText)
    }
    const requestId = readCodexRequestId(errorParams)
    if (requestId) {
      parts.push(`request id: ${requestId}`)
    }
    const providerCode = normalizeProviderErrorMessage(errorParams?.code)
    if (providerCode) {
      parts.push(`provider code: ${providerCode}`)
    }
  }

  if (diagnostics.retryableErrorEvents > 0) {
    parts.push(`retryable errors observed before failure: ${diagnostics.retryableErrorEvents}`)
  }
  parts.push(`events: ${diagnostics.totalEvents} total, ${diagnostics.mappedEvents} mapped`)
  parts.push(`event types: ${formatCounts(diagnostics.eventTypeCounts)}`)
  return parts.length > 0 ? parts.join('; ') : null
}

function readCodexStatusText(params: ErrorNotificationParams | undefined): string | null {
  const message = normalizeProviderErrorMessage(params?.error?.message ?? params?.message)
  const match = message?.match(/last status:\s*([^,]+)/i) ?? message?.match(/unexpected status\s+([^:]+)/i)
  return match ? `status: ${match[1].trim()}` : null
}

function readCodexRequestId(params: ErrorNotificationParams | undefined): string | null {
  const values = [
    params?.error?.message,
    params?.message,
    typeof params?.details === 'string' ? params.details : null,
  ]
  for (const value of values) {
    const match = value?.match(/request id:\s*([a-zA-Z0-9-]+)/i)
    if (match) {
      return match[1]
    }
  }
  return null
}

function formatCodexDiagnostics(diagnostics: CodexStreamDiagnostics): string {
  const eventTypes = formatCounts(diagnostics.eventTypeCounts)
  const itemTypes = formatCounts(diagnostics.itemTypeCounts)
  const samples = diagnostics.sampleEvents.length > 0
    ? `, samples=${formatDiagnosticValue(diagnostics.sampleEvents)}`
    : ''
  const errors = diagnostics.errorEvents.length > 0
    ? `, errors=${formatDiagnosticValue(diagnostics.errorEvents)}`
    : ''
  return `events_total=${diagnostics.totalEvents}, mapped_events=${diagnostics.mappedEvents}, event_types=${eventTypes}, item_types=${itemTypes}${samples}${errors}`
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))
  if (entries.length === 0) {
    return '-'
  }
  return entries.map(([key, count]) => `${key}:${count}`).join(',')
}

function formatDiagnosticValue(value: unknown): string {
  const text = JSON.stringify(sanitizeDiagnosticValue(value))
  if (text.length <= MAX_DIAGNOSTIC_STRING_LENGTH) {
    return text
  }
  return `${text.slice(0, MAX_DIAGNOSTIC_STRING_LENGTH)}...<truncated>`
}

function sanitizeDiagnosticValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return value
  }
  if (typeof value === 'string') {
    return value.length <= MAX_DIAGNOSTIC_STRING_LENGTH
      ? value
      : `${value.slice(0, MAX_DIAGNOSTIC_STRING_LENGTH)}...<truncated>`
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'bigint') {
    return value.toString()
  }
  if (typeof value !== 'object') {
    return String(value)
  }
  if (depth >= MAX_DIAGNOSTIC_DEPTH) {
    return '[MaxDepth]'
  }
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_DIAGNOSTIC_ARRAY_ITEMS)
      .map(item => sanitizeDiagnosticValue(item, depth + 1))
    if (value.length > MAX_DIAGNOSTIC_ARRAY_ITEMS) {
      items.push(`[${value.length - MAX_DIAGNOSTIC_ARRAY_ITEMS} more items]`)
    }
    return items
  }

  const output: Record<string, unknown> = {}
  const entries = Object.entries(value as Record<string, unknown>)
  for (const [key, item] of entries.slice(0, MAX_DIAGNOSTIC_OBJECT_KEYS)) {
    output[key] = sanitizeDiagnosticValue(item, depth + 1)
  }
  if (entries.length > MAX_DIAGNOSTIC_OBJECT_KEYS) {
    output.__truncatedKeys = entries.length - MAX_DIAGNOSTIC_OBJECT_KEYS
  }
  return output
}
