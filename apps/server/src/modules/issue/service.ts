// Input: Issue persistence tables, actor context, and workflow request data
// Output: Issue workflow semantics, provenance recording, and server-resolved comment author views
// Position: Issue module domain service used by HTTP routes and related capability modules

import { randomUUID } from 'node:crypto'

import type { Issue, IssueComment, IssueMilestone, IssueRelation, IssueStatus, Workspace } from '@cradle/db'
import {
  agents,
  issueComments,
  issueMilestones,
  issueRelations,
  issues,
  issueStatuses,
  sessions,
  workspaces,
} from '@cradle/db'
import { desc, eq, or, sql } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { parseJsonStringArray } from '../../helpers/json-text'
import { currentUnixSeconds } from '../../helpers/time'
import type { MutationActor } from '../../http/actor-context'
import { db } from '../../infra'

type StatusCategory = 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'

export interface IssueCommentAuthorView {
  kind: 'user' | 'agent' | 'system'
  id: string | null
  displayName: string
  avatarUrl: string | null
  label: string | null
}

export type IssueCommentView = IssueComment & { author: IssueCommentAuthorView }

const DEFAULT_STATUSES = [
  { name: 'Triage', color: '#a855f7', category: 'triage' as const },
  { name: 'Backlog', color: '#6b7280', category: 'backlog' as const },
  { name: 'To Do', color: '#9ca3af', category: 'unstarted' as const },
  { name: 'In Progress', color: '#f59e0b', category: 'started' as const },
  { name: 'Done', color: '#22c55e', category: 'completed' as const },
  { name: 'Canceled', color: '#6b7280', category: 'canceled' as const },
] as const

function getWorkspace(workspaceId: string): Workspace | undefined {
  return db().select().from(workspaces).where(eq(workspaces.id, workspaceId)).get()
}

function requireWorkspace(workspaceId: string): Workspace {
  const workspace = getWorkspace(workspaceId)
  if (!workspace) {
    throw new AppError({ code: 'issue_workspace_not_found', status: 404, message: 'Workspace not found', details: { workspaceId } })
  }
  return workspace
}

function countStatuses(workspaceId: string): number {
  const row = db().select({ count: sql<number>`count(*)` }).from(issueStatuses).where(eq(issueStatuses.workspaceId, workspaceId)).get()
  return row?.count ?? 0
}

function createStatusRow(input: { workspaceId: string, name: string, color: string | null, category: StatusCategory, order: number }): IssueStatus {
  return db().insert(issueStatuses).values({
    id: randomUUID(),
    workspaceId: input.workspaceId,
    name: input.name,
    color: input.color,
    category: input.category,
    order: input.order,
    createdAt: currentUnixSeconds(),
  }).returning().get()
}

export function seedDefaultStatuses(workspaceId: string): void {
  requireWorkspace(workspaceId)
  if (countStatuses(workspaceId) > 0) {
    return
  }
  DEFAULT_STATUSES.forEach((status, order) => {
    createStatusRow({ workspaceId, name: status.name, color: status.color, category: status.category, order })
  })
}

function readIssuePrefix(workspace: Workspace): string {
  const raw = workspace.identifier || workspace.name || workspace.id
  const normalized = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return (normalized.slice(0, 3) || 'ISS').padEnd(3, 'X')
}

function formatIssueId(prefix: string, number: number): string {
  return `${prefix}-${number.toString().padStart(3, '0')}`
}

function nextIssueIdentity(workspace: Workspace): { id: string, number: number } {
  const prefix = readIssuePrefix(workspace)
  const maxNumberRow = db()
    .select({ maxNum: sql<number>`coalesce(max(${issues.number}), 0)` })
    .from(issues)
    .where(eq(issues.workspaceId, workspace.id))
    .get()
  let number = (maxNumberRow?.maxNum ?? 0) + 1

  while (true) {
    const id = formatIssueId(prefix, number)
    const existing = db().select({ id: issues.id }).from(issues).where(eq(issues.id, id)).get()
    if (!existing) {
      return { id, number }
    }
    number += 1
  }
}

