// Input: Issue-agent query store abstraction, optional Drizzle-backed store factory, and issue-agent schema row types
// Output: Issue-agent read-side application service for agent sessions and activity projections
// Position: Issue-agent feature query module between IPC adapters and persistence

import { eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

import { getDb } from '../db'
import type * as schema from '../db/schema'
import type { AgentActivity, AgentSession } from '../db/schema'
import { agentActivities, agentSessions } from '../db/schema'

export interface IssueAgentQueryApplicationService {
  listAgentSessions: (issueId: string) => AgentSession[]
  listAgentActivities: (agentSessionId: string) => AgentActivity[]
}

export interface IssueAgentQueryStore {
  listAgentSessionsByIssue: (issueId: string) => AgentSession[]
  listAgentActivitiesBySession: (agentSessionId: string) => AgentActivity[]
}

interface IssueAgentQueryApplicationDeps {
  store?: IssueAgentQueryStore
  db?: BetterSQLite3Database<typeof schema>
}

function resolveDefaultDb(): BetterSQLite3Database<typeof schema> {
  return getDb()
}

export function createDrizzleIssueAgentQueryStore(
  db: BetterSQLite3Database<typeof schema>,
): IssueAgentQueryStore {
  return {
    listAgentSessionsByIssue(issueId) {
      return db.select().from(agentSessions).where(eq(agentSessions.issueId, issueId)).all()
    },
    listAgentActivitiesBySession(agentSessionId) {
      return db.select().from(agentActivities).where(eq(agentActivities.agentSessionId, agentSessionId)).all()
    },
  }
}

function sortAscByCreatedAt<T extends { createdAt: number }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => left.createdAt - right.createdAt)
}

function sortDescByCreatedAt<T extends { createdAt: number }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => right.createdAt - left.createdAt)
}

export function createIssueAgentQueryApplicationService(
  deps: IssueAgentQueryApplicationDeps = {},
): IssueAgentQueryApplicationService {
  const store = deps.store ?? createDrizzleIssueAgentQueryStore(deps.db ?? resolveDefaultDb())

  const listAgentSessions: IssueAgentQueryApplicationService['listAgentSessions'] = (issueId) => {
    return sortDescByCreatedAt(store.listAgentSessionsByIssue(issueId))
  }

  const listAgentActivities: IssueAgentQueryApplicationService['listAgentActivities'] = (agentSessionId) => {
    return sortAscByCreatedAt(store.listAgentActivitiesBySession(agentSessionId))
  }

  return {
    listAgentSessions,
    listAgentActivities,
  }
}
