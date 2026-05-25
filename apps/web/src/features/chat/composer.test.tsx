/**
 * Output: Regression coverage for chat composer file attachments.
 * Input: File input changes, attachment removal clicks, and send actions.
 * Position: Feature-owned tests for the chat composer input surface.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { FileUIPart } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '~/components/ui/tooltip'

import type { ChatComposerSlashCommand } from './chat-slash-commands'
import { Composer, type ComposerSlashCommandActionContext } from './composer'

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

  it('renders Cradle AppShot metadata as an AppShot card without filename heuristics', async () => {
    const onSend = vi.fn()
    const appshotPart: FileUIPart = {
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
    }

    render(
      <TooltipProvider>
        <Composer
          onSend={onSend}
          supportsAttachments
          appendExternalFileParts={[appshotPart]}
          appendExternalFilePartsKey={1}
        />
      </TooltipProvider>,
    )

    expect(await screen.findByTestId('chat-appshot-card')).toBeTruthy()
    expect(screen.getByTestId('chat-appshot-identity').textContent).toContain('Visual Studio Code')
    expect(screen.getByTestId('chat-appshot-image').getAttribute('src')).toBe('data:image/png;base64,transition')
    expect(screen.queryByText('window.png')).toBeNull()

    fireEvent.click(screen.getByTestId('chat-send-btn'))

    expect(onSend).toHaveBeenCalledWith('', [appshotPart])
  })

  it('renders pending AppShot slots with the composer identity height', async () => {
    const onSend = vi.fn()
    const { container } = render(
      <TooltipProvider>
        <Composer
          onSend={onSend}
          supportsAttachments
          pendingAppshots={[{
            requestId: 'request-title',
            transitionSnapshotHeight: 160.5,
            transitionSnapshotHeightResolved: true,
            transitionSpringDampingFraction: null,
            transitionSpringResponse: null,
          }]}
        />
      </TooltipProvider>,
    )

    const pendingSlot = container.querySelector<HTMLElement>('[data-pending-appshot-capture-request-id="request-title"]')
    expect(pendingSlot).toBeTruthy()
    expect(pendingSlot?.dataset.pendingAppshotCaptureHeight).toBe('190.5')
  })
})

describe('composer slash commands', () => {
  const runtimeCompactCommand: ChatComposerSlashCommand = {
    id: 'runtime:compact:0',
    name: 'compact',
    description: 'Compact the conversation',
    argumentHint: '[instructions]',
    aliases: ['summarize'],
    source: 'runtime',
    action: { kind: 'insertText', text: '/compact ' },
  }

  function createDeferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((res) => {
      resolve = res
    })
    return { promise, resolve }
  }

  it('inserts runtime slash commands and sends raw slash text unchanged', () => {
    const onSend = vi.fn()
    render(
      <TooltipProvider>
        <Composer onSend={onSend} slashCommands={[runtimeCompactCommand]} />
      </TooltipProvider>,
    )

    const textarea = screen.getByTestId('chat-composer-textarea') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '/' } })
    fireEvent.click(screen.getByRole('option', { name: '/compact Runtime' }))

    expect(textarea.value).toBe('/compact ')
    expect(screen.getByTestId('slash-argument-hint').textContent).toContain('[instructions]')

    fireEvent.change(textarea, { target: { value: '/compact keep recent context' } })
    fireEvent.click(screen.getByTestId('chat-send-btn'))

    expect(onSend).toHaveBeenCalledWith('/compact keep recent context', [])
  })

  it('dispatches Cradle UI slash commands without sending raw text or changing input', () => {
    const onSend = vi.fn()
    const onSlashCommandAction = vi.fn()
    const cradleGoalCommand: ChatComposerSlashCommand = {
      id: 'cradle:goal',
      name: 'goal',
      description: 'Open goal editor',
      argumentHint: '',
      source: 'cradle',
      action: { kind: 'uiAction', actionId: 'open-goal-editor' },
    }

    render(
      <TooltipProvider>
        <Composer
          onSend={onSend}
          onSlashCommandAction={onSlashCommandAction}
          slashCommands={[cradleGoalCommand]}
        />
      </TooltipProvider>,
    )

    const textarea = screen.getByTestId('chat-composer-textarea') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '/' } })
    fireEvent.click(screen.getByRole('option', { name: '/goal Cradle' }))

    expect(onSlashCommandAction).toHaveBeenCalledWith(cradleGoalCommand, {}, {
      readActionContext: expect.any(Function),
    })
    expect(onSend).not.toHaveBeenCalled()
    expect(textarea.value).toBe('/')
    expect(screen.queryByRole('option', { name: '/goal Cradle' })).toBeNull()
  })

  it('lets Cradle UI slash commands explicitly replace the trigger with returned text', async () => {
    const onSend = vi.fn()
    const onSlashCommandAction = vi.fn(async () => ({ insertText: '/goal Keep tests green ' }))
    const cradleGoalCommand: ChatComposerSlashCommand = {
      id: 'cradle:goal',
      name: 'goal',
      description: 'Open goal editor',
      argumentHint: '',
      source: 'cradle',
      action: { kind: 'uiAction', actionId: 'open-goal-editor' },
    }

    render(
      <TooltipProvider>
        <Composer
          onSend={onSend}
          onSlashCommandAction={onSlashCommandAction}
          slashCommands={[cradleGoalCommand]}
        />
      </TooltipProvider>,
    )

    const textarea = screen.getByTestId('chat-composer-textarea') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '/' } })
    fireEvent.click(screen.getByRole('option', { name: '/goal Cradle' }))

    await waitFor(() => {
      expect(textarea.value).toBe('/goal Keep tests green ')
    })
  })

  it('attaches files returned by Cradle UI slash commands', async () => {
    const onSend = vi.fn()
    const onSlashCommandAction = vi.fn(async () => ({
      insertText: '',
      fileParts: [{
        type: 'file' as const,
        mediaType: 'image/png',
        filename: 'appshot.png',
        url: 'data:image/png;base64,test',
      }],
    }))
    const cradleAppshotCommand: ChatComposerSlashCommand = {
      id: 'cradle:appshot',
      name: 'appshot',
      description: 'Capture the frontmost app window',
      argumentHint: '',
      source: 'cradle',
      action: { kind: 'uiAction', actionId: 'capture-appshot' },
    }

    render(
      <TooltipProvider>
        <Composer
          onSend={onSend}
          onSlashCommandAction={onSlashCommandAction}
          slashCommands={[cradleAppshotCommand]}
          supportsAttachments
        />
      </TooltipProvider>,
    )

    const actionTarget = screen.getByTestId('chat-composer-action-target')
    vi.spyOn(actionTarget, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 20,
      top: 20,
      left: 10,
      bottom: 140,
      right: 650,
      width: 640,
      height: 120,
      toJSON: () => ({}),
    } as DOMRect)

    const textarea = screen.getByTestId('chat-composer-textarea') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '/' } })
    fireEvent.click(screen.getByRole('option', { name: '/appshot Cradle' }))

    expect(onSlashCommandAction).toHaveBeenCalledWith(
      cradleAppshotCommand,
      {
        animationTarget: expect.objectContaining({
          destinationCornerRadius: 0,
          destinationFrame: expect.objectContaining({
            x: 10,
            y: 20,
            width: 232,
            height: 140,
          }),
          transitionSnapshotScale: 1,
        }),
      },
      { readActionContext: expect.any(Function) },
    )
    expect(await screen.findByText('appshot.png')).toBeTruthy()
    expect(screen.getByTestId('chat-attachment-image-preview').getAttribute('src')).toBe('data:image/png;base64,test')

    fireEvent.click(screen.getByTestId('chat-send-btn'))

    expect(onSend).toHaveBeenCalledWith('', [{
      type: 'file',
      mediaType: 'image/png',
      filename: 'appshot.png',
      url: 'data:image/png;base64,test',
    }])
  })

  it('measures AppShot animation destination from the matching pending slot', () => {
    const onSend = vi.fn()
    const measuredContexts: ComposerSlashCommandActionContext[] = []
    const cradleAppshotCommand: ChatComposerSlashCommand = {
      id: 'cradle:appshot',
      name: 'appshot',
      description: 'Capture the frontmost app window',
      argumentHint: '',
      source: 'cradle',
      action: { kind: 'uiAction', actionId: 'capture-appshot' },
    }

    render(
      <TooltipProvider>
        <Composer
          onSend={onSend}
          onSlashCommandAction={(_command, _context, tools) => {
            const measuredContext = tools?.readActionContext({ pendingAppshotRequestId: 'request-1' })
            if (measuredContext) {
              measuredContexts.push(measuredContext)
            }
            return { insertText: '' }
          }}
          slashCommands={[cradleAppshotCommand]}
          supportsAttachments
          pendingAppshots={[{
            requestId: 'request-1',
            transitionSnapshotHeight: null,
            transitionSnapshotHeightResolved: false,
            transitionSpringDampingFraction: null,
            transitionSpringResponse: null,
          }]}
        />
      </TooltipProvider>,
    )

    const actionTarget = screen.getByTestId('chat-composer-action-target')
    vi.spyOn(actionTarget, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 20,
      top: 20,
      left: 10,
      bottom: 220,
      right: 650,
      width: 640,
      height: 200,
      toJSON: () => ({}),
    } as DOMRect)
    const attachmentsContainer = actionTarget.querySelector<HTMLElement>('[data-composer-attachments-container]')
    const attachmentsRow = actionTarget.querySelector<HTMLElement>('[data-composer-attachments-row]')
    const pendingSlot = actionTarget.querySelector<HTMLElement>('[data-pending-appshot-capture-request-id="request-1"]')
    expect(attachmentsContainer).toBeTruthy()
    expect(attachmentsRow).toBeTruthy()
    expect(pendingSlot).toBeTruthy()
    vi.spyOn(attachmentsContainer!, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 100,
      top: 100,
      left: 10,
      bottom: 242,
      right: 650,
      width: 640,
      height: 142,
      toJSON: () => ({}),
    } as DOMRect)
    vi.spyOn(attachmentsRow!, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 100,
      top: 100,
      left: 10,
      bottom: 242,
      right: 650,
      width: 640,
      height: 142,
      toJSON: () => ({}),
    } as DOMRect)
    vi.spyOn(pendingSlot!, 'getBoundingClientRect').mockReturnValue({
      x: 321,
      y: 100,
      top: 100,
      left: 321,
      bottom: 100,
      right: 321,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    } as DOMRect)

    const textarea = screen.getByTestId('chat-composer-textarea') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '/' } })
    fireEvent.click(screen.getByRole('option', { name: '/appshot Cradle' }))

    expect(measuredContexts).toHaveLength(1)
    const context = measuredContexts[0]
    expect(context.animationTarget?.destinationFrame).toEqual({
      x: 321,
      y: 72,
      width: 232,
      height: 140,
    })
  })

  it('uses the title-aware AppShot height when correcting the capture destination', () => {
    const onSend = vi.fn()
    const measuredContexts: ComposerSlashCommandActionContext[] = []
    const cradleAppshotCommand: ChatComposerSlashCommand = {
      id: 'cradle:appshot',
      name: 'appshot',
      description: 'Capture the frontmost app window',
      argumentHint: '',
      source: 'cradle',
      action: { kind: 'uiAction', actionId: 'capture-appshot' },
    }

    render(
      <TooltipProvider>
        <Composer
          onSend={onSend}
          onSlashCommandAction={(_command, _context, tools) => {
            const measuredContext = tools?.readActionContext({
              pendingAppshotRequestId: 'request-title',
              transitionSnapshotHeight: 160.5,
            })
            if (measuredContext) {
              measuredContexts.push(measuredContext)
            }
            return { insertText: '' }
          }}
          slashCommands={[cradleAppshotCommand]}
          supportsAttachments
          pendingAppshots={[{
            requestId: 'request-title',
            transitionSnapshotHeight: null,
            transitionSnapshotHeightResolved: false,
            transitionSpringDampingFraction: null,
            transitionSpringResponse: null,
          }]}
        />
      </TooltipProvider>,
    )

    const actionTarget = screen.getByTestId('chat-composer-action-target')
    vi.spyOn(actionTarget, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 20,
      top: 20,
      left: 10,
      bottom: 220,
      right: 650,
      width: 640,
      height: 200,
      toJSON: () => ({}),
    } as DOMRect)
    const attachmentsContainer = actionTarget.querySelector<HTMLElement>('[data-composer-attachments-container]')
    const attachmentsRow = actionTarget.querySelector<HTMLElement>('[data-composer-attachments-row]')
    const pendingSlot = actionTarget.querySelector<HTMLElement>('[data-pending-appshot-capture-request-id="request-title"]')
    expect(attachmentsContainer).toBeTruthy()
    expect(attachmentsRow).toBeTruthy()
    expect(pendingSlot).toBeTruthy()
    vi.spyOn(attachmentsContainer!, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 100,
      top: 100,
      left: 10,
      bottom: 242,
      right: 650,
      width: 640,
      height: 142,
      toJSON: () => ({}),
    } as DOMRect)
    vi.spyOn(attachmentsRow!, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 100,
      top: 100,
      left: 10,
      bottom: 242,
      right: 650,
      width: 640,
      height: 142,
      toJSON: () => ({}),
    } as DOMRect)
    vi.spyOn(pendingSlot!, 'getBoundingClientRect').mockReturnValue({
      x: 321,
      y: 100,
      top: 100,
      left: 321,
      bottom: 100,
      right: 321,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    } as DOMRect)

    const textarea = screen.getByTestId('chat-composer-textarea') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '/' } })
    fireEvent.click(screen.getByRole('option', { name: '/appshot Cradle' }))

    expect(measuredContexts).toHaveLength(1)
    expect(measuredContexts[0].animationTarget?.destinationFrame).toEqual({
      x: 321,
      y: 51.5,
      width: 232,
      height: 140,
    })
  })

  it('falls back to the Codex AppShot tray offsets when a pending slot has not been laid out', async () => {
    const onSend = vi.fn()
    const measuredContexts: ComposerSlashCommandActionContext[] = []
    const appshotPart: FileUIPart = {
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
    }
    const cradleAppshotCommand: ChatComposerSlashCommand = {
      id: 'cradle:appshot',
      name: 'appshot',
      description: 'Capture the frontmost app window',
      argumentHint: '',
      source: 'cradle',
      action: { kind: 'uiAction', actionId: 'capture-appshot' },
    }

    render(
      <TooltipProvider>
        <Composer
          onSend={onSend}
          onSlashCommandAction={(_command, _context, tools) => {
            const measuredContext = tools?.readActionContext({ pendingAppshotRequestId: 'request-2' })
            if (measuredContext) {
              measuredContexts.push(measuredContext)
            }
            return { insertText: '' }
          }}
          slashCommands={[cradleAppshotCommand]}
          supportsAttachments
          appendExternalFileParts={[appshotPart]}
          appendExternalFilePartsKey={1}
          pendingAppshots={[
            {
              requestId: 'request-1',
              transitionSnapshotHeight: null,
              transitionSnapshotHeightResolved: false,
              transitionSpringDampingFraction: null,
              transitionSpringResponse: null,
            },
            {
              requestId: 'request-2',
              transitionSnapshotHeight: null,
              transitionSnapshotHeightResolved: false,
              transitionSpringDampingFraction: null,
              transitionSpringResponse: null,
            },
          ]}
        />
      </TooltipProvider>,
    )

    fireEvent.change(screen.getByTestId('chat-file-input'), {
      target: { files: [new File(['image'], 'diagram.png', { type: 'image/png' })] },
    })

    expect(await screen.findByText('diagram.png')).toBeTruthy()
    expect(await screen.findByTestId('chat-appshot-card')).toBeTruthy()

    const actionTarget = screen.getByTestId('chat-composer-action-target')
    vi.spyOn(actionTarget, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 20,
      top: 20,
      left: 10,
      bottom: 260,
      right: 650,
      width: 640,
      height: 240,
      toJSON: () => ({}),
    } as DOMRect)
    const attachmentsContainer = actionTarget.querySelector<HTMLElement>('[data-composer-attachments-container]')
    const attachmentsRow = actionTarget.querySelector<HTMLElement>('[data-composer-attachments-row]')
    const pendingSlot = actionTarget.querySelector<HTMLElement>('[data-pending-appshot-capture-request-id="request-2"]')
    expect(attachmentsContainer).toBeTruthy()
    expect(attachmentsRow).toBeTruthy()
    expect(pendingSlot).toBeTruthy()
    vi.spyOn(attachmentsContainer!, 'getBoundingClientRect').mockReturnValue({
      x: 20,
      y: 120,
      top: 120,
      left: 20,
      bottom: 262,
      right: 660,
      width: 640,
      height: 142,
      toJSON: () => ({}),
    } as DOMRect)
    vi.spyOn(attachmentsRow!, 'getBoundingClientRect').mockReturnValue({
      x: 20,
      y: 120,
      top: 120,
      left: 20,
      bottom: 262,
      right: 660,
      width: 640,
      height: 142,
      toJSON: () => ({}),
    } as DOMRect)
    Object.defineProperty(attachmentsRow!, 'scrollLeft', {
      configurable: true,
      value: 4,
    })
    vi.spyOn(pendingSlot!, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    } as DOMRect)

    const textarea = screen.getByTestId('chat-composer-textarea') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '/' } })
    fireEvent.click(screen.getByRole('option', { name: '/appshot Cradle' }))

    expect(measuredContexts).toHaveLength(1)
    expect(measuredContexts[0].animationTarget?.destinationFrame).toEqual({
      x: 584,
      y: 92,
      width: 232,
      height: 140,
    })
  })

  it('does not let delayed Cradle UI inserted text overwrite later user edits', async () => {
    const onSend = vi.fn()
    const deferred = createDeferred<{ insertText: string }>()
    const onSlashCommandAction = vi.fn(() => deferred.promise)
    const cradleGoalCommand: ChatComposerSlashCommand = {
      id: 'cradle:goal',
      name: 'goal',
      description: 'Open goal editor',
      argumentHint: '',
      source: 'cradle',
      action: { kind: 'uiAction', actionId: 'open-goal-editor' },
    }

    render(
      <TooltipProvider>
        <Composer
          onSend={onSend}
          onSlashCommandAction={onSlashCommandAction}
          slashCommands={[cradleGoalCommand]}
        />
      </TooltipProvider>,
    )

    const textarea = screen.getByTestId('chat-composer-textarea') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '/' } })
    fireEvent.click(screen.getByRole('option', { name: '/goal Cradle' }))
    fireEvent.change(textarea, { target: { value: 'manual edit' } })

    deferred.resolve({ insertText: '/goal from callback ' })
    await Promise.resolve()

    await waitFor(() => {
      expect(onSlashCommandAction).toHaveBeenCalledOnce()
    })
    expect(textarea.value).toBe('manual edit')
  })

  it('does not show Cradle UI slash commands without an action handler', () => {
    const onSend = vi.fn()
    const cradleGoalCommand: ChatComposerSlashCommand = {
      id: 'cradle:goal',
      name: 'goal',
      description: 'Open goal editor',
      argumentHint: '',
      source: 'cradle',
      action: { kind: 'uiAction', actionId: 'open-goal-editor' },
    }

    render(
      <TooltipProvider>
        <Composer onSend={onSend} slashCommands={[cradleGoalCommand]} />
      </TooltipProvider>,
    )

    const textarea = screen.getByTestId('chat-composer-textarea') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '/' } })

    expect(screen.queryByRole('option', { name: '/goal Cradle' })).toBeNull()
  })

  it('shows unavailable Cradle UI slash commands without dispatching them', () => {
    const onSend = vi.fn()
    const onSlashCommandAction = vi.fn()
    const cradleAppshotCommand: ChatComposerSlashCommand = {
      id: 'cradle:appshot',
      name: 'appshot',
      description: 'Capture the frontmost app window',
      argumentHint: '',
      source: 'cradle',
      action: { kind: 'uiAction', actionId: 'capture-appshot' },
      availability: {
        enabled: false,
        reason: 'Requires the macOS desktop app.',
      },
    }

    render(
      <TooltipProvider>
        <Composer
          onSend={onSend}
          onSlashCommandAction={onSlashCommandAction}
          slashCommands={[runtimeCompactCommand, cradleAppshotCommand]}
        />
      </TooltipProvider>,
    )

    const textarea = screen.getByTestId('chat-composer-textarea') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '/app' } })
    const option = screen.getByRole('option', { name: '/appshot Cradle' }) as HTMLButtonElement

    expect(option.disabled).toBe(true)
    expect(screen.getAllByText(/Requires the macOS desktop app/).length).toBeGreaterThan(0)

    fireEvent.click(option)

    expect(onSlashCommandAction).not.toHaveBeenCalled()
    expect(textarea.value).toBe('/app')
  })

  it('keeps duplicate command names selectable by source', () => {
    const onSend = vi.fn()
    const onSlashCommandAction = vi.fn()
    const cradleGoalCommand: ChatComposerSlashCommand = {
      id: 'cradle:goal',
      name: 'goal',
      description: 'Open goal editor',
      argumentHint: '',
      source: 'cradle',
      action: { kind: 'uiAction', actionId: 'open-goal-editor' },
    }
    const runtimeGoalCommand: ChatComposerSlashCommand = {
      id: 'runtime:goal:0',
      name: 'goal',
      description: 'Provider goal command',
      argumentHint: '<objective>',
      source: 'runtime',
      action: { kind: 'insertText', text: '/goal ' },
    }

    render(
      <TooltipProvider>
        <Composer
          onSend={onSend}
          onSlashCommandAction={onSlashCommandAction}
          slashCommands={[cradleGoalCommand, runtimeGoalCommand]}
        />
      </TooltipProvider>,
    )

    const textarea = screen.getByTestId('chat-composer-textarea') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '/' } })

    expect(screen.getByRole('option', { name: '/goal Cradle' })).toBeTruthy()
    expect(screen.getByRole('option', { name: '/goal Runtime' })).toBeTruthy()
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(screen.getAllByText('Cradle').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Runtime').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('option', { name: '/goal Runtime' }))

    expect(textarea.value).toBe('/goal ')
  })

  it('replaces slash triggers after leading spaces and keeps argument hints active', () => {
    const onSend = vi.fn()
    render(
      <TooltipProvider>
        <Composer onSend={onSend} slashCommands={[runtimeCompactCommand]} />
      </TooltipProvider>,
    )

    const textarea = screen.getByTestId('chat-composer-textarea') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '  /' } })
    fireEvent.click(screen.getByRole('option', { name: '/compact Runtime' }))

    expect(textarea.value).toBe('  /compact ')
    expect(screen.getByTestId('slash-argument-hint').textContent).toContain('[instructions]')
  })

  it('does not open slash commands after a newline', () => {
    const onSend = vi.fn()
    render(
      <TooltipProvider>
        <Composer onSend={onSend} slashCommands={[runtimeCompactCommand]} />
      </TooltipProvider>,
    )

    const textarea = screen.getByTestId('chat-composer-textarea') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'first line\n/' } })

    expect(screen.queryByRole('option', { name: '/compact Runtime' })).toBeNull()
  })

  it('sends unmatched slash text when the slash panel has no results', async () => {
    const onSend = vi.fn()
    render(
      <TooltipProvider>
        <Composer onSend={onSend} slashCommands={[runtimeCompactCommand]} />
      </TooltipProvider>,
    )

    const textarea = screen.getByTestId('chat-composer-textarea') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '/zz' } })
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: '/compact Runtime' })).toBeNull()
    })

    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onSend).toHaveBeenCalledWith('/zz', [])
  })

  it('does not send bare slash when pressing Enter while commands are visible', () => {
    const onSend = vi.fn()
    render(
      <TooltipProvider>
        <Composer onSend={onSend} slashCommands={[runtimeCompactCommand]} />
      </TooltipProvider>,
    )

    const textarea = screen.getByTestId('chat-composer-textarea') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '/' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onSend).not.toHaveBeenCalled()
  })

  it('sends unmatched slash text immediately when no slash result is visible', () => {
    const onSend = vi.fn()
    render(
      <TooltipProvider>
        <Composer onSend={onSend} slashCommands={[runtimeCompactCommand]} />
      </TooltipProvider>,
    )

    const textarea = screen.getByTestId('chat-composer-textarea') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '/' } })
    fireEvent.change(textarea, { target: { value: '/zz' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onSend).toHaveBeenCalledOnce()
    expect(onSend).toHaveBeenCalledWith('/zz', [])
  })

  it('links the textarea to the visible slash command listbox and active option', () => {
    const onSend = vi.fn()
    render(
      <TooltipProvider>
        <Composer onSend={onSend} slashCommands={[runtimeCompactCommand]} />
      </TooltipProvider>,
    )

    const textarea = screen.getByTestId('chat-composer-textarea')
    fireEvent.change(textarea, { target: { value: '/' } })
    const option = screen.getByRole('option', { name: '/compact Runtime' })

    expect(textarea.getAttribute('aria-expanded')).toBe('true')
    expect(textarea.getAttribute('aria-controls')).toBe('chat-slash-command-listbox')
    expect(textarea.getAttribute('aria-activedescendant')).toBe(option.id)
    expect(screen.getByRole('listbox').id).toBe('chat-slash-command-listbox')
  })
})
