// Input: getDb, kanban schema tables, drizzle-orm operators
// Output: KanbanService — IPC surface for boards, statuses, milestones, issues, comments, and relations
// Position: Main-process IPC service for the Kanban feature

import { randomUUID } from 'node:crypto'

import { IpcMethod, IpcService } from '@cradle/ipc'
import { and, asc, desc, eq, like, or, sql } from 'drizzle-orm'

import { getDb } from '../db'
import type {
  KanbanBoard,
  KanbanIssue,
  KanbanIssueComment,
  KanbanIssueRelation,
  KanbanMilestone,
  KanbanStatus,
} from '../db/schema'
import {
  kanbanBoards,
  kanbanIssueComments,
  kanbanIssueRelations,
  kanbanIssues,
  kanbanMilestones,
  kanbanStatuses,
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
  }): KanbanIssueComment {
    const db = getDb()
    const id = randomUUID()
    db.insert(kanbanIssueComments).values({
      id,
      issueId: input.issueId,
      content: input.content,
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
}
