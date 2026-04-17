import type { MergeIpcService } from '@cradle/ipc'

import type { AcpService } from './services/acp'
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
}>

// Convenience re-exports so the renderer imports from one place
export type { Message, Session, Workspace } from './db/schema'
export type { AcpAgent, AcpAuditEntry } from './db/schema'
export type { RegistryAgent } from './lib/acp-registry'
