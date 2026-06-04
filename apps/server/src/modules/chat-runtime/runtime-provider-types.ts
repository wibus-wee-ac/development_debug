import type { UIMessage, UIMessageChunk } from 'ai'

import type { ProviderKind, RuntimeKind } from '../provider-contracts/types'
import type { CradleTurnTranscript } from './transcript'

export interface RuntimeProviderTargetProfile {
  id: string
  name: string
  providerKind: ProviderKind
  enabled: boolean
  configJson: string
  credentialRef: string | null
  customModels: string
  iconSlug: string | null
  providerTargetKind: 'manual' | 'external'
  providerTargetId: string
}

export interface RuntimeSlashCommand {
  name: string
  description: string
  argumentHint: string
  aliases?: string[]
}

export type RuntimeUiSlotSurface
  = | 'slashCommand'
    | 'toolbarPicker'
    | 'composerState'
    | 'messageInline'
    | 'runtimePanel'
    // Stream evidence is rendered from provider-emitted message/tool chunks, not from polled slot state.
    | 'streamEvidence'
    | 'recordOnly'

export type RuntimeUiSlotIconKey
  = | 'alert'
    | 'approvals'
    | 'code-review'
    | 'compact'
    | 'config'
    | 'diff'
    | 'feedback'
    | 'filesystem'
    | 'goal'
    | 'crew'
    | 'ide-context'
    | 'mcp'
    | 'model'
    | 'personality'
    | 'plugin'
    | 'plan'
    | 'reasoning'
    | 'search'
    | 'side-chat'
    | 'skills'
    | 'status'
    | 'terminal'
    | 'tool-activity'
    | 'usage'

export interface RuntimeUiSlot {
  id: string
  name: string
  label: string
  description: string
  argumentHint: string
  aliases?: string[]
  iconKey?: RuntimeUiSlotIconKey
  commandText?: string
  surfaces: RuntimeUiSlotSurface[]
}

export type RuntimeUiSlotStateKind = 'alert' | 'approvals' | 'compact' | 'config' | 'crew' | 'diff' | 'filesystem' | 'goal' | 'mcp' | 'model' | 'plan' | 'plugin' | 'reasoning' | 'search' | 'skills' | 'status' | 'terminal' | 'toolActivity' | 'usage'

export type RuntimeGoalStatus = 'active' | 'paused' | 'blocked' | 'usageLimited' | 'budgetLimited' | 'complete'
export type RuntimeCompactStatus = 'idle' | 'running' | 'nearLimit' | 'overLimit' | 'compacted'
export type RuntimeThreadStatus = 'notLoaded' | 'idle' | 'systemError' | 'active'
export type RuntimePlanStepStatus = 'pending' | 'inProgress' | 'completed'
export type RuntimeToolActivityStatus = 'running' | 'completed' | 'failed'
export type RuntimeMcpServerStatus = 'starting' | 'ready' | 'failed' | 'cancelled' | 'unknown'
export type RuntimeMcpAuthStatus = 'unsupported' | 'notLoggedIn' | 'bearerToken' | 'oAuth' | 'unknown'
export type RuntimeApprovalStatus = 'pending' | 'approved' | 'denied' | 'timedOut' | 'aborted'
export type RuntimeAlertSeverity = 'info' | 'warning' | 'error'

export interface RuntimeTokenUsageBreakdown {
  totalTokens: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
}

export interface RuntimeGoalUiSlotState {
  kind: 'goal'
  slotId: string
  threadId: string
  objective: string
  status: RuntimeGoalStatus
  tokenBudget: number | null
  tokensUsed: number
  timeUsedSeconds: number
  createdAt: number
  updatedAt: number
}

export interface RuntimeCompactUiSlotState {
  kind: 'compact'
  slotId: string
  threadId: string
  turnId: string | null
  status: RuntimeCompactStatus
  isCompactRelevant: boolean
  total: RuntimeTokenUsageBreakdown
  last: RuntimeTokenUsageBreakdown
  modelContextWindow: number | null
  autoCompactTokenLimit: number | null
  usagePercent: number | null
  autoCompactPercent: number | null
  lastCompactedAt: number | null
  compactionItemId: string | null
  updatedAt: number
}

