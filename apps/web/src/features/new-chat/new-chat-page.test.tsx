// @vitest-environment jsdom
//
// Input: React Testing Library, mocked NewChatPage dependencies, and NewChatPage
// Output: Regression tests for new chat composer icon button accessibility
// Position: New Chat feature test guarding composer button names and send wiring

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NewChatPage } from './new-chat-page'

const mockedDeps = vi.hoisted(() => ({
  openTab: vi.fn(),
  postSessions: vi.fn(),
  startChatResponse: vi.fn(),
  invalidateQueries: vi.fn(),
  composerState: {
    selection: {
      agentId: null,
      profileId: 'profile-1',
      modelId: 'model-1',
      thinkingEffort: null,
      runtimeKind: 'standard',
    },
    setAgentId: vi.fn(),
    setProfileId: vi.fn(),
    setModelId: vi.fn(),
    setThinkingEffort: vi.fn(),
    setRuntimeKind: vi.fn(),
    agents: [],
    profiles: [{
      id: 'profile-1',
      name: 'Default Profile',
      enabled: true,
      providerKind: 'openai-compatible',
      configJson: '{}',
      credentialRef: null,
      customModels: '[]',
      createdAt: 1,
      updatedAt: 1,
    }],
    models: [{
      id: 'model-1',
      label: 'Default Model',
      providerKind: 'openai-compatible',
      capabilities: {},
    }],
    modelsByProfileId: {},
    loadingProfileIds: new Set<string>(),
    isLoadingModels: false,
    effectiveAgent: null,
    effectiveProfile: {
      id: 'profile-1',
      name: 'Default Profile',
      enabled: true,
      providerKind: 'openai-compatible',
      configJson: '{}',
      credentialRef: null,
      customModels: '[]',
      createdAt: 1,
      updatedAt: 1,
    },
    effectiveModel: {
      id: 'model-1',
      label: 'Default Model',
      providerKind: 'openai-compatible',
      capabilities: {},
    },
  },
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mockedDeps.invalidateQueries,
  }),
}))

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  m: new Proxy({}, {
    get: (_target, tag: keyof HTMLElementTagNameMap) => {
      const Component = ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => {
        return createElement(tag, props, children)
      }
      return Component
    },
  }),
}))

vi.mock('~/api-gen/sdk.gen', () => ({
  postSessions: mockedDeps.postSessions,
}))

vi.mock('~/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>{children}</button>
  ),
}))

vi.mock('~/components/ui/kbd', () => ({
  Kbd: ({ children }: { children: React.ReactNode }) => <kbd>{children}</kbd>,
}))

vi.mock('~/components/ui/menu', () => ({
  Menu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  MenuGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MenuGroupLabel: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  MenuItem: ({
    children,
    disabled,
    onClick,
  }: {
    children: React.ReactNode
    disabled?: boolean
    onClick?: () => void
  }) => <button type="button" disabled={disabled} onClick={onClick}>{children}</button>,
  MenuPopup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MenuSeparator: () => <hr />,
  MenuTrigger: ({
    children,
    render,
    ...props
  }: {
    children: React.ReactNode
    render: React.ReactElement<React.ButtonHTMLAttributes<HTMLButtonElement>>
  } & React.ButtonHTMLAttributes<HTMLButtonElement>) => {
    const { children: triggerChildren, ...triggerProps } = render.props
    return (
      <button type="button" {...triggerProps} {...props}>
        {triggerChildren ?? children}
      </button>
    )
  },
}))

vi.mock('~/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  TooltipTrigger: ({ children }: { children: React.ReactNode, asChild?: boolean }) => <>{children}</>,
}))

vi.mock('~/features/chat/chat-response-command', () => ({
  startChatResponse: mockedDeps.startChatResponse,
}))

vi.mock('~/features/composer-toolbar', () => ({
  ComposerToolbar: () => <div data-testid="mock-composer-toolbar" />,
  useComposerState: () => mockedDeps.composerState,
}))

vi.mock('~/features/workspace/use-session', () => ({
  sessionsQueryKey: (workspaceId: string) => ['sessions', workspaceId],
  useSessions: () => ({ sessions: [] }),
}))

vi.mock('~/features/workspace/use-workspace', () => ({
  useWorkspaces: () => ({
    workspaces: [{
      id: 'workspace-1',
      name: 'Workspace Alpha',
      path: '/tmp/workspace-alpha',
      identifier: 'ALP',
      createdAt: 1,
      updatedAt: 1,
    }],
  }),
}))

vi.mock('~/hooks/use-now', () => ({
  useNow: () => 1_700_000_000_000,
}))

vi.mock('~/lib/cn', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}))

vi.mock('~/tabs/use-cradle-navigation', () => ({
  useCradleNavigation: () => ({
    openTab: mockedDeps.openTab,
  }),
}))

describe('NewChatPage composer actions', () => {
  beforeEach(() => {
    mockedDeps.postSessions.mockResolvedValue({ data: { id: 'session-1' } })
    mockedDeps.startChatResponse.mockResolvedValue(undefined)
    mockedDeps.invalidateQueries.mockClear()
    mockedDeps.openTab.mockClear()
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null)
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('exposes named composer icon controls and disables send while empty', () => {
    render(<NewChatPage />)

    const attachButton = screen.getByRole('button', { name: 'Attach file' })
    const sendButton = screen.getByRole('button', { name: 'Send message' })

    expect(attachButton.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect((sendButton as HTMLButtonElement).disabled).toBe(true)
    expect(sendButton.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('keeps the named send control wired to session creation', async () => {
    render(<NewChatPage />)

    fireEvent.change(screen.getByTestId('new-chat-textarea'), {
      target: { value: 'Investigate the failing test' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => {
      expect(mockedDeps.postSessions).toHaveBeenCalledWith({
        body: {
          workspaceId: 'workspace-1',
          title: 'Investigate the failing test',
          agentProfileId: 'profile-1',
          runtimeKind: 'standard',
        },
      })
    })
    expect(mockedDeps.startChatResponse).toHaveBeenCalledWith({
      sessionId: 'session-1',
      body: {
        text: 'Investigate the failing test',
        modelId: 'model-1',
        thinkingEffort: undefined,
      },
    })
    expect(mockedDeps.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sessions', 'workspace-1'] })
    expect(mockedDeps.openTab).toHaveBeenCalledWith('chat', { sessionId: 'session-1' })
  })
})
