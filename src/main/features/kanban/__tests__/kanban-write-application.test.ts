// Input: Kanban write application service, in-memory fake store, and Kanban schema row types
// Output: Behavior tests for Kanban write-side commands without native SQLite dependencies
// Position: Kanban context application test for kanban-write-application.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  KanbanBoard,
  KanbanIssue,
  KanbanIssueComment,
  KanbanIssueRelation,
  KanbanMilestone,
  KanbanStatus,
} from '../../../db/schema'
import type { KanbanWriteStore } from '../kanban-write'
import {
  createKanbanWriteApplicationService,
} from '../kanban-write'

vi.mock('better-sqlite3', () => ({
  default: class MockBetterSqliteDatabase {},
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: false },
}))

const now = vi.fn(() => 1_700_000_000)

interface FakeSessionRecord {
  id: string
  linkedIssueId: string | null
}

interface FakeStoreState {
  statuses: Map<string, KanbanStatus>
  boards: Map<string, KanbanBoard>
  milestones: Map<string, KanbanMilestone>
  issues: Map<string, KanbanIssue>
  comments: Map<string, KanbanIssueComment>
  relations: Map<string, KanbanIssueRelation>
  sessions: Map<string, FakeSessionRecord>
}

function createState(): FakeStoreState {
  return {
    statuses: new Map(),
    boards: new Map(),
    milestones: new Map(),
    issues: new Map(),
    comments: new Map(),
    relations: new Map(),
    sessions: new Map(),
  }
}

function createStore(state: FakeStoreState): KanbanWriteStore {
  return {
    getMaxStatusOrder(workspaceId) {
      return [...state.statuses.values()]
        .filter(status => status.workspaceId === workspaceId)
        .reduce((max, status) => Math.max(max, status.order), -1)
    },
    createStatus(status) {
      state.statuses.set(status.id, { ...status })
    },
    updateStatus(id, patch) {
      const current = state.statuses.get(id)
      if (!current) {
        return
      }
      state.statuses.set(id, { ...current, ...patch })
    },
    getStatus(id) {
      const status = state.statuses.get(id)
      return status ? { ...status } : undefined
    },
    reorderStatuses(workspaceId, orderedIds) {
      orderedIds.forEach((id, index) => {
        const current = state.statuses.get(id)
        if (!current || current.workspaceId !== workspaceId) {
          return
        }
        state.statuses.set(id, { ...current, order: index })
      })
    },
    deleteStatus(id) {
      state.statuses.delete(id)
      for (const [issueId, issue] of state.issues.entries()) {
        if (issue.statusId === id) {
          state.issues.set(issueId, { ...issue, statusId: null })
        }
      }
    },
    createBoard(board) {
      state.boards.set(board.id, { ...board })
    },
    updateBoard(id, patch) {
      const current = state.boards.get(id)
      if (!current) {
        return
      }
      state.boards.set(id, { ...current, ...patch })
    },
    getBoard(id) {
      const board = state.boards.get(id)
      return board ? { ...board } : undefined
    },
    deleteBoard(id) {
      state.boards.delete(id)
    },
    createMilestone(milestone) {
      state.milestones.set(milestone.id, { ...milestone })
    },
    updateMilestone(id, patch) {
      const current = state.milestones.get(id)
      if (!current) {
        return
      }
      state.milestones.set(id, { ...current, ...patch })
    },
    getMilestone(id) {
      const milestone = state.milestones.get(id)
      return milestone ? { ...milestone } : undefined
    },
    deleteMilestone(id) {
      state.milestones.delete(id)
      for (const [issueId, issue] of state.issues.entries()) {
        if (issue.milestoneId === id) {
          state.issues.set(issueId, { ...issue, milestoneId: null })
        }
      }
    },
    createIssue(issue) {
      state.issues.set(issue.id, { ...issue })
    },
    updateIssue(id, patch) {
      const current = state.issues.get(id)
      if (!current) {
        return
      }
      state.issues.set(id, { ...current, ...patch })
    },
    getIssue(id) {
      const issue = state.issues.get(id)
      return issue ? { ...issue } : undefined
    },
    clearParentForChildIssues(parentIssueId) {
      for (const [issueId, issue] of state.issues.entries()) {
        if (issue.parentIssueId === parentIssueId) {
          state.issues.set(issueId, { ...issue, parentIssueId: null })
        }
      }
    },
    deleteIssue(id) {
      state.issues.delete(id)
      for (const [commentId, comment] of state.comments.entries()) {
        if (comment.issueId === id) {
          state.comments.delete(commentId)
        }
      }
      for (const [relationId, relation] of state.relations.entries()) {
        if (relation.sourceIssueId === id || relation.targetIssueId === id) {
          state.relations.delete(relationId)
        }
      }
      for (const [sessionId, session] of state.sessions.entries()) {
        if (session.linkedIssueId === id) {
          state.sessions.set(sessionId, { ...session, linkedIssueId: null })
        }
      }
    },
    createComment(comment) {
      state.comments.set(comment.id, { ...comment })
    },
    getComment(id) {
      const comment = state.comments.get(id)
      return comment ? { ...comment } : undefined
    },
    deleteComment(id) {
      state.comments.delete(id)
    },
    createRelation(relation) {
      state.relations.set(relation.id, { ...relation })
    },
    getRelation(id) {
      const relation = state.relations.get(id)
      return relation ? { ...relation } : undefined
    },
    deleteRelation(id) {
      state.relations.delete(id)
    },
    updateSessionLinkedIssue(chatSessionId, issueId) {
      const current = state.sessions.get(chatSessionId)
      if (!current) {
        return
      }
      state.sessions.set(chatSessionId, { ...current, linkedIssueId: issueId })
    },
  }
}

