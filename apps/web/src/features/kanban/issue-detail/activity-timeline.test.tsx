import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { KanbanIssueCommentView } from '~/lib/types'

import { ActivityTimeline } from './activity-timeline'

const mocks = vi.hoisted(() => ({
  addCommentMutate: vi.fn(),
  comments: [] as KanbanIssueCommentView[],
  deleteCommentMutate: vi.fn(),
}))

vi.mock('../use-kanban', () => ({
  useAddComment: () => ({
    mutate: mocks.addCommentMutate,
  }),
  useComments: () => ({
    data: mocks.comments,
  }),
  useDeleteComment: () => ({
    mutate: mocks.deleteCommentMutate,
  }),
}))

afterEach(() => {
  cleanup()
})

function comment(content: string): KanbanIssueCommentView {
  return {
    id: 'comment-1',
    issueId: 'issue-1',
    content,
    authorKind: 'agent',
    authorId: 'agent-1',
    agentActivityId: null,
    createdAt: 1_700_000_000,
    author: {
      kind: 'agent',
      id: 'agent-1',
      displayName: 'Jarvis',
      avatarUrl: null,
      label: 'AI',
    },
  }
}

describe('activity timeline', () => {
  beforeEach(() => {
    mocks.addCommentMutate.mockReset()
    mocks.deleteCommentMutate.mockReset()
    mocks.comments = []
  })

  it('renders agent comments as static markdown', () => {
    mocks.comments = [
      comment('**Root cause:** blocked navigation\n\n- First finding'),
    ]

    render(<ActivityTimeline issueId="issue-1" />)

    const row = screen.getByTestId('comment-comment-1')
    const strong = row.querySelector('strong')
    const listItem = screen.getByText('First finding').closest('li')

    expect(strong?.textContent).toBe('Root cause:')
    expect(listItem).toBeTruthy()
    expect(row.textContent).not.toContain('**Root cause:**')
  })
})
