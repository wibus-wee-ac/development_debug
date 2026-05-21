// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentSessionPanel } from './agent-session-panel'

const mockedDeps = vi.hoisted(() => ({
  activities: [],
  sessions: [
    {
      id: 'agent-session-1',
      status: 'active',
      chatSessionId: 'chat-session-1',
    },
  ],
  startSession: vi.fn(),
  stopSession: vi.fn(),
}))

vi.mock('@cradle/tabs-next', () => ({
  Link: ({
    children,
    params,
    to,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    children: React.ReactNode
    params: { sessionId: string }
    to: string
  }) => (
    <a href={`/${to}/${params.sessionId}`} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('../use-kanban', () => ({
  useAgentActivities: () => ({
    data: mockedDeps.activities,
  }),
  useAgentSessions: () => ({
    data: mockedDeps.sessions,
  }),
  useStartAgentSession: () => ({
    mutate: mockedDeps.startSession,
  }),
  useStopAgentSession: () => ({
    mutate: mockedDeps.stopSession,
  }),
}))

vi.mock('./agent-activity-item', () => ({
  AgentActivityItem: () => <div data-testid="agent-activity-item" />,
}))

vi.mock('./agent-prompt-input', () => ({
  AgentPromptInput: () => <div data-testid="agent-prompt-input" />,
}))

describe('AgentSessionPanel', () => {
  beforeEach(() => {
    mockedDeps.sessions = [
      {
        id: 'agent-session-1',
        status: 'active',
        chatSessionId: 'chat-session-1',
      },
    ]
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('exposes named session actions with decorative icons', () => {
    render(<AgentSessionPanel issueId="issue-1" workspaceId="workspace-1" />)

    const stopButton = screen.getByRole('button', { name: 'Stop' })
    const openChatLink = screen.getByRole('link', { name: 'Open Chat' })

    expect(stopButton.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(openChatLink.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(openChatLink.getAttribute('href')).toBe('/chat/chat-session-1')
  })

  it('keeps the stop action wired to the active agent session', () => {
    render(<AgentSessionPanel issueId="issue-1" workspaceId="workspace-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))

    expect(mockedDeps.stopSession).toHaveBeenCalledWith({
      agentSessionId: 'agent-session-1',
      issueId: 'issue-1',
    })
  })
})
