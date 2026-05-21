// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { KanbanGroupHeader } from './kanban-group-header'

vi.mock('motion/react', () => ({
  m: {
    span: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
      <span {...props}>{children}</span>
    ),
  },
}))

describe('KanbanGroupHeader', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('exposes collapse state and decorative toggle icon', () => {
    const onToggle = vi.fn()

    render(
      <KanbanGroupHeader
        name="In Progress"
        count={3}
        category="started"
        collapsed={false}
        onToggle={onToggle}
      />,
    )

    const toggleButton = screen.getByRole('button', { name: /In Progress/ })

    expect(toggleButton.getAttribute('aria-expanded')).toBe('true')
    expect(toggleButton.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')

    fireEvent.click(toggleButton)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('exposes a named create action with a keyboard-visible icon button', () => {
    const onCreateIssue = vi.fn()

    render(
      <KanbanGroupHeader
        name="Backlog"
        count={2}
        collapsed
        onToggle={vi.fn()}
        onCreateIssue={onCreateIssue}
      />,
    )

    const toggleButton = screen.getByRole('button', { name: /Backlog/ })
    const createButton = screen.getByRole('button', { name: 'Create issue in Backlog' })

    expect(toggleButton.getAttribute('aria-expanded')).toBe('false')
    expect(createButton.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(createButton.className).toContain('focus-visible:opacity-100')

    fireEvent.click(createButton)
    expect(onCreateIssue).toHaveBeenCalledTimes(1)
  })
})
