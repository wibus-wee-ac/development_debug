/**
 * Output: Regression coverage for chat PNG export scope selection and rendering.
 * Input: UI messages rendered through the chat share export dialog.
 * Position: Feature-owned tests for conversation share/export behavior.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { UIMessage } from 'ai'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '~/components/ui/tooltip'
import { useChatStore } from '~/store/chat'

import { ChatShareExport } from './chat-share-export'

const domToPngMock = vi.fn(async () => 'data:image/png;base64,exported')

vi.mock('modern-screenshot', () => ({
  domToPng: domToPngMock,
}))

vi.mock('~/components/ui/toast', () => ({
  toastManager: {
    add: vi.fn(),
  },
}))

vi.mock('./message-bubble', () => ({
  MessageBubble: ({ executionDetailsDefaultOpen, message }: { executionDetailsDefaultOpen?: boolean, message: UIMessage }) => (
    <div data-testid="exported-message" data-message-id={message.id}>
      {executionDetailsDefaultOpen ? 'execution-open' : 'execution-folded'}
      {message.parts
        .flatMap(part => part.type === 'text' ? [(part as { text: string }).text] : [])
        .join('\n')}
    </div>
  ),
}))

const messages: UIMessage[] = [
  {
    id: 'user-1',
    role: 'user',
    parts: [{ type: 'text', text: 'First user message' }],
  },
  {
    id: 'assistant-1',
    role: 'assistant',
    parts: [{ type: 'text', text: 'Assistant reply' }],
  },
  {
    id: 'user-2',
    role: 'user',
    parts: [{ type: 'text', text: 'Second user message' }],
  },
]

beforeAll(() => {
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: {
      ready: Promise.resolve(),
    },
  })
})

afterEach(() => {
  cleanup()
  domToPngMock.mockClear()
  useChatStore.getState().clearSession('session-export-test')
})

function renderShareExport() {
  useChatStore.getState().setMessages('session-export-test', messages)
  render(
    <TooltipProvider>
      <ChatShareExport sessionId="session-export-test" />
    </TooltipProvider>,
  )

  fireEvent.click(screen.getByTestId('chat-share-export-open'))
  return within(screen.getByTestId('chat-share-export-surface'))
}

describe('chat share export', () => {
  it('previews all current session messages by default', () => {
    const surface = renderShareExport()
    const exportedMessages = surface.getAllByTestId('exported-message')

    expect(exportedMessages).toHaveLength(3)
    expect(surface.queryByText('execution-open')).toBeNull()
    expect(exportedMessages[0].textContent).toContain('First user message')
    expect(exportedMessages[1].textContent).toContain('Assistant reply')
    expect(exportedMessages[2].textContent).toContain('Second user message')
  })

  it('previews only selected messages in selected scope', () => {
    renderShareExport()

    fireEvent.click(screen.getByRole('button', { name: 'Selected' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select message 2' }))

    const surface = within(screen.getByTestId('chat-share-export-surface'))
    expect(surface.getAllByTestId('exported-message')).toHaveLength(1)
    expect(surface.queryByText('First user message')).toBeNull()
    expect(surface.getByText('Assistant reply')).toBeTruthy()
    expect(surface.queryByText('Second user message')).toBeNull()
  })

  it('renders the export surface to PNG when downloading', async () => {
    renderShareExport()

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    try {
      fireEvent.click(screen.getByRole('button', { name: 'Download PNG' }))

      await waitFor(() => {
        expect(domToPngMock).toHaveBeenCalledTimes(1)
      })

      expect(domToPngMock).toHaveBeenCalledWith(
        screen.getByTestId('chat-share-export-surface'),
        expect.objectContaining({
          backgroundColor: '#ffffff',
          scale: 2,
          width: 960,
        }),
      )
      expect(clickSpy).toHaveBeenCalledTimes(1)
    }
    finally {
      clickSpy.mockRestore()
    }
  })
})
