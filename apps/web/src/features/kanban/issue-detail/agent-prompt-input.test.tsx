// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentPromptInput } from './agent-prompt-input'

const mockedDeps = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mockedDeps.invalidateQueries,
  }),
}))

vi.mock('~/lib/electron', () => ({
  getServerUrl: () => 'http://127.0.0.1:1455',
}))

describe('AgentPromptInput', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    }))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('exposes a named send prompt control and disables it while empty or busy', () => {
    const { rerender } = render(
      <AgentPromptInput
        agentSessionId="agent-session-1"
        sessionStatus="completed"
        issueId="issue-1"
      />,
    )

    const sendButton = screen.getByRole('button', { name: 'Send prompt' })
    expect((sendButton as HTMLButtonElement).disabled).toBe(true)
    expect(sendButton.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')

    fireEvent.change(screen.getByPlaceholderText('Send a message...'), {
      target: { value: 'Continue investigation' },
    })
    expect((sendButton as HTMLButtonElement).disabled).toBe(false)

    rerender(
      <AgentPromptInput
        agentSessionId="agent-session-1"
        sessionStatus="active"
        issueId="issue-1"
      />,
    )

    expect((screen.getByRole('button', { name: 'Send prompt' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('sends the prompt and invalidates agent activities through the named control', async () => {
    render(
      <AgentPromptInput
        agentSessionId="agent-session-1"
        sessionStatus="completed"
        issueId="issue-1"
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('Send a message...'), {
      target: { value: ' Continue investigation ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send prompt' }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:1455/issue-agent-sessions/agent-session-1/prompt',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: 'Continue investigation' }),
        },
      )
    })
    await waitFor(() => {
      expect(mockedDeps.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['kanban', 'agentActivities', 'agent-session-1'],
      })
    })
  })
})
