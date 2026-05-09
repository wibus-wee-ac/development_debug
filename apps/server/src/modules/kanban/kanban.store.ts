// Input: DbAccessor and kanban tables
// Output: DB-backed board/status/milestone/issue/comment persistence for kanban module
// Position: apps/server/src/modules/kanban/kanban.store.ts

import { randomUUID } from 'node:crypto'

import type { KanbanBoard, KanbanIssue, KanbanIssueComment, KanbanMilestone, KanbanStatus } from '@cradle/db'
import {
  kanbanBoards,
  kanbanIssueComments,
  kanbanIssues,
  kanbanMilestones,
  kanbanStatuses,
  workspaces,
} from '@cradle/db'
import { desc, eq, sql } from 'drizzle-orm'
import { inject, injectable } from 'tsyringe'

import { DbAccessor } from '../../database/db-accessor'

export interface IssueListParams {
  workspaceId: string
  milestoneId?: string | null
  parentIssueId?: string | null
  priority?: string | null
  labels?: string[] | null
  statusId?: string | null
}

@injectable()
export class KanbanStore {
  constructor(@inject(DbAccessor) private readonly dbAccessor: DbAccessor) {}

  workspaceExists(workspaceId: string): boolean {
    return !!this.dbAccessor.get().select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)).get()
  }

  listBoards(workspaceId?: string): KanbanBoard[] {
    const db = this.dbAccessor.get()
    const query = db.select().from(kanbanBoards)
    if (!workspaceId) {
      return query.orderBy(desc(kanbanBoards.createdAt)).all()
    }
    return query.where(eq(kanbanBoards.workspaceId, workspaceId)).orderBy(desc(kanbanBoards.createdAt)).all()
  }

  getBoard(id: string): KanbanBoard | undefined {
    return this.dbAccessor.get().select().from(kanbanBoards).where(eq(kanbanBoards.id, id)).get()
  }

  createBoard(input: { workspaceId: string, name: string, filterConfig?: string | null }): KanbanBoard {
    const id = randomUUID()
    const now = nowUnix()
    return this.dbAccessor.get().insert(kanbanBoards).values({
      id,
      workspaceId: input.workspaceId,
      name: input.name,
      filterConfig: input.filterConfig ?? null,
      createdAt: now,
      updatedAt: now,
    }).returning().get()
  }

  deleteBoard(id: string): void {
    this.dbAccessor.get().delete(kanbanBoards).where(eq(kanbanBoards.id, id)).run()
  }

  listStatuses(workspaceId: string): KanbanStatus[] {
    return this.dbAccessor.get().select().from(kanbanStatuses).where(eq(kanbanStatuses.workspaceId, workspaceId)).orderBy(kanbanStatuses.order).all()
  }

  countStatuses(workspaceId: string): number {
    const row = this.dbAccessor.get().select({ count: sql<number>`count(*)` }).from(kanbanStatuses).where(eq(kanbanStatuses.workspaceId, workspaceId)).get()
    return row?.count ?? 0
  }

  createStatus(input: { workspaceId: string, name: string, color?: string | null, order: number }): KanbanStatus {
    const id = randomUUID()
    return this.dbAccessor.get().insert(kanbanStatuses).values({
      id,
      workspaceId: input.workspaceId,
      name: input.name,
      color: input.color ?? null,
      order: input.order,
      createdAt: nowUnix(),
    }).returning().get()
  }

  listMilestones(workspaceId: string): KanbanMilestone[] {
    return this.dbAccessor.get().select().from(kanbanMilestones).where(eq(kanbanMilestones.workspaceId, workspaceId)).orderBy(desc(kanbanMilestones.createdAt)).all()
  }

  listIssues(params: IssueListParams): KanbanIssue[] {
    const issues = this.dbAccessor.get()
      .select()
      .from(kanbanIssues)
      .where(eq(kanbanIssues.workspaceId, params.workspaceId))
      .orderBy(desc(kanbanIssues.createdAt))
      .all()

    return issues
      .filter((issue) => {
        if (params.milestoneId === undefined) {
          return true
        }
        return issue.milestoneId === (params.milestoneId ?? null)
      })
      .filter((issue) => {
        if (params.parentIssueId === undefined) {
          return true
        }
        return issue.parentIssueId === (params.parentIssueId ?? null)
      })
      .filter((issue) => {
        if (params.priority == null) {
          return true
        }
        return issue.priority === params.priority
      })
      .filter((issue) => {
        if (params.statusId === undefined) {
          return true
        }
        return issue.statusId === (params.statusId ?? null)
      })
      .filter((issue) => {
        if (!params.labels || params.labels.length === 0) {
          return true
        }
        const labels = parseStringArray(issue.labels)
        return params.labels.every(label => labels.includes(label))
      })
  }

  getIssue(id: string): KanbanIssue | undefined {
    return this.dbAccessor.get().select().from(kanbanIssues).where(eq(kanbanIssues.id, id)).get()
  }

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
    const id = randomUUID()
    const now = nowUnix()
    return this.dbAccessor.get().insert(kanbanIssues).values({
      id,
      workspaceId: input.workspaceId,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? 'none',
      labels: JSON.stringify(input.labels ?? []),
      milestoneId: input.milestoneId ?? null,
      parentIssueId: input.parentIssueId ?? null,
      statusId: input.statusId ?? null,
      assigneeKind: null,
      assigneeId: null,
      delegateAgentId: null,
      contextRefs: '[]',
      createdAt: now,
      updatedAt: now,
    }).returning().get()
  }

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
  }>): KanbanIssue | undefined {
    const updates: Record<string, unknown> = { updatedAt: nowUnix() }
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

    this.dbAccessor.get().update(kanbanIssues).set(updates).where(eq(kanbanIssues.id, id)).run()
    return this.getIssue(id)
  }

  clearParentForChildIssues(parentIssueId: string): void {
    this.dbAccessor.get().update(kanbanIssues).set({ parentIssueId: null, updatedAt: nowUnix() }).where(eq(kanbanIssues.parentIssueId, parentIssueId)).run()
  }

  deleteIssue(id: string): void {
    this.dbAccessor.get().delete(kanbanIssues).where(eq(kanbanIssues.id, id)).run()
  }

  listComments(issueId: string): KanbanIssueComment[] {
    return this.dbAccessor.get().select().from(kanbanIssueComments).where(eq(kanbanIssueComments.issueId, issueId)).orderBy(kanbanIssueComments.createdAt).all()
  }

  getComment(id: string): KanbanIssueComment | undefined {
    return this.dbAccessor.get().select().from(kanbanIssueComments).where(eq(kanbanIssueComments.id, id)).get()
  }

  addComment(input: { issueId: string, content: string, authorKind?: KanbanIssueComment['authorKind'], authorId?: string | null }): KanbanIssueComment {
    return this.dbAccessor.get().insert(kanbanIssueComments).values({
      id: randomUUID(),
      issueId: input.issueId,
      content: input.content,
      authorKind: input.authorKind ?? 'user',
      authorId: input.authorId ?? '__self__',
      agentActivityId: null,
      createdAt: nowUnix(),
    }).returning().get()
  }

  deleteComment(id: string): void {
    this.dbAccessor.get().delete(kanbanIssueComments).where(eq(kanbanIssueComments.id, id)).run()
  }
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  }
  catch {
    return []
  }
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000)
}