export function listStatuses(workspaceId: string): IssueStatus[] {
  requireWorkspace(workspaceId)
  seedDefaultStatuses(workspaceId)
  return db().select().from(issueStatuses).where(eq(issueStatuses.workspaceId, workspaceId)).orderBy(issueStatuses.order).all()
}

export function createStatus(input: { workspaceId: string, name: string, color?: string | null, category?: StatusCategory }): IssueStatus {
  requireWorkspace(input.workspaceId)
  const count = countStatuses(input.workspaceId)
  return createStatusRow({ ...input, color: input.color ?? null, category: input.category ?? 'unstarted', order: count })
}

export function updateStatus(id: string, patch: { name?: string, color?: string | null }): IssueStatus {
  const updates: Record<string, unknown> = {}
  if (patch.name !== undefined) {
    updates.name = patch.name
  }
  if ('color' in patch) {
    updates.color = patch.color ?? null
  }
  if (Object.keys(updates).length > 0) {
    db().update(issueStatuses).set(updates).where(eq(issueStatuses.id, id)).run()
  }
  const status = db().select().from(issueStatuses).where(eq(issueStatuses.id, id)).get()
  if (!status) {
    throw new AppError({ code: 'issue_status_not_found', status: 404, message: 'Status not found', details: { statusId: id } })
  }
  return status
}

export function deleteStatus(id: string): void {
  if (!db().select().from(issueStatuses).where(eq(issueStatuses.id, id)).get()) {
    throw new AppError({ code: 'issue_status_not_found', status: 404, message: 'Status not found', details: { statusId: id } })
  }
  db().delete(issueStatuses).where(eq(issueStatuses.id, id)).run()
}

export function reorderStatuses(workspaceId: string, orderedIds: string[]): void {
  requireWorkspace(workspaceId)
  orderedIds.forEach((id, index) => {
    db().update(issueStatuses).set({ order: index }).where(eq(issueStatuses.id, id)).run()
  })
}

export function listMilestones(workspaceId: string): IssueMilestone[] {
  requireWorkspace(workspaceId)
  return db().select().from(issueMilestones).where(eq(issueMilestones.workspaceId, workspaceId)).orderBy(desc(issueMilestones.createdAt)).all()
}

