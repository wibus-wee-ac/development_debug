// @vitest-environment jsdom
//
// Input: React Testing Library, mocked overlay primitives, and KanbanToolbar
// Output: Regression tests for Kanban toolbar icon-only action accessibility
// Position: Kanban feature test guarding toolbar action names and layout callbacks

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { KanbanToolbar } from './kanban-toolbar'
import type { FilterState, ViewConfig } from './use-view-config'

vi.mock('~/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
  DropdownMenuRadioGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuRadioItem: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('~/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('~/components/ui/checkbox', () => ({
  Checkbox: ({ checked }: { checked?: boolean }) => (
    <input type="checkbox" checked={!!checked} readOnly />
  ),
}))

const config: ViewConfig = {
  layout: 'board',
  groupBy: 'status',
  orderBy: 'manual',
  orderDirection: 'asc',
  showEmptyGroups: true,
  displayProperties: {
    id: true,
    priority: true,
    status: false,
    labels: true,
    assignee: true,
    subIssueProgress: false,
    agentIndicator: true,
    milestone: false,
    dueDate: false,
    createdAt: false,
  },
}

function renderToolbar(overrides: Partial<{
  config: ViewConfig
  filter: FilterState
  onCreateIssue: () => void
  resetFilter: () => void
  setConfig: (patch: Partial<ViewConfig>) => void
  setFilter: (patch: Partial<FilterState>) => void
}> = {}) {
  return render(
    <KanbanToolbar
      config={overrides.config ?? config}
      filter={overrides.filter ?? {}}
      onCreateIssue={overrides.onCreateIssue}
      onSearchChange={vi.fn()}
      resetFilter={overrides.resetFilter ?? vi.fn()}
      searchQuery=""
      setConfig={overrides.setConfig ?? vi.fn()}
      setFilter={overrides.setFilter ?? vi.fn()}
    />,
  )
}

describe('KanbanToolbar', () => {
  afterEach(() => {
    cleanup()
  })

  it('exposes named icon-only toolbar actions with decorative icons', () => {
    renderToolbar({ onCreateIssue: vi.fn() })

    for (const name of ['Filter issues', 'Group issues', 'Sort issues', 'Display options', 'Create issue']) {
      const button = screen.getByRole('button', { name })
      expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('exposes named layout controls with pressed state and callbacks', () => {
    const setConfig = vi.fn()
    const onCreateIssue = vi.fn()
    renderToolbar({ onCreateIssue, setConfig })

    const boardButton = screen.getByRole('button', { name: 'Board layout' })
    const listButton = screen.getByRole('button', { name: 'List layout' })

    expect(boardButton.getAttribute('aria-pressed')).toBe('true')
    expect(listButton.getAttribute('aria-pressed')).toBe('false')
    expect(boardButton.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(listButton.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')

    fireEvent.click(listButton)
    fireEvent.click(screen.getByRole('button', { name: 'Create issue' }))

    expect(setConfig).toHaveBeenCalledWith({ layout: 'list' })
    expect(onCreateIssue).toHaveBeenCalledTimes(1)
  })
})
