// Input: DbAccessor and issue-agent related tables
// Output: DB-backed issue-agent persistence for delegation state, sessions, activities, and chat-session binding
// Position: apps/server/src/modules/issue-agent/issue-agent.store.ts

import { randomUUID } from 'node:crypto'

import type { AgentActivity, AgentProfile, AgentSession, BackendRun, KanbanIssue } from '@cradle/db'
import {
  agentActivities,
  agentProfiles,
  agentSessions,
  backendRuns,
  kanbanIssues,
} from '@cradle/db'
import { desc, eq } from 'drizzle-orm'
import { inject, injectable } from 'tsyringe'

import { DbAccessor } from '../../database/db-accessor'

export interface IssueAgentDelegationState {
  issueId: string
  delegated: boolean
  agentProfileId: string | null
  agentSessionId: string | null
  chatSessionId: string | null
}

@injectable()
export class IssueAgentStore {
  constructor(@inject(DbAccessor) private readonly dbAccessor: DbAccessor) {}

  getIssue(issueId: string): KanbanIssue | undefined {
    return this.dbAccessor.get().select().from(kanbanIssues).where(eq(kanbanIssues.id, issueId)).get()
  }

  getAgentProfile(agentProfileId: string): Pick<AgentProfile, 'id' | 'name' | 'enabled'> | undefined {
    return this.dbAccessor.get()
      .select({ id: agentProfiles.id, name: agentProfiles.name, enabled: agentProfiles.enabled })
      .from(agentProfiles)
      .where(eq(agentProfiles.id, agentProfileId))
      .get()
  }

  getAgentSession(agentSessionId: string): AgentSession | undefined {
    return this.dbAccessor.get().select().from(agentSessions).where(eq(agentSessions.id, agentSessionId)).get()
  }

  listAgentSessions(issueId: string): AgentSession[] {
    return this.dbAccessor.get().select().from(agentSessions).where(eq(agentSessions.issueId, issueId)).orderBy(desc(agentSessions.createdAt)).all()
  }

  listAgentActivities(agentSessionId: string): AgentActivity[] {
    return this.dbAccessor.get().select().from(agentActivities).where(eq(agentActivities.agentSessionId, agentSessionId)).orderBy(agentActivities.createdAt).all()
  }

  createDelegationSession(input: { issueId: string, agentProfileId: string }): AgentSession {
    const now = nowUnix()
    return this.dbAccessor.get().insert(agentSessions).values({
      id: randomUUID(),
      issueId: input.issueId,
      agentProfileId: input.agentProfileId,
      chatSessionId: null,
      status: 'created',
      createdAt: now,
      updatedAt: now,
    }).returning().get()
  }

  attachChatSession(input: { agentSessionId: string, chatSessionId: string }): AgentSession | undefined {
    this.dbAccessor.get().update(agentSessions).set({
      chatSessionId: input.chatSessionId,
      updatedAt: nowUnix(),
    }).where(eq(agentSessions.id, input.agentSessionId)).run()
    return this.getAgentSession(input.agentSessionId)
  }

  updateAgentSessionStatus(agentSessionId: string, status: AgentSession['status']): AgentSession | undefined {
    this.dbAccessor.get().update(agentSessions).set({ status, updatedAt: nowUnix() }).where(eq(agentSessions.id, agentSessionId)).run()
    return this.getAgentSession(agentSessionId)
  }

  createActivity(input: {
    agentSessionId: string
    type: AgentActivity['type']
    body: string
    signal?: string | null
    signalMetadata?: Record<string, unknown> | null
  }): AgentActivity {
    return this.dbAccessor.get().insert(agentActivities).values({
      id: randomUUID(),
      agentSessionId: input.agentSessionId,
      type: input.type,
      content: JSON.stringify({ body: input.body }),
      signal: input.signal ?? null,
      signalMetadata: input.signalMetadata ? JSON.stringify(input.signalMetadata) : null,
      createdAt: nowUnix(),
    }).returning().get()
  }

  getLatestRun(runId: string): BackendRun | undefined {
    return this.dbAccessor.get().select().from(backendRuns).where(eq(backendRuns.id, runId)).get()
  }

  getLatestRunByChatSession(chatSessionId: string): BackendRun | undefined {
    return this.dbAccessor.get().select().from(backendRuns).where(eq(backendRuns.chatSessionId, chatSessionId)).orderBy(desc(backendRuns.startedAt)).get()
  }

  getDelegationState(issueId: string): IssueAgentDelegationState {
    const latestSession = this.listAgentSessions(issueId)[0]
    if (!latestSession) {
      return {
        issueId,
        delegated: false,
        agentProfileId: null,
        agentSessionId: null,
        chatSessionId: null,
      }
    }

    const latestActivity = this.listAgentActivities(latestSession.id).at(-1)
    if (latestActivity?.signal === 'delegation.removed') {
      return {
        issueId,
        delegated: false,
        agentProfileId: null,
        agentSessionId: null,
        chatSessionId: null,
      }
    }

    return {
      issueId,
      delegated: true,
      agentProfileId: latestSession.agentProfileId,
      agentSessionId: latestSession.id,
      chatSessionId: latestSession.chatSessionId,
    }
  }
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000)
}
