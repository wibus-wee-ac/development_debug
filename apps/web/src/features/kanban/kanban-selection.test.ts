// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import type { KanbanIssue, KanbanMilestone, KanbanStatus } from '~/lib/types'

import { addIssueSelectionRange, issueRangeIds, orderedIssuesForKanbanView, toggleIssueSelection } from './kanban-selection'

const issueIds = ['issue-1', 'issue-2', 'issue-3', 'issue-4']

function issue(id: string, statusId: string, createdAt: number): KanbanIssue {
  return {
    id,
    workspaceId: 'workspace-1',
    number: createdAt,
    statusId,
    milestoneId: null,
    parentIssueId: null,
    title: id,
    description: null,
    priority: 'none',
    labels: [],
    assigneeKind: null,
    assigneeId: null,
    createdByKind: 'user',
    createdById: '__self__',
    delegateAgentId: null,
    delegateAgentProfileId: null,
    contextRefs: '[]',
    order: createdAt,
    createdAt,
    updatedAt: createdAt,
  }
}

const statuses: KanbanStatus[] = [
  {
    id: 'todo',
    workspaceId: 'workspace-1',
    name: 'Todo',
    color: null,
    category: 'unstarted',
    order: 1,
    createdAt: 1,
  },
  {
    id: 'doing',
    workspaceId: 'workspace-1',
    name: 'Doing',
    color: null,
    category: 'started',
    order: 2,
    createdAt: 1,
  },
]

const milestones: KanbanMilestone[] = []

describe('kanban selection helpers', () => {
  it('collects consecutive issue ids from anchor to target in either direction', () => {
    expect(issueRangeIds(issueIds, 'issue-1', 'issue-3')).toEqual(['issue-1', 'issue-2', 'issue-3'])
    expect(issueRangeIds(issueIds, 'issue-4', 'issue-2')).toEqual(['issue-2', 'issue-3', 'issue-4'])
  })

  it('falls back to the target issue when the anchor is not visible', () => {
    expect(issueRangeIds(issueIds, 'missing', 'issue-2')).toEqual(['issue-2'])
    expect(issueRangeIds(issueIds, null, 'issue-2')).toEqual(['issue-2'])
  })

  it('toggles a single issue without mutating the previous set', () => {
    const current = new Set(['issue-1'])
    const selected = toggleIssueSelection(current, 'issue-2')
    const unselected = toggleIssueSelection(current, 'issue-1')

    expect([...current]).toEqual(['issue-1'])
    expect([...selected]).toEqual(['issue-1', 'issue-2'])
    expect([...unselected]).toEqual([])
  })

  it('adds a range to the current selection', () => {
    const selected = addIssueSelectionRange(new Set(['issue-4']), issueIds, 'issue-1', 'issue-3')

    expect([...selected]).toEqual(['issue-4', 'issue-1', 'issue-2', 'issue-3'])
  })

  it('orders issues by rendered status groups instead of incoming sort order', () => {
    const sortedByCreated = [
      issue('doing-1', 'doing', 3),
      issue('todo-1', 'todo', 2),
      issue('todo-2', 'todo', 1),
    ]

    const ordered = orderedIssuesForKanbanView(sortedByCreated, statuses, milestones, {
      groupBy: 'status',
      showEmptyGroups: true,
    })

    expect(ordered.map(row => row.id)).toEqual(['todo-1', 'todo-2', 'doing-1'])
  })
})