export interface RuntimeStatusUiSlotState {
  kind: 'status'
  slotId: string
  threadId: string
  status: RuntimeThreadStatus
  activeFlags: string[]
  updatedAt: number
}

export interface RuntimeModelUiSlotState {
  kind: 'model'
  slotId: string
  threadId: string
  modelId: string | null
  modelLabel: string | null
  modelProvider: string | null
  serviceTier: string | null
  supportsImages: boolean | null
  supportsWebSearch: boolean | null
  supportsNamespaceTools: boolean | null
  updatedAt: number
}

export interface RuntimeReasoningUiSlotState {
  kind: 'reasoning'
  slotId: string
  threadId: string
  effort: string | null
  summary: string | null
  supportedEfforts: Array<{ id: string, description: string }>
  updatedAt: number
}

export interface RuntimePlanStep {
  step: string
  status: RuntimePlanStepStatus
}

export interface RuntimePlanUiSlotState {
  kind: 'plan'
  slotId: string
  threadId: string
  turnId: string | null
  explanation: string | null
  steps: RuntimePlanStep[]
  currentStep: string | null
  pendingCount: number
  inProgressCount: number
  completedCount: number
  updatedAt: number
}

export interface RuntimeToolActivityItem {
  id: string
  type: string
  label: string
  status: RuntimeToolActivityStatus
  startedAt: number | null
  completedAt: number | null
}

export interface RuntimeToolActivityUiSlotState {
  kind: 'toolActivity'
  slotId: string
  threadId: string
  turnId: string | null
  activeCount: number
  completedCount: number
  failedCount: number
  recentItems: RuntimeToolActivityItem[]
  updatedAt: number
}

export interface RuntimeCrewCollaborationMode {
  name: string
  mode: string | null
  model: string | null
  reasoningEffort: string | null
}

export interface RuntimeCrewAgentItem {
  threadId: string
  status: string | null
  message: string | null
  name: string | null
  preview: string | null
  modelProvider: string | null
  agentNickname: string | null
  agentRole: string | null
}

export interface RuntimeCrewCallItem {
  id: string
  tool: string
  status: RuntimeToolActivityStatus
  senderThreadId: string | null
  receiverThreadIds: string[]
  prompt: string | null
  model: string | null
  reasoningEffort: string | null
  agents: RuntimeCrewAgentItem[]
  startedAt: number | null
  completedAt: number | null
}

export interface RuntimeMcpServerSummary {
  name: string
  status: RuntimeMcpServerStatus
  authStatus: RuntimeMcpAuthStatus
  toolCount: number
  resourceCount: number
  error: string | null
}

export interface RuntimeMcpUiSlotState {
  kind: 'mcp'
  slotId: string
  threadId: string
  serverCount: number
  readyCount: number
  failedCount: number
  needsLoginCount: number
  recentProgress: string | null
  servers: RuntimeMcpServerSummary[]
  updatedAt: number
}

export interface RuntimeDiffUiSlotState {
  kind: 'diff'
  slotId: string
  threadId: string
  turnId: string | null
  fileCount: number
  addedLines: number
  removedLines: number
  hasDiff: boolean
  updatedAt: number
}

export interface RuntimeTerminalUiSlotState {
  kind: 'terminal'
  slotId: string
  threadId: string
  turnId: string | null
  activeCount: number
  completedCount: number
  failedCount: number
  lastCommand: string | null
  lastOutputPreview: string | null
  updatedAt: number
}

export interface RuntimeApprovalItem {
  id: string
  targetItemId: string | null
  status: RuntimeApprovalStatus
  label: string
  riskLevel: string | null
  rationale: string | null
  startedAt: number | null
  completedAt: number | null
}

export interface RuntimeApprovalsUiSlotState {
  kind: 'approvals'
  slotId: string
  threadId: string
  turnId: string | null
  pendingCount: number
  approvedCount: number
  deniedCount: number
  recentItems: RuntimeApprovalItem[]
  updatedAt: number
}

