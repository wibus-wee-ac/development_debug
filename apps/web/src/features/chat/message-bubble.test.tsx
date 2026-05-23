/**
 * Output: Regression coverage for chat message bubble execution-detail rendering.
 * Input: UI messages containing final replies after tool call parts.
 * Position: Feature-owned tests for the shared chat/Jarvis message renderer.
 */

import { cleanup, render, screen } from '@testing-library/react'
import type { UIMessage } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '~/components/ui/tooltip'

import { MessageBubble } from './message-bubble'

vi.mock('@cradle/streamdown', () => ({
  Streamdown: ({ content }: { content: string }) => <div>{content}</div>,
}))

afterEach(() => {
  cleanup()
})

const messageWithToolCall: UIMessage = {
  id: 'assistant-1',
  role: 'assistant',
  parts: [
    {
      type: 'dynamic-tool',
      toolCallId: 'tool-1',
      toolName: 'unknown_tool',
      state: 'output-available',
      input: { action: 'inspect' },
      output: { ok: true },
    },
    { type: 'text', text: 'Done.' },
  ],
}

describe('message bubble', () => {
  it('keeps execution details folded by default', () => {
    render(
      <TooltipProvider>
        <MessageBubble message={messageWithToolCall} isStreaming={false} />
      </TooltipProvider>,
    )

    expect(screen.getByText('Show execution details')).toBeTruthy()
    expect(screen.queryByTestId('chat-tool-call-tool-1')).toBeNull()
    expect(screen.getByText('Done.')).toBeTruthy()
  })

  it('renders execution details immediately when default-open is requested', () => {
    render(
      <TooltipProvider>
        <MessageBubble
          message={messageWithToolCall}
          isStreaming={false}
          executionDetailsDefaultOpen
        />
      </TooltipProvider>,
    )

    expect(screen.getByText('Hide execution details')).toBeTruthy()
    expect(screen.getByTestId('chat-tool-call-tool-1')).toBeTruthy()
    expect(screen.getByText('Done.')).toBeTruthy()
  })
})
