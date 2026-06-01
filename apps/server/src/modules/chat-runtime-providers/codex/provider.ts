// Output: Codex Chat Runtime provider backed by the Codex app-server protocol.
// Input: Chat Runtime turn requests, Codex profile config, and app-server notifications.
// Position: Runtime provider that streams Codex turns and supports true live steering.

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
import type {
  CancelTurnInput,
  ChatRuntime,
  ChatRuntimeCapabilities,
  GetCapabilitiesInput,
  GetUiSlotStatesInput,
  ResumeChatSessionInput,
  RuntimeAlertSeverity,
  RuntimeAlertUiSlotState,
  RuntimeApprovalStatus,
  RuntimeApprovalsUiSlotState,
  RuntimeCompactUiSlotState,
  RuntimeConfigUiSlotState,
  RuntimeCrewUiSlotState,
  RuntimeDiffUiSlotState,
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
import type { CreateEventInput } from '../../observability/contract'
import { createDedupeKey, OBSERVABILITY_CODES } from '../../observability/contract'
import type { CodexConfig } from '../../provider-contracts/provider-base'
import { readTrustedCodexConfig, resolveApiKey } from '../../provider-contracts/provider-base'
import type { RuntimeKind } from '../../provider-contracts/types'
import { createBoundedTextCollector } from '../bounded-text-collector'
import { readWorkspaceProviderStateSnapshot } from '../provider-state-snapshot'
import { buildDefaultCodexAppServerRequestResult } from './app-server-bridge'
import { CODEX_APP_SERVER_CAPABILITIES } from './app-server-capabilities'
import type { CodexAppServerClientOptions, CodexAppServerMessage } from './app-server-client'
import { CodexAppServerClient } from './app-server-client'
import {
  closeOpenCodexAppServerReasoning,
  closeOpenCodexAppServerText,
  createCodexAppServerMapperState,
  mapCodexAppServerNotificationToChunks,
} from './app-server-mapper'
import type { ThreadInjectItemsParams } from './app-server-protocol/v2/ThreadInjectItemsParams'
import { projectCradleTranscriptToCodexItems } from './transcript-projector'
import { projectCodexUiSlots } from './ui-slots'

interface CodexProviderDeps {
  readSecret: (credentialRef: string) => string
  resolveSkillPaths: (workspacePath: string) => string[]
  recordObservability: (input: CreateEventInput) => void
  createAppServerClient?: (options: CodexAppServerClientOptions) => CodexAppServerClientLike
}

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
  eventTypeCounts: Record<string, number>
  itemTypeCounts: Record<string, number>
  sampleEvents: Array<Record<string, unknown>>
  errorEvents: Array<Record<string, unknown>>
}

interface CodexGoalCommand {
  objective: string
}

interface CodexThreadStatus {
  type?: string
  activeFlags?: string[]
}

interface CodexThreadSettings {
  model?: string | null
  modelProvider?: string | null
  serviceTier?: string | null
  effort?: string | null
  summary?: string | null
}

interface ThreadResponse {
  thread?: { id?: string, name?: string | null, status?: CodexThreadStatus, modelProvider?: string | null }
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

interface ThreadGoalSetResponse {
  goal?: ThreadGoalGetResponse['goal']
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
  error?: { message?: string }
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
  primary?: { usedPercent?: number | null, resetsAt?: number | null } | null
  secondary?: { usedPercent?: number | null, resetsAt?: number | null } | null
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
  server?: string
  tool?: string
  status?: string
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
  data?: Array<{ name?: string }>
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
  models?: {
    currentModelId?: string | null
    [key: string]: unknown
  }
  codex?: {
    compact?: CodexCompactSnapshot
    goal?: {
      threadId: string
      objective: string
      status: RuntimeGoalStatus
      tokenBudget: number | null
      tokensUsed: number
      timeUsedSeconds: number
      createdAt: number
      updatedAt: number
    }
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

interface CodexProviderErrorData {
  details: null
  runtimeKind: RuntimeKind
  diagnostics: CodexStreamDiagnostics
  notification?: Record<string, unknown>
}

type RuntimeMessageInput = UIMessage | string
type MessagePart = UIMessage['parts'][number]
type CodexUserInput = { type: 'text', text: string, text_elements: [] }
  | { type: 'image', detail?: 'high' | 'original', url: string }
  | { type: 'localImage', detail?: 'high' | 'original', path: string }

const RUNTIME_KIND: RuntimeKind = 'codex'
const CRADLE_CODEX_MODEL_PROVIDER = 'cradle-openai-compatible'
const CRADLE_CODEX_API_KEY_ENV = 'CRADLE_CODEX_API_KEY'
const MAX_EVENT_SAMPLES = 20
const MAX_DIAGNOSTIC_STRING_LENGTH = 2_000
const MAX_DIAGNOSTIC_ARRAY_ITEMS = 20
const MAX_DIAGNOSTIC_OBJECT_KEYS = 40
const MAX_DIAGNOSTIC_DEPTH = 4

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

  private readonly activeTurns = new Map<string, ActiveCodexTurn>()
  private _lastUsage: TokenUsage | null = null

  get lastUsage(): TokenUsage | null {
    return this._lastUsage
  }

  constructor(private readonly deps: CodexProviderDeps) {}

  private releaseTurn(sessionId: string, entry: ActiveCodexTurn): void {
    if (this.activeTurns.get(sessionId) === entry) {
      this.activeTurns.delete(sessionId)
    }
  }

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      providerTargetId: input.profile.providerTargetId,
      runtimeKind: RUNTIME_KIND,
      providerSessionId: null,
      providerStateSnapshot: JSON.stringify({ workspacePath: input.workspacePath, models: { currentModelId: input.modelId } }),
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    return {
      ...input.runtimeSession,
      providerStateSnapshot: JSON.stringify({
        ...snapshot,
        workspacePath: input.workspacePath,
        models: {
          currentModelId: input.modelId ?? snapshot.models.currentModelId,
        },
      }),
    }
  }

