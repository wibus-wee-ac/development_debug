/**
 * Output: Regression coverage for chat composer file attachments.
 * Input: File input changes, attachment removal clicks, and send actions.
 * Position: Feature-owned tests for the chat composer input surface.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { FileUIPart } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '~/components/ui/tooltip'

import { Composer } from './composer'

const aiMocks = vi.hoisted(() => ({
  convertFileListToFileUIParts: vi.fn(async (files: FileList | undefined): Promise<FileUIPart[]> => {
    return Array.from(files ?? []).map(file => ({
      type: 'file',
      mediaType: file.type,
      filename: file.name,
      url: `data:${file.type};base64,test`,
    }))
  }),
}))

vi.mock('ai', () => ({
  convertFileListToFileUIParts: aiMocks.convertFileListToFileUIParts,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('composer attachments', () => {
  it('selects, removes, and sends file attachments', async () => {
    const onSend = vi.fn()
    render(
      <TooltipProvider>
        <Composer onSend={onSend} supportsAttachments />
      </TooltipProvider>,
    )

    const file = new File(['image'], 'diagram.png', { type: 'image/png' })
    fireEvent.change(screen.getByTestId('chat-file-input'), {
      target: { files: [file] },
    })

    expect(await screen.findByText('diagram.png')).toBeTruthy()
    expect(screen.getByTestId('chat-attachment-image-preview').getAttribute('src')).toBe('data:image/png;base64,test')
    expect((screen.getByTestId('chat-send-btn') as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(screen.getByTestId('chat-remove-attachment-btn'))
    await waitFor(() => {
      expect(screen.queryByText('diagram.png')).toBeNull()
    })
    expect((screen.getByTestId('chat-send-btn') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByTestId('chat-file-input'), {
      target: { files: [file] },
    })
    expect(await screen.findByText('diagram.png')).toBeTruthy()
    expect(screen.getByTestId('chat-attachment-image-preview').getAttribute('src')).toBe('data:image/png;base64,test')

    fireEvent.click(screen.getByTestId('chat-send-btn'))

    expect(onSend).toHaveBeenCalledWith('', [
      {
        type: 'file',
        mediaType: 'image/png',
        filename: 'diagram.png',
        url: 'data:image/png;base64,test',
      },
    ])
    await waitFor(() => {
      expect(screen.queryByText('diagram.png')).toBeNull()
    })
  })

  it('accepts pasted files as attachments', async () => {
    const onSend = vi.fn()
    render(
      <TooltipProvider>
        <Composer onSend={onSend} supportsAttachments />
      </TooltipProvider>,
    )

    const pastedFile = new File(['screenshot'], 'screenshot.png', { type: 'image/png' })
    fireEvent.paste(screen.getByTestId('chat-composer-textarea'), {
      clipboardData: {
        files: [pastedFile],
      },
    })

    expect(await screen.findByText('screenshot.png')).toBeTruthy()
    expect(screen.getByTestId('chat-attachment-image-preview').getAttribute('src')).toMatch(/^data:image\/png;base64,/)

    fireEvent.click(screen.getByTestId('chat-send-btn'))

    expect(onSend).toHaveBeenCalledWith('', [
      expect.objectContaining({
        type: 'file',
        mediaType: 'image/png',
        filename: 'screenshot.png',
        url: expect.stringMatching(/^data:image\/png;base64,/),
      }),
    ])
  })

  it('ignores pasted files when the current model does not support attachments', async () => {
    const onSend = vi.fn()
    render(
      <TooltipProvider>
        <Composer onSend={onSend} supportsAttachments={false} />
      </TooltipProvider>,
    )

    const pastedFile = new File(['screenshot'], 'screenshot.png', { type: 'image/png' })
    fireEvent.paste(screen.getByTestId('chat-composer-textarea'), {
      clipboardData: {
        files: [pastedFile],
      },
    })

    expect(screen.queryByText('screenshot.png')).toBeNull()
    expect(screen.queryByTestId('chat-attachment-image-preview')).toBeNull()
    expect((screen.getByTestId('chat-send-btn') as HTMLButtonElement).disabled).toBe(true)
  })
})
