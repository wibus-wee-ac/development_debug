import type { MergeIpcService } from '@cradle/ipc'

import type { SessionService } from './services/session'
import type { WorkspaceService } from './services/workspace'

/**
 * Full type map of all exposed IPC services.
 * Consumed by the preload and renderer for type-safe IPC calls.
 */
export type IpcServices = MergeIpcService<{
  workspace: typeof WorkspaceService
  session: typeof SessionService
}>

// Convenience re-exports so the renderer imports from one place
export type { Message, Session, Workspace } from './db/schema'