export interface RuntimeAlertItem {
  id: string
  severity: RuntimeAlertSeverity
  message: string
  source: string
  updatedAt: number
}

export interface RuntimeAlertUiSlotState {
  kind: 'alert'
  slotId: string
  threadId: string | null
  warningCount: number
  errorCount: number
  recentItems: RuntimeAlertItem[]
  updatedAt: number
}

export interface RuntimeFilesystemUiSlotState {
  kind: 'filesystem'
  slotId: string
  threadId: string
  changedPathCount: number
  recentPaths: string[]
  updatedAt: number
}

export interface RuntimeSkillsUiSlotState {
  kind: 'skills'
  slotId: string
  threadId: string
  enabledCount: number
  disabledCount: number
  errorCount: number
  roots: string[]
  updatedAt: number
}

export interface RuntimePluginUiSlotState {
  kind: 'plugin'
  slotId: string
  threadId: string
  installedCount: number
  enabledCount: number
  appCount: number
  marketplaceCount: number
  errorCount: number
  updatedAt: number
}

export interface RuntimeSearchUiSlotState {
  kind: 'search'
  slotId: string
  threadId: string
  recentResultCount: number
  recentQuery: string | null
  fuzzySessionActive: boolean
  updatedAt: number
}

export interface RuntimeCrewUiSlotState {
  kind: 'crew'
  slotId: string
  threadId: string
  activeCount: number
  completedCount: number
  failedCount: number
  recentItems: RuntimeToolActivityItem[]
  collaborationModeCount: number
  collaborationModes: RuntimeCrewCollaborationMode[]
  calls: RuntimeCrewCallItem[]
  updatedAt: number
}

export interface RuntimeUsageUiSlotState {
  kind: 'usage'
  slotId: string
  threadId: string
  limitName: string | null
  usedPercent: number | null
  primaryWindowDurationMins: number | null
  primaryResetsAt: number | null
  secondaryUsedPercent: number | null
  secondaryWindowDurationMins: number | null
  secondaryResetsAt: number | null
  creditsBalance: string | null
  hasCredits: boolean | null
  rateLimitReachedType: string | null
  planType: string | null
  updatedAt: number
}

export interface RuntimeConfigUiSlotState {
  kind: 'config'
  slotId: string
  threadId: string
  modelId: string | null
  approvalPolicy: string | null
  sandboxMode: string | null
  allowedApprovalPolicyCount: number | null
  allowedSandboxModeCount: number | null
  featureRequirementCount: number | null
  webSearchModeCount: number | null
  updatedAt: number
}

export type RuntimeUiSlotState
  = | RuntimeAlertUiSlotState
    | RuntimeApprovalsUiSlotState
    | RuntimeCompactUiSlotState
    | RuntimeConfigUiSlotState
    | RuntimeCrewUiSlotState
    | RuntimeDiffUiSlotState
    | RuntimeFilesystemUiSlotState
    | RuntimeGoalUiSlotState
    | RuntimeMcpUiSlotState
    | RuntimeModelUiSlotState
    | RuntimePlanUiSlotState
    | RuntimePluginUiSlotState
    | RuntimeReasoningUiSlotState
    | RuntimeSearchUiSlotState
    | RuntimeSkillsUiSlotState
    | RuntimeStatusUiSlotState
    | RuntimeTerminalUiSlotState
    | RuntimeToolActivityUiSlotState
    | RuntimeUsageUiSlotState

export interface ChatRuntimeCapabilities {
  runtimeKind: RuntimeKind
  slashCommands: RuntimeSlashCommand[]
  uiSlots: RuntimeUiSlot[]
  skills: string[]
}

export type RuntimeCatalogSurface = 'chat' | 'jarvis'

export interface ChatRuntimeMetadata {
  label: string
  description?: string
  providerKinds: ProviderKind[]
  iconKey?: string
  surfaces?: RuntimeCatalogSurface[]
  sortOrder?: number
}