function insertStatus(state: FakeStoreState, id: string, workspaceId: string, order: number, name = id) {
  state.statuses.set(id, {
    id,
    workspaceId,
    name,
    color: null,
    order,
    createdAt: now(),
  })
  return id
}

function insertMilestone(state: FakeStoreState, id: string, workspaceId: string, title = id) {
  state.milestones.set(id, {
    id,
    workspaceId,
    title,
    description: null,
    dueDate: null,
    status: 'open',
    createdAt: now(),
    updatedAt: now(),
  })
  return id
}

function insertIssue(
  state: FakeStoreState,
  id: string,
  workspaceId: string,
  overrides: Partial<KanbanIssue> = {},
) {
  state.issues.set(id, {
    id,
    workspaceId,
    title: `Issue ${id}`,
    description: null,
    priority: 'none',
    labels: '[]',
    contextRefs: '[]',
    statusId: null,
    milestoneId: null,
    parentIssueId: null,
    assigneeKind: null,
    assigneeId: null,
    delegateAgentId: null,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  })
  return id
}

function insertSession(state: FakeStoreState, id: string) {
  state.sessions.set(id, { id, linkedIssueId: null })
  return id
}

describe('kanbanWriteApplicationService', () => {
  let state: FakeStoreState
  let store: KanbanWriteStore
  let createId: ReturnType<typeof vi.fn<() => string>>

  beforeEach(() => {
    now.mockReturnValue(1_700_000_000)
    state = createState()
    store = createStore(state)
    createId = vi.fn<() => string>()
      .mockReturnValueOnce('generated-1')
      .mockReturnValueOnce('generated-2')
      .mockReturnValueOnce('generated-3')
      .mockReturnValueOnce('generated-4')
      .mockReturnValueOnce('generated-5')
      .mockReturnValueOnce('generated-6')
      .mockReturnValue('generated-next')
  })

  it('appends statuses, reorders them, and deleting a status clears issue assignments', () => {
    const workspaceId = 'workspace-1'
    insertStatus(state, 'status-backlog', workspaceId, 0, 'Backlog')
    insertStatus(state, 'status-progress', workspaceId, 1, 'In Progress')

    const service = createKanbanWriteApplicationService({ store, nowUnix: now, createId })
    const review = service.createStatus({ workspaceId, name: 'Review', color: '#f59e0b' })
    insertIssue(state, 'issue-1', workspaceId, { statusId: review.id })

    expect(review.order).toBe(2)

    service.reorderStatuses(workspaceId, [review.id, 'status-backlog', 'status-progress'])

    const ordered = [...state.statuses.values()]
      .filter(status => status.workspaceId === workspaceId)
      .sort((left, right) => left.order - right.order)
    expect(ordered.map(status => status.id)).toEqual([review.id, 'status-backlog', 'status-progress'])

    service.deleteStatus(review.id)

    expect(state.issues.get('issue-1')?.statusId).toBeNull()
  })

  it('creates, updates, and deletes boards', () => {
    const workspaceId = 'workspace-1'
    const service = createKanbanWriteApplicationService({ store, nowUnix: now, createId })

    const board = service.createBoard({ workspaceId, name: 'Delivery', filterConfig: '{"priority":"high"}' })
    const updated = service.updateBoard(board.id, { name: 'Delivery Board', filterConfig: null })

    expect(updated.name).toBe('Delivery Board')
    expect(updated.filterConfig).toBeNull()
    expect(updated.updatedAt).toBe(1_700_000_000)

    service.deleteBoard(board.id)

    expect(state.boards.size).toBe(0)
  })

  it('creates, updates, and deletes milestones', () => {
    const workspaceId = 'workspace-1'
    const service = createKanbanWriteApplicationService({ store, nowUnix: now, createId })

    const milestone = service.createMilestone({ workspaceId, title: 'Beta', description: 'Cut beta', dueDate: 1_800_000_000 })
    const updated = service.updateMilestone(milestone.id, {
      title: 'Beta 1',
      description: null,
      dueDate: null,
      status: 'closed',
    })

    expect(updated.title).toBe('Beta 1')
    expect(updated.description).toBeNull()
    expect(updated.status).toBe('closed')

    service.deleteMilestone(milestone.id)

    expect(state.milestones.size).toBe(0)
  })

  it('creates, updates, and moves issues while serializing labels', () => {
    const workspaceId = 'workspace-1'
    const statusId = insertStatus(state, 'status-1', workspaceId, 0, 'Backlog')
    const milestoneId = insertMilestone(state, 'milestone-1', workspaceId, 'M1')
    const service = createKanbanWriteApplicationService({ store, nowUnix: now, createId })

    const issue = service.createIssue({
      workspaceId,
      title: 'Ship refactor',
      description: 'Move writes to application layer',
      priority: 'high',
      labels: ['backend', 'kanban'],
      milestoneId,
      statusId,
    })

    const updated = service.updateIssue(issue.id, {
      labels: ['ddd'],
      assigneeKind: 'user',
      assigneeId: '__self__',
      description: null,
    })
    const moved = service.moveIssue(issue.id, null)

    expect(updated.labels).toBe('["ddd"]')
    expect(updated.assigneeKind).toBe('user')
    expect(updated.assigneeId).toBe('__self__')
    expect(updated.description).toBeNull()
    expect(moved.statusId).toBeNull()
  })

  it('clears child issue parent references before deleting a parent issue', () => {
    const workspaceId = 'workspace-1'
    insertIssue(state, 'parent-1', workspaceId)
    insertIssue(state, 'child-1', workspaceId, { parentIssueId: 'parent-1' })
    const service = createKanbanWriteApplicationService({ store, nowUnix: now, createId })

    service.deleteIssue('parent-1')

    const parent = state.issues.get('parent-1')
    const child = state.issues.get('child-1')
    expect(parent).toBeUndefined()
    expect(child?.parentIssueId).toBeNull()
  })

  it('adds and deletes comments and relations', () => {
    const workspaceId = 'workspace-1'
    insertIssue(state, 'issue-1', workspaceId)
    insertIssue(state, 'issue-2', workspaceId)
    const service = createKanbanWriteApplicationService({ store, nowUnix: now, createId })

    const comment = service.addComment({ issueId: 'issue-1', content: 'Investigating', authorKind: 'system', authorId: null })
    const relation = service.addRelation({ sourceIssueId: 'issue-1', targetIssueId: 'issue-2', type: 'blocks' })

    expect(comment.authorKind).toBe('system')
    expect(relation.type).toBe('blocks')

    service.deleteComment(comment.id)
    service.deleteRelation(relation.id)

    expect(state.comments.size).toBe(0)
    expect(state.relations.size).toBe(0)
  })

  it('replaces and mutates context refs as JSON arrays', () => {
    const workspaceId = 'workspace-1'
    insertIssue(state, 'issue-1', workspaceId)
    const service = createKanbanWriteApplicationService({ store, nowUnix: now, createId })

    service.updateContextRefs('issue-1', '[{"type":"path","path":"README.md"}]')
    service.addContextRef('issue-1', '{"type":"url","url":"https://example.com"}')
    service.removeContextRef('issue-1', 0)

    expect(state.issues.get('issue-1')?.contextRefs).toBe('[{"type":"url","url":"https://example.com"}]')
  })

  it('links and unlinks an issue to a chat session', () => {
    const workspaceId = 'workspace-1'
    insertIssue(state, 'issue-1', workspaceId)
    insertSession(state, 'session-1')
    const service = createKanbanWriteApplicationService({ store, nowUnix: now, createId })

    service.linkIssueToSession('session-1', 'issue-1')
    let session = state.sessions.get('session-1')
    expect(session?.linkedIssueId).toBe('issue-1')

    service.unlinkIssueFromSession('session-1')
    session = state.sessions.get('session-1')
    expect(session?.linkedIssueId).toBeNull()
  })
})
