// @vitest-environment jsdom
//
// Input: React Testing Library, mocked Kanban item dependencies, KanbanCard and KanbanListRow
// Output: Regression tests for issue card/list row button semantics
// Position: Kanban feature test guarding issue item accessibility and activation behavior

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { KanbanIssue, KanbanMilestone, KanbanStatus } from '~/lib/types'

import { KanbanCard } from './kanban-card'
import { KanbanListRow } from './kanban-list-row'
import type { ViewConfig } from './use-view-config'

vi.mock('@dnd-kit/core', () => ({
  useDraggable: () => ({
    attributes: {
      'role': 'button',
      'tabIndex': 0,
      'aria-describedby': 'dnd-description',
    },
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    isDragging: false,
  }),
}))

vi.mock('~/features/workspace/use-workspace', () => ({
  useWorkspaces: () => ({
    workspaces: [{
      id: 'workspace-1',
      name: 'Workspace Alpha',
      path: '/tmp/workspace-alpha',
      identifier: 'ALP',
      createdAt: 1,
      updatedAt: 1,
    }],
  }),
}))

vi.mock('~/lib/cn', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}))

vi.mock('./issue-context-menu', () => ({
  IssueContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('./shared/label-chip', () => ({
  LabelChip: ({ label }: { label: string }) => <span>{label}</span>,
}))

const issue: KanbanIssue = {
  id: 'issue-1',
  workspaceId: 'workspace-1',
  number: 7,
  statusId: 'status-1',
  milestoneId: null,
  parentIssueId: null,
  title: 'Improve keyboard access',
  description: null,
  priority: 'high',
  labels: '["ux"]',
  assigneeKind: 'user',
  assigneeId: 'wibus',
  createdByKind: 'user',
  createdById: '__self__',
  delegateAgentId: null,
  delegateAgentProfileId: null,
  contextRefs: '[]',
  order: 1,
  createdAt: 1,
  updatedAt: 1,
}

const statuses: KanbanStatus[] = [{
  id: 'status-1',
  workspaceId: 'workspace-1',
  name: 'In Progress',
  color: null,
  category: 'started',
  order: 1,
  createdAt: 1,
}]

const milestones: KanbanMilestone[] = []

const displayProperties: ViewConfig['displayProperties'] = {
  id: true,
  priority: true,
  status: true,
  labels: true,
  assignee: true,
  subIssueProgress: false,
  agentIndicator: true,
  milestone: false,
  dueDate: false,
  createdAt: true,
}

describe('kanban item actions', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  it('opens a board card through a named native button', () => {
    vi.useFakeTimers()
    const onClick = vi.fn()

    render(
      <KanbanCard
        issue={issue}
        statuses={statuses}
        milestones={milestones}
        displayProperties={displayProperties}
        onClick={onClick}
        category="started"
      />,
    )

    const card = screen.getByRole('button', { name: 'Open issue Improve keyboard access' })
    expect(card.tagName).toBe('BUTTON')
    expect(card.getAttribute('role')).toBeNull()
    expect(card.getAttribute('tabindex')).toBeNull()
    expect(card.getAttribute('aria-describedby')).toBe('dnd-description')
    expect(card.querySelector('div,p')).toBeNull()
    fireEvent.click(card, { detail: 1 })

    expect(onClick).not.toHaveBeenCalled()
    vi.advanceTimersByTime(90)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('toggles board card selection with modified clicks', () => {
    const onClick = vi.fn()
    const onSelectionGesture = vi.fn()

    render(
      <KanbanCard
        issue={issue}
        statuses={statuses}
        milestones={milestones}
        displayProperties={displayProperties}
        onClick={onClick}
        onSelectionGesture={onSelectionGesture}
        category="started"
      />,
    )

    const card = screen.getByRole('button', { name: 'Open issue Improve keyboard access' })
    fireEvent.click(card, { metaKey: true })
    fireEvent.click(card, { shiftKey: true })

    expect(onClick).not.toHaveBeenCalled()
    expect(onSelectionGesture).toHaveBeenNthCalledWith(1, 'issue-1', 'toggle')
    expect(onSelectionGesture).toHaveBeenNthCalledWith(2, 'issue-1', 'range')
  })

  it('does not toggle board card selection from the visual checkbox area', () => {
    vi.useFakeTimers()
    const onClick = vi.fn()
    const onSelectionGesture = vi.fn()

    render(
      <KanbanCard
        issue={issue}
        statuses={statuses}
        milestones={milestones}
        displayProperties={displayProperties}
        onClick={onClick}
        onSelectionGesture={onSelectionGesture}
        category="started"
      />,
    )

    const card = screen.getByRole('button', { name: 'Open issue Improve keyboard access' })
    fireEvent.click(card.querySelector('span')!, { detail: 1 })
    vi.advanceTimersByTime(90)

    expect(onSelectionGesture).not.toHaveBeenCalled()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('opens a list row through a named native button', () => {
    vi.useFakeTimers()
    const onClick = vi.fn()

    render(
      <KanbanListRow
        issue={issue}
        statuses={statuses}
        milestones={milestones}
        displayProperties={displayProperties}
        onClick={onClick}
      />,
    )

    const row = screen.getByRole('button', { name: 'Open issue Improve keyboard access' })
    expect(row.tagName).toBe('BUTTON')
    expect(row.getAttribute('role')).toBeNull()
    expect(row.getAttribute('tabindex')).toBeNull()
    fireEvent.click(row, { detail: 1 })

    expect(onClick).not.toHaveBeenCalled()
    vi.advanceTimersByTime(70)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('opens issue items immediately for keyboard activation clicks', () => {
    const onClick = vi.fn()

    render(
      <KanbanCard
        issue={issue}
        statuses={statuses}
        milestones={milestones}
        displayProperties={displayProperties}
        onClick={onClick}
        category="started"
      />,
    )

    const card = screen.getByRole('button', { name: 'Open issue Improve keyboard access' })
    fireEvent.click(card, { detail: 0 })

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('marks selected list rows as pressed native buttons', () => {
    render(
      <KanbanListRow
        issue={issue}
        statuses={statuses}
        milestones={milestones}
        displayProperties={displayProperties}
        onClick={vi.fn()}
        selected
      />,
    )

    const row = screen.getByRole('button', { name: 'Selected issue Improve keyboard access' })
    expect(row.getAttribute('aria-pressed')).toBe('true')
  })
})
