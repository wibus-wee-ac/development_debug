import { cleanup, render, screen } from '@testing-library/react'
import { use, useEffect, useMemo } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { LayoutSlotsContext, LayoutSlotsProvider } from './layout-slots-context'

function SlotProbe() {
  const { slots } = use(LayoutSlotsContext)
  return (
    <div
      data-testid="slot-probe"
      data-browser-panel={slots.hasBrowserPanel ? 'true' : 'false'}
      data-bottom-panel={slots.hasPanel ? 'true' : 'false'}
    >
      {slots.panel}
    </div>
  )
}

function RegisterWithEffect({ id, label }: { id: string, label: string }) {
  const { register } = use(LayoutSlotsContext)
  const slots = useMemo(() => ({
    hasBrowserPanel: true,
    hasPanel: true,
    panel: <span>{label}</span>,
  }), [label])

  useEffect(() => {
    register(id, slots)
  }, [id, register, slots])

  return null
}

describe('layoutSlotsProvider', () => {
  afterEach(() => {
    cleanup()
  })

  it('keeps the last known slots while the newly active slot has not registered yet', () => {
    const { rerender } = render(
      <LayoutSlotsProvider activeSlotId="session-a" validSlotIds={['session-a', 'session-b']}>
        <RegisterWithEffect id="session-a" label="Terminal A" />
        <SlotProbe />
      </LayoutSlotsProvider>,
    )

    expect(screen.getByTestId('slot-probe').getAttribute('data-browser-panel')).toBe('true')
    expect(screen.getByTestId('slot-probe').getAttribute('data-bottom-panel')).toBe('true')
    expect(screen.getByText('Terminal A')).not.toBeNull()

    rerender(
      <LayoutSlotsProvider activeSlotId="session-b" validSlotIds={['session-a', 'session-b']}>
        <RegisterWithEffect id="session-a" label="Terminal A" />
        <SlotProbe />
      </LayoutSlotsProvider>,
    )

    expect(screen.getByTestId('slot-probe').getAttribute('data-browser-panel')).toBe('true')
    expect(screen.getByTestId('slot-probe').getAttribute('data-bottom-panel')).toBe('true')
    expect(screen.getByText('Terminal A')).not.toBeNull()

    rerender(
      <LayoutSlotsProvider activeSlotId="session-b" validSlotIds={['session-a', 'session-b']}>
        <RegisterWithEffect id="session-a" label="Terminal A" />
        <RegisterWithEffect id="session-b" label="Terminal B" />
        <SlotProbe />
      </LayoutSlotsProvider>,
    )

    expect(screen.getByText('Terminal B')).not.toBeNull()
  })
})
