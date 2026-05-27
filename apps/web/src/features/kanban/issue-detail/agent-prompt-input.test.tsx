/**
 * Output: Regression coverage for Agent Session continuation input behavior.
 * Input: Chat continuation preference, keyboard modifiers, and submit actions.
 * Position: Feature-owned tests for Issue Agent prompt continuation UI.
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentPromptInput } from './agent-prompt-input'

const preferenceMocks = vi.hoisted(() => ({
  useChatPreferencesQuery: vi.fn(),
}))

vi.mock('~/features/settings/use-chat-preferences', () => ({
  useChatPreferencesQuery: preferenceMocks.useChatPreferencesQuery,
}))

beforeEach(() => {
  preferenceMocks.useChatPreferencesQuery.mockReturnValue({
    data: {
      modelId: null,
      configSelections: {},
      continuationBehavior: 'queue',
    },
  })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    ok: true,
    chatSessionId: 'chat-session-1',
    queueItemId: 'queue-item-1',
    mode: 'queue',
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('agentPromptInput', () => {
  it('uses the saved queue preference for a busy agent continuation', async () => {
    const onQueued = vi.fn()
    render(
      <AgentPromptInput
        agentSessionId="agent-session-1"
        chatSessionId="chat-session-1"
        sessionStatus="active"
        onQueued={onQueued}
      />,
    )

    const textarea = screen.getByPlaceholderText('Queue follow-up...')
    fireEvent.change(textarea, { target: { value: 'Continue after this pass' } })
    fireEvent.click(screen.getByRole('button', { name: 'Queue prompt' }))

    await waitFor(() => expect(onQueued).toHaveBeenCalledOnce())
    const fetchCall = vi.mocked(fetch).mock.calls[0]
    expect(String(fetchCall?.[0])).toBe('http://127.0.0.1:21423/issue-agent-sessions/agent-session-1/continuation')
    expect(JSON.parse(String(fetchCall?.[1]?.body))).toEqual({
      mode: 'queue',
      text: 'Continue after this pass',
    })
  })

  it('uses steer by default and flips one message with Shift+Meta+Enter', async () => {
    preferenceMocks.useChatPreferencesQuery.mockReturnValue({
      data: {
        modelId: null,
        configSelections: {},
        continuationBehavior: 'steer',
      },
    })
    const onQueued = vi.fn()
    render(
      <AgentPromptInput
        agentSessionId="agent-session-1"
        chatSessionId="chat-session-1"
        sessionStatus="active"
        onQueued={onQueued}
      />,
    )

    const textarea = screen.getByPlaceholderText('Send steer...')
    fireEvent.change(textarea, { target: { value: 'Switch strategy once' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true, metaKey: true })

    await waitFor(() => expect(onQueued).toHaveBeenCalledOnce())
    const fetchCall = vi.mocked(fetch).mock.calls[0]
    expect(JSON.parse(String(fetchCall?.[1]?.body))).toEqual({
      mode: 'queue',
      text: 'Switch strategy once',
    })
  })
})
