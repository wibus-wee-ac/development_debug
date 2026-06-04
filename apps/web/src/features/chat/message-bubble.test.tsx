import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { UIMessage } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '~/components/ui/tooltip'
import { useChatStore } from '~/store/chat'

import { MessageBubble, MessageBubbleById } from './message-bubble'

vi.mock('@cradle/streamdown', () => ({
  Streamdown: ({ content }: { content: string }) => <div>{content}</div>,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key === 'status.thinking' ? 'Thinking...' : key,
  }),
}))

afterEach(() => {
  cleanup()
  useChatStore.setState(state => ({
    ...state,
    messagesMap: new Map(),
    generatingMessageIds: new Set(),
    passiveStreamingMessageIds: new Set(),
    activeAbortControllers: new Map(),
    runDisplayMetaMap: new Map(),
    errorMap: new Map(),
    sessionMetaMap: new Map(),
  }))
  vi.useRealTimers()
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
                appIconDataUrl: 'data:image/png;base64,icon',
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
    expect(screen.getByTestId('chat-appshot-identity').textContent).toContain('Cradle')
    expect(screen.getByTestId('chat-appshot-identity').querySelector('img')).toBeNull()
    expect(screen.getByTestId('chat-appshot-app-icon').getAttribute('src')).toBe('data:image/png;base64,icon')
    expect(screen.getByTestId('chat-appshot-app-icon').parentElement).not.toBe(screen.getByTestId('chat-appshot-image').parentElement)
    expect(screen.queryByTestId('chat-file-attachment')).toBeNull()
  })

  it('shows Thinking after streamed text becomes idle', () => {
    vi.useFakeTimers()
    const streamingMessage: UIMessage = {
      id: 'assistant-streaming',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Let me look at the chat tab.' }],
    }

    render(
      <TooltipProvider>
        <MessageBubble message={streamingMessage} isStreaming />
      </TooltipProvider>,
    )

    expect(screen.queryByTestId('message-bubble-thinking-placeholder')).toBeNull()

    act(() => {
      vi.advanceTimersByTime(900)
    })

    expect(screen.getByTestId('message-bubble-thinking-placeholder').textContent).toBe('Thinking...')
  })

  it('hides Thinking while streamed text is still growing', () => {
    vi.useFakeTimers()
    const firstMessage: UIMessage = {
      id: 'assistant-streaming-growth',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Let me look' }],
    }
    const nextMessage: UIMessage = {
      ...firstMessage,
      parts: [{ type: 'text', text: 'Let me look at the chat tab.' }],
    }

    const { rerender } = render(
      <TooltipProvider>
        <MessageBubble message={firstMessage} isStreaming />
      </TooltipProvider>,
    )

    act(() => {
      vi.advanceTimersByTime(500)
    })

    rerender(
      <TooltipProvider>
        <MessageBubble message={nextMessage} isStreaming />
      </TooltipProvider>,
    )

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(screen.queryByTestId('message-bubble-thinking-placeholder')).toBeNull()

    act(() => {
      vi.advanceTimersByTime(400)
    })

    expect(screen.getByTestId('message-bubble-thinking-placeholder').textContent).toBe('Thinking...')
  })

  it('keeps Thinking idle detection tied to text length instead of full text content', () => {
    vi.useFakeTimers()
    const firstMessage: UIMessage = {
      id: 'assistant-streaming-same-length',
      role: 'assistant',
      parts: [{ type: 'text', text: 'abc' }],
    }
    const sameLengthMessage: UIMessage = {
      ...firstMessage,
      parts: [{ type: 'text', text: 'xyz' }],
    }

    const { rerender } = render(
      <TooltipProvider>
        <MessageBubble message={firstMessage} isStreaming />
      </TooltipProvider>,
    )

    act(() => {
      vi.advanceTimersByTime(500)
    })

    rerender(
      <TooltipProvider>
        <MessageBubble message={sameLengthMessage} isStreaming />
      </TooltipProvider>,
    )

    act(() => {
      vi.advanceTimersByTime(400)
    })

    expect(screen.getByTestId('message-bubble-thinking-placeholder').textContent).toBe('Thinking...')
  })

  it('does not duplicate Thinking while reasoning is streaming', () => {
    vi.useFakeTimers()
    const reasoningMessage: UIMessage = {
      id: 'assistant-reasoning-streaming',
      role: 'assistant',
      parts: [{ type: 'reasoning', text: 'Inspecting the session state.', state: 'streaming' }],
    }

    render(
      <TooltipProvider>
        <MessageBubble message={reasoningMessage} isStreaming />
      </TooltipProvider>,
    )

    act(() => {
      vi.advanceTimersByTime(900)
    })

    expect(screen.queryByTestId('message-bubble-thinking-placeholder')).toBeNull()
    expect(screen.getByText('Thinking')).toBeTruthy()
  })

  it('shows Thinking after completed tool progress becomes idle during streaming', () => {
    vi.useFakeTimers()

    render(
      <TooltipProvider>
        <MessageBubble message={messageWithToolCall} isStreaming />
      </TooltipProvider>,
    )

    expect(screen.queryByTestId('message-bubble-thinking-placeholder')).toBeNull()

    act(() => {
      vi.advanceTimersByTime(900)
    })

    expect(screen.getByTestId('message-bubble-thinking-placeholder').textContent).toBe('Thinking...')
  })

  it('does not duplicate Thinking while a tool call is still active', () => {
    vi.useFakeTimers()
    const activeToolMessage: UIMessage = {
      id: 'assistant-active-tool',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolCallId: 'tool-active',
          toolName: 'unknown_tool',
          state: 'input-streaming',
        } as UIMessage['parts'][number],
        { type: 'text', text: 'Checking the workspace.' },
      ],
    }

    render(
      <TooltipProvider>
        <MessageBubble message={activeToolMessage} isStreaming />
      </TooltipProvider>,
    )

    act(() => {
      vi.advanceTimersByTime(900)
    })

    expect(screen.queryByTestId('message-bubble-thinking-placeholder')).toBeNull()
  })

  it('shows Thinking in the store-backed renderer after completed tool progress becomes idle', () => {
    vi.useFakeTimers()
    useChatStore.setState(state => ({
      ...state,
      messagesMap: new Map([['session-1', [messageWithToolCall]]]),
    }))

    render(
      <TooltipProvider>
        <MessageBubbleById sessionId="session-1" messageId={messageWithToolCall.id} />
      </TooltipProvider>,
    )

    act(() => {
      useChatStore.setState(state => ({
        ...state,
        passiveStreamingMessageIds: new Set([messageWithToolCall.id]),
      }))
    })

    act(() => {
      vi.advanceTimersByTime(900)
    })

    expect(screen.getByTestId('message-bubble-thinking-placeholder').textContent).toBe('Thinking...')
  })

  it('does not show Thinking after the assistant bubble stops streaming', () => {
    const completedMessage: UIMessage = {
      id: 'assistant-completed',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Done.' }],
    }

    render(
      <TooltipProvider>
        <MessageBubble message={completedMessage} isStreaming={false} />
      </TooltipProvider>,
    )

    expect(screen.queryByTestId('message-bubble-thinking-placeholder')).toBeNull()
  })

  it('does not show Thinking on streaming user bubbles', () => {
    const userMessage: UIMessage = {
      id: 'user-streaming',
      role: 'user',
      parts: [{ type: 'text', text: 'Hello' }],
    }

    render(
      <TooltipProvider>
        <MessageBubble message={userMessage} isStreaming />
      </TooltipProvider>,
    )

    expect(screen.queryByTestId('message-bubble-thinking-placeholder')).toBeNull()
  })

  it('does not offer a separate set-goal action on completed user messages', () => {
    const userMessage: UIMessage = {
      id: 'user-goal',
      role: 'user',
      parts: [{ type: 'text', text: 'Refactor the runtime slot state' }],
    }

    render(
      <TooltipProvider>
        <MessageBubble
          message={userMessage}
          isStreaming={false}
        />
      </TooltipProvider>,
    )

    expect(screen.queryByRole('button', { name: 'Set message as goal' })).toBeNull()
  })

  it('projects Codex goal slash messages as objective timeline items', () => {
    const userMessage: UIMessage = {
      id: 'user-goal-command',
      role: 'user',
      parts: [{ type: 'text', text: '/goal Refactor runtime slots' }],
    }

    render(
      <TooltipProvider>
        <MessageBubble
          message={userMessage}
          isStreaming={false}
        />
      </TooltipProvider>,
    )

    expect(screen.getByText('Goal')).toBeTruthy()
    expect(screen.getByText('Refactor runtime slots')).toBeTruthy()
    expect(screen.queryByText('/goal Refactor runtime slots')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Set message as goal' })).toBeNull()
  })

  it('projects Codex goal slash messages in the store-backed renderer', () => {
    const userMessage: UIMessage = {
      id: 'user-goal-command-store',
      role: 'user',
      parts: [{ type: 'text', text: '/goal Refactor store-backed slots' }],
    }
    useChatStore.setState(state => ({
      ...state,
      messagesMap: new Map([['session-1', [userMessage]]]),
    }))

    render(
      <TooltipProvider>
        <MessageBubbleById
          sessionId="session-1"
          messageId={userMessage.id}
        />
      </TooltipProvider>,
    )

    expect(screen.getByText('Goal')).toBeTruthy()
    expect(screen.getByText('Refactor store-backed slots')).toBeTruthy()
    expect(screen.queryByText('/goal Refactor store-backed slots')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Set message as goal' })).toBeNull()
  })

  it('renders sent bang commands as terminal prompts instead of normal user text', () => {
    const userMessage: UIMessage = {
      id: 'user-bang-command',
      role: 'user',
      parts: [{ type: 'text', text: '!git status' }],
      metadata: {
        cradle: {
          bangCommand: {
            command: 'git status',
          },
        },
      },
    }

    render(
      <TooltipProvider>
        <MessageBubble
          message={userMessage}
          isStreaming={false}
        />
      </TooltipProvider>,
    )

    expect(screen.getByTestId('chat-bang-command-prompt')).toBeTruthy()
    expect(screen.getByText('$')).toBeTruthy()
    expect(screen.getByText('git status')).toBeTruthy()
    expect(screen.queryByText('!git status')).toBeNull()
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
