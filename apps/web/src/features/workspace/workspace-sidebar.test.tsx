// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTabStore, defineTab, TabsProvider } from '@cradle/tabs-next'
import type { TabStoreState } from '@cradle/tabs-next'
import type { StoreApi, UseBoundStore } from 'zustand'

import { WorkspaceSidebar } from './workspace-sidebar'

const mockedDeps = vi.hoisted(() => ({
  navigate: vi.fn(),
  openInFinder: vi.fn(),
  deleteWorkspace: vi.fn(),
  recordActivity: vi.fn(),
  sessions: [
    {
      id: 'session-1',
      title: 'Session One',
      updatedAt: 100,
    },
  ],
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

vi.mock('~/components/ui/context-menu', () => ({
  ContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ContextMenuTrigger: ({ children }: { children: React.ReactNode, asChild?: boolean }) => <>{children}</>,
  ContextMenuContent: ({ children }: { children: React.ReactNode }) => <div data-testid="session-context-menu">{children}</div>,
  ContextMenuItem: ({
    children,
    onSelect,
    ...props
  }: {
    children: React.ReactNode
    onSelect?: () => void
  } & React.HTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={onSelect} {...props}>{children}</button>
  ),
  ContextMenuSeparator: () => <hr />,
}))

vi.mock('~/features/search/global-search-dialog', () => ({
  GlobalSearchDialog: () => null,
}))

vi.mock('~/features/kanban/kanban-sidebar', () => ({
  KanbanSidebar: () => null,
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
  useSessionActivityStore: Object.assign(
    (selector: (state: {
      unread: Set<string>
    }) => unknown) => selector({
      unread: new Set(),
    }),
    {
      getState: () => ({
        recordActivity: mockedDeps.recordActivity,
      }),
    },
  ),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: [],
    isPending: false,
    isFetching: false,
    isLoading: false,
  }),
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

vi.mock('~/tabs/registry', () => ({
  useCradleTabStore: Object.assign(
    (selector: (state: {
      activeTabId: string | null
      tabs: Array<{ id: string, type: string }>
    }) => unknown) => selector({
      activeTabId: 'tab-1',
      tabs: [{ id: 'tab-1', type: 'home' }],
    }),
    {
      getState: () => ({
        activeTabId: 'tab-1',
        tabs: [{ id: 'tab-1', type: 'home' }],
      }),
    },
  ),
}))

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  m: {
    div: ({
      children,
      ...props
    }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    span: ({
      children,
      ...props
    }: React.HTMLAttributes<HTMLSpanElement>) => <span {...props}>{children}</span>,
  },
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

function DummyTab() {
  return null
}

const testRegistry = {
  home: defineTab({
    type: 'home' as const,
    label: 'Home',
    component: DummyTab,
  }),
  chat: defineTab({
    type: 'chat' as const,
    label: 'Chat',
    component: DummyTab,
  }),
  'workspace-detail': defineTab({
    type: 'workspace-detail' as const,
    label: 'Workspace',
    component: DummyTab,
  }),
}

function renderWorkspaceSidebar(): {
  store: UseBoundStore<StoreApi<TabStoreState>>
  view: ReturnType<typeof render>
} {
  const store = createTabStore(testRegistry, { persistKey: `workspace-sidebar-test-${Math.random()}` })

  const view = render(
    <TabsProvider store={store} registry={testRegistry}>
      <WorkspaceSidebar />
    </TabsProvider>,
  )

  return { store, view }
}

vi.mock('./use-session', () => ({
  sessionsQueryKey: (workspaceId: string) => ['sessions', workspaceId],
  useSessions: () => ({
    sessions: mockedDeps.sessions,
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
    mockedDeps.sessions = [
      {
        id: 'session-1',
        title: 'Session One',
        updatedAt: 100,
      },
    ]
  })

  it('opens workspace-detail tab when workspace name is clicked without collapsing sessions', () => {
    const { store } = renderWorkspaceSidebar()

    expect(screen.queryByText('Session One')).not.toBeNull()

    fireEvent.click(screen.getByText('Workspace One'))

    expect(store.getState().getActiveTab()).toMatchObject({
      type: 'workspace-detail',
      params: { workspaceId: 'workspace-1' },
    })
    expect(screen.queryByText('Session One')).not.toBeNull()
  })

  it('collapses the session list only when the folder toggle is clicked', () => {
    renderWorkspaceSidebar()

    for (const toggle of screen.getAllByLabelText('切换工作区折叠状态')) {
      fireEvent.click(toggle)
    }

    expect(screen.queryByText('Session One')).toBeNull()
    expect(mockedDeps.navigate).not.toHaveBeenCalled()
  })

  it('does not infer unread activity from background session updatedAt changes', () => {
    const { store, view } = renderWorkspaceSidebar()

    expect(mockedDeps.recordActivity).not.toHaveBeenCalled()

    mockedDeps.sessions = [
      {
        id: 'session-1',
        title: 'Session One',
        updatedAt: 101,
      },
    ]

    view.rerender(
      <TabsProvider store={store} registry={testRegistry}>
        <WorkspaceSidebar />
      </TabsProvider>,
    )

    expect(mockedDeps.recordActivity).not.toHaveBeenCalled()
  })

  it('keeps the session menu trigger keyboard-discoverable with a stable hit target', () => {
    const { view } = renderWorkspaceSidebar()

    const sessionMenuTrigger = view.container.querySelector<HTMLButtonElement>('[aria-label="会话菜单"]')

    expect(sessionMenuTrigger).not.toBeNull()
    expect(sessionMenuTrigger?.className).toContain('size-6')
    expect(sessionMenuTrigger?.className).toContain('focus-visible:opacity-100')
  })

  it('keeps long session titles constrained to the sidebar width', () => {
    const { view } = renderWorkspaceSidebar()

    const sessionItem = screen.getByTestId('session-item-session-1')
    const sessionLink = screen.getByTestId('session-open-session-1')
    const sessionTitle = screen.getByTestId('session-title-session-1')
    const workspaceList = view.container.querySelector<HTMLElement>('[data-testid="workspace-list"]')

    expect(workspaceList?.className).toContain('min-w-0')
    expect(sessionItem.className).toContain('min-w-0')
    expect(sessionLink.className).toContain('min-w-0')
    expect(sessionLink.className).toContain('overflow-hidden')
    expect(sessionTitle.className).toContain('truncate')
  })

  it('reuses session menu actions in the row context menu', () => {
    renderWorkspaceSidebar()

    expect(screen.getByTestId('session-menu-rename-session-1-context')).toBeTruthy()
    expect(screen.getByTestId('session-menu-toggle-pin-session-1-context')).toBeTruthy()
    expect(screen.getByTestId('session-menu-copy-markdown-session-1-context')).toBeTruthy()
    expect(screen.getByTestId('session-menu-delete-session-1-context')).toBeTruthy()
  })
})
