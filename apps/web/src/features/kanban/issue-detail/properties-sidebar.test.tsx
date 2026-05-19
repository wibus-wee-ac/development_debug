// @vitest-environment jsdom
//
// Input: React Testing Library, mocked menu/popover dependencies, and PropertiesSidebar
// Output: Regression tests for issue detail properties label editing accessibility
// Position: Kanban issue detail test guarding labels add trigger semantics and update wiring

import type { KanbanIssue, KanbanMilestone, KanbanStatus } from '~/lib/types'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PropertiesSidebar } from './properties-sidebar'

vi.mock('./relation-manager', () => ({
  RelationManager: () => <div data-testid="mock-relation-manager" />,
}))

vi.mock('~/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children: React.ReactNode, onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
  DropdownMenuRadioGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuRadioItem: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>{children}</button>
  ),
}))

vi.mock('~/components/ui/popover', () => {
  return {
    Popover: ({
      children,
    }: {
      children: React.ReactNode
      onOpenChange?: (open: boolean) => void
      open?: boolean
    }) => <div>{children}</div>,
    PopoverContent: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    PopoverTrigger: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button type="button" {...props}>{children}</button>
    ),
  }
})

vi.mock('~/features/agent-runtime/use-agents', () => ({
  useAgents: () => ({ agents: [] }),
}))

vi.mock('../use-kanban', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../use-kanban')>()
  return {
    ...actual,
    useDelegateIssue: () => ({ mutate: vi.fn() }),
    useUndelegateIssue: () => ({ mutate: vi.fn() }),
  }
})

const issue: KanbanIssue = {
  id: 'issue-1',
  workspaceId: 'workspace-1',
  number: 1,
  statusId: 'status-1',
  milestoneId: null,
  parentIssueId: null,
  title: 'Improve labels',
  description: null,
  priority: 'medium',
  labels: '["bug"]',
  assigneeKind: null,
  assigneeId: null,
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
  name: 'Todo',
  color: null,
  category: 'unstarted',
  order: 1,
  createdAt: 1,
}]

const milestones: KanbanMilestone[] = []

describe('PropertiesSidebar', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('exposes a named add-label control with a decorative icon', () => {
    render(
      <PropertiesSidebar
        issue={issue}
        statuses={statuses}
        milestones={milestones}
        workspaceId="workspace-1"
        onUpdate={vi.fn()}
      />,
    )

    const addLabelButton = screen.getByRole('button', { name: 'Add label' })
    expect(addLabelButton.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('adds a new label through the named add-label control', () => {
    const onUpdate = vi.fn()

    render(
      <PropertiesSidebar
        issue={issue}
        statuses={statuses}
        milestones={milestones}
        workspaceId="workspace-1"
        onUpdate={onUpdate}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add label' }))
    fireEvent.change(screen.getByPlaceholderText('Add label...'), {
      target: { value: 'frontend' },
    })
    fireEvent.keyDown(screen.getByPlaceholderText('Add label...'), { key: 'Enter' })

    expect(onUpdate).toHaveBeenCalledWith({ labels: ['bug', 'frontend'] })
  })
})
