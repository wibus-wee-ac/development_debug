// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { IssueAsidePanel } from './issue-aside-panel'

const mockedDeps = vi.hoisted(() => ({
  boards: [{ id: 'board-1', workspaceId: 'workspace-1', name: 'Default board' }],
  comments: [{ id: 'comment-1' }, { id: 'comment-2' }],
  issues: [
    {
      id: 'issue-1',
      workspaceId: 'workspace-1',
      number: 42,
      statusId: 'status-started',
      milestoneId: null,
      parentIssueId: null,
      title: 'Wire the issue aside panel',
      description: 'Replace the placeholder with linked Kanban context.',
      priority: 'high',
      labels: '["frontend","kanban"]',
      assigneeKind: null,
      assigneeId: null,
      createdByKind: 'user',
      createdById: '__self__',
      delegateAgentId: null,
      delegateAgentProfileId: null,
      contextRefs: '[]',
      order: 0,
      createdAt: 1700000000,
      updatedAt: 1700003600,
    },
    {
      id: 'issue-2',
      workspaceId: 'workspace-1',
      number: 43,
      statusId: 'status-backlog',
      milestoneId: null,
      parentIssueId: null,
      title: 'Second Kanban issue',
      description: null,
      priority: 'medium',
      labels: '[]',
      assigneeKind: null,
      assigneeId: null,
      createdByKind: 'user',
      createdById: '__self__',
      delegateAgentId: null,
      delegateAgentProfileId: null,
      contextRefs: '[]',
      order: 1,
      createdAt: 1700000000,
      updatedAt: 1700003600,
    },
  ],
  linkIssue: vi.fn(),
  linkedIssueId: 'issue-1' as string | null,
  openTab: vi.fn(),
  unlinkIssue: vi.fn(),
}))

vi.mock('motion/react', () => ({
  m: {
    section: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => <section {...props}>{children}</section>,
  },
}))

vi.mock('~/components/ui/combobox', () => ({
  Combobox: ({
    children,
    onInputValueChange,
    onValueChange,
  }: {
    children: React.ReactNode
    onInputValueChange: (value: string) => void
    onValueChange: (value: string | null) => void
  }) => (
    <div
      data-testid="issue-combobox"
      data-select-value=""
      onChange={(event) => {
        const target = event.target as HTMLInputElement
        onInputValueChange(target.value)
      }}
      onClick={(event) => {
        const target = event.target as HTMLElement
        const item = target.closest('[data-combobox-value]') as HTMLElement | null
        if (item) {
          onValueChange(item.dataset.comboboxValue ?? null)
        }
      }}
    >
      {children}
    </div>
  ),
  ComboboxContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ComboboxInput: ({ 'aria-label': ariaLabel, placeholder }: { 'aria-label': string, placeholder?: string }) => (
    <input aria-label={ariaLabel} placeholder={placeholder} />
  ),
  ComboboxItem: ({
    children,
    value,
  }: {
    children: React.ReactNode
    value: string
  }) => (
    <button type="button" data-combobox-value={value}>
      {children}
    </button>
  ),
  ComboboxList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('~/features/workspace/use-workspace', () => ({
  useWorkspaces: () => ({
    loading: false,
    workspaces: [{ id: 'workspace-1', identifier: 'CRA', name: 'Cradle', path: '/repo' }],
  }),
}))

vi.mock('~/tabs/use-cradle-navigation', () => ({
  useCradleNavigation: () => ({ openTab: mockedDeps.openTab }),
}))

vi.mock('./use-kanban', () => ({
  useBoards: () => ({ data: mockedDeps.boards, isLoading: false }),
  useComments: () => ({ data: mockedDeps.comments }),
  useIssue: (id: string) => ({
    data: mockedDeps.issues.find(issue => issue.id === id),
    isLoading: false,
  }),
  useIssues: () => ({ data: mockedDeps.issues, isLoading: false }),
  useLinkIssue: () => ({
    isError: false,
    isPending: false,
    mutate: mockedDeps.linkIssue,
  }),
  useLinkedIssue: () => ({
    data: { issueId: mockedDeps.linkedIssueId },
    isLoading: false,
  }),
  useStatuses: () => ({
    data: [
      { id: 'status-started', workspaceId: 'workspace-1', name: 'In Progress', color: '#f59e0b', category: 'started', order: 1, createdAt: 1700000000 },
      { id: 'status-backlog', workspaceId: 'workspace-1', name: 'Backlog', color: '#6b7280', category: 'backlog', order: 0, createdAt: 1700000000 },
    ],
  }),
  useUnlinkIssue: () => ({
    isError: false,
    isPending: false,
    mutate: mockedDeps.unlinkIssue,
  }),
}))

describe('IssueAsidePanel', () => {
  beforeEach(() => {
    mockedDeps.linkedIssueId = 'issue-1'
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders the linked issue and opens the Kanban issue tab', () => {
    render(<IssueAsidePanel sessionId="chat-1" workspaceId="workspace-1" />)

    expect(screen.getByText('CRA-42')).toBeTruthy()
    expect(screen.getByText('Wire the issue aside panel')).toBeTruthy()
    expect(screen.queryByText('In Progress')).toBeNull()
    expect(screen.getByLabelText('In Progress')).toBeTruthy()
    expect(screen.getByText('High')).toBeTruthy()
    expect(screen.getByText('frontend')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Open issue in Kanban' }))

    expect(mockedDeps.openTab).toHaveBeenCalledWith('kanban-board', {
      boardId: 'board-1',
      issue: 'issue-1',
    })
  })

  it('unlinks the current issue from the active chat session', () => {
    render(<IssueAsidePanel sessionId="chat-1" workspaceId="workspace-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Unlink issue' }))

    expect(mockedDeps.unlinkIssue).toHaveBeenCalledWith('chat-1')
  })

  it('links an issue from the empty state picker', () => {
    mockedDeps.linkedIssueId = null
    render(<IssueAsidePanel sessionId="chat-1" workspaceId="workspace-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Link issue' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Search issues' }), {
      target: { value: 'Second' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Second Kanban issue/ }))

    expect(mockedDeps.linkIssue).toHaveBeenCalledWith(
      { chatSessionId: 'chat-1', issueId: 'issue-2' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
  })
})
