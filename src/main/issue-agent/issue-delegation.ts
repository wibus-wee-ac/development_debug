// Input: Injected issue-agent store/runner adapters plus issue/agent schema row types
// Output: Issue delegation application service plus a Drizzle-backed store for delegate/run/stop/undelegate commands
// Position: Issue-agent feature write-side rules with app-level dependency wiring kept outside this file

import { randomUUID } from 'node:crypto'

import { and, eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

import type * as schema from '../db/schema'
import type { AgentProfile, AgentSession } from '../db/schema'
import { agentProfiles, agentSessions, kanbanIssueComments, kanbanIssues } from '../db/schema'

const defaultNowUnix = (): number => Math.floor(Date.now() / 1000)

export interface IssueDelegationStore {
  getAgentProfile: (agentProfileId: string) => Pick<AgentProfile, 'id' | 'name'> | undefined
  createDelegation: (input: {
    issueId: string
    agentProfileId: string
    agentProfileName: string
    sessionId: string
    timestamp: number
  }) => AgentSession | undefined
  removeDelegation: (input: {
    issueId: string
    timestamp: number
  }) => void
}

export interface IssueDelegationRunner {
  run: (input: {
    issueId: string
    agentSessionId: string
    agentProfileId: string
    agentId?: string
  }) => Promise<void>
  stop: (agentSessionId: string) => Promise<void>
}

export interface IssueDelegationApplicationService {
  delegateIssue: (input: { issueId: string, agentProfileId: string }) => Promise<AgentSession>
  runDelegatedIssue: (input: {
    issueId: string
    agentSessionId: string
    agentProfileId: string
    agentId?: string
  }) => Promise<void>
  stopAgentSession: (agentSessionId: string) => Promise<void>
  undelegateIssue: (issueId: string) => Promise<void>
}

interface IssueDelegationApplicationDeps {
  store: IssueDelegationStore
  runner: IssueDelegationRunner
  nowUnix?: () => number
}

export function createDrizzleIssueDelegationStore(
  db: BetterSQLite3Database<typeof schema>,
): IssueDelegationStore {
  return {
    getAgentProfile(agentProfileId) {
      return db
        .select({ id: agentProfiles.id, name: agentProfiles.name })
        .from(agentProfiles)
        .where(eq(agentProfiles.id, agentProfileId))
        .get()
    },
    createDelegation({ issueId, agentProfileId, agentProfileName, sessionId, timestamp }) {
      return db.transaction((tx) => {
        tx.update(agentSessions)
          .set({ status: 'stopped', updatedAt: timestamp })
          .where(and(
            eq(agentSessions.issueId, issueId),
            eq(agentSessions.status, 'active'),
          ))
          .run()

        tx.update(kanbanIssues)
          .set({ delegateAgentId: agentProfileId, updatedAt: timestamp })
          .where(eq(kanbanIssues.id, issueId))
          .run()

        tx.insert(agentSessions).values({
          id: sessionId,
          issueId,
          agentProfileId,
          status: 'created',
          createdAt: timestamp,
          updatedAt: timestamp,
        }).run()

        tx.insert(kanbanIssueComments).values({
          id: randomUUID(),
          issueId,
          content: `Delegated to ${agentProfileName}`,
          authorKind: 'system.delegated',
          authorId: null,
          createdAt: timestamp,
        }).run()

        return tx.select().from(agentSessions).where(eq(agentSessions.id, sessionId)).get()
      })
    },
    removeDelegation({ issueId, timestamp }) {
      db.transaction((tx) => {
        tx.update(agentSessions)
          .set({ status: 'stopped', updatedAt: timestamp })
          .where(and(
            eq(agentSessions.issueId, issueId),
            eq(agentSessions.status, 'active'),
          ))
          .run()

        tx.update(kanbanIssues)
          .set({ delegateAgentId: null, updatedAt: timestamp })
          .where(eq(kanbanIssues.id, issueId))
          .run()

        tx.insert(kanbanIssueComments).values({
          id: randomUUID(),
          issueId,
          content: 'Delegation removed',
          authorKind: 'system.undelegated',
          authorId: null,
          createdAt: timestamp,
        }).run()
      })
    },
  }
}

export function createIssueDelegationApplicationService(
  deps: IssueDelegationApplicationDeps,
): IssueDelegationApplicationService {
  const nowUnix = deps.nowUnix ?? defaultNowUnix
  const { runner, store } = deps

  const delegateIssue: IssueDelegationApplicationService['delegateIssue'] = async ({ issueId, agentProfileId }) => {
    const profile = store.getAgentProfile(agentProfileId)
    if (!profile) {
      throw new Error(`Agent profile ${agentProfileId} not found`)
    }

    const created = store.createDelegation({
      issueId,
      agentProfileId,
      agentProfileName: profile.name,
      sessionId: randomUUID(),
      timestamp: nowUnix(),
    })
    if (!created) {
      throw new Error(`Delegation session was not created for issue ${issueId}`)
    }
    return created
  }

  const runDelegatedIssue: IssueDelegationApplicationService['runDelegatedIssue'] = async (input) => {
    await runner.run(input)
  }

  const stopAgentSession: IssueDelegationApplicationService['stopAgentSession'] = async (agentSessionId) => {
    await runner.stop(agentSessionId)
  }

  const undelegateIssue: IssueDelegationApplicationService['undelegateIssue'] = async (issueId) => {
    store.removeDelegation({ issueId, timestamp: nowUnix() })
  }

  return {
    delegateIssue,
    runDelegatedIssue,
    stopAgentSession,
    undelegateIssue,
  }
}
