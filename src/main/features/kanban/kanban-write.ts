// Input: Kanban persistence store abstraction, optional Drizzle-backed store factory, and node:crypto IDs
// Output: Kanban write-side application service for statuses, boards, milestones, issues, comments, relations, context refs, and session links
// Position: Kanban context application mutation boundary between IPC adapters and persistence

import { randomUUID } from 'node:crypto'

import { and, eq, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

import { getDb } from '../../db'
import type * as schema from '../../db/schema'
import type {
  KanbanBoard,
  KanbanIssue,
  KanbanIssueComment,
  KanbanIssueRelation,
  KanbanMilestone,
  KanbanStatus,
} from '../../db/schema'
import {
  kanbanBoards,
  kanbanIssueComments,
  kanbanIssueRelations,
  kanbanIssues,
  kanbanMilestones,
  kanbanStatuses,
  sessions,
} from '../../db/schema'

const defaultNowUnix = (): number => Math.floor(Date.now() / 1000)
const defaultCreateId = (): string => randomUUID()

interface CreateStatusInput {
  workspaceId: string
  name: string
  color?: string | null
}

interface UpdateStatusPatch {
  name?: string
  color?: string | null
}

interface CreateBoardInput {
  workspaceId: string
  name: string
  filterConfig?: string | null
}

interface UpdateBoardPatch {
  name?: string
  filterConfig?: string | null
}

interface CreateMilestoneInput {
  workspaceId: string
  title: string
  description?: string | null
  dueDate?: number | null
}

interface UpdateMilestonePatch {
  title?: string
  description?: string | null
  dueDate?: number | null
  status?: 'open' | 'closed'
}

interface CreateIssueInput {
  workspaceId: string
  title: string
  description?: string | null
  priority?: KanbanIssue['priority']
  labels?: string[]
  milestoneId?: string | null
  parentIssueId?: string | null
  statusId?: string | null
}

interface UpdateIssuePatch {
  title?: string
  description?: string | null
  priority?: KanbanIssue['priority']
  labels?: string[]
  milestoneId?: string | null
  parentIssueId?: string | null
  statusId?: string | null
  assigneeKind?: string | null
  assigneeId?: string | null
}

interface AddCommentInput {
  issueId: string
  content: string
  authorKind?: KanbanIssueComment['authorKind']
  authorId?: string | null
}

interface AddRelationInput {
  sourceIssueId: string
  targetIssueId: string
  type: 'blocks' | 'duplicates' | 'relates_to'
}

export interface KanbanWriteApplicationService {
  createStatus: (input: CreateStatusInput) => KanbanStatus
  updateStatus: (id: string, patch: UpdateStatusPatch) => KanbanStatus
  reorderStatuses: (workspaceId: string, orderedIds: string[]) => void
  deleteStatus: (id: string) => void
  createBoard: (input: CreateBoardInput) => KanbanBoard
  updateBoard: (id: string, patch: UpdateBoardPatch) => KanbanBoard
  deleteBoard: (id: string) => void
  createMilestone: (input: CreateMilestoneInput) => KanbanMilestone
  updateMilestone: (id: string, patch: UpdateMilestonePatch) => KanbanMilestone
  deleteMilestone: (id: string) => void
  createIssue: (input: CreateIssueInput) => KanbanIssue
  updateIssue: (id: string, patch: UpdateIssuePatch) => KanbanIssue
  moveIssue: (id: string, statusId: string | null) => KanbanIssue
  deleteIssue: (id: string) => void
  addComment: (input: AddCommentInput) => KanbanIssueComment
  deleteComment: (id: string) => void
  addRelation: (input: AddRelationInput) => KanbanIssueRelation
  deleteRelation: (id: string) => void
  updateContextRefs: (issueId: string, refs: string) => void
  addContextRef: (issueId: string, ref: string) => void
  removeContextRef: (issueId: string, index: number) => void
  linkIssueToSession: (chatSessionId: string, issueId: string) => void
  unlinkIssueFromSession: (chatSessionId: string) => void
}

export interface KanbanWriteStore {
  getMaxStatusOrder: (workspaceId: string) => number
  createStatus: (status: KanbanStatus) => void
  updateStatus: (id: string, patch: Partial<Pick<KanbanStatus, 'name' | 'color'>>) => void
  getStatus: (id: string) => KanbanStatus | undefined
  reorderStatuses: (workspaceId: string, orderedIds: string[]) => void
  deleteStatus: (id: string) => void
  createBoard: (board: KanbanBoard) => void
  updateBoard: (id: string, patch: Partial<Pick<KanbanBoard, 'name' | 'filterConfig' | 'updatedAt'>>) => void
  getBoard: (id: string) => KanbanBoard | undefined
  deleteBoard: (id: string) => void
  createMilestone: (milestone: KanbanMilestone) => void
  updateMilestone: (id: string, patch: Partial<Pick<KanbanMilestone, 'title' | 'description' | 'dueDate' | 'status' | 'updatedAt'>>) => void
  getMilestone: (id: string) => KanbanMilestone | undefined
  deleteMilestone: (id: string) => void
  createIssue: (issue: KanbanIssue) => void
  updateIssue: (id: string, patch: Partial<KanbanIssue>) => void
  getIssue: (id: string) => KanbanIssue | undefined
  clearParentForChildIssues: (parentIssueId: string) => void
  deleteIssue: (id: string) => void
  createComment: (comment: KanbanIssueComment) => void
  getComment: (id: string) => KanbanIssueComment | undefined
  deleteComment: (id: string) => void
  createRelation: (relation: KanbanIssueRelation) => void
  getRelation: (id: string) => KanbanIssueRelation | undefined
  deleteRelation: (id: string) => void
  updateSessionLinkedIssue: (chatSessionId: string, issueId: string | null) => void
}

interface KanbanWriteApplicationDeps {
  store?: KanbanWriteStore
  db?: BetterSQLite3Database<typeof schema>
  nowUnix?: () => number
  createId?: () => string
}

function resolveDefaultDb(): BetterSQLite3Database<typeof schema> {
  return getDb()
}

export function createDrizzleKanbanWriteStore(
  db: BetterSQLite3Database<typeof schema>,
): KanbanWriteStore {
  return {
    getMaxStatusOrder(workspaceId) {
      const row = db
        .select({ maxOrder: sql<number>`coalesce(max(${kanbanStatuses.order}), -1)` })
        .from(kanbanStatuses)
        .where(eq(kanbanStatuses.workspaceId, workspaceId))
        .get()
      return row?.maxOrder ?? -1
    },
    createStatus(status) {
      db.insert(kanbanStatuses).values(status).run()
    },
    updateStatus(id, patch) {
      db.update(kanbanStatuses).set(patch).where(eq(kanbanStatuses.id, id)).run()
    },
    getStatus(id) {
      return db.select().from(kanbanStatuses).where(eq(kanbanStatuses.id, id)).get()
    },
    reorderStatuses(workspaceId, orderedIds) {
      db.transaction((tx) => {
        for (let index = 0; index < orderedIds.length; index += 1) {
          tx.update(kanbanStatuses)
            .set({ order: index })
            .where(and(eq(kanbanStatuses.id, orderedIds[index]), eq(kanbanStatuses.workspaceId, workspaceId)))
            .run()
        }
      })
    },
    deleteStatus(id) {
      db.delete(kanbanStatuses).where(eq(kanbanStatuses.id, id)).run()
    },
    createBoard(board) {
      db.insert(kanbanBoards).values(board).run()
    },
    updateBoard(id, patch) {
      db.update(kanbanBoards).set(patch).where(eq(kanbanBoards.id, id)).run()
    },
    getBoard(id) {
      return db.select().from(kanbanBoards).where(eq(kanbanBoards.id, id)).get()
    },
    deleteBoard(id) {
      db.delete(kanbanBoards).where(eq(kanbanBoards.id, id)).run()
    },
    createMilestone(milestone) {
      db.insert(kanbanMilestones).values(milestone).run()
    },
    updateMilestone(id, patch) {
      db.update(kanbanMilestones).set(patch).where(eq(kanbanMilestones.id, id)).run()
    },
    getMilestone(id) {
      return db.select().from(kanbanMilestones).where(eq(kanbanMilestones.id, id)).get()
    },
    deleteMilestone(id) {
      db.delete(kanbanMilestones).where(eq(kanbanMilestones.id, id)).run()
    },
    createIssue(issue) {
      db.insert(kanbanIssues).values(issue).run()
    },
    updateIssue(id, patch) {
      db.update(kanbanIssues).set(patch).where(eq(kanbanIssues.id, id)).run()
    },
    getIssue(id) {
      return db.select().from(kanbanIssues).where(eq(kanbanIssues.id, id)).get()
    },
    clearParentForChildIssues(parentIssueId) {
      db.update(kanbanIssues).set({ parentIssueId: null }).where(eq(kanbanIssues.parentIssueId, parentIssueId)).run()
    },
    deleteIssue(id) {
      db.delete(kanbanIssues).where(eq(kanbanIssues.id, id)).run()
    },
    createComment(comment) {
      db.insert(kanbanIssueComments).values(comment).run()
    },
    getComment(id) {
      return db.select().from(kanbanIssueComments).where(eq(kanbanIssueComments.id, id)).get()
    },
    deleteComment(id) {
      db.delete(kanbanIssueComments).where(eq(kanbanIssueComments.id, id)).run()
    },
    createRelation(relation) {
      db.insert(kanbanIssueRelations).values(relation).run()
    },
    getRelation(id) {
      return db.select().from(kanbanIssueRelations).where(eq(kanbanIssueRelations.id, id)).get()
    },
    deleteRelation(id) {
      db.delete(kanbanIssueRelations).where(eq(kanbanIssueRelations.id, id)).run()
    },
    updateSessionLinkedIssue(chatSessionId, issueId) {
      db.update(sessions).set({ linkedIssueId: issueId }).where(eq(sessions.id, chatSessionId)).run()
    },
  }
}

function parseJsonArray<T>(raw: string): T[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed as T[] : []
  }
  catch {
    return []
  }
}

