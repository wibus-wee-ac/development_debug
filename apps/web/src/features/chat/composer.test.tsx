// @vitest-environment jsdom
//
// Input: React Testing Library and Composer slash command props
// Output: Regression tests for native Claude SDK slash command insertion and send-through
// Position: Chat composer unit tests for runtime command discovery UI

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { serializeWorkspaceFileDragPayload, writeWorkspaceFileDragData } from '~/lib/workspace-drag-data'

import { Composer } from './composer'

afterEach(() => {
  cleanup()
})

function createFakeDataTransfer(): DataTransfer {
  const values = new Map<string, string>()
  return {
    getData: (format: string) => values.get(format) ?? '',
    setData: (format: string, data: string) => {
      values.set(format, data)
    },
  } as DataTransfer
}

describe('Composer slash commands', () => {
  it('exposes a named send control and keeps send disabled while empty', () => {
    const onSend = vi.fn()

    render(<Composer onSend={onSend} />)

    const sendButton = screen.getByRole('button', { name: 'Send message' })
    expect((sendButton as HTMLButtonElement).disabled).toBe(true)
    expect(sendButton.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')

    fireEvent.change(screen.getByTestId('chat-composer-textarea'), {
      target: { value: 'Ship the patch' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    expect(onSend).toHaveBeenCalledWith('Ship the patch')
  })

  it('exposes a named stop control while streaming', () => {
    const onStop = vi.fn()

    render(<Composer onSend={vi.fn()} onStop={onStop} isStreaming />)

    const stopButton = screen.getByRole('button', { name: 'Stop generation' })
    expect(stopButton.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')

    fireEvent.click(stopButton)

    expect(onStop).toHaveBeenCalledTimes(1)
  })

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

  it('inserts a structured workspace file drag payload into the composer', () => {
    render(<Composer onSend={vi.fn()} />)

    const dataTransfer = createFakeDataTransfer()
    writeWorkspaceFileDragData(
      dataTransfer,
      serializeWorkspaceFileDragPayload({
        relativePath: 'src/app file.ts',
        workspacePath: '/Users/wibus/dev/Cradle',
      }),
    )

    const textarea = screen.getByTestId('chat-composer-textarea') as HTMLTextAreaElement
    fireEvent.drop(textarea, { dataTransfer })

    expect(textarea.value).toBe('"/Users/wibus/dev/Cradle/src/app file.ts"')
  })
})
