import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TraySnapshot } from './types'
import { TrayPopover } from './tray-popover'

const mockedDeps = vi.hoisted(() => ({
  readTraySnapshot: vi.fn(),
}))

vi.mock('./api', () => ({
  readTraySnapshot: mockedDeps.readTraySnapshot,
}))

vi.mock('~/store/theme', () => ({
  useThemeStore: (selector: (state: { mode: 'light' }) => unknown) => selector({ mode: 'light' }),
}))

const snapshot: TraySnapshot = {
  generatedAt: 1,
  running: [
    {
      id: 'session-running',
      sessionId: 'session-running',
      title: 'Running Chat',
      workspaceId: 'workspace-running',
      workspaceName: 'Running Workspace',
      runtimeKind: 'codex',
      modelId: 'gpt-5.2',
      updatedAt: 10,
      detail: 'Running codex',
    },
  ],
  resident: [
    {
      id: 'session-resident',
      sessionId: 'session-resident',
      title: 'Resident Chat',
      workspaceId: 'workspace-resident',
      workspaceName: 'Resident Workspace',
      runtimeKind: 'claude',
      modelId: null,
      updatedAt: 9,
      detail: 'Resident claude',
    },
  ],
  metrics: [
    { id: 'running', label: 'Running', value: '1', tone: 'active' },
    { id: 'resident', label: 'Resident', value: '1', tone: 'active' },
    { id: 'awaits', label: 'Awaits', value: '0', tone: 'neutral' },
  ],
  quickActions: [
    {
      id: 'open-app',
      label: 'Open Cradle',
      description: 'Bring the main desktop window forward.',
      accelerator: null,
      badge: null,
      enabled: true,
    },
    {
      id: 'new-chat',
      label: 'New Chat',
      description: 'Start a fresh agent conversation.',
      accelerator: '⌘N',
      badge: null,
      enabled: true,
    },
    {
      id: 'open-approvals',
      label: 'Approvals',
      description: 'Review pending tool approvals.',
      accelerator: null,
      badge: '2',
      enabled: true,
    },
  ],
}

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>,
  )
}

describe('TrayPopover', () => {
  const performAction = vi.fn()

  beforeEach(() => {
    mockedDeps.readTraySnapshot.mockResolvedValue(snapshot)
    performAction.mockResolvedValue(undefined)
    Object.defineProperty(window, 'cradle', {
      configurable: true,
      value: {
        desktopTray: {
          performAction,
        },
      },
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders running and resident sessions with title and workspace name', async () => {
    renderWithQueryClient(<TrayPopover />)

    expect(await screen.findByText('Running Chat')).toBeTruthy()
    expect(screen.getByText('Running Workspace')).toBeTruthy()
    expect(screen.getByText('Resident Chat')).toBeTruthy()
    expect(screen.getByText('Resident Workspace')).toBeTruthy()
    expect(screen.getByText('Approvals')).toBeTruthy()
  })

  it('dispatches session, new chat, and quit actions through the desktop tray bridge', async () => {
    renderWithQueryClient(<TrayPopover />)

    fireEvent.click(await screen.findByText('Running Chat'))
    fireEvent.click(screen.getByRole('button', { name: /New Chat/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Quit Cradle' }))

    await waitFor(() => {
      expect(performAction).toHaveBeenCalledWith('open-chat', { sessionId: 'session-running' })
      expect(performAction).toHaveBeenCalledWith('new-chat', undefined)
      expect(performAction).toHaveBeenCalledWith('quit', undefined)
    })
  })
})