function requireRow<T>(row: T | undefined, message: string): T {
  if (!row) {
    throw new Error(message)
  }
  return row
}

export function createKanbanWriteApplicationService(
  deps: KanbanWriteApplicationDeps = {},
): KanbanWriteApplicationService {
  const store = deps.store ?? createDrizzleKanbanWriteStore(deps.db ?? resolveDefaultDb())
  const nowUnix = deps.nowUnix ?? defaultNowUnix
  const createId = deps.createId ?? defaultCreateId

  const createStatus: KanbanWriteApplicationService['createStatus'] = (input) => {
    const id = createId()

    store.createStatus({
      id,
      workspaceId: input.workspaceId,
      name: input.name,
      color: input.color ?? null,
      order: store.getMaxStatusOrder(input.workspaceId) + 1,
      createdAt: nowUnix(),
    })

    return requireRow(
      store.getStatus(id),
      `Status ${id} was not created`,
    )
  }

  const updateStatus: KanbanWriteApplicationService['updateStatus'] = (id, patch) => {
    const updates: Record<string, unknown> = {}
    if (patch.name !== undefined) {
      updates.name = patch.name
    }
    if ('color' in patch) {
      updates.color = patch.color ?? null
    }
    if (Object.keys(updates).length > 0) {
      store.updateStatus(id, updates)
    }

    return requireRow(
      store.getStatus(id),
      `Status ${id} was not found after update`,
    )
  }

  const reorderStatuses: KanbanWriteApplicationService['reorderStatuses'] = (workspaceId, orderedIds) => {
    store.reorderStatuses(workspaceId, orderedIds)
  }

  const deleteStatus: KanbanWriteApplicationService['deleteStatus'] = (id) => {
    store.deleteStatus(id)
  }

  const createBoard: KanbanWriteApplicationService['createBoard'] = (input) => {
    const id = createId()
    const ts = nowUnix()
    store.createBoard({
      id,
      workspaceId: input.workspaceId,
      name: input.name,
      filterConfig: input.filterConfig ?? null,
      createdAt: ts,
      updatedAt: ts,
    })

    return requireRow(
      store.getBoard(id),
      `Board ${id} was not created`,
    )
  }

  const updateBoard: KanbanWriteApplicationService['updateBoard'] = (id, patch) => {
    const updates: Record<string, unknown> = { updatedAt: nowUnix() }
    if (patch.name !== undefined) {
      updates.name = patch.name
    }
    if ('filterConfig' in patch) {
      updates.filterConfig = patch.filterConfig ?? null
    }

    store.updateBoard(id, updates)

    return requireRow(
      store.getBoard(id),
      `Board ${id} was not found after update`,
    )
  }

  const deleteBoard: KanbanWriteApplicationService['deleteBoard'] = (id) => {
    store.deleteBoard(id)
  }

  const createMilestone: KanbanWriteApplicationService['createMilestone'] = (input) => {
    const id = createId()
    const ts = nowUnix()
    store.createMilestone({
      id,
      workspaceId: input.workspaceId,
      title: input.title,
      description: input.description ?? null,
      dueDate: input.dueDate ?? null,
      status: 'open',
      createdAt: ts,
      updatedAt: ts,
    })

    return requireRow(
      store.getMilestone(id),
      `Milestone ${id} was not created`,
    )
  }

  const updateMilestone: KanbanWriteApplicationService['updateMilestone'] = (id, patch) => {
    const updates: Record<string, unknown> = { updatedAt: nowUnix() }
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

    store.updateMilestone(id, updates)

    return requireRow(
      store.getMilestone(id),
      `Milestone ${id} was not found after update`,
    )
  }

  const deleteMilestone: KanbanWriteApplicationService['deleteMilestone'] = (id) => {
    store.deleteMilestone(id)
  }

  const createIssue: KanbanWriteApplicationService['createIssue'] = (input) => {
    const id = createId()
    const ts = nowUnix()
    store.createIssue({
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
      createdAt: ts,
      updatedAt: ts,
    })

    return requireRow(
      store.getIssue(id),
      `Issue ${id} was not created`,
    )
  }

  const updateIssue: KanbanWriteApplicationService['updateIssue'] = (id, patch) => {
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

    store.updateIssue(id, updates)

    return requireRow(
      store.getIssue(id),
      `Issue ${id} was not found after update`,
    )
  }

  const moveIssue: KanbanWriteApplicationService['moveIssue'] = (id, statusId) => {
    return updateIssue(id, { statusId })
  }

  const deleteIssue: KanbanWriteApplicationService['deleteIssue'] = (id) => {
    store.clearParentForChildIssues(id)
    store.deleteIssue(id)
  }

  const addComment: KanbanWriteApplicationService['addComment'] = (input) => {
    const id = createId()
    store.createComment({
      id,
      issueId: input.issueId,
      content: input.content,
      authorKind: input.authorKind ?? 'user',
      authorId: input.authorId ?? '__self__',
      agentActivityId: null,
      createdAt: nowUnix(),
    })

    return requireRow(
      store.getComment(id),
      `Comment ${id} was not created`,
    )
  }

  const deleteComment: KanbanWriteApplicationService['deleteComment'] = (id) => {
    store.deleteComment(id)
  }

  const addRelation: KanbanWriteApplicationService['addRelation'] = (input) => {
    const id = createId()
    store.createRelation({
      id,
      sourceIssueId: input.sourceIssueId,
      targetIssueId: input.targetIssueId,
      type: input.type,
      createdAt: nowUnix(),
    })

    return requireRow(
      store.getRelation(id),
      `Relation ${id} was not created`,
    )
  }

  const deleteRelation: KanbanWriteApplicationService['deleteRelation'] = (id) => {
    store.deleteRelation(id)
  }

  const updateContextRefs: KanbanWriteApplicationService['updateContextRefs'] = (issueId, refs) => {
    store.updateIssue(issueId, { contextRefs: refs, updatedAt: nowUnix() })
  }

  const addContextRef: KanbanWriteApplicationService['addContextRef'] = (issueId, ref) => {
    const issue = store.getIssue(issueId)
    if (!issue) {
      return
    }

    const refs = parseJsonArray<unknown>(issue.contextRefs)
    refs.push(JSON.parse(ref) as unknown)
    updateContextRefs(issueId, JSON.stringify(refs))
  }

  const removeContextRef: KanbanWriteApplicationService['removeContextRef'] = (issueId, index) => {
    const issue = store.getIssue(issueId)
    if (!issue) {
      return
    }

    const refs = parseJsonArray<unknown>(issue.contextRefs)
    refs.splice(index, 1)
    updateContextRefs(issueId, JSON.stringify(refs))
  }

  const linkIssueToSession: KanbanWriteApplicationService['linkIssueToSession'] = (chatSessionId, issueId) => {
    store.updateSessionLinkedIssue(chatSessionId, issueId)
  }

  const unlinkIssueFromSession: KanbanWriteApplicationService['unlinkIssueFromSession'] = (chatSessionId) => {
    store.updateSessionLinkedIssue(chatSessionId, null)
  }

  return {
    createStatus,
    updateStatus,
    reorderStatuses,
    deleteStatus,
    createBoard,
    updateBoard,
    deleteBoard,
    createMilestone,
    updateMilestone,
    deleteMilestone,
    createIssue,
    updateIssue,
    moveIssue,
    deleteIssue,
    addComment,
    deleteComment,
    addRelation,
    deleteRelation,
    updateContextRefs,
    addContextRef,
    removeContextRef,
    linkIssueToSession,
    unlinkIssueFromSession,
  }
}
