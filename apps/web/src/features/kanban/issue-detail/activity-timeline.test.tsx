// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { KanbanIssueCommentView } from '~/lib/types'
import { ActivityTimeline } from './activity-timeline'

const mockedDeps = vi.hoisted(() => ({
  addComment: vi.fn(),
  comments: [] as KanbanIssueCommentView[],
}))

vi.mock('../shared/assignee-avatar', () => ({
  AssigneeAvatar: ({ name }: { name: string | null }) => (
    <span data-testid="assignee-avatar">{name}</span>
  ),
}))

vi.mock('../use-kanban', () => ({
  useAddComment: () => ({
    mutate: mockedDeps.addComment,
  }),
  useComments: () => ({
    data: mockedDeps.comments,
  }),
  useDeleteComment: () => ({
    mutate: vi.fn(),
  }),
}))

describe('ActivityTimeline', () => {
  beforeEach(() => {
    mockedDeps.comments = []
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('marks system and agent activity icons as decorative', () => {
    mockedDeps.comments = [
      {
        id: 'comment-system',
        issueId: 'issue-1',
        content: 'Delegated to agent',
        authorKind: 'system.delegated',
        authorId: null,
        author: {
          kind: 'system',
          id: null,
          displayName: 'Cradle',
          avatarUrl: null,
          label: 'System',
        },
        agentActivityId: null,
        createdAt: Math.floor(Date.now() / 1000),
      },
      {
        id: 'comment-agent',
        issueId: 'issue-1',
        content: 'Investigated the failing workflow',
        authorKind: 'agent',
        authorId: 'agent-1',
        author: {
          kind: 'agent',
          id: 'agent-1',
          displayName: 'Jarvis',
          avatarUrl: null,
          label: 'AI',
        },
        agentActivityId: null,
        createdAt: Math.floor(Date.now() / 1000),
      },
    ]

    render(<ActivityTimeline issueId="issue-1" />)

    const systemComment = screen.getByTestId('comment-comment-system')
    const agentComment = screen.getByTestId('comment-comment-agent')

    expect(systemComment.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(agentComment.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByText('Delegated to agent')).toBeTruthy()
    expect(screen.getByText('Investigated the failing workflow')).toBeTruthy()
    expect(screen.getByText('Jarvis')).toBeTruthy()
    expect(screen.getByText('AI')).toBeTruthy()
  })

  it('submits trimmed comments and clears the input through the named action', () => {
    render(<ActivityTimeline issueId="issue-1" />)

    const input = screen.getByPlaceholderText('Leave a comment...') as HTMLTextAreaElement
    const commentButton = screen.getByRole('button', { name: 'Comment' }) as HTMLButtonElement

    expect(commentButton.disabled).toBe(true)

    fireEvent.change(input, {
      target: { value: ' Ship the scoped fix ' },
    })
    expect(commentButton.disabled).toBe(false)

    fireEvent.click(commentButton)

    expect(mockedDeps.addComment).toHaveBeenCalledWith({
      issueId: 'issue-1',
      content: 'Ship the scoped fix',
    })
    expect(input.value).toBe('')
  })
})
