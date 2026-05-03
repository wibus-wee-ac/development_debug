// Input: getDb, kanban schema tables, drizzle-orm operators
// Output: KanbanService — IPC surface for boards, statuses, milestones, issues, comments, relations, delegation, and agent activities
// Position: Main-process IPC service for the Kanban feature

import { randomUUID } from 'node:crypto'

import { IpcMethod, IpcService } from '@cradle/ipc'
import { and, asc, desc, eq, like, or, sql } from 'drizzle-orm'

import { getDb } from '../db'
import type {
  AgentActivity,
  AgentSession,
  KanbanBoard,
  KanbanIssue,
  KanbanIssueComment,
  KanbanIssueRelation,
  KanbanMilestone,
  KanbanStatus,
} from '../db/schema'
import {
  agentActivities,
  agentProfiles,
  agentSessions,
  kanbanBoards,
  kanbanIssueComments,
  kanbanIssueRelations,
  kanbanIssues,
  kanbanMilestones,
  kanbanStatuses,
  sessions,
} from '../db/schema'

const now = (): number => Math.floor(Date.now() / 1000)

export class KanbanService extends IpcService {
  static readonly groupName = 'kanban'

  // ── Status ────────────────────────────────────────────────────────────────

  @IpcMethod()
  listStatuses(workspaceId: string): KanbanStatus[] {
    return getDb()
      .select()
      .from(kanbanStatuses)
      .where(eq(kanbanStatuses.workspaceId, workspaceId))
      .orderBy(asc(kanbanStatuses.order))
      .all()
  }

  @IpcMethod()
  createStatus(input: {
    workspaceId: string
    name: string
    color?: string | null
  }): KanbanStatus {
    const db = getDb()
    const maxRow = db
      .select({ maxOrder: sql<number>`coalesce(max(${kanbanStatuses.order}), -1)` })
      .from(kanbanStatuses)
      .where(eq(kanbanStatuses.workspaceId, input.workspaceId))
      .get()
    const nextOrder = (maxRow?.maxOrder ?? -1) + 1
    const id = randomUUID()
    db.insert(kanbanStatuses).values({
      id,
      workspaceId: input.workspaceId,
      name: input.name,
      color: input.color ?? null,
      order: nextOrder,
      createdAt: now(),
    }).run()
    return db.select().from(kanbanStatuses).where(eq(kanbanStatuses.id, id)).get()!
  }

  @IpcMethod()
  updateStatus(id: string, patch: {
    name?: string
    color?: string | null
  }): KanbanStatus {
    const db = getDb()
    const updates: Record<string, unknown> = {}
    if (patch.name !== undefined) {
      updates.name = patch.name
    }
    if ('color' in patch) {
      updates.color = patch.color ?? null
    }
    if (Object.keys(updates).length > 0) {
      db.update(kanbanStatuses).set(updates).where(eq(kanbanStatuses.id, id)).run()
    }
    return db.select().from(kanbanStatuses).where(eq(kanbanStatuses.id, id)).get()!
  }

  @IpcMethod()
  reorderStatuses(workspaceId: string, orderedIds: string[]): void {
    const db = getDb()
    db.transaction(() => {
      for (let i = 0; i < orderedIds.length; i++) {
        db.update(kanbanStatuses)
          .set({ order: i })
          .where(and(eq(kanbanStatuses.id, orderedIds[i]), eq(kanbanStatuses.workspaceId, workspaceId)))
          .run()
      }
    })
  }

  @IpcMethod()
  deleteStatus(id: string): void {
    getDb().delete(kanbanStatuses).where(eq(kanbanStatuses.id, id)).run()
  }

  // ── Board ─────────────────────────────────────────────────────────────────

  @IpcMethod()
  listBoards(workspaceId?: string): KanbanBoard[] {
    const db = getDb()
    if (workspaceId) {
      return db
        .select()
        .from(kanbanBoards)
        .where(eq(kanbanBoards.workspaceId, workspaceId))
        .orderBy(desc(kanbanBoards.createdAt))
        .all()
    }
    return db.select().from(kanbanBoards).orderBy(desc(kanbanBoards.createdAt)).all()
  }

  @IpcMethod()
  createBoard(input: {
    workspaceId: string
    name: string
    filterConfig?: string | null
  }): KanbanBoard {
    const db = getDb()
    const id = randomUUID()
    const ts = now()
    db.insert(kanbanBoards).values({
      id,
      workspaceId: input.workspaceId,
      name: input.name,
      filterConfig: input.filterConfig ?? null,
      createdAt: ts,
      updatedAt: ts,
    }).run()
    return db.select().from(kanbanBoards).where(eq(kanbanBoards.id, id)).get()!
  }

