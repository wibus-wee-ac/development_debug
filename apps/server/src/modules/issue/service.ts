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
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import type { MutationActor } from '../../http/actor-context'
import { db } from '../../infra'

type StatusCategory = 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'

const StatusCategorySchema = z.enum(['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled'])
const IssueCommentAuthorKindSchema = z.enum(['user', 'agent', 'system', 'system.delegated', 'system.undelegated'])
const IssueLabelsJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.array(z.string()))

const CreateIssueInputSchema = z.object({
  workspaceId: z.string(),
  title: z.string(),
  description: z.string().nullable().default(null),
  priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']).default('none'),
  labels: z.array(z.string()).default([]),
  milestoneId: z.string().nullable().default(null),
  parentIssueId: z.string().nullable().default(null),
  statusId: z.string().nullable().default(null),
  statusName: z.string().nullable().default(null),
})

const CreateStatusInputSchema = z.object({
  workspaceId: z.string(),
  name: z.string(),
  color: z.string().nullable().default(null),
  category: StatusCategorySchema.default('unstarted'),
})

const CreateMilestoneInputSchema = z.object({
  workspaceId: z.string(),
  title: z.string(),
  description: z.string().nullable().default(null),
  dueDate: z.number().nullable().default(null),
  status: z.enum(['open', 'closed']).default('open'),
})

const AddCommentBaseInputSchema = z.object({
  issueId: z.string(),
  content: z.string(),
  authorKind: IssueCommentAuthorKindSchema.default('user'),
  authorId: z.string().nullable().optional(),
})

const AddCommentInputSchema = AddCommentBaseInputSchema.transform(input => ({
  ...input,
  authorId: z.string().nullable().default(() => input.authorKind.startsWith('system') ? null : '__self__').parse(input.authorId),
}))

export const IssueContextRefsJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.array(z.string()))

export const IssuePromptContextRefsJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.array(z.union([
    z.string().transform(value => ({
      type: 'ref',
      value,
      label: undefined as string | undefined,
    })),
    z.object({
      type: z.string(),
      value: z.string(),
      label: z.string().optional(),
    }),
  ])))

export interface IssueCommentAuthorView {
  kind: 'user' | 'agent' | 'system'
  id: string | null
  displayName: string
  avatarUrl: string | null
  label: string | null
}

export type IssueCommentView = IssueComment & { author: IssueCommentAuthorView }
export type IssueView = Omit<Issue, 'labels'> & { labels: string[] }

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

