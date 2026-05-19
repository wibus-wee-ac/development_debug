// @vitest-environment jsdom
//
// Input: React Testing Library, ChatMinimap, React 19 ref prop
// Output: Regression coverage for minimap imperative scroll progress updates
// Position: Chat feature test guarding ChatMinimap handle wiring used by ChatView

import type { UIMessage } from 'ai'
import { act, createRef } from 'react'
import { fireEvent, render, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ChatMinimap, type ChatMinimapHandle } from './chat-minimap'

function message(id: string, role: UIMessage['role'], text: string): UIMessage {
  return {
    id,
    role,
    parts: [{ type: 'text', text }],
  } as UIMessage
}

describe('ChatMinimap', () => {
  it('exposes a React 19 ref prop handle that updates bar progress fills', () => {
    const minimapRef = createRef<ChatMinimapHandle>()
    const { container } = render(
      <ChatMinimap
        ref={minimapRef}
        messages={[
          message('user-1', 'user', 'Question'),
          message('assistant-1', 'assistant', 'Answer'),
        ]}
        scrollHeight={1000}
        viewportHeight={500}
        onScrollToIndex={vi.fn()}
        onScrollTo={vi.fn()}
      />,
    )

    expect(minimapRef.current?.setScrollProgress).toBeTypeOf('function')
    const fills = Array.from(container.querySelectorAll<HTMLSpanElement>('[style*="scaleX"]'))
    expect(fills.map(fill => fill.style.transform)).toEqual(['scaleX(0)', 'scaleX(0)'])

    act(() => {
      minimapRef.current?.setScrollProgress(0.5)
    })

    expect(fills.map(fill => fill.style.transform)).toEqual(['scaleX(1)', 'scaleX(0)'])
  })

  it('exposes the minimap track as an accessible native button', () => {
    const minimapRef = createRef<ChatMinimapHandle>()
    const onScrollToIndex = vi.fn()
    const { container } = render(
      <ChatMinimap
        ref={minimapRef}
        messages={[
          message('user-1', 'user', 'Question'),
          message('assistant-1', 'assistant', 'Answer'),
        ]}
        scrollHeight={1000}
        viewportHeight={500}
        onScrollToIndex={onScrollToIndex}
        onScrollTo={vi.fn()}
      />,
    )

    const button = within(container).getByRole('button', { name: 'Chat minimap' })
    expect(button.closest('[aria-hidden="true"]')).toBeNull()

    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 8,
      bottom: 100,
      width: 8,
      height: 100,
      toJSON: () => ({}),
    })

    fireEvent.click(button, { clientY: 75 })

    expect(onScrollToIndex).toHaveBeenCalledWith(1)

    onScrollToIndex.mockClear()
    act(() => {
      minimapRef.current?.setScrollProgress(0.75)
    })
    fireEvent.keyDown(button, { key: 'Enter' })

    expect(onScrollToIndex).toHaveBeenCalledWith(1)
  })
})
