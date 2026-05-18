// @vitest-environment jsdom
//
// Input: React Testing Library, LayoutSlotsProvider, LayoutSlotsContext
// Output: Regression coverage for active layout slot projection
// Position: Layout component test guarding shell slot ownership when tabs change

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { useContext, useEffect } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import type { LayoutSlots } from './layout-slots-context'
import { LayoutSlotsContext, LayoutSlotsProvider } from './layout-slots-context'

afterEach(() => {
  cleanup()
})

function RegisteredSlot({ id, slots }: { id: string, slots: LayoutSlots }) {
  const { register, unregister } = useContext(LayoutSlotsContext)

  useEffect(() => {
    register(id, slots)
    return () => unregister(id)
  }, [id, register, slots, unregister])

  return null
}

function ActiveSlotProbe() {
  const { slots } = useContext(LayoutSlotsContext)

  return (
    <div>
      <span data-testid="has-panel">{String(Boolean(slots.hasPanel))}</span>
      {slots.panel}
    </div>
  )
}

describe('LayoutSlotsProvider', () => {
  it('returns empty slots when activeSlotId is null', async () => {
    const chatSlots = {
      hasPanel: true,
      panel: <div data-testid="chat-panel">Chat panel</div>,
    }

    const { rerender } = render(
      <LayoutSlotsProvider activeSlotId="chat-session-1">
        <RegisteredSlot id="chat-session-1" slots={chatSlots} />
        <ActiveSlotProbe />
      </LayoutSlotsProvider>,
    )

    expect(await screen.findByTestId('chat-panel')).not.toBeNull()
    expect(screen.getByTestId('has-panel').textContent).toBe('true')

    rerender(
      <LayoutSlotsProvider activeSlotId={null}>
        <RegisteredSlot id="chat-session-1" slots={chatSlots} />
        <ActiveSlotProbe />
      </LayoutSlotsProvider>,
    )

    await waitFor(() => {
      expect(screen.queryByTestId('chat-panel')).toBeNull()
    })
    expect(screen.getByTestId('has-panel').textContent).toBe('false')
  })

  it('does not fall back to a stale registered slot for an unregistered activeSlotId', async () => {
    const chatSlots = {
      hasPanel: true,
      panel: <div data-testid="chat-panel">Chat panel</div>,
    }

    const { rerender } = render(
      <LayoutSlotsProvider activeSlotId="chat-session-1">
        <RegisteredSlot id="chat-session-1" slots={chatSlots} />
        <ActiveSlotProbe />
      </LayoutSlotsProvider>,
    )

    expect(await screen.findByTestId('chat-panel')).not.toBeNull()

    rerender(
      <LayoutSlotsProvider activeSlotId="missing-session">
        <RegisteredSlot id="chat-session-1" slots={chatSlots} />
        <ActiveSlotProbe />
      </LayoutSlotsProvider>,
    )

    await waitFor(() => {
      expect(screen.queryByTestId('chat-panel')).toBeNull()
    })
    expect(screen.getByTestId('has-panel').textContent).toBe('false')
  })
})
