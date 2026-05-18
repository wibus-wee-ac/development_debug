// @vitest-environment jsdom
//
// Input: React Testing Library and Composer slash command props
// Output: Regression tests for native Claude SDK slash command insertion and send-through
// Position: Chat composer unit tests for runtime command discovery UI

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Composer } from './composer'

afterEach(() => {
  cleanup()
})

describe('Composer slash commands', () => {
  it('inserts a selected slash command and sends native slash prompt text unchanged', () => {
    const onSend = vi.fn()

    render(
      <Composer
        onSend={onSend}
        slashCommands={[
          {
            name: 'review',
            description: 'Review a target file',
            argumentHint: '<file>',
            aliases: ['code-review'],
          },
        ]}
      />,
    )

    const textarea = screen.getByTestId('chat-composer-textarea') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '/rev', selectionStart: 4 } })

    fireEvent.click(screen.getByRole('option', { name: /review/i }))

    expect(textarea.value).toBe('/review ')
    expect(screen.getByTestId('slash-argument-hint').textContent).toBe('/review <file>')

    fireEvent.change(textarea, { target: { value: '/review src/app.ts', selectionStart: 18 } })
    expect(screen.queryByTestId('slash-argument-hint')).toBeNull()
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })

    expect(onSend).toHaveBeenCalledWith('/review src/app.ts')
  })

  it('shows the hovered slash command description in the composer picker', () => {
    render(
      <Composer
        onSend={vi.fn()}
        slashCommands={[
          {
            name: 'compact',
            description: 'Compact the conversation',
            argumentHint: '',
          },
          {
            name: 'review',
            description: 'Review a target file',
            argumentHint: '<file>',
            aliases: ['code-review'],
          },
        ]}
      />,
    )

    fireEvent.change(screen.getByTestId('chat-composer-textarea'), { target: { value: '/', selectionStart: 1 } })

    expect(screen.getByTestId('slash-command-description').textContent).toContain('Compact the conversation')

    fireEvent.mouseEnter(screen.getByRole('option', { name: /review/i }))

    const descriptionText = screen.getByTestId('slash-command-description').textContent ?? ''
    expect(descriptionText).toContain('/review')
    expect(descriptionText).toContain('<file>')
    expect(descriptionText).toContain('Review a target file')
    expect(descriptionText).toContain('Aliases: /code-review')
  })

  it('renders duplicate command names without duplicate React keys', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      render(
        <Composer
          onSend={vi.fn()}
          slashCommands={[
            {
              name: 'agent-browser',
              description: 'Open browser tools',
              argumentHint: '',
            },
            {
              name: 'agent-browser',
              description: 'Open browser automation',
              argumentHint: '<url>',
            },
          ]}
        />,
      )

      fireEvent.change(screen.getByTestId('chat-composer-textarea'), { target: { value: '/agent', selectionStart: 6 } })

      expect(screen.getAllByRole('option', { name: /agent-browser/i })).toHaveLength(2)
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Encountered two children with the same key'),
        expect.anything(),
      )
    }
    finally {
      consoleErrorSpy.mockRestore()
    }
  })
})
