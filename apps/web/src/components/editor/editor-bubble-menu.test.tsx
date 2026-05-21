// @vitest-environment jsdom

import type { Editor } from '@tiptap/core'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EditorBubbleMenu } from './editor-bubble-menu'

vi.mock('@tiptap/react/menus', () => ({
  BubbleMenu: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-bubble-menu">{children}</div>
  ),
}))

function createEditorStub(activeMarks: string[] = []) {
  const calls = {
    focus: vi.fn(),
    run: vi.fn(),
    setLink: vi.fn(),
    toggleBold: vi.fn(),
    toggleCode: vi.fn(),
    toggleItalic: vi.fn(),
    toggleStrike: vi.fn(),
    unsetLink: vi.fn(),
  }

  const chain = {
    focus: () => {
      calls.focus()
      return chain
    },
    run: () => {
      calls.run()
      return true
    },
    setLink: (attrs: { href: string }) => {
      calls.setLink(attrs)
      return chain
    },
    toggleBold: () => {
      calls.toggleBold()
      return chain
    },
    toggleCode: () => {
      calls.toggleCode()
      return chain
    },
    toggleItalic: () => {
      calls.toggleItalic()
      return chain
    },
    toggleStrike: () => {
      calls.toggleStrike()
      return chain
    },
    unsetLink: () => {
      calls.unsetLink()
      return chain
    },
  }

  const editor = {
    chain: () => chain,
    isActive: (mark: string) => activeMarks.includes(mark),
  } as unknown as Editor

  return { calls, editor }
}

describe('EditorBubbleMenu', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders named formatting actions with decorative icons', () => {
    const { calls, editor } = createEditorStub()

    render(<EditorBubbleMenu editor={editor} />)

    for (const name of ['Bold', 'Italic', 'Strikethrough', 'Code', 'Link']) {
      const button = screen.getByRole('button', { name })
      expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    }

    fireEvent.click(screen.getByRole('button', { name: 'Bold' }))

    expect(calls.focus).toHaveBeenCalledTimes(1)
    expect(calls.toggleBold).toHaveBeenCalledTimes(1)
    expect(calls.run).toHaveBeenCalledTimes(1)
  })

  it('keeps link apply action named and decorative after opening link input', () => {
    const { calls, editor } = createEditorStub()

    render(<EditorBubbleMenu editor={editor} />)

    fireEvent.click(screen.getByRole('button', { name: 'Link' }))
    fireEvent.change(screen.getByPlaceholderText('https://'), {
      target: { value: 'https://example.com' },
    })

    const applyButton = screen.getByRole('button', { name: 'Apply link' })
    expect(applyButton.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')

    fireEvent.click(applyButton)

    expect(calls.setLink).toHaveBeenCalledWith({ href: 'https://example.com' })
    expect(calls.run).toHaveBeenCalledTimes(1)
  })
})
