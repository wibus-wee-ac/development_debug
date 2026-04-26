// Input: IPC service classes, DB schema row types, ACP/runtime support types
// Output: Shared IPC type surface for preload and renderer consumers
// Position: Main-process type aggregation module bridging service signatures across process boundaries

import type { MergeIpcService } from '@cradle/ipc'

import type { AcpService } from './services/acp'
import type { AgentRuntimeService } from './services/agent-runtime'
import type { ChatService } from './services/chat'
import type { DevService } from './services/dev'
import type { GitService } from './services/git'
import type { IpcDevtoolService } from './services/ipc-devtool'
import type { KanbanService } from './services/kanban'
import type { PreferencesService } from './services/preferences'
import type { PtyService } from './services/pty'
import type { SearchService } from './services/search'
import type { SessionService } from './services/session'
import type { UsageService } from './services/usage'
import type { WindowService } from './services/window'
import type { WorkspaceService } from './services/workspace'

/**
 * Full type map of all exposed IPC services.
 * Consumed by the preload and renderer for type-safe IPC calls.
 */
export type IpcServices = MergeIpcService<{
  workspace: typeof WorkspaceService
  session: typeof SessionService
  agentRuntime: typeof AgentRuntimeService
  acp: typeof AcpService
  preferences: typeof PreferencesService
  ipcDevtool: typeof IpcDevtoolService
  dev: typeof DevService
  chat: typeof ChatService
  search: typeof SearchService
  pty: typeof PtyService
  window: typeof WindowService
  git: typeof GitService
  kanban: typeof KanbanService
  usage: typeof UsageService
}>

// Convenience re-exports so the renderer imports from one place
export type { CredentialMetadata } from './agent-runtime/credential-vault'
export type { ModelDescriptor, ProviderKind, ProviderProbeResult } from './agent-runtime/types'
export type { Message, Session, Workspace } from './db/schema'
export type {
  AcpAgent,
  AcpAuditEntry,
  AgentCredential,
  AgentProfile,
  RuntimeAuditEntry,
  RuntimeSession,
} from './db/schema'
export type { KanbanBoard, KanbanIssue, KanbanIssueComment, KanbanIssueRelation, KanbanMilestone, KanbanStatus } from './db/schema'
export type { AgentActivity, AgentSession } from './db/schema'
export type { AcpSessionState } from './lib/acp-connection'
export type { ProcessMetrics } from './lib/acp-process-manager'
export type { RegistryAgent } from './lib/acp-registry'
export type { ChatMessage, EnsureLiveResult } from './lib/chat-engine'
export type { ChatResponseEventPayload, ResponseStreamEvent } from './lib/chat-provider'
export type {
  MatchRange,
  ThreadSearchHit,
  ThreadSearchParams,
  ThreadSearchSnippet,
} from './lib/thread-search'
export type { GitBranches, GitGraphCommit, GitLocalBranch, GitRemoteBranch, GitStatus } from './services/git'
export type { DailyUsage, UsageSummary } from './services/usage'
export type { AcpDevtoolEvent } from '@cradle/ipc'