  @IpcMethod()
  updateBoard(id: string, patch: {
    name?: string
    filterConfig?: string | null
  }): KanbanBoard {
    const db = getDb()
    const updates: Record<string, unknown> = { updatedAt: now() }
    if (patch.name !== undefined) {
      updates.name = patch.name
    }
    if ('filterConfig' in patch) {
      updates.filterConfig = patch.filterConfig ?? null
    }
    db.update(kanbanBoards).set(updates).where(eq(kanbanBoards.id, id)).run()
    return db.select().from(kanbanBoards).where(eq(kanbanBoards.id, id)).get()!
  }

  @IpcMethod()
  deleteBoard(id: string): void {
    getDb().delete(kanbanBoards).where(eq(kanbanBoards.id, id)).run()
  }

  // ── Milestone ─────────────────────────────────────────────────────────────

  @IpcMethod()
  listMilestones(workspaceId: string): KanbanMilestone[] {
    return getDb()
      .select()
      .from(kanbanMilestones)
      .where(eq(kanbanMilestones.workspaceId, workspaceId))
      .orderBy(desc(kanbanMilestones.createdAt))
      .all()
  }

  @IpcMethod()
  createMilestone(input: {
    workspaceId: string
    title: string
    description?: string | null
    dueDate?: number | null
  }): KanbanMilestone {
    const db = getDb()
    const id = randomUUID()
    const ts = now()
    db.insert(kanbanMilestones).values({
      id,
      workspaceId: input.workspaceId,
      title: input.title,
      description: input.description ?? null,
      dueDate: input.dueDate ?? null,
      status: 'open',
      createdAt: ts,
      updatedAt: ts,
    }).run()
    return db.select().from(kanbanMilestones).where(eq(kanbanMilestones.id, id)).get()!
  }

  @IpcMethod()
  updateMilestone(id: string, patch: {
    title?: string
    description?: string | null
    dueDate?: number | null
    status?: 'open' | 'closed'
  }): KanbanMilestone {
    const db = getDb()
    const updates: Record<string, unknown> = { updatedAt: now() }
    if (patch.title !== undefined) {
      updates.title = patch.title
    }
    if ('description' in patch) {
      updates.description = patch.description ?? null
    }
    if ('dueDate' in patch) {
      updates.dueDate = patch.dueDate ?? null
    }
    if (patch.status !== undefined) {
      updates.status = patch.status
    }
    db.update(kanbanMilestones).set(updates).where(eq(kanbanMilestones.id, id)).run()
    return db.select().from(kanbanMilestones).where(eq(kanbanMilestones.id, id)).get()!
  }

  @IpcMethod()
  deleteMilestone(id: string): void {
    getDb().delete(kanbanMilestones).where(eq(kanbanMilestones.id, id)).run()
  }

  // ── Issue ─────────────────────────────────────────────────────────────────

  @IpcMethod()
  listIssues(params: {
    workspaceId: string
    milestoneId?: string | null
    parentIssueId?: string | null
    priority?: string | null
    labels?: string[] | null
    statusId?: string | null
  }): KanbanIssue[] {
    const db = getDb()
    const conditions = [eq(kanbanIssues.workspaceId, params.workspaceId)]

    if (params.milestoneId != null) {
      conditions.push(eq(kanbanIssues.milestoneId, params.milestoneId))
    }
    if (params.parentIssueId != null) {
      conditions.push(eq(kanbanIssues.parentIssueId, params.parentIssueId))
    }
    if (params.priority != null) {
      conditions.push(eq(kanbanIssues.priority, params.priority as KanbanIssue['priority']))
    }
    if (params.statusId !== undefined) {
      if (params.statusId === null) {
        conditions.push(sql`${kanbanIssues.statusId} IS NULL`)
      }
      else {
        conditions.push(eq(kanbanIssues.statusId, params.statusId))
      }
    }
    if (params.labels && params.labels.length > 0) {
      for (const label of params.labels) {
        conditions.push(like(kanbanIssues.labels, `%"${label}"%`))
      }
    }

    return db
      .select()
      .from(kanbanIssues)
      .where(and(...conditions))
      .orderBy(desc(kanbanIssues.createdAt))
      .all()
  }

