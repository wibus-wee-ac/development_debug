// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RelationManager } from './relation-manager'

const mockedDeps = vi.hoisted(() => ({
  deleteRelation: vi.fn(),
  relations: [
    {
      id: 'relation-1',
      sourceIssueId: 'issue-1',
      targetIssueId: 'issue-2abcdef',
      type: 'blocks',
      createdAt: 1,
    },
    {
      id: 'relation-2',
      sourceIssueId: 'issue-3abcdef',
      targetIssueId: 'issue-1',
      type: 'blocks',
      createdAt: 2,
    },
  ],
}))

vi.mock('~/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>{children}</button>
  ),
}))

vi.mock('../use-kanban', () => ({
  useDeleteRelation: () => ({
    mutate: mockedDeps.deleteRelation,
  }),
  useRelations: () => ({
    data: mockedDeps.relations,
  }),
}))

describe('RelationManager', () => {
  beforeEach(() => {
    mockedDeps.deleteRelation.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('exposes a named add-relation control with a decorative icon', () => {
    render(<RelationManager issueId="issue-1" />)

    const addButton = screen.getByRole('button', { name: 'Add relation' })
    expect(addButton.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('exposes named remove controls and keeps delete payloads wired', () => {
    render(<RelationManager issueId="issue-1" />)

    const removeBlocks = screen.getByRole('button', { name: 'Remove Blocks relation issue-2a' })
    const removeBlockedBy = screen.getByRole('button', { name: 'Remove Blocked by relation issue-3a' })

    expect(removeBlocks.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(removeBlocks.className.split(/\s+/)).not.toContain('hidden')
    expect(removeBlocks.className).toContain('focus-visible:opacity-100')
    expect(removeBlocks.className).toContain('group-focus-within:opacity-100')
    fireEvent.click(removeBlockedBy)

    expect(mockedDeps.deleteRelation).toHaveBeenCalledWith({
      id: 'relation-2',
      issueId: 'issue-1',
    })
  })
})