function normalizeStatusName(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function readWorkspaceStatuses(workspaceId: string): IssueStatus[] {
  return db().select().from(issueStatuses).where(eq(issueStatuses.workspaceId, workspaceId)).orderBy(issueStatuses.order).all()
}

function resolveStatusId(workspaceId: string, reference: {
  statusId?: string | null
  statusName?: string | null
}, options: { useDefaultWhenMissing: boolean }): string | null {
  if (reference.statusId != null && reference.statusName != null) {
    throw new AppError({
      code: 'issue_status_reference_conflict',
      status: 400,
      message: 'Use either statusId or statusName, not both',
      details: { statusId: reference.statusId, statusName: reference.statusName },
    })
  }

  if (reference.statusId == null && reference.statusName == null && !options.useDefaultWhenMissing) {
    return null
  }

  seedDefaultStatuses(workspaceId)

  if (reference.statusId != null) {
    const status = db()
      .select({ id: issueStatuses.id })
      .from(issueStatuses)
      .where(sql`${issueStatuses.workspaceId} = ${workspaceId} AND ${issueStatuses.id} = ${reference.statusId}`)
      .get()
    if (!status) {
      throw new AppError({
        code: 'issue_status_not_found',
        status: 404,
        message: 'Status not found',
        details: { workspaceId, statusId: reference.statusId },
      })
    }
    return status.id
  }

  if (reference.statusName != null) {
    const normalizedName = normalizeStatusName(reference.statusName)
    if (!normalizedName) {
      throw new AppError({
        code: 'issue_status_name_empty',
        status: 400,
        message: 'Status name must not be empty',
        details: { workspaceId },
      })
    }
    const status = readWorkspaceStatuses(workspaceId)
      .find(candidate => normalizeStatusName(candidate.name) === normalizedName)
    if (!status) {
      throw new AppError({
        code: 'issue_status_not_found',
        status: 404,
        message: 'Status not found',
        details: { workspaceId, statusName: reference.statusName, normalizedStatusName: normalizedName },
      })
    }
    return status.id
  }

  if (!options.useDefaultWhenMissing) {
    return null
  }

  return readWorkspaceStatuses(workspaceId)[0]?.id ?? null
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
  return readWorkspaceStatuses(workspaceId)
}

export function createStatus(rawInput: { workspaceId: string, name: string, color?: string | null, category?: StatusCategory }): IssueStatus {
  const input = CreateStatusInputSchema.parse(rawInput)
  requireWorkspace(input.workspaceId)
  const count = countStatuses(input.workspaceId)
  return createStatusRow({ ...input, order: count })
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

export function createMilestone(rawInput: { workspaceId: string, title: string, description?: string | null, dueDate?: number | null, status?: 'open' | 'closed' }): IssueMilestone {
  const input = CreateMilestoneInputSchema.parse(rawInput)
  requireWorkspace(input.workspaceId)
  const now = currentUnixSeconds()
  return db().insert(issueMilestones).values({
    id: randomUUID(),
    workspaceId: input.workspaceId,
    title: input.title,
    description: input.description,
    dueDate: input.dueDate,
    status: input.status,
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

export function listIssues(params: IssueListParams): IssueView[] {
  requireWorkspace(params.workspaceId)
  const rows = db()
    .select()
    .from(issues)
    .where(eq(issues.workspaceId, params.workspaceId))
    .orderBy(desc(issues.createdAt))
    .all()

  return rows
    .map(toIssueView)
    .filter(issue => params.milestoneId === undefined || issue.milestoneId === (params.milestoneId ?? null))
    .filter(issue => params.parentIssueId === undefined || issue.parentIssueId === (params.parentIssueId ?? null))
    .filter(issue => params.priority == null || issue.priority === params.priority)
    .filter(issue => params.statusId === undefined || issue.statusId === (params.statusId ?? null))
    .filter((issue) => {
      if (!params.labels || params.labels.length === 0) {
        return true
      }
      return params.labels.every(label => issue.labels.includes(label))
    })
}

function getIssueRow(id: string): Issue {
  const issue = db().select().from(issues).where(eq(issues.id, id)).get()
  if (!issue) {
    throw new AppError({ code: 'issue_not_found', status: 404, message: 'Issue not found', details: { issueId: id } })
  }
  return issue
}

export function getIssue(id: string): IssueView {
  return toIssueView(getIssueRow(id))
}

function toIssueView(issue: Issue): IssueView {
  return {
    ...issue,
    labels: IssueLabelsJsonSchema.parse(issue.labels),
  }
}

export function searchIssues(q: string, limit = 20): IssueView[] {
  const lowerQ = q.toLowerCase()
  const all = db().select().from(issues).orderBy(desc(issues.createdAt)).all()
  return all
    .filter(issue => issue.title.toLowerCase().includes(lowerQ) || (issue.description ?? '').toLowerCase().includes(lowerQ))
    .slice(0, limit)
    .map(toIssueView)
}

export function createIssue(rawInput: {
  workspaceId: string
  title: string
  description?: string | null
  priority?: 'none' | 'low' | 'medium' | 'high' | 'urgent'
  labels?: string[]
  milestoneId?: string | null
  parentIssueId?: string | null
  statusId?: string | null
  statusName?: string | null
}, actor: MutationActor = { kind: 'user', id: '__self__', source: 'default-user' }): IssueView {
  const input = CreateIssueInputSchema.parse(rawInput)
  const workspace = requireWorkspace(input.workspaceId)
  const now = currentUnixSeconds()
  const identity = nextIssueIdentity(workspace)
  const maxOrderRow = db().select({ maxOrder: sql<number>`coalesce(max(${issues.order}), 0)` }).from(issues).where(eq(issues.workspaceId, input.workspaceId)).get()
  const order = (maxOrderRow?.maxOrder ?? 0) + 1024
  const statusId = resolveStatusId(input.workspaceId, input, { useDefaultWhenMissing: true })
  const issue = db().insert(issues).values({
    id: identity.id,
    workspaceId: input.workspaceId,
    title: input.title,
    description: input.description,
    priority: input.priority,
    labels: JSON.stringify(input.labels),
    milestoneId: input.milestoneId,
    parentIssueId: input.parentIssueId,
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
  return toIssueView(issue)
}

export function updateIssue(id: string, patch: Partial<{
  title: string
  description: string | null
  priority: 'none' | 'low' | 'medium' | 'high' | 'urgent'
  labels: string[]
  milestoneId: string | null
  parentIssueId: string | null
  statusId: string | null
  statusName: string | null
  assigneeKind: string | null
  assigneeId: string | null
  order: number
}>): IssueView {
  const issue = getIssueRow(id)
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
  if ('statusId' in patch || 'statusName' in patch) {
    updates.statusId = resolveStatusId(issue.workspaceId, patch, { useDefaultWhenMissing: false })
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

export function moveIssueToStatusName(id: string, statusName: string): IssueView {
  return updateIssue(id, { statusName })
}

export function updateIssueDelegation(id: string, delegation: { agentId: string, agentProfileId: string } | null): IssueView {
  db().update(issues).set({
    delegateAgentId: delegation?.agentId ?? null,
    delegateAgentProfileId: delegation?.agentProfileId ?? null,
    updatedAt: currentUnixSeconds(),
  }).where(eq(issues.id, id)).run()
  return getIssue(id)
}

export function deleteIssue(id: string): void {
  getIssueRow(id)
  db().update(issues).set({ parentIssueId: null, updatedAt: currentUnixSeconds() }).where(eq(issues.parentIssueId, id)).run()
  db().delete(issues).where(eq(issues.id, id)).run()
}

export function bulkUpdateIssues(issueIds: string[], update: { statusId?: string | null, priority?: string, labels?: string[], milestoneId?: string | null, assigneeKind?: string | null, assigneeId?: string | null }): number {
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
    updates.labels = JSON.stringify(update.labels)
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
  getIssueRow(issueId)
  return db().select().from(issueComments).where(eq(issueComments.issueId, issueId)).orderBy(issueComments.createdAt).all().map(toCommentView)
}

export function addComment(rawInput: { issueId: string, content: string, authorKind?: IssueComment['authorKind'], authorId?: string | null }): IssueCommentView {
  const input = AddCommentInputSchema.parse(rawInput)
  getIssue(input.issueId)
  const comment = db().insert(issueComments).values({
    id: randomUUID(),
    issueId: input.issueId,
    content: input.content,
    authorKind: input.authorKind,
    authorId: input.authorId,
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
  getIssueRow(issueId)
  return db()
    .select()
    .from(issueRelations)
    .where(or(eq(issueRelations.sourceIssueId, issueId), eq(issueRelations.targetIssueId, issueId)))
    .all()
}

export function createRelation(input: { sourceIssueId: string, targetIssueId: string, type: 'blocks' | 'duplicates' | 'relates_to' }): IssueRelation {
  getIssueRow(input.sourceIssueId)
  getIssueRow(input.targetIssueId)
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

export function addContextRef(issueId: string, ref: string): IssueView {
  const issue = getIssue(issueId)
  const refs = IssueContextRefsJsonSchema.parse(issue.contextRefs)
  refs.push(ref)
  db().update(issues).set({ contextRefs: JSON.stringify(refs), updatedAt: currentUnixSeconds() }).where(eq(issues.id, issueId)).run()
  return getIssue(issueId)
}

export function removeContextRef(issueId: string, index: number): IssueView {
  const issue = getIssue(issueId)
  const refs = IssueContextRefsJsonSchema.parse(issue.contextRefs)
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
