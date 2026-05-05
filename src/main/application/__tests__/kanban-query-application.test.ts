// Input: Kanban query application service, in-memory fake store, and Kanban/session schema row types
// Output: Behavior tests for Kanban read-side queries without native SQLite dependencies
// Position: Unit/integration test for src/main/application/kanban-query-application.ts

import { describe, expect, it, vi } from 'vitest'

import type {
  AgentActivity,
  AgentSession,
  KanbanBoard,
  KanbanIssue,
  KanbanIssueComment,
  KanbanIssueRelation,
  KanbanMilestone,
  KanbanStatus,
  Session,
} from '../../db/schema'
import type { KanbanQueryStore } from '../kanban-query-application'
import {
  createKanbanQueryApplicationService,
} from '../kanban-query-application'

vi.mock('better-sqlite3', () => ({
  default: class MockBetterSqliteDatabase {},
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: false },
}))

interface FakeStoreState {
  statuses: KanbanStatus[]
  boards: KanbanBoard[]
  milestones: KanbanMilestone[]
  issues: KanbanIssue[]
  comments: KanbanIssueComment[]
  relations: KanbanIssueRelation[]
  sessions: Session[]
  agentSessions: AgentSession[]
  agentActivities: AgentActivity[]
}

function clone<T>(value: T): T {
  return { ...value }
}

function createStore(state: FakeStoreState): KanbanQueryStore {
  return {
    listStatusesByWorkspace(workspaceId) {
      return state.statuses
        .filter(status => status.workspaceId === workspaceId)
        .map(clone)
    },
    listBoards(workspaceId) {
      return state.boards
        .filter(board => workspaceId === undefined || board.workspaceId === workspaceId)
        .map(clone)
    },
    listMilestonesByWorkspace(workspaceId) {
      return state.milestones
        .filter(milestone => milestone.workspaceId === workspaceId)
        .map(clone)
    },
    listIssues() {
      return state.issues.map(clone)
    },
    getIssue(id) {
      const issue = state.issues.find(candidate => candidate.id === id)
      return issue ? clone(issue) : undefined
    },
    listCommentsByIssue(issueId) {
      return state.comments
        .filter(comment => comment.issueId === issueId)
        .map(clone)
    },
    listRelationsByIssue(issueId) {
      return state.relations
        .filter(relation => relation.sourceIssueId === issueId || relation.targetIssueId === issueId)
        .map(clone)
    },
    listAgentSessionsByIssue(issueId) {
      return state.agentSessions
        .filter(session => session.issueId === issueId)
        .map(clone)
    },
    listAgentActivitiesBySession(agentSessionId) {
      return state.agentActivities
        .filter(activity => activity.agentSessionId === agentSessionId)
        .map(clone)
    },
    getAgentSessionByChatSessionId(chatSessionId) {
      const session = state.agentSessions.find(candidate => candidate.chatSessionId === chatSessionId)
      return session ? clone(session) : undefined
    },
    getSession(id) {
      const session = state.sessions.find(candidate => candidate.id === id)
      return session ? clone(session) : undefined
    },
    getStatus(id) {
      const status = state.statuses.find(candidate => candidate.id === id)
      return status ? clone(status) : undefined
    },
  }
}

function createStatus(id: string, workspaceId: string, order: number, name = id): KanbanStatus {
  return {
    id,
    workspaceId,
    name,
    color: null,
    order,
    createdAt: 1_700_000_000 + order,
  }
}

function createBoard(id: string, workspaceId: string, createdAt: number): KanbanBoard {
  return {
    id,
    workspaceId,
    name: `Board ${id}`,
    filterConfig: null,
    createdAt,
    updatedAt: createdAt,
  }
}

function createMilestone(id: string, workspaceId: string, createdAt: number): KanbanMilestone {
  return {
    id,
    workspaceId,
    title: `Milestone ${id}`,
    description: null,
    dueDate: null,
    status: 'open',
    createdAt,
    updatedAt: createdAt,
  }
}

function createIssue(id: string, workspaceId: string, overrides: Partial<KanbanIssue> = {}): KanbanIssue {
  const createdAt = overrides.createdAt ?? 1_700_000_000
  return {
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
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
    ...overrides,
  }
}