  async getCapabilities(_input: GetCapabilitiesInput): Promise<ChatRuntimeCapabilities> {
    return {
      runtimeKind: RUNTIME_KIND,
      slashCommands: [],
      uiSlots: projectCodexUiSlots(CODEX_APP_SERVER_CAPABILITIES),
      skills: [],
    }
  }

  async getUiSlotStates(input: GetUiSlotStatesInput): Promise<RuntimeUiSlotState[]> {
    const config = readTrustedCodexConfig(input.profile.configJson)
    const apiKey = resolveApiKey(input.profile, config.apiKey, 'OPENAI_API_KEY', this.deps)
    if (!apiKey) {
      return []
    }

    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const workspacePath = snapshot.workspacePath ?? input.workspacePath
    const runtimeSession = input.runtimeSession.providerSessionId
      ? input.runtimeSession
      : await this.resumeChatSession({
          runtimeSession: {
            ...input.runtimeSession,
            providerSessionId: null,
          },
          profile: input.profile,
          workspacePath: input.workspacePath,
          modelId: input.modelId,
        })
    if (!runtimeSession.providerSessionId) {
      return []
    }
    const client = this.createAppServerClient({
      apiKey,
      config: buildCodexConfig(config, workspacePath, this.deps.resolveSkillPaths, null, input.modelId ?? snapshot.models.currentModelId),
      serverRequestHandler: request => buildDefaultCodexAppServerRequestResult(request),
    })

    try {
      await client.initialize()
      const [goalResult, configResult, providerCapabilitiesResult, modelListResult, mcpStatusResult, rateLimitsResult, configRequirementsResult, skillsResult, pluginResult, appsResult, collaborationModesResult] = await Promise.allSettled([
        client.request('thread/goal/get', {
          threadId: runtimeSession.providerSessionId,
        }) as Promise<ThreadGoalGetResponse>,
        client.request('config/read', {
          cwd: workspacePath,
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
          cwd: workspacePath,
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
      const crewState = projectCodexCrewState(
        runtimeSession.providerSessionId,
        readCodexProviderSnapshot(runtimeSession.providerStateSnapshot),
        collaborationModes,
      )
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
      const goalState = projectCodexGoalState(goalResult.status === 'fulfilled'
        ? goalResult.value.goal
        : readCodexProviderSnapshot(runtimeSession.providerStateSnapshot).codex?.goal ?? null)
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

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    const config = readTrustedCodexConfig(input.profile.configJson)
    const apiKey = resolveApiKey(input.profile, config.apiKey, 'OPENAI_API_KEY', this.deps)
    const effectiveModel = input.modelId ?? config.model
    const userInput = projectCodexUserInput(input.message, 'Codex provider')
    const userPromptText = extractUiMessageText(input.message).trim()
    const goalCommand = parseGoalCommand(userPromptText)
    if (!apiKey) {
      throw new Error('Codex provider requires an API key')
    }

    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const workspacePath = snapshot.workspacePath ?? '.'
    const systemPromptFile = writeSystemPromptFile(input.systemPrompt)
    const codexConfig = buildCodexConfig(config, workspacePath, this.deps.resolveSkillPaths, systemPromptFile, effectiveModel)
    const client = this.createAppServerClient({
      apiKey,
      config: codexConfig,
      serverRequestHandler: request => buildDefaultCodexAppServerRequestResult(request),
    })
    const abortController = new AbortController()
    const sessionId = input.runtimeSession.chatSessionId
    const shouldInjectReconstructedHistory = !input.runtimeSession.providerSessionId
    this._lastUsage = null

    const textItemId = randomUUID()
    const mapperState = createCodexAppServerMapperState(textItemId)
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
      await client.initialize()
      const threadStart = await startOrResumeThread(client, input.runtimeSession, {
        model: effectiveModel,
        cwd: workspacePath,
        approvalPolicy: config.approvalPolicy,
        sandbox: config.sandboxMode,
        config: codexConfig,
      })
      const threadId = threadStart.threadId
      input.runtimeSession.providerSessionId = threadId
      writeCodexThreadSnapshot(input.runtimeSession, threadStart)
      if (threadStart.title) {
        input.reportSessionTitle?.(threadStart.title)
      }
      if (shouldInjectReconstructedHistory) {
        await injectCradleTranscriptHistory(client, threadId, input.transcript?.history ?? input.history)
      }

      if (goalCommand) {
        const goalResponse = await client.request('thread/goal/set', {
          threadId,
          objective: goalCommand.objective,
          status: 'active',
          tokenBudget: null,
        }) as ThreadGoalSetResponse
        const goalState = projectCodexGoalState(goalResponse.goal ?? null)
        if (goalState) {
          writeCodexGoalSnapshot(input.runtimeSession, goalState)
        }
        yield { type: 'finish', finishReason: 'stop' }
        return
      }

      const turnResponse = await client.request('turn/start', {
        threadId,
        input: userInput,
        cwd: workspacePath,
        approvalPolicy: config.approvalPolicy,
        sandboxPolicy: toSandboxPolicy(config.sandboxMode, workspacePath, config.additionalDirectories),
        model: effectiveModel,
        effort: config.reasoningEffort,
      }) as TurnResponse
      const turnId = turnResponse.turn?.id ?? turnResponse.turnId ?? null
      activeEntry = { client, abortController, threadId, turnId }
      this.activeTurns.set(sessionId, activeEntry)

      for await (const notification of readTurnNotifications(client, threadId, turnId, abortController.signal)) {
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

        if (notification.method === 'turn/started' && !activeEntry.turnId) {
          activeEntry.turnId = getTurnId(notification)
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
        if (notification.method === 'turn/completed') {
          const turn = (notification.params as TurnNotificationParams | undefined)?.turn
          if (turn?.status === 'failed') {
            throw createCodexTurnFailureError(turn.error?.message, diagnostics, notification)
          }
          break
        }
        if (notification.method === 'error') {
          if (isRetryableCodexAppServerError(notification)) {
            continue
          }
          throw createCodexAppServerError(notification, diagnostics)
        }
      }

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
        this.deps.recordObservability({
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
      throw new Error('Codex live steer requires an active turn')
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

function parseGoalCommand(text: string): CodexGoalCommand | null {
  const match = text.match(/^\/goal(?:\s+([\s\S]*))?$/i)
  if (!match) {
    return null
  }
  const objective = (match[1] ?? '').trim()
  return objective ? { objective } : null
}

function isCodexGoalStatus(value: unknown): value is RuntimeGoalStatus {
  return value === 'active'
    || value === 'paused'
    || value === 'blocked'
    || value === 'usageLimited'
    || value === 'budgetLimited'
    || value === 'complete'
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
  const usagePercent = modelContextWindow ? readPercent(last.totalTokens, modelContextWindow) : null
  const autoCompactPercent = autoCompactTokenLimit ? readPercent(last.totalTokens, autoCompactTokenLimit) : null
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

function projectCodexCrewState(
  threadId: string,
  snapshot: CodexProviderSnapshot,
  collaborationModes: CodexCollaborationModeListResponse | null,
): RuntimeCrewUiSlotState | null {
  const activity = snapshot.codex?.toolActivity
  const crewItems = (activity?.items ?? []).filter(item => item.type === 'collabAgentToolCall')
  const collaborationModeCount = collaborationModes?.data?.length ?? 0
  if (crewItems.length === 0 && collaborationModeCount === 0) {
    return null
  }
  return {
    kind: 'crew',
    slotId: 'codex:crew',
    threadId,
    activeCount: crewItems.filter(item => item.status === 'running').length,
    completedCount: crewItems.filter(item => item.status === 'completed').length,
    failedCount: crewItems.filter(item => item.status === 'failed').length,
    recentItems: crewItems,
    collaborationModeCount,
    updatedAt: Math.max(activity?.updatedAt ?? 0, collaborationModeCount > 0 ? Date.now() : 0),
  }
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
    usedPercent: readNullablePercent(rateLimits.primary?.usedPercent),
    secondaryUsedPercent: readNullablePercent(rateLimits.secondary?.usedPercent),
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

async function startOrResumeThread(
  client: CodexAppServerClientLike,
  runtimeSession: RuntimeSession,
  params: {
    model?: string | null
    cwd: string
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
    throw new Error('Codex app-server did not return a thread id')
  }
  return {
    threadId,
    title: normalizeProviderTitle(response.thread?.name),
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

async function* readTurnNotifications(
  client: CodexAppServerClientLike,
  threadId: string,
  initialTurnId: string | null,
  signal: AbortSignal,
): AsyncGenerator<CodexAppServerMessage, void, void> {
  let turnId = initialTurnId
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
    const notificationThreadId = getThreadId(notification)
    if (notificationThreadId && notificationThreadId !== threadId) {
      continue
    }
    if (notification.method === 'turn/started') {
      turnId = getTurnId(notification)
      yield notification
      continue
    }
    const notificationTurnId = getNotificationTurnId(notification)
    if (turnId && notificationTurnId && notificationTurnId !== turnId) {
      continue
    }
    yield notification
    if (notification.method === 'turn/completed') {
      return
    }
  }
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
  const codexConfig: Record<string, unknown> = {}
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
      throw new Error(`${runtimeLabel} requires non-empty text or image input`)
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
    unsupportedParts.push(part.type)
  }

  if (unsupportedParts.length > 0) {
    throw new Error(`${runtimeLabel} only supports text and image input; unsupported parts: ${unsupportedParts.join(', ')}`)
  }
  if (input.length === 0) {
    throw new Error(`${runtimeLabel} requires non-empty text or image input`)
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
  if (imageCount === 0) {
    return text
  }
  const suffix = `[${imageCount} image${imageCount === 1 ? '' : 's'}]`
  return text ? `${text}\n${suffix}` : suffix
}

function toSandboxPolicy(
  sandboxMode: CodexConfig['sandboxMode'],
  workspacePath: string,
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
    writableRoots: [workspacePath, ...additionalDirectories],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  }
}

function createDiagnostics(): CodexStreamDiagnostics {
  return {
    totalEvents: 0,
    mappedEvents: 0,
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

function normalizeProviderTitle(title: string | null | undefined): string | null {
  const normalized = title?.replace(/\s+/g, ' ').trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

function incrementCount(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1
}

function validateCodexStreamOutput(diagnostics: CodexStreamDiagnostics): { ok: boolean, errorText: string | null } {
  if (diagnostics.mappedEvents > 0) {
    return { ok: true, errorText: null }
  }
  return {
    ok: false,
    errorText: `Codex app-server stream completed without mapped timeline events. ${formatCodexDiagnostics(diagnostics)}`,
  }
}

function createCodexTurnFailureError(
  message: string | undefined,
  diagnostics: CodexStreamDiagnostics,
  notification: CodexAppServerMessage,
): CodexProviderError {
  const errorText = `Codex turn failed${message ? `: ${message}` : ''} (raw=${formatCodexDiagnostics(diagnostics)})`
  return createCodexProviderError(errorText, diagnostics, notification)
}

function createCodexAppServerError(notification: CodexAppServerMessage, diagnostics: CodexStreamDiagnostics): CodexProviderError {
  const params = notification.params as ErrorNotificationParams | undefined
  const message = params?.error?.message ?? params?.message ?? 'Codex app-server error'
  const errorText = `${message} (raw=${formatCodexDiagnostics(diagnostics)})`
  return createCodexProviderError(errorText, diagnostics, notification)
}

function isRetryableCodexAppServerError(notification: CodexAppServerMessage): boolean {
  return (notification.params as ErrorNotificationParams | undefined)?.willRetry === true
}

function createCodexEmptyStreamError(errorText: string, diagnostics: CodexStreamDiagnostics): CodexProviderError {
  return createCodexProviderError(errorText, diagnostics)
}

function createCodexProviderError(
  message: string,
  diagnostics: CodexStreamDiagnostics,
  notification?: CodexAppServerMessage,
): CodexProviderError {
  return new CodexProviderError(OBSERVABILITY_CODES.turnStreamFailed, message, {
    details: null,
    runtimeKind: RUNTIME_KIND,
    diagnostics,
    ...(notification ? { notification: buildDiagnosticNotification(notification) } : {}),
  })
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
