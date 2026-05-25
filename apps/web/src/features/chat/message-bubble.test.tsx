/**
 * Output: Regression coverage for chat message bubble execution-detail rendering.
 * Input: UI messages containing final replies after tool call parts.
 * Position: Feature-owned tests for the shared chat/Jarvis message renderer.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

  it('renders Cradle AppShot file parts as thread AppShot cards', () => {
    const messageWithAppshot: UIMessage = {
      id: 'user-appshot',
      role: 'user',
      parts: [
        {
          type: 'file',
          mediaType: 'image/png',
          filename: 'window.png',
          url: 'data:image/png;base64,final',
          providerMetadata: {
            cradle: {
              appshot: {
                kind: 'cradle-appshot',
                appName: 'Visual Studio Code',
                windowTitle: 'Cradle',
                bundleIdentifier: 'com.microsoft.VSCode',
                imageName: 'window.png',
                imageDataUrl: 'data:image/png;base64,final',
                imagePath: '/tmp/window.png',
                transitionSnapshotDataUrl: 'data:image/png;base64,transition',
                transitionSnapshotHeight: 140,
                appIconDataUrl: null,
                axTree: '',
              },
            },
          },
        },
      ],
    }

    render(
      <TooltipProvider>
        <MessageBubble message={messageWithAppshot} isStreaming={false} />
      </TooltipProvider>,
    )

    expect(screen.getByTestId('chat-appshot-card')).toBeTruthy()
    expect(screen.getByTestId('chat-appshot-image').getAttribute('src')).toBe('data:image/png;base64,final')
    expect(screen.getByTestId('chat-appshot-identity').textContent).toContain('Visual Studio Code')
    expect(screen.queryByText('Cradle')).toBeNull()
    expect(screen.queryByTestId('chat-file-attachment')).toBeNull()
  })

  it('opens Cradle AppShot previews and toggles accessibility text', () => {
    const messageWithAppshot: UIMessage = {
      id: 'user-appshot-preview',
      role: 'user',
      parts: [
        {
          type: 'file',
          mediaType: 'image/png',
          filename: 'window.png',
          url: 'data:image/png;base64,final',
          providerMetadata: {
            cradle: {
              appshot: {
                kind: 'cradle-appshot',
                appName: 'Visual Studio Code',
                windowTitle: 'Cradle',
                bundleIdentifier: 'com.microsoft.VSCode',
                imageName: 'window.png',
                imageDataUrl: 'data:image/png;base64,final',
                imagePath: '/tmp/window.png',
                transitionSnapshotDataUrl: 'data:image/png;base64,transition',
                transitionSnapshotHeight: 140,
                appIconDataUrl: null,
                axTree: 'Window: "Cradle", App: "Visual Studio Code"',
              },
            },
          },
        },
      ],
    }

    render(
      <TooltipProvider>
        <MessageBubble message={messageWithAppshot} isStreaming={false} />
      </TooltipProvider>,
    )

    fireEvent.click(screen.getByTestId('chat-appshot-card'))

    expect(screen.getByTestId('chat-appshot-preview-dialog')).toBeTruthy()
    expect(screen.getByTestId('chat-appshot-preview-image').getAttribute('src')).toBe('data:image/png;base64,final')

    fireEvent.click(screen.getByTestId('chat-appshot-preview-toggle'))

    expect(screen.getByText('Window: "Cradle", App: "Visual Studio Code"')).toBeTruthy()
    expect(screen.queryByTestId('chat-appshot-preview-image')).toBeNull()
  })
})