function createComment(id: string, issueId: string, createdAt: number): KanbanIssueComment {
  return {
    id,
    issueId,
    content: `Comment ${id}`,
    authorKind: 'user',
    authorId: '__self__',
    agentActivityId: null,
    createdAt,
  }
}

function createRelation(id: string, sourceIssueId: string, targetIssueId: string, createdAt: number): KanbanIssueRelation {
  return {
    id,
    sourceIssueId,
    targetIssueId,
    type: 'relates_to',
    createdAt,
  }
}

function createSession(id: string, workspaceId: string, linkedIssueId: string | null): Session {
  return {
    id,
    workspaceId,
    title: `Session ${id}`,
    agentProfileId: 'profile-1',
    agentId: null,
    linkedIssueId,
    providerKind: 'openai-compatible',
    providerSessionId: null,
    providerStateSnapshot: null,
    modelId: null,
    configSnapshot: null,
    pinned: 0,
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_000,
  }
}

function createAgentSession(id: string, issueId: string, chatSessionId: string | null, createdAt: number): AgentSession {
  return {
    id,
    issueId,
    agentProfileId: 'profile-1',
    chatSessionId,
    status: 'active',
    createdAt,
    updatedAt: createdAt,
  }
}

function createAgentActivity(id: string, agentSessionId: string, createdAt: number): AgentActivity {
  return {
    id,
    agentSessionId,
    type: 'thought',
    content: JSON.stringify({ body: id }),
    signal: null,
    signalMetadata: null,
    createdAt,
  }
}

