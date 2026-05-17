import { randomUUID } from 'node:crypto'

import type { KanbanBoard, KanbanIssue, KanbanIssueComment, KanbanIssueRelation, KanbanMilestone, KanbanStatus } from '@cradle/db'
import {
  kanbanBoards,
  kanbanIssueComments,
  kanbanIssueRelations,
  kanbanIssues,
  kanbanMilestones,
  kanbanStatuses,
  sessions,
  workspaces,
} from '@cradle/db'
import { desc, eq, or, sql } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { parseJsonStringArray } from '../../helpers/json-text'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'

// ── helpers ──

function workspaceExists(workspaceId: string): boolean {
  return !!db().select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)).get()
}

function requireWorkspace(workspaceId: string): void {
  if (!workspaceExists(workspaceId)) {
    throw new AppError({ code: 'kanban_workspace_not_found', status: 404, message: 'Workspace not found', details: { workspaceId } })
  }
}

const DEFAULT_STATUSES = [
  { name: 'Triage', color: '#a855f7', category: 'triage' as const },
  { name: 'Backlog', color: '#6b7280', category: 'backlog' as const },
  { name: 'To Do', color: '#9ca3af', category: 'unstarted' as const },
  { name: 'In Progress', color: '#f59e0b', category: 'started' as const },
  { name: 'Done', color: '#22c55e', category: 'completed' as const },
  { name: 'Canceled', color: '#6b7280', category: 'canceled' as const },
] as const

function ensureDefaultStatuses(workspaceId: string): void {
  if (countStatuses(workspaceId) > 0) {
    return
  }
  DEFAULT_STATUSES.forEach((s, i) => {
    createStatusRow({ workspaceId, name: s.name, color: s.color, category: s.category, order: i })
  })
}

// ── low-level DB ops ──

function countStatuses(workspaceId: string): number {
  const row = db().select({ count: sql<number>`count(*)` }).from(kanbanStatuses).where(eq(kanbanStatuses.workspaceId, workspaceId)).get()
  return row?.count ?? 0
}