export interface ChatRuntimeCatalogItem extends ChatRuntimeMetadata {
  runtimeKind: RuntimeKind
  source: 'builtin' | 'plugin'
  pluginOwner: string | null
}

export type ChatPermissionMode = 'bypassPermissions' | 'plan'

export interface RuntimeSession {
  id: string
  chatSessionId: string
  providerTargetId: string
  runtimeKind: RuntimeKind
  providerSessionId: string | null
  providerStateSnapshot: string | null
}

export interface StartChatSessionInput {
  chatSessionId: string
  profile: RuntimeProviderTargetProfile
  workspacePath: string
  agentId?: string | null
  modelId?: string
  previousProviderStateSnapshot?: string | null
}

export interface ResumeChatSessionInput {
  runtimeSession: RuntimeSession
  profile: RuntimeProviderTargetProfile
  workspacePath: string
  agentId?: string | null
  modelId?: string
}

export interface StreamTurnInput {
  runId: string
  runtimeSession: RuntimeSession
  profile: RuntimeProviderTargetProfile
  message: UIMessage
  transcript?: CradleTurnTranscript
  originalMessages?: UIMessage[]
  responseMessageId?: string
  modelId?: string
  workspaceId?: string | null
  workspacePath?: string
  agentId?: string | null
  providerOptions?: {
    thinkingEffort?: 'low' | 'medium' | 'high' | 'xhigh'
    permissionMode?: ChatPermissionMode
  }
  systemPrompt?: string
  history?: UIMessage[]
  reportSessionTitle?: (title: string) => void
}

export interface CancelTurnInput {
  runtimeSession: RuntimeSession
  profile: RuntimeProviderTargetProfile
}

export interface SteerTurnInput {
  runtimeSession: RuntimeSession
  profile: RuntimeProviderTargetProfile
  message: UIMessage
}

export interface ExecuteShellCommandInput {
  runtimeSession: RuntimeSession
  profile: RuntimeProviderTargetProfile
  workspaceId?: string | null
  workspacePath: string
  agentId?: string | null
  modelId?: string
  command: string
  signal?: AbortSignal
}

export interface ExecuteShellCommandResult {
  command: string
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
  timedOut: boolean
  truncated: boolean
}

export interface GetCapabilitiesInput {
  runtimeSession: RuntimeSession
  profile: RuntimeProviderTargetProfile
  workspaceId?: string | null
  workspacePath: string
  agentId?: string | null
  modelId?: string
  systemPrompt?: string
}

export interface GetUiSlotStatesInput extends GetCapabilitiesInput {}

export interface SetPermissionModeInput {
  runtimeSession: RuntimeSession
  profile: RuntimeProviderTargetProfile
  mode: ChatPermissionMode
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface ChatRuntime {
  readonly runtimeKind: RuntimeKind
  readonly metadata?: ChatRuntimeMetadata
  readonly lastUsage?: TokenUsage | null
  readonly lastModelId?: string | null
  startChatSession: (input: StartChatSessionInput) => Promise<RuntimeSession>
  resumeChatSession: (input: ResumeChatSessionInput) => Promise<RuntimeSession>
  getDraftCapabilities?: () => Promise<ChatRuntimeCapabilities> | ChatRuntimeCapabilities
  getCapabilities?: (input: GetCapabilitiesInput) => Promise<ChatRuntimeCapabilities>
  getUiSlotStates?: (input: GetUiSlotStatesInput) => Promise<RuntimeUiSlotState[]>
  /**
   * Stream a turn, yielding AI SDK UIMessageChunk events directly.
   * No custom intermediate abstraction — pure AI SDK protocol.
  */
  streamTurn: (input: StreamTurnInput) => AsyncGenerator<UIMessageChunk, void, void>
  steerTurn?: (input: SteerTurnInput) => Promise<void>
  executeShellCommand?: (input: ExecuteShellCommandInput) => Promise<ExecuteShellCommandResult>
  cancelTurn: (input: CancelTurnInput) => Promise<void>
  setPermissionMode?: (input: SetPermissionModeInput) => Promise<void>
}