  @IpcMethod()
  searchIssues(query: string, limit = 20): KanbanIssue[] {
    if (!query.trim()) {
      return []
    }
    const pattern = `%${query.trim()}%`
    return getDb()
      .select()
      .from(kanbanIssues)
      .where(or(
        like(kanbanIssues.title, pattern),
        like(kanbanIssues.description, pattern),
      ))
      .orderBy(desc(kanbanIssues.updatedAt))
      .limit(limit)
      .all()
  }

  @IpcMethod()
  getIssue(id: string): KanbanIssue | undefined {
    return getDb().select().from(kanbanIssues).where(eq(kanbanIssues.id, id)).get()
  }

  @IpcMethod()
  createIssue(input: {
    workspaceId: string
    title: string
    description?: string | null
    priority?: KanbanIssue['priority']
    labels?: string[]
    milestoneId?: string | null
    parentIssueId?: string | null
    statusId?: string | null
  }): KanbanIssue {
    const db = getDb()
    const id = randomUUID()
    const ts = now()
    db.insert(kanbanIssues).values({
      id,
      workspaceId: input.workspaceId,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? 'none',
      labels: JSON.stringify(input.labels ?? []),
      milestoneId: input.milestoneId ?? null,
      parentIssueId: input.parentIssueId ?? null,
      statusId: input.statusId ?? null,
      createdAt: ts,
      updatedAt: ts,
    }).run()
    return db.select().from(kanbanIssues).where(eq(kanbanIssues.id, id)).get()!
  }

  @IpcMethod()
  updateIssue(id: string, patch: Partial<{
    title: string
    description: string | null
    priority: KanbanIssue['priority']
    labels: string[]
    milestoneId: string | null
    parentIssueId: string | null
    statusId: string | null
    assigneeKind: string | null
    assigneeId: string | null
  }>): KanbanIssue {
    const db = getDb()
    const updates: Record<string, unknown> = { updatedAt: now() }
    if (patch.title !== undefined) {
      updates.title = patch.title
    }
    if ('description' in patch) {
      updates.description = patch.description ?? null
    }
    if (patch.priority !== undefined) {
      updates.priority = patch.priority
    }
    if (patch.labels !== undefined) {
      updates.labels = JSON.stringify(patch.labels)
    }
    if ('milestoneId' in patch) {
      updates.milestoneId = patch.milestoneId ?? null
    }
    if ('parentIssueId' in patch) {
      updates.parentIssueId = patch.parentIssueId ?? null
    }
    if ('statusId' in patch) {
      updates.statusId = patch.statusId ?? null
    }
    if ('assigneeKind' in patch) {
      updates.assigneeKind = patch.assigneeKind ?? null
    }
    if ('assigneeId' in patch) {
      updates.assigneeId = patch.assigneeId ?? null
    }
    db.update(kanbanIssues).set(updates).where(eq(kanbanIssues.id, id)).run()
    return db.select().from(kanbanIssues).where(eq(kanbanIssues.id, id)).get()!
  }

  @IpcMethod()
  moveIssue(id: string, statusId: string | null): KanbanIssue {
    return this.updateIssue(id, { statusId })
  }

  @IpcMethod()
  deleteIssue(id: string): void {
    const db = getDb()
    // Clear parentIssueId on child issues before deletion (self-ref FK is application-managed)
    db.update(kanbanIssues).set({ parentIssueId: null }).where(eq(kanbanIssues.parentIssueId, id)).run()
    db.delete(kanbanIssues).where(eq(kanbanIssues.id, id)).run()
  }

  // ── Comment ───────────────────────────────────────────────────────────────

  @IpcMethod()
  listComments(issueId: string): KanbanIssueComment[] {
    return getDb()
      .select()
      .from(kanbanIssueComments)
      .where(eq(kanbanIssueComments.issueId, issueId))
      .orderBy(asc(kanbanIssueComments.createdAt))
      .all()
  }

  @IpcMethod()
  addComment(input: {
    issueId: string
    content: string
    authorKind?: KanbanIssueComment['authorKind']
    authorId?: string | null
  }): KanbanIssueComment {
    const db = getDb()
    const id = randomUUID()
    db.insert(kanbanIssueComments).values({
      id,
      issueId: input.issueId,
      content: input.content,
      authorKind: input.authorKind ?? 'user',
      authorId: input.authorId ?? '__self__',
      createdAt: now(),
    }).run()
    return db.select().from(kanbanIssueComments).where(eq(kanbanIssueComments.id, id)).get()!
  }

  @IpcMethod()
  deleteComment(id: string): void {
    getDb().delete(kanbanIssueComments).where(eq(kanbanIssueComments.id, id)).run()
  }

