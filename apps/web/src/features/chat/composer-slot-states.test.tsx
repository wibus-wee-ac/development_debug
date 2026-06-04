/**
 * Regression coverage for composer-adjacent runtime slot dispatch.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '~/components/ui/tooltip'

import type { ChatRuntimeUiSlot, ChatRuntimeUsageUiSlotState } from './chat-capabilities'
import { ComposerSlotStates } from './composer-slot-states'

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
})
