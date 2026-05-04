// Input: Drizzle DB context, issue/agent schema tables, and IssueAgentRunner coordination
// Output: Issue delegation application service with delegate/run/stop/undelegate commands
// Position: Application-layer orchestration boundary between IPC services and lib runners

import { randomUUID } from 'node:crypto'

import { and, eq } from 'drizzle-orm'

import { getDb } from '../db'
import type { AgentSession } from '../db/schema'
import { agentProfiles, agentSessions, kanbanIssueComments, kanbanIssues } from '../db/schema'
import { IssueAgentRunner } from '../lib/issue-agent-runner'

const defaultNowUnix = (): number => Math.floor(Date.now() / 1000)

export interface IssueDelegationDbContext {
  select: () => { from: (table: unknown) => { where: (condition: unknown) => { get: () => unknown, all: () => unknown[] }, all: () => unknown[] } }
  update: (table: unknown) => { set: (values: Record<string, unknown>) => { where: (condition: unknown) => { run: () => void } } }
  insert: (table: unknown) => { values: (values: Record<string, unknown>) => { run: () => void } }
  transaction: (tx: (db: IssueDelegationDbContext) => unknown) => unknown
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
  db?: IssueDelegationDbContext
  runner?: IssueDelegationRunner
  nowUnix?: () => number
}

export function createIssueDelegationApplicationService(
  deps: IssueDelegationApplicationDeps = {},
): IssueDelegationApplicationService {
  const db = deps.db ?? (getDb() as unknown as IssueDelegationDbContext)
  const runner = deps.runner ?? IssueAgentRunner.getInstance()
  const nowUnix = deps.nowUnix ?? defaultNowUnix

  const delegateIssue: IssueDelegationApplicationService['delegateIssue'] = async ({ issueId, agentProfileId }) => {
    const profile = db.select().from(agentProfiles).where(eq(agentProfiles.id, agentProfileId)).get() as { id: string, name: string } | undefined
    if (!profile) {
      throw new Error(`Agent profile ${agentProfileId} not found`)
    }

    const ts = nowUnix()
    const sessionId = randomUUID()
    db.transaction((tx) => {
      tx.update(agentSessions)
        .set({ status: 'stopped', updatedAt: ts })
        .where(and(
          eq(agentSessions.issueId, issueId),
          eq(agentSessions.status, 'active'),
        ))
        .run()

      tx.update(kanbanIssues)
        .set({ delegateAgentId: agentProfileId, updatedAt: ts })
        .where(eq(kanbanIssues.id, issueId))
        .run()

      tx.insert(agentSessions).values({
        id: sessionId,
        issueId,
        agentProfileId,
        status: 'created',
        createdAt: ts,
        updatedAt: ts,
      }).run()

      tx.insert(kanbanIssueComments).values({
        id: randomUUID(),
        issueId,
        content: `Delegated to ${profile.name}`,
        authorKind: 'system.delegated',
        authorId: null,
        createdAt: ts,
      }).run()
    })

    const created = db.select().from(agentSessions).where(eq(agentSessions.id, sessionId)).get() as AgentSession | undefined
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
    const ts = nowUnix()
    db.transaction((tx) => {
      tx.update(agentSessions)
        .set({ status: 'stopped', updatedAt: ts })
        .where(and(
          eq(agentSessions.issueId, issueId),
          eq(agentSessions.status, 'active'),
        ))
        .run()

      tx.update(kanbanIssues)
        .set({ delegateAgentId: null, updatedAt: ts })
        .where(eq(kanbanIssues.id, issueId))
        .run()

      tx.insert(kanbanIssueComments).values({
        id: randomUUID(),
        issueId,
        content: 'Delegation removed',
        authorKind: 'system.undelegated',
        authorId: null,
        createdAt: ts,
      }).run()
    })
  }

  return {
    delegateIssue,
    runDelegatedIssue,
    stopAgentSession,
    undelegateIssue,
  }
}
