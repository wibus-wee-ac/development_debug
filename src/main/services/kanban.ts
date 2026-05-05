// Input: getDb, kanban schema tables, drizzle-orm operators, and Kanban/issue application services
// Output: KanbanService — IPC facade for Kanban queries, commands, delegation, and agent activities
// Position: Main-process IPC adapter for the Kanban feature

import { randomUUID } from 'node:crypto'

import { IpcMethod, IpcService } from '@cradle/ipc'
import { and, asc, desc, eq, like, or, sql } from 'drizzle-orm'

import { createIssueDelegationApplicationService } from '../application/issue-delegation-application'
import {
  createKanbanWriteApplicationService,
  type KanbanWriteApplicationService,
} from '../application/kanban-write-application'
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
  agentSessions,
  kanbanBoards,
  kanbanIssueComments,
  kanbanIssueRelations,
  kanbanIssues,
  kanbanMilestones,
  kanbanStatuses,
  sessions,
} from '../db/schema'
import {
  type IssueDelegationApplicationService,
} from '../application/issue-delegation-application'

const now = (): number => Math.floor(Date.now() / 1000)

export class KanbanService extends IpcService {
  static readonly groupName = 'kanban'
  private readonly delegationApp: IssueDelegationApplicationService
  private readonly kanbanWriteApp: KanbanWriteApplicationService

  constructor(
    delegationApp: IssueDelegationApplicationService = createIssueDelegationApplicationService(),
    kanbanWriteApp: KanbanWriteApplicationService = createKanbanWriteApplicationService(),
  ) {
    super()
    this.delegationApp = delegationApp
    this.kanbanWriteApp = kanbanWriteApp
  }

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
    return this.kanbanWriteApp.createStatus(input)
  }

  @IpcMethod()
  updateStatus(id: string, patch: {
    name?: string
    color?: string | null
  }): KanbanStatus {
    return this.kanbanWriteApp.updateStatus(id, patch)
  }

  @IpcMethod()
  reorderStatuses(workspaceId: string, orderedIds: string[]): void {
    this.kanbanWriteApp.reorderStatuses(workspaceId, orderedIds)
  }

  @IpcMethod()
  deleteStatus(id: string): void {
    this.kanbanWriteApp.deleteStatus(id)
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
    return this.kanbanWriteApp.createBoard(input)
  }

  @IpcMethod()
  updateBoard(id: string, patch: {
    name?: string
    filterConfig?: string | null
  }): KanbanBoard {
    return this.kanbanWriteApp.updateBoard(id, patch)
  }

  @IpcMethod()
  deleteBoard(id: string): void {
    this.kanbanWriteApp.deleteBoard(id)
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
    return this.kanbanWriteApp.createMilestone(input)
  }

  @IpcMethod()
  updateMilestone(id: string, patch: {
    title?: string
    description?: string | null
    dueDate?: number | null
    status?: 'open' | 'closed'
  }): KanbanMilestone {
    return this.kanbanWriteApp.updateMilestone(id, patch)
  }

  @IpcMethod()
  deleteMilestone(id: string): void {
    this.kanbanWriteApp.deleteMilestone(id)
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
    return this.kanbanWriteApp.createIssue(input)
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
    return this.kanbanWriteApp.updateIssue(id, patch)
  }

  @IpcMethod()
  moveIssue(id: string, statusId: string | null): KanbanIssue {
    return this.kanbanWriteApp.moveIssue(id, statusId)
  }

  @IpcMethod()
  deleteIssue(id: string): void {
    this.kanbanWriteApp.deleteIssue(id)
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
    return this.kanbanWriteApp.addComment(input)
  }

  @IpcMethod()
  deleteComment(id: string): void {
    this.kanbanWriteApp.deleteComment(id)
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
    return this.kanbanWriteApp.addRelation(input)
  }

  @IpcMethod()
  deleteRelation(id: string): void {
    this.kanbanWriteApp.deleteRelation(id)
  }

  // ── Delegation ───────────────────────────────────────────────────────────

  @IpcMethod()
  async delegateIssue(issueId: string, agentProfileId: string, _agentId?: string): Promise<AgentSession> {
    return this.delegationApp.delegateIssue({ issueId, agentProfileId })
  }

  /**
   * Trigger agent execution for a delegated issue.
   * Called by the renderer after delegateIssue succeeds.
   */
  @IpcMethod()
  async runDelegatedIssue(issueId: string, agentSessionId: string, agentProfileId: string, agentId?: string): Promise<void> {
    await this.delegationApp.runDelegatedIssue({ issueId, agentSessionId, agentProfileId, agentId })
  }

  /**
   * Stop an agent session that's currently executing.
   */
  @IpcMethod()
  async stopAgentSession(agentSessionId: string): Promise<void> {
    await this.delegationApp.stopAgentSession(agentSessionId)
  }

  @IpcMethod()
  async undelegateIssue(issueId: string): Promise<void> {
    await this.delegationApp.undelegateIssue(issueId)
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
    this.kanbanWriteApp.updateContextRefs(issueId, refs)
  }

  @IpcMethod()
  addContextRef(issueId: string, ref: string): void {
    this.kanbanWriteApp.addContextRef(issueId, ref)
  }

  @IpcMethod()
  removeContextRef(issueId: string, index: number): void {
    this.kanbanWriteApp.removeContextRef(issueId, index)
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
    this.kanbanWriteApp.linkIssueToSession(chatSessionId, issueId)
  }

  @IpcMethod()
  unlinkIssueFromSession(chatSessionId: string): void {
    this.kanbanWriteApp.unlinkIssueFromSession(chatSessionId)
  }
}
