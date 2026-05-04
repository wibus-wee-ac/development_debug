// Input: getDb, kanban/agent schema tables, IssueAgentRunner
// Output: Issue delegation domain service for create/run/stop/undelegate workflows
// Position: Main-process domain orchestration library used by KanbanService

import { randomUUID } from 'node:crypto'

import { and, eq } from 'drizzle-orm'

import { getDb } from '../db'
import type { AgentSession } from '../db/schema'
import {
  agentProfiles,
  agentSessions,
  kanbanIssueComments,
  kanbanIssues,
} from '../db/schema'
import { IssueAgentRunner } from './issue-agent-runner'

const now = (): number => Math.floor(Date.now() / 1000)

export interface DelegateIssueInput {
  issueId: string
  agentProfileId: string
}

export interface RunDelegatedIssueInput {
  issueId: string
  agentSessionId: string
  agentProfileId: string
  agentId?: string
}

export async function delegateIssue(input: DelegateIssueInput): Promise<AgentSession> {
  const db = getDb()
  const { issueId, agentProfileId } = input

  const profile = db.select().from(agentProfiles).where(eq(agentProfiles.id, agentProfileId)).get()
  if (!profile) {
    throw new Error(`Agent profile ${agentProfileId} not found`)
  }

  db.update(agentSessions)
    .set({ status: 'stopped', updatedAt: now() })
    .where(and(
      eq(agentSessions.issueId, issueId),
      eq(agentSessions.status, 'active'),
    ))
    .run()

  db.update(kanbanIssues)
    .set({ delegateAgentId: agentProfileId, updatedAt: now() })
    .where(eq(kanbanIssues.id, issueId))
    .run()

  const sessionId = randomUUID()
  db.insert(agentSessions).values({
    id: sessionId,
    issueId,
    agentProfileId,
    status: 'created',
    createdAt: now(),
    updatedAt: now(),
  }).run()

  db.insert(kanbanIssueComments).values({
    id: randomUUID(),
    issueId,
    content: `Delegated to ${profile.name}`,
    authorKind: 'system.delegated',
    authorId: null,
    createdAt: now(),
  }).run()

  return db.select().from(agentSessions).where(eq(agentSessions.id, sessionId)).get()!
}

export async function runDelegatedIssue(input: RunDelegatedIssueInput): Promise<void> {
  await IssueAgentRunner.getInstance().run(input)
}

export async function stopDelegatedIssueSession(agentSessionId: string): Promise<void> {
  await IssueAgentRunner.getInstance().stop(agentSessionId)
}

export async function undelegateIssue(issueId: string): Promise<void> {
  const db = getDb()

  db.update(agentSessions)
    .set({ status: 'stopped', updatedAt: now() })
    .where(and(
      eq(agentSessions.issueId, issueId),
      eq(agentSessions.status, 'active'),
    ))
    .run()

  db.update(kanbanIssues)
    .set({ delegateAgentId: null, updatedAt: now() })
    .where(eq(kanbanIssues.id, issueId))
    .run()

  db.insert(kanbanIssueComments).values({
    id: randomUUID(),
    issueId,
    content: 'Delegation removed',
    authorKind: 'system.undelegated',
    authorId: null,
    createdAt: now(),
  }).run()
}
