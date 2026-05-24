/**
 * Output: Regression coverage for chat message bubble execution-detail rendering.
 * Input: UI messages containing final replies after tool call parts.
 * Position: Feature-owned tests for the shared chat/Jarvis message renderer.
 */

import { cleanup, render, screen } from '@testing-library/react'
import type { UIMessage } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '~/components/ui/tooltip'
import { useChatStore } from '~/store/chat'

import { MessageBubble } from './message-bubble'

vi.mock('@cradle/streamdown', () => ({
  Streamdown: ({ content }: { content: string }) => <div>{content}</div>,
}))

afterEach(() => {
  cleanup()
  useChatStore.setState(state => ({
    ...state,
    messagesMap: new Map(),
    toolCallIdsByMessageId: new Map(),
    toolEntitiesMap: new Map(),
    subagentMessagesMap: new Map(),
    generatingMessageIds: new Set(),
    activeAbortControllers: new Map(),
    runDisplayMetaMap: new Map(),
    errorMap: new Map(),
    sessionMetaMap: new Map(),
  }))
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
  function seedToolEntity() {
    useChatStore.setState(state => ({
      ...state,
      toolCallIdsByMessageId: new Map([[messageWithToolCall.id, ['tool-1']]]),
      toolEntitiesMap: new Map([[
        'tool-1',
        {
          toolCallId: 'tool-1',
          messageId: messageWithToolCall.id,
          toolName: 'unknown_tool',
          state: 'output-available',
          input: { action: 'inspect' },
          output: { ok: true },
        },
      ]]),
    }))
  }

  it('keeps execution details folded by default', () => {
    seedToolEntity()
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
    seedToolEntity()
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

  it('renders file parts with filename, media type, and image preview', () => {
    const messageWithFile: UIMessage = {
      id: 'user-attachment',
      role: 'user',
      parts: [
        {
          type: 'file',
          mediaType: 'image/png',
          filename: 'diagram.png',
          url: 'data:image/png;base64,test',
        },
      ],
    }

    render(
      <TooltipProvider>
        <MessageBubble message={messageWithFile} isStreaming={false} />
      </TooltipProvider>,
    )

    expect(screen.getByTestId('chat-file-attachment')).toBeTruthy()
    expect(screen.getByTestId('chat-file-attachment-image').getAttribute('src')).toBe('data:image/png;base64,test')
    expect(screen.getByText('diagram.png')).toBeTruthy()
    expect(screen.getByText('image/png')).toBeTruthy()
  })
})