export function createMilestone(input: { workspaceId: string, title: string, description?: string | null, dueDate?: number | null, status?: 'open' | 'closed' }): IssueMilestone {
  requireWorkspace(input.workspaceId)
  const now = currentUnixSeconds()
  return db().insert(issueMilestones).values({
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

export function updateMilestone(id: string, patch: { title?: string, description?: string | null, dueDate?: number | null, status?: 'open' | 'closed' }): IssueMilestone {
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
  db().update(issueMilestones).set(updates).where(eq(issueMilestones.id, id)).run()
  const milestone = db().select().from(issueMilestones).where(eq(issueMilestones.id, id)).get()
  if (!milestone) {
    throw new AppError({ code: 'issue_milestone_not_found', status: 404, message: 'Milestone not found', details: { milestoneId: id } })
  }
  return milestone
}

export function deleteMilestone(id: string): void {
  if (!db().select().from(issueMilestones).where(eq(issueMilestones.id, id)).get()) {
    throw new AppError({ code: 'issue_milestone_not_found', status: 404, message: 'Milestone not found', details: { milestoneId: id } })
  }
  db().update(issues).set({ milestoneId: null, updatedAt: currentUnixSeconds() }).where(eq(issues.milestoneId, id)).run()
  db().delete(issueMilestones).where(eq(issueMilestones.id, id)).run()
}

export interface IssueListParams {
  workspaceId: string
  milestoneId?: string | null
  parentIssueId?: string | null
  priority?: string | null
  labels?: string[] | null
  statusId?: string | null
}

export function listIssues(params: IssueListParams): Issue[] {
  requireWorkspace(params.workspaceId)
  const rows = db()
    .select()
    .from(issues)
    .where(eq(issues.workspaceId, params.workspaceId))
    .orderBy(desc(issues.createdAt))
    .all()

  return rows
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

export function getIssue(id: string): Issue {
  const issue = db().select().from(issues).where(eq(issues.id, id)).get()
  if (!issue) {
    throw new AppError({ code: 'issue_not_found', status: 404, message: 'Issue not found', details: { issueId: id } })
  }
  return issue
}

export function searchIssues(q: string, limit = 20): Issue[] {
  const lowerQ = q.toLowerCase()
  const all = db().select().from(issues).orderBy(desc(issues.createdAt)).all()
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
}, actor: MutationActor = { kind: 'user', id: '__self__', source: 'default-user' }): Issue {
  const workspace = requireWorkspace(input.workspaceId)
  seedDefaultStatuses(input.workspaceId)
  const now = currentUnixSeconds()
  const identity = nextIssueIdentity(workspace)
  const maxOrderRow = db().select({ maxOrder: sql<number>`coalesce(max(${issues.order}), 0)` }).from(issues).where(eq(issues.workspaceId, input.workspaceId)).get()
  const order = (maxOrderRow?.maxOrder ?? 0) + 1024
  const statusId = input.statusId
    ?? db().select({ id: issueStatuses.id }).from(issueStatuses).where(eq(issueStatuses.workspaceId, input.workspaceId)).orderBy(issueStatuses.order).get()?.id
    ?? null
  return db().insert(issues).values({
    id: identity.id,
    workspaceId: input.workspaceId,
    title: input.title,
    description: input.description ?? null,
    priority: input.priority ?? 'none',
    labels: JSON.stringify(input.labels ?? []),
    milestoneId: input.milestoneId ?? null,
    parentIssueId: input.parentIssueId ?? null,
    statusId,
    number: identity.number,
    assigneeKind: null,
    assigneeId: null,
    createdByKind: actor.kind,
    createdById: actor.id,
    delegateAgentId: null,
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
}>): Issue {
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

  db().update(issues).set(updates).where(eq(issues.id, id)).run()
  return getIssue(id)
}

export function updateIssueDelegation(id: string, delegation: { agentId: string, agentProfileId: string } | null): Issue {
  db().update(issues).set({
    delegateAgentId: delegation?.agentId ?? null,
    delegateAgentProfileId: delegation?.agentProfileId ?? null,
    updatedAt: currentUnixSeconds(),
  }).where(eq(issues.id, id)).run()
  return getIssue(id)
}

export function deleteIssue(id: string): void {
  getIssue(id)
  db().update(issues).set({ parentIssueId: null, updatedAt: currentUnixSeconds() }).where(eq(issues.parentIssueId, id)).run()
  db().delete(issues).where(eq(issues.id, id)).run()
}

export function bulkUpdateIssues(issueIds: string[], update: { statusId?: string | null, priority?: string, labels?: string, milestoneId?: string | null, assigneeKind?: string | null, assigneeId?: string | null }): number {
  if (issueIds.length === 0) {
    return 0
  }
  const updates: Record<string, unknown> = { updatedAt: currentUnixSeconds() }
  if ('statusId' in update) {
    updates.statusId = update.statusId ?? null
  }
  if (update.priority !== undefined) {
    updates.priority = update.priority
  }
  if (update.labels !== undefined) {
    updates.labels = update.labels
  }
  if ('milestoneId' in update) {
    updates.milestoneId = update.milestoneId ?? null
  }
  if ('assigneeKind' in update) {
    updates.assigneeKind = update.assigneeKind ?? null
  }
  if ('assigneeId' in update) {
    updates.assigneeId = update.assigneeId ?? null
  }

  const result = db().update(issues).set(updates).where(sql`${issues.id} IN (${sql.join(issueIds.map(id => sql`${id}`), sql`, `)})`).run()
  return result.changes
}

export function listComments(issueId: string): IssueCommentView[] {
  getIssue(issueId)
  return db().select().from(issueComments).where(eq(issueComments.issueId, issueId)).orderBy(issueComments.createdAt).all().map(toCommentView)
}

export function addComment(input: { issueId: string, content: string, authorKind?: IssueComment['authorKind'], authorId?: string | null }): IssueCommentView {
  getIssue(input.issueId)
  const authorKind = input.authorKind ?? 'user'
  const comment = db().insert(issueComments).values({
    id: randomUUID(),
    issueId: input.issueId,
    content: input.content,
    authorKind,
    authorId: input.authorId ?? (authorKind.startsWith('system') ? null : '__self__'),
    agentActivityId: null,
    createdAt: currentUnixSeconds(),
  }).returning().get()
  return toCommentView(comment)
}

function toCommentView(comment: IssueComment): IssueCommentView {
  return {
    ...comment,
    author: resolveCommentAuthor(comment),
  }
}

function resolveCommentAuthor(comment: IssueComment): IssueCommentAuthorView {
  if (comment.authorKind.startsWith('system')) {
    return {
      kind: 'system',
      id: null,
      displayName: 'Cradle',
      avatarUrl: null,
      label: 'System',
    }
  }

  if (comment.authorKind === 'agent') {
    const agent = comment.authorId
      ? db()
          .select({
            id: agents.id,
            name: agents.name,
            avatarUrl: agents.avatarUrl,
            runtimeKind: agents.runtimeKind,
          })
          .from(agents)
          .where(eq(agents.id, comment.authorId))
          .get()
      : null

    return {
      kind: 'agent',
      id: agent?.id ?? comment.authorId ?? null,
      displayName: agent?.name ?? 'Unknown agent',
      avatarUrl: agent?.avatarUrl ?? null,
      label: agent?.runtimeKind === 'jar-core' ? 'AI' : 'Agent',
    }
  }

  return {
    kind: 'user',
    id: comment.authorId ?? '__self__',
    displayName: 'You',
    avatarUrl: null,
    label: null,
  }
}

export function deleteComment(id: string): void {
  if (!db().select().from(issueComments).where(eq(issueComments.id, id)).get()) {
    throw new AppError({ code: 'issue_comment_not_found', status: 404, message: 'Comment not found', details: { commentId: id } })
  }
  db().delete(issueComments).where(eq(issueComments.id, id)).run()
}

export function listRelations(issueId: string): IssueRelation[] {
  getIssue(issueId)
  return db()
    .select()
    .from(issueRelations)
    .where(or(eq(issueRelations.sourceIssueId, issueId), eq(issueRelations.targetIssueId, issueId)))
    .all()
}

export function createRelation(input: { sourceIssueId: string, targetIssueId: string, type: 'blocks' | 'duplicates' | 'relates_to' }): IssueRelation {
  getIssue(input.sourceIssueId)
  getIssue(input.targetIssueId)
  return db().insert(issueRelations).values({
    id: randomUUID(),
    sourceIssueId: input.sourceIssueId,
    targetIssueId: input.targetIssueId,
    type: input.type,
    createdAt: currentUnixSeconds(),
  }).returning().get()
}

export function deleteRelation(id: string): void {
  if (!db().select().from(issueRelations).where(eq(issueRelations.id, id)).get()) {
    throw new AppError({ code: 'issue_relation_not_found', status: 404, message: 'Relation not found', details: { relationId: id } })
  }
  db().delete(issueRelations).where(eq(issueRelations.id, id)).run()
}

export function addContextRef(issueId: string, ref: string): Issue {
  const issue = getIssue(issueId)
  const refs = parseJsonStringArray(issue.contextRefs)
  refs.push(ref)
  db().update(issues).set({ contextRefs: JSON.stringify(refs), updatedAt: currentUnixSeconds() }).where(eq(issues.id, issueId)).run()
  return getIssue(issueId)
}

export function removeContextRef(issueId: string, index: number): Issue {
  const issue = getIssue(issueId)
  const refs = parseJsonStringArray(issue.contextRefs)
  if (index < 0 || index >= refs.length) {
    throw new AppError({ code: 'issue_context_ref_invalid_index', status: 400, message: 'Invalid context ref index', details: { issueId, index } })
  }
  refs.splice(index, 1)
  db().update(issues).set({ contextRefs: JSON.stringify(refs), updatedAt: currentUnixSeconds() }).where(eq(issues.id, issueId)).run()
  return getIssue(issueId)
}

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
  getIssue(issueId)
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