  // ── Relation ──────────────────────────────────────────────────────────────

  @IpcMethod()
  listRelations(issueId: string): KanbanIssueRelation[] {
    return getDb()
      .select()
      .from(kanbanIssueRelations)
      .where(
        or(
          eq(kanbanIssueRelations.sourceIssueId, issueId),
          eq(kanbanIssueRelations.targetIssueId, issueId),
        ),
      )
      .orderBy(asc(kanbanIssueRelations.createdAt))
      .all()
  }

  @IpcMethod()
  addRelation(input: {
    sourceIssueId: string
    targetIssueId: string
    type: 'blocks' | 'duplicates' | 'relates_to'
  }): KanbanIssueRelation {
    const db = getDb()
    const id = randomUUID()
    db.insert(kanbanIssueRelations).values({
      id,
      sourceIssueId: input.sourceIssueId,
      targetIssueId: input.targetIssueId,
      type: input.type,
      createdAt: now(),
    }).run()
    return db.select().from(kanbanIssueRelations).where(eq(kanbanIssueRelations.id, id)).get()!
  }

  @IpcMethod()
  deleteRelation(id: string): void {
    getDb().delete(kanbanIssueRelations).where(eq(kanbanIssueRelations.id, id)).run()
  }

  // ── Delegation ───────────────────────────────────────────────────────────

  @IpcMethod()
  delegateIssue(issueId: string, agentProfileId: string, _agentId?: string): AgentSession {
    const db = getDb()
    const profile = db.select().from(agentProfiles).where(eq(agentProfiles.id, agentProfileId)).get()
    if (!profile) {
      throw new Error(`Agent profile ${agentProfileId} not found`)
    }

    // Stop any active agent session for this issue
    db.update(agentSessions)
      .set({ status: 'stopped', updatedAt: now() })
      .where(and(
        eq(agentSessions.issueId, issueId),
        eq(agentSessions.status, 'active'),
      ))
      .run()

    // Update issue delegate
    db.update(kanbanIssues)
      .set({ delegateAgentId: agentProfileId, updatedAt: now() })
      .where(eq(kanbanIssues.id, issueId))
      .run()

    // Create agent session
    const sessionId = randomUUID()
    db.insert(agentSessions).values({
      id: sessionId,
      issueId,
      agentProfileId,
      status: 'created',
      createdAt: now(),
      updatedAt: now(),
    }).run()

    // System comment
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

  /**
   * Trigger agent execution for a delegated issue.
   * Called by the renderer after delegateIssue succeeds.
   */
  @IpcMethod()
  async runDelegatedIssue(issueId: string, agentSessionId: string, agentProfileId: string, agentId?: string): Promise<void> {
    const { IssueAgentRunner } = await import('../lib/issue-agent-runner')
    await IssueAgentRunner.getInstance().run({ issueId, agentSessionId, agentProfileId, agentId })
  }

  /**
   * Stop an agent session that's currently executing.
   */
  @IpcMethod()
  async stopAgentSession(agentSessionId: string): Promise<void> {
    const { IssueAgentRunner } = await import('../lib/issue-agent-runner')
    await IssueAgentRunner.getInstance().stop(agentSessionId)
  }

  @IpcMethod()
  undelegateIssue(issueId: string): void {
    const db = getDb()

    // Stop active sessions
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

  // ── Agent Sessions ──────────────────────────────────────────────────────

  @IpcMethod()
  getAgentSessions(issueId: string): AgentSession[] {
    return getDb()
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.issueId, issueId))
      .orderBy(desc(agentSessions.createdAt))
      .all()
  }

  @IpcMethod()
  updateAgentSessionStatus(sessionId: string, status: AgentSession['status']): void {
    getDb().update(agentSessions)
      .set({ status, updatedAt: now() })
      .where(eq(agentSessions.id, sessionId))
      .run()
  }

  @IpcMethod()
  updateAgentSessionChatSession(sessionId: string, chatSessionId: string): void {
    getDb().update(agentSessions)
      .set({ chatSessionId, updatedAt: now() })
      .where(eq(agentSessions.id, sessionId))
      .run()
  }

  // ── Agent Activities ────────────────────────────────────────────────────

  @IpcMethod()
  getAgentActivities(agentSessionId: string): AgentActivity[] {
    return getDb()
      .select()
      .from(agentActivities)
      .where(eq(agentActivities.agentSessionId, agentSessionId))
      .orderBy(asc(agentActivities.createdAt))
      .all()
  }

