/**
 * Output: Regression coverage for idempotent layout store updates.
 * Input: Repeated browser panel visibility and ratio setter calls.
 * Position: Store-owned tests for layout state subscription behavior.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useLayoutStore } from './layout'

describe('layout store updates', () => {
  beforeEach(() => {
    useLayoutStore.setState({
      browserPanelOpen: true,
      browserPanelRatio: 0.4,
      bottomPanelOpen: true,
    })
  })

  it('does not notify subscribers when setting the browser panel to its current state', () => {
    const listener = vi.fn()
    const unsubscribe = useLayoutStore.subscribe(listener)

    useLayoutStore.getState().setBrowserPanelOpen(true)

    unsubscribe()
    expect(listener).not.toHaveBeenCalled()
  })

  it('does not notify subscribers when the clamped browser panel ratio is unchanged', () => {
    const listener = vi.fn()
    const unsubscribe = useLayoutStore.subscribe(listener)

    useLayoutStore.getState().setBrowserPanelRatio(0.4)

    unsubscribe()
    expect(listener).not.toHaveBeenCalled()
  })
})
