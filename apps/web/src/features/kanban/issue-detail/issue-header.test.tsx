// @vitest-environment jsdom
//
// Input: React Testing Library, mocked menu primitives, and IssueHeader
// Output: Regression tests for issue header action accessibility and callback wiring
// Position: Kanban issue detail test guarding header navigation and action semantics

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { KanbanIssue, KanbanStatus } from '~/lib/types'
import { IssueHeader } from './issue-header'

vi.mock('~/components/ui/menu', () => ({
  Menu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MenuItem: ({
    children,
    onClick,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
  MenuPopup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MenuTrigger: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}))

const issue = {
  id: 'issue-1',
  title: 'Investigate keyboard support',
  statusId: 'status-1',
} as KanbanIssue

const status = {
  id: 'status-1',
  name: 'In Progress',
  category: 'started',
} as KanbanStatus

describe('IssueHeader', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('exposes named icon-only controls with decorative icons', () => {
    render(
      <IssueHeader
        issue={issue}
        status={status}
        onBack={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const backButton = screen.getByRole('button', { name: 'Back to board' })
    const actionsButton = screen.getByRole('button', { name: 'Issue actions' })

    expect(backButton.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(actionsButton.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByText('In Progress')).toBeTruthy()
    expect(screen.getByText('Investigate keyboard support')).toBeTruthy()
  })

  it('keeps back and delete actions wired through named controls', () => {
    const onBack = vi.fn()
    const onDelete = vi.fn()

    render(
      <IssueHeader
        issue={issue}
        status={status}
        onBack={onBack}
        onDelete={onDelete}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Back to board' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete issue' }))

    const deleteButton = screen.getByRole('button', { name: 'Delete issue' })
    expect(deleteButton.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})
