// Input: IPC service classes, DB schema row types, ACP/runtime support types
// Output: Shared IPC type surface for preload and renderer consumers
// Position: Main-process type aggregation module bridging service signatures across process boundaries

import type { MergeIpcService } from '@cradle/ipc'

import type { AcpService } from './app/ipc/acp'
import type { AgentService } from './app/ipc/agent'
import type { AgentRuntimeService } from './app/ipc/agent-runtime'
import type { ApprovalService } from './app/ipc/approval'
import type { ChatService } from './app/ipc/chat'
import type { DevService } from './app/ipc/dev'
import type { GitService } from './app/ipc/git'
import type { IpcDevtoolService } from './app/ipc/ipc-devtool'
import type { IssueAgentService } from './app/ipc/issue-agent'
import type { KanbanService } from './app/ipc/kanban'
import type { PackCodebaseService } from './app/ipc/pack-codebase'
import type { PreferencesService } from './app/ipc/preferences'
import type { PtyService } from './app/ipc/pty'
import type { SearchService } from './app/ipc/search'
import type { SessionService } from './app/ipc/session'
import type { SkillsService } from './app/ipc/skills'
import type { UsageService } from './app/ipc/usage'
import type { WindowService } from './app/ipc/window'
import type { WorkflowRulesService } from './app/ipc/workflow-rules'
import type { WorkspaceService } from './app/ipc/workspace'

/**
 * Full type map of all exposed IPC services.
 * Consumed by the preload and renderer for type-safe IPC calls.
 */
export type IpcServices = MergeIpcService<{
  workspace: typeof WorkspaceService
  session: typeof SessionService
  agent: typeof AgentService
  agentRuntime: typeof AgentRuntimeService
  acp: typeof AcpService
  approval: typeof ApprovalService
  preferences: typeof PreferencesService
  ipcDevtool: typeof IpcDevtoolService
  dev: typeof DevService
  chat: typeof ChatService
  search: typeof SearchService
  pty: typeof PtyService
  window: typeof WindowService
  git: typeof GitService
  kanban: typeof KanbanService
  issueAgent: typeof IssueAgentService
  usage: typeof UsageService
  skills: typeof SkillsService
  workflowRules: typeof WorkflowRulesService
  packCodebase: typeof PackCodebaseService
}>

// Convenience re-exports so the renderer imports from one place
export type { ChatTimelineEventPayload } from '../shared/chat-events'
export type { AcpSessionState } from './acp/acp-connection'
export type { ProcessMetrics } from './acp/acp-process-manager'
export type { RegistryAgent } from './acp/acp-registry'
export type { CredentialMetadata } from './agent-runtime/credential-vault'
export type { ModelDescriptor, ProviderHealthCheckResult, ProviderKind } from './agent-runtime/runtime-provider-types'
export type { CreateAgentInput, UpdateAgentInput } from './app/ipc/agent'
export type { GitBranches, GitFileStatus, GitGraphCommit, GitLocalBranch, GitRemoteBranch, GitStatus } from './app/ipc/git'
export type { DailyUsage, UsageSummary } from './app/ipc/usage'
export type { EnsureLiveResult } from './chat/chat-engine'
export type {
  MatchRange,
  ThreadSearchHit,
  ThreadSearchParams,
  ThreadSearchSnippet,
} from './chat/thread-search'
export type { ChatTimelineGroup } from './chat/timeline-query'
export type { Message, Session, Workspace } from './db/schema'
export type {
  AcpAgent,
  AcpAuditEntry,
  Agent,
  AgentCredential,
  AgentProfile,
  RuntimeAuditEntry,
} from './db/schema'
export type { KanbanBoard, KanbanIssue, KanbanIssueComment, KanbanIssueRelation, KanbanMilestone, KanbanStatus } from './db/schema'
export type { AgentActivity, AgentSession } from './db/schema'
export type { DiscoveredSkill, ParsedSkillSource, SkillSourceType } from './skills/skill-source'
export type {
  CreateSkillInput,
  SkillCatalogEntry,
  SkillContext,
  SkillDocument,
  SkillInventoryEntry,
  SkillScope,
  UpdateSkillInput,
} from './skills/skills'
export type { AcpDevtoolEvent } from '@cradle/ipc'

// Pack-codebase types — inlined here so the renderer doesn't need to resolve the feature module
export type PackStyle = 'xml' | 'markdown' | 'plain'

export interface PackCodebaseOptions {
  style: PackStyle
  compress: boolean
  include?: string
  ignore?: string
  removeComments?: boolean
  removeEmptyLines?: boolean
}

export interface PackCodebaseResult {
  content: string
  totalFiles: number
  totalTokens: number
}