describe('kanbanQueryApplicationService', () => {
  it('lists statuses, boards, milestones, comments, relations, agent sessions, and activities in current UI order', () => {
    const workspaceId = 'workspace-1'
    const state: FakeStoreState = {
      statuses: [
        createStatus('status-2', workspaceId, 2, 'Done'),
        createStatus('status-0', workspaceId, 0, 'Backlog'),
        createStatus('status-1', workspaceId, 1, 'Doing'),
      ],
      boards: [
        createBoard('board-old', workspaceId, 10),
        createBoard('board-new', workspaceId, 20),
      ],
      milestones: [
        createMilestone('milestone-old', workspaceId, 10),
        createMilestone('milestone-new', workspaceId, 20),
      ],
      issues: [createIssue('issue-1', workspaceId)],
      comments: [
        createComment('comment-late', 'issue-1', 20),
        createComment('comment-early', 'issue-1', 10),
      ],
      relations: [
        createRelation('relation-late', 'issue-1', 'issue-2', 20),
        createRelation('relation-early', 'issue-3', 'issue-1', 10),
      ],
      sessions: [],
      agentSessions: [
        createAgentSession('agent-session-old', 'issue-1', 'chat-1', 10),
        createAgentSession('agent-session-new', 'issue-1', 'chat-2', 20),
      ],
      agentActivities: [
        createAgentActivity('activity-late', 'agent-session-new', 20),
        createAgentActivity('activity-early', 'agent-session-new', 10),
      ],
    }

    const service = createKanbanQueryApplicationService({ store: createStore(state) })

    expect(service.listStatuses(workspaceId).map(status => status.id)).toEqual(['status-0', 'status-1', 'status-2'])
    expect(service.listBoards(workspaceId).map(board => board.id)).toEqual(['board-new', 'board-old'])
    expect(service.listMilestones(workspaceId).map(milestone => milestone.id)).toEqual(['milestone-new', 'milestone-old'])
    expect(service.listComments('issue-1').map(comment => comment.id)).toEqual(['comment-early', 'comment-late'])
    expect(service.listRelations('issue-1').map(relation => relation.id)).toEqual(['relation-early', 'relation-late'])
    expect(service.getAgentSessions('issue-1').map(session => session.id)).toEqual(['agent-session-new', 'agent-session-old'])
    expect(service.getAgentActivities('agent-session-new').map(activity => activity.id)).toEqual(['activity-early', 'activity-late'])
  })

  it('filters issues by workspace, milestone, parent, priority, labels, and nullable status', () => {
    const workspaceId = 'workspace-1'
    const state: FakeStoreState = {
      statuses: [],
      boards: [],
      milestones: [],
      issues: [
        createIssue('issue-match', workspaceId, {
          milestoneId: 'milestone-1',
          parentIssueId: 'parent-1',
          priority: 'high',
          labels: '["backend","kanban"]',
          statusId: 'status-1',
          createdAt: 20,
        }),
        createIssue('issue-null-status', workspaceId, {
          labels: '["backend"]',
          statusId: null,
          createdAt: 10,
        }),
        createIssue('issue-other-workspace', 'workspace-2', {
          milestoneId: 'milestone-1',
          parentIssueId: 'parent-1',
          priority: 'high',
          labels: '["backend","kanban"]',
          statusId: 'status-1',
          createdAt: 30,
        }),
      ],
      comments: [],
      relations: [],
      sessions: [],
      agentSessions: [],
      agentActivities: [],
    }

    const service = createKanbanQueryApplicationService({ store: createStore(state) })

    expect(service.listIssues({
      workspaceId,
      milestoneId: 'milestone-1',
      parentIssueId: 'parent-1',
      priority: 'high',
      labels: ['backend', 'kanban'],
      statusId: 'status-1',
    }).map(issue => issue.id)).toEqual(['issue-match'])

    expect(service.listIssues({
      workspaceId,
      statusId: null,
    }).map(issue => issue.id)).toEqual(['issue-null-status'])
  })

  it('searches issues by title or description, trims blank input, and respects the limit', () => {
    const state: FakeStoreState = {
      statuses: [],
      boards: [],
      milestones: [],
      issues: [
        createIssue('issue-1', 'workspace-1', {
          title: 'Refactor Kanban query boundary',
          updatedAt: 10,
        }),
        createIssue('issue-2', 'workspace-1', {
          title: 'Unrelated',
          description: 'Need kanban query cleanup',
          updatedAt: 30,
        }),
        createIssue('issue-3', 'workspace-1', {
          title: 'kanban search third result',
          updatedAt: 20,
        }),
      ],
      comments: [],
      relations: [],
      sessions: [],
      agentSessions: [],
      agentActivities: [],
    }

    const service = createKanbanQueryApplicationService({ store: createStore(state) })

    expect(service.searchIssues('   ')).toEqual([])
    expect(service.searchIssues('kanban query', 2).map(issue => issue.id)).toEqual(['issue-2', 'issue-1'])
  })

  it('returns a single issue by id', () => {
    const state: FakeStoreState = {
      statuses: [],
      boards: [],
      milestones: [],
      issues: [createIssue('issue-1', 'workspace-1')],
      comments: [],
      relations: [],
      sessions: [],
      agentSessions: [],
      agentActivities: [],
    }

    const service = createKanbanQueryApplicationService({ store: createStore(state) })

    expect(service.getIssue('issue-1')?.id).toBe('issue-1')
    expect(service.getIssue('missing')).toBeUndefined()
  })

  it('prefers auto-linked issues over manual links and falls back when auto-link is absent', () => {
    const workspaceId = 'workspace-1'
    const state: FakeStoreState = {
      statuses: [createStatus('status-1', workspaceId, 0, 'Backlog')],
      boards: [],
      milestones: [],
      issues: [
        createIssue('issue-auto', workspaceId, { statusId: 'status-1' }),
        createIssue('issue-manual', workspaceId),
      ],
      comments: [],
      relations: [],
      sessions: [
        createSession('chat-auto', workspaceId, 'issue-manual'),
        createSession('chat-manual', workspaceId, 'issue-manual'),
        createSession('chat-none', workspaceId, null),
      ],
      agentSessions: [
        createAgentSession('agent-session-1', 'issue-auto', 'chat-auto', 10),
      ],
      agentActivities: [],
    }

    const service = createKanbanQueryApplicationService({ store: createStore(state) })

    expect(service.getLinkedIssue('chat-auto')).toEqual({
      issue: expect.objectContaining({ id: 'issue-auto' }),
      status: expect.objectContaining({ id: 'status-1' }),
      agentSession: expect.objectContaining({ id: 'agent-session-1' }),
    })
    expect(service.getLinkedIssue('chat-manual')).toEqual({
      issue: expect.objectContaining({ id: 'issue-manual' }),
      status: null,
      agentSession: null,
    })
    expect(service.getLinkedIssue('chat-none')).toBeNull()
  })
})
