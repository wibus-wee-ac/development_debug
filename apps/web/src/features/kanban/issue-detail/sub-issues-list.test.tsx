// @vitest-environment jsdom
//
// Input: React Testing Library, mocked kanban hooks, and SubIssuesList
// Output: Regression tests for sub-issue creation action semantics and payload wiring
// Position: Kanban issue detail test guarding sub-issue create controls

import type { KanbanStatus } from '~/lib/types'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SubIssuesList } from './sub-issues-list'

const mockedDeps = vi.hoisted(() => ({
  createIssue: vi.fn(),
  subIssues: [],
}))

vi.mock('~/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuRadioGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuRadioItem: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('../use-kanban', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../use-kanban')>()
  return {
    ...actual,
    useCreateIssue: () => ({
      isPending: false,
      mutate: mockedDeps.createIssue,
    }),
    useIssues: () => ({
      data: mockedDeps.subIssues,
    }),
  }
})

const statuses: KanbanStatus[] = [{
  id: 'status-1',
  workspaceId: 'workspace-1',
  name: 'Todo',
  color: null,
  category: 'unstarted',
  order: 1,
  createdAt: 1,
}]

describe('SubIssuesList', () => {
  beforeEach(() => {
    mockedDeps.createIssue.mockClear()
    mockedDeps.subIssues = []
  })

  afterEach(() => {
    cleanup()
  })

  it('exposes Add sub-issue with a decorative plus icon', () => {
    render(
      <SubIssuesList
        issueId="issue-parent"
        workspaceId="workspace-1"
        statuses={statuses}
      />,
    )

    const addButton = screen.getByRole('button', { name: 'Add sub-issue' })
    expect(addButton.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('creates a sub-issue with a trimmed title and default metadata', () => {
    render(
      <SubIssuesList
        issueId="issue-parent"
        workspaceId="workspace-1"
        statuses={statuses}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add sub-issue' }))
    fireEvent.change(screen.getByPlaceholderText('Sub-issue title'), {
      target: { value: '  Draft release notes  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(mockedDeps.createIssue).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      title: 'Draft release notes',
      parentIssueId: 'issue-parent',
      statusId: undefined,
      priority: 'none',
    })
  })
})
