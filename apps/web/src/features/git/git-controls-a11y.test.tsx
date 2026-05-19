// @vitest-environment jsdom
//
// Input: React Testing Library, mocked git hooks, GitPanel and BranchPicker
// Output: Regression tests for Git fetch/create control accessibility
// Position: Git feature test guarding icon-only control semantics

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BranchPicker } from './branch-picker'
import { GitPanel } from './git-panel'

const mockedDeps = vi.hoisted(() => ({
  fetchGit: vi.fn(),
  invalidateQueries: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mockedDeps.invalidateQueries,
  }),
}))

vi.mock('virtua', () => ({
  VList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('~/api-gen/sdk.gen', () => ({
  postWorkspacesByIdGitBranches: vi.fn(),
  postWorkspacesByIdGitCheckout: vi.fn(),
  postWorkspacesByIdGitFetch: mockedDeps.fetchGit,
}))

vi.mock('~/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>{children}</button>
  ),
}))

vi.mock('~/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('~/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('~/lib/cn', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}))

vi.mock('./git-graph-row', () => ({
  GitGraphRow: () => <div />,
  ROW_HEIGHT: 23,
}))

vi.mock('./use-git', () => ({
  gitBranchesQueryKey: (input: unknown) => ['git-branches', input],
  gitGraphQueryKey: (input: unknown) => ['git-graph', input],
  gitStatusQueryKey: (input: unknown) => ['git-status', input],
  useGitBranches: () => ({
    data: {
      local: [{ name: 'main', isCurrent: true }],
      remote: [],
    },
  }),
  useGitGraph: () => ({
    data: [],
    isLoading: false,
    isFetching: false,
  }),
  useGitStatus: () => ({
    data: {
      branch: 'main',
      tracking: 'origin/main',
      ahead: 0,
      behind: 0,
      isDetached: false,
    },
    isLoading: false,
    isError: false,
  }),
}))

describe('Git controls accessibility', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('exposes the GitPanel fetch control by accessible name', async () => {
    mockedDeps.fetchGit.mockResolvedValue({})

    render(<GitPanel workspaceId="workspace-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Fetch git updates' }))

    await waitFor(() => {
      expect(mockedDeps.fetchGit).toHaveBeenCalledWith({ path: { id: 'workspace-1' } })
    })
  })

  it('exposes BranchPicker fetch and cancel controls by accessible name', async () => {
    mockedDeps.fetchGit.mockResolvedValue({})

    render(
      <BranchPicker workspaceId="workspace-1" currentBranch="main">
        <button type="button">main</button>
      </BranchPicker>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Fetch branches' }))

    await waitFor(() => {
      expect(mockedDeps.fetchGit).toHaveBeenCalledWith({ path: { id: 'workspace-1' } })
    })

    fireEvent.click(screen.getByRole('button', { name: '新建分支…' }))
    expect(screen.getByRole('button', { name: 'Cancel branch creation' })).toBeTruthy()
  })
})