function createStatusRow(input: { workspaceId: string, name: string, color: string | null, category: 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled', order: number }): KanbanStatus {
  return db().insert(kanbanStatuses).values({
    id: randomUUID(),
    workspaceId: input.workspaceId,
    name: input.name,
    color: input.color,
    category: input.category,
    order: input.order,
    createdAt: currentUnixSeconds(),
  }).returning().get()
}

// ── boards ──

export function listBoards(workspaceId?: string): KanbanBoard[] {
  if (workspaceId && !workspaceExists(workspaceId)) {
    throw new AppError({ code: 'kanban_workspace_not_found', status: 404, message: 'Workspace not found', details: { workspaceId } })
  }
  const query = db().select().from(kanbanBoards)
  if (!workspaceId) {
    return query.orderBy(desc(kanbanBoards.createdAt)).all()
  }
  return query.where(eq(kanbanBoards.workspaceId, workspaceId)).orderBy(desc(kanbanBoards.createdAt)).all()
}

export function createBoard(input: { workspaceId: string, name: string, filterConfig?: string | null }): KanbanBoard {
  requireWorkspace(input.workspaceId)
  const now = currentUnixSeconds()
  const board = db().insert(kanbanBoards).values({
    id: randomUUID(),
    workspaceId: input.workspaceId,
    name: input.name,
    filterConfig: input.filterConfig ?? null,
    createdAt: now,
    updatedAt: now,
  }).returning().get()
  ensureDefaultStatuses(input.workspaceId)
  return board
}

export function deleteBoard(id: string): void {
  if (!db().select().from(kanbanBoards).where(eq(kanbanBoards.id, id)).get()) {
    throw new AppError({ code: 'kanban_board_not_found', status: 404, message: 'Board not found', details: { boardId: id } })
  }
  db().delete(kanbanBoards).where(eq(kanbanBoards.id, id)).run()
}

export function updateBoard(id: string, patch: { name?: string, filterConfig?: string | null }): KanbanBoard {
  const updates: Record<string, unknown> = { updatedAt: currentUnixSeconds() }
  if (patch.name !== undefined) {
    updates.name = patch.name
  }
  if ('filterConfig' in patch) {
    updates.filterConfig = patch.filterConfig ?? null
  }
  db().update(kanbanBoards).set(updates).where(eq(kanbanBoards.id, id)).run()
  const board = db().select().from(kanbanBoards).where(eq(kanbanBoards.id, id)).get()
  if (!board) {
    throw new AppError({ code: 'kanban_board_not_found', status: 404, message: 'Board not found', details: { boardId: id } })
  }
  return board
}

// ── statuses ──

export function listStatuses(workspaceId: string): KanbanStatus[] {
  requireWorkspace(workspaceId)
  return db().select().from(kanbanStatuses).where(eq(kanbanStatuses.workspaceId, workspaceId)).orderBy(kanbanStatuses.order).all()
}

type StatusCategory = 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'

export function createStatus(input: { workspaceId: string, name: string, color?: string | null, category?: StatusCategory }): KanbanStatus {
  requireWorkspace(input.workspaceId)
  const count = countStatuses(input.workspaceId)
  return createStatusRow({ ...input, color: input.color ?? null, category: input.category ?? 'unstarted', order: count })
}

export function updateStatus(id: string, patch: { name?: string, color?: string | null }): KanbanStatus {
  const updates: Record<string, unknown> = {}
  if (patch.name !== undefined) {
    updates.name = patch.name
  }
  if ('color' in patch) {
    updates.color = patch.color ?? null
  }
  if (Object.keys(updates).length > 0) {
    db().update(kanbanStatuses).set(updates).where(eq(kanbanStatuses.id, id)).run()
  }
  const status = db().select().from(kanbanStatuses).where(eq(kanbanStatuses.id, id)).get()
  if (!status) {
    throw new AppError({ code: 'kanban_status_not_found', status: 404, message: 'Status not found', details: { statusId: id } })
  }
  return status
}

export function deleteStatus(id: string): void {
  if (!db().select().from(kanbanStatuses).where(eq(kanbanStatuses.id, id)).get()) {
    throw new AppError({ code: 'kanban_status_not_found', status: 404, message: 'Status not found', details: { statusId: id } })
  }
  db().delete(kanbanStatuses).where(eq(kanbanStatuses.id, id)).run()
}

export function reorderStatuses(workspaceId: string, orderedIds: string[]): void {
  requireWorkspace(workspaceId)
  orderedIds.forEach((id, index) => {
    db().update(kanbanStatuses).set({ order: index }).where(eq(kanbanStatuses.id, id)).run()
  })
}

// ── milestones ──

export function listMilestones(workspaceId: string): KanbanMilestone[] {
  requireWorkspace(workspaceId)
  return db().select().from(kanbanMilestones).where(eq(kanbanMilestones.workspaceId, workspaceId)).orderBy(desc(kanbanMilestones.createdAt)).all()
}

export function createMilestone(input: { workspaceId: string, title: string, description?: string | null, dueDate?: number | null, status?: 'open' | 'closed' }): KanbanMilestone {
  requireWorkspace(input.workspaceId)
  const now = currentUnixSeconds()
  return db().insert(kanbanMilestones).values({
    id: randomUUID(),
    workspaceId: input.workspaceId,
    title: input.title,
    description: input.description ?? null,
    dueDate: input.dueDate ?? null,
    status: input.status ?? 'open',
    createdAt: now,
    updatedAt: now,
  }).returning().get()
}

export function updateMilestone(id: string, patch: { title?: string, description?: string | null, dueDate?: number | null, status?: 'open' | 'closed' }): KanbanMilestone {
  const updates: Record<string, unknown> = { updatedAt: currentUnixSeconds() }
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
  db().update(kanbanMilestones).set(updates).where(eq(kanbanMilestones.id, id)).run()
  const milestone = db().select().from(kanbanMilestones).where(eq(kanbanMilestones.id, id)).get()
  if (!milestone) {
    throw new AppError({ code: 'kanban_milestone_not_found', status: 404, message: 'Milestone not found', details: { milestoneId: id } })
  }
  return milestone
}

export function deleteMilestone(id: string): void {
  if (!db().select().from(kanbanMilestones).where(eq(kanbanMilestones.id, id)).get()) {
    throw new AppError({ code: 'kanban_milestone_not_found', status: 404, message: 'Milestone not found', details: { milestoneId: id } })
  }
  db().update(kanbanIssues).set({ milestoneId: null, updatedAt: currentUnixSeconds() }).where(eq(kanbanIssues.milestoneId, id)).run()
  db().delete(kanbanMilestones).where(eq(kanbanMilestones.id, id)).run()
}

// ── issues ──

export interface IssueListParams {
  workspaceId: string
  milestoneId?: string | null
  parentIssueId?: string | null
  priority?: string | null
  labels?: string[] | null
  statusId?: string | null
}

export function listIssues(params: IssueListParams): KanbanIssue[] {
  requireWorkspace(params.workspaceId)
  const issues = db()
    .select()
    .from(kanbanIssues)
    .where(eq(kanbanIssues.workspaceId, params.workspaceId))
    .orderBy(desc(kanbanIssues.createdAt))
    .all()

  return issues
    .filter(issue => params.milestoneId === undefined || issue.milestoneId === (params.milestoneId ?? null))
    .filter(issue => params.parentIssueId === undefined || issue.parentIssueId === (params.parentIssueId ?? null))
    .filter(issue => params.priority == null || issue.priority === params.priority)
    .filter(issue => params.statusId === undefined || issue.statusId === (params.statusId ?? null))
    .filter((issue) => {
      if (!params.labels || params.labels.length === 0) {
        return true
      }
      const labels = parseJsonStringArray(issue.labels)
      return params.labels.every(label => labels.includes(label))
    })
}

export function getIssue(id: string): KanbanIssue {
  const issue = db().select().from(kanbanIssues).where(eq(kanbanIssues.id, id)).get()
  if (!issue) {
    throw new AppError({ code: 'kanban_issue_not_found', status: 404, message: 'Issue not found', details: { issueId: id } })
  }
  return issue
}

export function searchIssues(q: string, limit = 20): KanbanIssue[] {
  const lowerQ = q.toLowerCase()
  const all = db().select().from(kanbanIssues).orderBy(desc(kanbanIssues.createdAt)).all()
  return all
    .filter(issue => issue.title.toLowerCase().includes(lowerQ) || (issue.description ?? '').toLowerCase().includes(lowerQ))
    .slice(0, limit)
}

export function createIssue(input: {
  workspaceId: string
  title: string
  description?: string | null
  priority?: 'none' | 'low' | 'medium' | 'high' | 'urgent'
  labels?: string[]
  milestoneId?: string | null
  parentIssueId?: string | null
  statusId?: string | null
}): KanbanIssue {
  requireWorkspace(input.workspaceId)
  const now = currentUnixSeconds()
  const maxOrderRow = db().select({ maxOrder: sql<number>`coalesce(max(${kanbanIssues.order}), 0)` }).from(kanbanIssues).where(eq(kanbanIssues.workspaceId, input.workspaceId)).get()
  const order = (maxOrderRow?.maxOrder ?? 0) + 1024
  const maxNumberRow = db().select({ maxNum: sql<number>`coalesce(max(${kanbanIssues.number}), 0)` }).from(kanbanIssues).where(eq(kanbanIssues.workspaceId, input.workspaceId)).get()
  const number = (maxNumberRow?.maxNum ?? 0) + 1
  const statusId = input.statusId
    ?? db().select({ id: kanbanStatuses.id }).from(kanbanStatuses).where(eq(kanbanStatuses.workspaceId, input.workspaceId)).orderBy(kanbanStatuses.order).get()?.id
    ?? null
  return db().insert(kanbanIssues).values({
    id: randomUUID(),
    workspaceId: input.workspaceId,
    title: input.title,
    description: input.description ?? null,
    priority: input.priority ?? 'none',
    labels: JSON.stringify(input.labels ?? []),
    milestoneId: input.milestoneId ?? null,
    parentIssueId: input.parentIssueId ?? null,
    statusId,
    number,
    assigneeKind: null,
    assigneeId: null,
    delegateAgentProfileId: null,
    contextRefs: '[]',
    order,
    createdAt: now,
    updatedAt: now,
  }).returning().get()
}

export function updateIssue(id: string, patch: Partial<{
  title: string
  description: string | null
  priority: 'none' | 'low' | 'medium' | 'high' | 'urgent'
  labels: string[]
  milestoneId: string | null
  parentIssueId: string | null
  statusId: string | null
  assigneeKind: string | null
  assigneeId: string | null
  order: number
}>): KanbanIssue {
  const updates: Record<string, unknown> = { updatedAt: currentUnixSeconds() }
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
  if (patch.order !== undefined) {
    updates.order = patch.order
  }

  db().update(kanbanIssues).set(updates).where(eq(kanbanIssues.id, id)).run()
  const issue = db().select().from(kanbanIssues).where(eq(kanbanIssues.id, id)).get()
  if (!issue) {
    throw new AppError({ code: 'kanban_issue_not_found', status: 404, message: 'Issue not found', details: { issueId: id } })
  }
  return issue
}

export function updateIssueDelegation(id: string, agentProfileId: string | null): KanbanIssue {
  db().update(kanbanIssues)
    .set({ delegateAgentProfileId: agentProfileId, updatedAt: currentUnixSeconds() })
    .where(eq(kanbanIssues.id, id))
    .run()
  return getIssue(id)
}

export function deleteIssue(id: string): void {
  if (!db().select().from(kanbanIssues).where(eq(kanbanIssues.id, id)).get()) {
    throw new AppError({ code: 'kanban_issue_not_found', status: 404, message: 'Issue not found', details: { issueId: id } })
  }
  db().update(kanbanIssues).set({ parentIssueId: null, updatedAt: currentUnixSeconds() }).where(eq(kanbanIssues.parentIssueId, id)).run()
  db().delete(kanbanIssues).where(eq(kanbanIssues.id, id)).run()
}

export function bulkUpdateIssues(issueIds: string[], update: { statusId?: string | null, priority?: string, labels?: string, milestoneId?: string | null, assigneeKind?: string | null, assigneeId?: string | null }): number {
  if (issueIds.length === 0) return 0
  const updates: Record<string, unknown> = { updatedAt: currentUnixSeconds() }
  if ('statusId' in update) updates.statusId = update.statusId ?? null
  if (update.priority !== undefined) updates.priority = update.priority
  if (update.labels !== undefined) updates.labels = update.labels
  if ('milestoneId' in update) updates.milestoneId = update.milestoneId ?? null
  if ('assigneeKind' in update) updates.assigneeKind = update.assigneeKind ?? null
  if ('assigneeId' in update) updates.assigneeId = update.assigneeId ?? null

  const result = db().update(kanbanIssues)
    .set(updates)
    .where(sql`${kanbanIssues.id} IN (${sql.join(issueIds.map(id => sql`${id}`), sql`, `)})`)
    .run()
  return result.changes
}

// ── comments ──

export function listComments(issueId: string): KanbanIssueComment[] {
  getIssue(issueId) // throws if not found
  return db().select().from(kanbanIssueComments).where(eq(kanbanIssueComments.issueId, issueId)).orderBy(kanbanIssueComments.createdAt).all()
}

export function addComment(input: { issueId: string, content: string, authorKind?: KanbanIssueComment['authorKind'], authorId?: string | null }): KanbanIssueComment {
  getIssue(input.issueId) // throws if not found
  return db().insert(kanbanIssueComments).values({
    id: randomUUID(),
    issueId: input.issueId,
    content: input.content,
    authorKind: input.authorKind ?? 'user',
    authorId: input.authorId ?? '__self__',
    agentActivityId: null,
    createdAt: currentUnixSeconds(),
  }).returning().get()
}

export function deleteComment(id: string): void {
  if (!db().select().from(kanbanIssueComments).where(eq(kanbanIssueComments.id, id)).get()) {
    throw new AppError({ code: 'kanban_comment_not_found', status: 404, message: 'Comment not found', details: { commentId: id } })
  }
  db().delete(kanbanIssueComments).where(eq(kanbanIssueComments.id, id)).run()
}

// ── relations ──

export function listRelations(issueId: string): KanbanIssueRelation[] {
  getIssue(issueId) // throws if not found
  return db()
    .select()
    .from(kanbanIssueRelations)
    .where(
      or(
        eq(kanbanIssueRelations.sourceIssueId, issueId),
        eq(kanbanIssueRelations.targetIssueId, issueId),
      ),
    )
    .all()
}

export function createRelation(input: { sourceIssueId: string, targetIssueId: string, type: 'blocks' | 'duplicates' | 'relates_to' }): KanbanIssueRelation {
  getIssue(input.sourceIssueId)
  getIssue(input.targetIssueId)
  return db().insert(kanbanIssueRelations).values({
    id: randomUUID(),
    sourceIssueId: input.sourceIssueId,
    targetIssueId: input.targetIssueId,
    type: input.type,
    createdAt: currentUnixSeconds(),
  }).returning().get()
}

export function deleteRelation(id: string): void {
  if (!db().select().from(kanbanIssueRelations).where(eq(kanbanIssueRelations.id, id)).get()) {
    throw new AppError({ code: 'kanban_relation_not_found', status: 404, message: 'Relation not found', details: { relationId: id } })
  }
  db().delete(kanbanIssueRelations).where(eq(kanbanIssueRelations.id, id)).run()
}

// ── context refs ──

export function addContextRef(issueId: string, ref: string): KanbanIssue {
  const issue = getIssue(issueId)
  const refs = parseJsonStringArray(issue.contextRefs)
  refs.push(ref)
  db().update(kanbanIssues).set({ contextRefs: JSON.stringify(refs), updatedAt: currentUnixSeconds() }).where(eq(kanbanIssues.id, issueId)).run()
  return getIssue(issueId)
}

export function removeContextRef(issueId: string, index: number): KanbanIssue {
  const issue = getIssue(issueId)
  const refs = parseJsonStringArray(issue.contextRefs)
  if (index < 0 || index >= refs.length) {
    throw new AppError({ code: 'kanban_context_ref_invalid_index', status: 400, message: 'Invalid context ref index', details: { issueId, index } })
  }
  refs.splice(index, 1)
  db().update(kanbanIssues).set({ contextRefs: JSON.stringify(refs), updatedAt: currentUnixSeconds() }).where(eq(kanbanIssues.id, issueId)).run()
  return getIssue(issueId)
}

// ── linked issue (session ↔ issue) ──

export function getLinkedIssue(sessionId: string): { issueId: string | null } {
  const s = db().select({ linkedIssueId: sessions.linkedIssueId }).from(sessions).where(eq(sessions.id, sessionId)).get()
  if (!s) {
    throw new AppError({ code: 'session_not_found', status: 404, message: 'Session not found', details: { sessionId } })
  }
  return { issueId: s.linkedIssueId }
}

export function linkIssue(sessionId: string, issueId: string): { ok: true } {
  const s = db().select().from(sessions).where(eq(sessions.id, sessionId)).get()
  if (!s) {
    throw new AppError({ code: 'session_not_found', status: 404, message: 'Session not found', details: { sessionId } })
  }
  getIssue(issueId) // validate issue exists
  db().update(sessions).set({ linkedIssueId: issueId }).where(eq(sessions.id, sessionId)).run()
  return { ok: true }
}

export function unlinkIssue(sessionId: string): { ok: true } {
  const s = db().select().from(sessions).where(eq(sessions.id, sessionId)).get()
  if (!s) {
    throw new AppError({ code: 'session_not_found', status: 404, message: 'Session not found', details: { sessionId } })
  }
  db().update(sessions).set({ linkedIssueId: null }).where(eq(sessions.id, sessionId)).run()
  return { ok: true }
}
