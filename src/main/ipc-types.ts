// Input: IPC service classes, DB schema row types, ACP/runtime support types
// Output: Shared IPC type surface for preload and renderer consumers
// Position: Main-process type aggregation module bridging service signatures across process boundaries

import type { MergeIpcService } from '@cradle/ipc'

import type { AcpService } from './services/acp'
import type { ChatService } from './services/chat'
import type { DevService } from './services/dev'
import type { IpcDevtoolService } from './services/ipc-devtool'
import type { PreferencesService } from './services/preferences'
import type { SearchService } from './services/search'
import type { SessionService } from './services/session'
import type { WorkspaceService } from './services/workspace'

/**
 * Full type map of all exposed IPC services.
 * Consumed by the preload and renderer for type-safe IPC calls.
 */
export type IpcServices = MergeIpcService<{
  workspace: typeof WorkspaceService
  session: typeof SessionService
  acp: typeof AcpService
  preferences: typeof PreferencesService
  ipcDevtool: typeof IpcDevtoolService
  dev: typeof DevService
  chat: typeof ChatService
  search: typeof SearchService
}>

// Convenience re-exports so the renderer imports from one place
export type { Message, Session, Workspace } from './db/schema'
export type { AcpAgent, AcpAuditEntry } from './db/schema'
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
export type { ModelInfo, SessionConfigOption, SessionModelState } from '@agentclientprotocol/sdk'
