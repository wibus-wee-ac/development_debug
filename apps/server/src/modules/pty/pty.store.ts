// Input: DbAccessor and session/profile/workspace tables
// Output: DB-backed terminal-session context resolution
// Position: apps/server/src/modules/pty/pty.store.ts

import { inject, injectable } from 'tsyringe'

import type { AgentProfile, Session, Workspace } from '@cradle/db'
import { agentProfiles, sessions, workspaces } from '@cradle/db'
import { eq } from 'drizzle-orm'

import { DbAccessor } from '../../database/db-accessor'

export interface TerminalSessionContext {
  session: Session
  workspace: Workspace
  profile: AgentProfile
}

@injectable()
export class PtyStore {
  constructor(@inject(DbAccessor) private readonly dbAccessor: DbAccessor) {}

  getSession(sessionId: string): Session | undefined {
    return this.dbAccessor.get().select().from(sessions).where(eq(sessions.id, sessionId)).get()
  }

  getTerminalContext(sessionId: string): TerminalSessionContext | null {
    const session = this.getSession(sessionId)
    if (!session) {
      return null
    }
    const workspace = this.dbAccessor.get().select().from(workspaces).where(eq(workspaces.id, session.workspaceId)).get()
    const profile = this.dbAccessor.get().select().from(agentProfiles).where(eq(agentProfiles.id, session.agentProfileId)).get()
    if (!workspace || !profile) {
      return null
    }
    return { session, workspace, profile }
  }
}
