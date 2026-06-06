/**
 * Regression coverage for composer-adjacent runtime slot dispatch.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '~/components/ui/tooltip'

import type { ChatRuntimeUiSlot, ChatRuntimeUsageUiSlotState } from './chat-capabilities'
import { ComposerSlotStates } from './composer-slot-states'

vi.mock('@cradle/streamdown', () => ({
  Streamdown: ({ content }: { content: string }) => <div>{content}</div>,
}))

const USAGE_SLOT: ChatRuntimeUiSlot = {
  id: 'codex:usage',
  name: 'usage',
  label: 'Usage',
  description: 'Show current usage and rate limit state.',
  argumentHint: '',
  iconKey: 'usage',
  commandText: '/usage ',
  surfaces: ['slashCommand', 'runtimePanel'],
}

const LEGACY_COMPOSER_USAGE_SLOT: ChatRuntimeUiSlot = {
  ...USAGE_SLOT,
  surfaces: ['composerState', 'runtimePanel'],
}

const USAGE_STATE: ChatRuntimeUsageUiSlotState = {
  kind: 'usage',
  slotId: 'codex:usage',
  threadId: 'thread-1',
  limitName: null,
  usedPercent: null,
  primaryWindowDurationMins: null,
  primaryResetsAt: null,
  secondaryUsedPercent: null,
  secondaryWindowDurationMins: null,
  secondaryResetsAt: null,
  creditsBalance: null,
  hasCredits: false,
  rateLimitReachedType: null,
  planType: null,
  updatedAt: 1,
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderSlotStates(usage: { open: boolean, onDismiss: () => void }) {
  return render(
    <TooltipProvider>
      <ComposerSlotStates
        slots={[USAGE_SLOT]}
        states={[USAGE_STATE]}
        usage={usage}
      />
    </TooltipProvider>,
  )
}

describe('composer slot states', () => {
  it('renders slash usage only while the usage panel is open', () => {
    const onDismiss = vi.fn()
    const { rerender } = render(
      <TooltipProvider>
        <ComposerSlotStates
          slots={[USAGE_SLOT]}
          states={[USAGE_STATE]}
          usage={{ open: false, onDismiss }}
        />
      </TooltipProvider>,
    )

    expect(screen.queryByText('rate limit unavailable')).toBeNull()

    rerender(
      <TooltipProvider>
        <ComposerSlotStates
          slots={[USAGE_SLOT]}
          states={[USAGE_STATE]}
          usage={{ open: true, onDismiss }}
        />
      </TooltipProvider>,
    )

    expect(screen.getByText('rate limit unavailable')).toBeTruthy()
  })

  it('does not render usage persistently from older composerState capabilities', () => {
    render(
      <TooltipProvider>
        <ComposerSlotStates
          slots={[LEGACY_COMPOSER_USAGE_SLOT]}
          states={[USAGE_STATE]}
          usage={{ open: false, onDismiss: vi.fn() }}
        />
      </TooltipProvider>,
    )

    expect(screen.queryByText('rate limit unavailable')).toBeNull()
  })

  it('dismisses the slash-triggered usage panel from its close action', () => {
    const onDismiss = vi.fn()
    renderSlotStates({ open: true, onDismiss })

    fireEvent.click(screen.getByRole('button', { name: 'Close usage' }))

    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('renders quick questions as a composer slot instead of an overlay dialog', async () => {
    const onDismiss = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"type":"text-delta","id":"text-1","delta":"Short answer"}\n\n'))
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
          controller.close()
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )))

    render(
      <TooltipProvider>
        <ComposerSlotStates
          slots={[]}
          states={[]}
          quickQuestion={{
            open: true,
            question: 'What is BTW?',
            sessionId: 'session-1',
            apiBaseUrl: 'http://localhost:21423',
            onDismiss,
          }}
        />
      </TooltipProvider>,
    )

    const slot = screen.getByTestId('quick-question-slot')
    expect(slot.getAttribute('data-chat-runtime-slot-state')).toBe('quick-question')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('What is BTW?')).toBeTruthy()

    await waitFor(() => {
      expect(screen.getByText('Short answer')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Close quick question' }))
    expect(onDismiss).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:21423/chat/sessions/session-1/quick-question',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ question: 'What is BTW?' }),
      }),
    )
  })
})
