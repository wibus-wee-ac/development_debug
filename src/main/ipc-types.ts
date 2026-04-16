import type { MergeIpcService } from '@cradle/ipc'
import type { WorkspaceService } from './services/workspace'
import type { SessionService } from './services/session'

/**
 * Full type map of all exposed IPC services.
 * Consumed by the preload and renderer for type-safe IPC calls.
 */
export type IpcServices = MergeIpcService<{
  workspace: typeof WorkspaceService
  session: typeof SessionService
}>

// Convenience re-exports so the renderer imports from one place
export type { Workspace, Session, Message } from './db/schema'