  @IpcMethod()
  addAgentActivity(input: {
    agentSessionId: string
    type: AgentActivity['type']
    content: string
    signal?: string | null
    signalMetadata?: string | null
  }): AgentActivity {
    const db = getDb()
    const id = randomUUID()
    db.insert(agentActivities).values({
      id,
      agentSessionId: input.agentSessionId,
      type: input.type,
      content: input.content,
      signal: input.signal ?? null,
      signalMetadata: input.signalMetadata ?? null,
      createdAt: now(),
    }).run()

    const activity = db.select().from(agentActivities).where(eq(agentActivities.id, id)).get()!

    // Auto-create comment for response and error activities
    if (input.type === 'response' || input.type === 'error') {
      const session = db.select().from(agentSessions).where(eq(agentSessions.id, input.agentSessionId)).get()
      if (session) {
        const parsed = JSON.parse(input.content) as { body?: string }
        if (parsed.body) {
          db.insert(kanbanIssueComments).values({
            id: randomUUID(),
            issueId: session.issueId,
            content: parsed.body,
            authorKind: 'agent',
            authorId: session.agentProfileId,
            agentActivityId: id,
            createdAt: now(),
          }).run()
        }
      }
    }

    return activity
  }

  // ── Context Refs ────────────────────────────────────────────────────────

  @IpcMethod()
  updateContextRefs(issueId: string, refs: string): void {
    getDb().update(kanbanIssues)
      .set({ contextRefs: refs, updatedAt: now() })
      .where(eq(kanbanIssues.id, issueId))
      .run()
  }

  @IpcMethod()
  addContextRef(issueId: string, ref: string): void {
    const db = getDb()
    const issue = db.select({ contextRefs: kanbanIssues.contextRefs }).from(kanbanIssues).where(eq(kanbanIssues.id, issueId)).get()
    if (!issue) return
    const refs = JSON.parse(issue.contextRefs) as unknown[]
    refs.push(JSON.parse(ref))
    db.update(kanbanIssues)
      .set({ contextRefs: JSON.stringify(refs), updatedAt: now() })
      .where(eq(kanbanIssues.id, issueId))
      .run()
  }

  @IpcMethod()
  removeContextRef(issueId: string, index: number): void {
    const db = getDb()
    const issue = db.select({ contextRefs: kanbanIssues.contextRefs }).from(kanbanIssues).where(eq(kanbanIssues.id, issueId)).get()
    if (!issue) return
    const refs = JSON.parse(issue.contextRefs) as unknown[]
    refs.splice(index, 1)
    db.update(kanbanIssues)
      .set({ contextRefs: JSON.stringify(refs), updatedAt: now() })
      .where(eq(kanbanIssues.id, issueId))
      .run()
  }

  // ── Session ↔ Issue Link ────────────────────────────────────────────────

  @IpcMethod()
  getLinkedIssue(chatSessionId: string): {
    issue: KanbanIssue
    status: KanbanStatus | null
    agentSession: AgentSession | null
  } | null {
    const db = getDb()

    // 1. Check auto-link via agentSessions
    const agentSession = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.chatSessionId, chatSessionId))
      .get()

    if (agentSession) {
      const issue = db.select().from(kanbanIssues).where(eq(kanbanIssues.id, agentSession.issueId)).get()
      if (issue) {
        const status = issue.statusId
          ? db.select().from(kanbanStatuses).where(eq(kanbanStatuses.id, issue.statusId)).get() ?? null
          : null
        return { issue, status, agentSession }
      }
    }

    // 2. Check manual link via sessions.linkedIssueId
    const session = db.select().from(sessions).where(eq(sessions.id, chatSessionId)).get()
    if (session?.linkedIssueId) {
      const issue = db.select().from(kanbanIssues).where(eq(kanbanIssues.id, session.linkedIssueId)).get()
      if (issue) {
        const status = issue.statusId
          ? db.select().from(kanbanStatuses).where(eq(kanbanStatuses.id, issue.statusId)).get() ?? null
          : null
        return { issue, status, agentSession: null }
      }
    }

    return null
  }

  @IpcMethod()
  linkIssueToSession(chatSessionId: string, issueId: string): void {
    getDb().update(sessions)
      .set({ linkedIssueId: issueId })
      .where(eq(sessions.id, chatSessionId))
      .run()
  }

  @IpcMethod()
  unlinkIssueFromSession(chatSessionId: string): void {
    getDb().update(sessions)
      .set({ linkedIssueId: null })
      .where(eq(sessions.id, chatSessionId))
      .run()
  }
}
