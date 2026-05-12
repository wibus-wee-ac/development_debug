// @vitest-environment jsdom
//
// Input: React Testing Library, Vitest mocks, WorkspaceSidebar component
// Output: Renderer interaction tests for workspace sidebar header behavior
// Position: Workspace feature regression test for navigation vs collapse semantics

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkspaceSidebar } from './workspace-sidebar'

const mockedDeps = vi.hoisted(() => ({
  navigate: vi.fn(),
  openInFinder: vi.fn(),
  deleteWorkspace: vi.fn(),
}))

vi.mock('~/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>{children}</button>
  ),
}))

vi.mock('~/components/ui/menu', () => ({
  Menu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  MenuTrigger: ({
    children,
    render,
  }: {
    children: React.ReactNode
    render: React.ReactElement<React.ButtonHTMLAttributes<HTMLButtonElement>>
  }) => {
    const { children: triggerChildren, ...triggerProps } = render.props
    return (
      <button type="button" {...triggerProps}>
        {triggerChildren ?? children}
      </button>
    )
  },
  MenuPopup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode
    onClick?: () => void
  }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
  MenuSeparator: () => <hr />,
}))

vi.mock('~/features/search/global-search-dialog', () => ({
  GlobalSearchDialog: () => null,
}))

vi.mock('~/hooks/use-shortcut', () => ({
  useShortcut: () => { },
}))

vi.mock('~/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode, asChild?: boolean }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('~/lib/cn', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}))

vi.mock('~/lib/ipc', () => ({
  ipc: {
    session: {
      delete: vi.fn(),
    },
    workspace: {
      openInFinder: mockedDeps.openInFinder,
    },
  },
}))

vi.mock('~/store/session-activity', () => ({
  useSessionActivityStore: (selector: (state: {
    unread: Set<string>
    clearUnread: ReturnType<typeof vi.fn>
  }) => unknown) => selector({
    unread: new Set(),
    clearUnread: vi.fn(),
  }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}))

vi.mock('~/tabs/use-cradle-navigation', () => ({
  useCradleNavigation: () => ({
    openTab: mockedDeps.navigate,
    openNewTab: vi.fn(),
  }),
  useIsActiveTab: () => false,
}))

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({
      children,
      ...props
    }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    span: ({
      children,
      ...props
    }: React.HTMLAttributes<HTMLSpanElement>) => <span {...props}>{children}</span>,
  },
}))

vi.mock('./use-session', () => ({
  sessionsQueryKey: (workspaceId: string) => ['sessions', workspaceId],
  useSessions: () => ({
    sessions: [
      {
        id: 'session-1',
        title: 'Session One',
        updatedAt: Math.floor(Date.now() / 1000),
      },
    ],
  }),
}))

vi.mock('./use-workspace', () => ({
  useWorkspaces: () => ({
    workspaces: [
      {
        id: 'workspace-1',
        name: 'Workspace One',
        path: '/tmp/workspace-one',
      },
    ],
  }),
  useAddWorkspace: () => ({
    addFromPicker: vi.fn(),
    adding: false,
  }),
  useDeleteWorkspace: () => ({
    remove: mockedDeps.deleteWorkspace,
  }),
}))

describe('workspaceSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens workspace-detail tab when workspace name is clicked without collapsing sessions', () => {
    render(<WorkspaceSidebar />)

    expect(screen.queryByText('Session One')).not.toBeNull()

    fireEvent.click(screen.getByText('Workspace One'))

    expect(mockedDeps.navigate).toHaveBeenCalledWith(
      'workspace-detail',
      { workspaceId: 'workspace-1' },
    )
    expect(screen.queryByText('Session One')).not.toBeNull()
  })

  it('collapses the session list only when the folder toggle is clicked', () => {
    render(<WorkspaceSidebar />)

    fireEvent.click(screen.getByLabelText('切换工作区折叠状态'))

    expect(screen.queryByText('Session One')).toBeNull()
    expect(mockedDeps.navigate).not.toHaveBeenCalled()
  })
})
