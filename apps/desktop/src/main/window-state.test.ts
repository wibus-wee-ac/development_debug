import { describe, expect, it } from 'vitest'

import { resolveVisibleWindowBounds } from './window-state'

const policy = {
  defaultWidth: 1280,
  defaultHeight: 820,
  minWidth: 800,
  minHeight: 600,
}

describe('resolveVisibleWindowBounds', () => {
  it('keeps a stored window on the display where it is visible', () => {
    const bounds = resolveVisibleWindowBounds(
      { x: 2020, y: 160, width: 1100, height: 760 },
      [
        { x: 0, y: 0, width: 1440, height: 900 },
        { x: 1440, y: 0, width: 2560, height: 1440 },
      ],
      policy,
      { x: 0, y: 0, width: 1440, height: 900 },
    )

    expect(bounds).toEqual({ x: 2020, y: 160, width: 1100, height: 760 })
  })

  it('shrinks oversized stored windows to the selected display work area', () => {
    const bounds = resolveVisibleWindowBounds(
      { x: 100, y: 80, width: 1800, height: 1200 },
      [{ x: 0, y: 0, width: 1440, height: 900 }],
      policy,
      { x: 0, y: 0, width: 1440, height: 900 },
    )

    expect(bounds).toEqual({ x: 0, y: 0, width: 1440, height: 900 })
  })

  it('falls back to the primary display when the previous display is gone', () => {
    const bounds = resolveVisibleWindowBounds(
      { x: 4400, y: 120, width: 1100, height: 760 },
      [{ x: 0, y: 0, width: 1440, height: 900 }],
      policy,
      { x: 0, y: 0, width: 1440, height: 900 },
    )

    expect(bounds).toEqual({ x: 170, y: 70, width: 1100, height: 760 })
  })

  it('uses centered defaults when no stored bounds exist', () => {
    const bounds = resolveVisibleWindowBounds(
      {},
      [{ x: 0, y: 0, width: 1440, height: 900 }],
      policy,
      { x: 0, y: 0, width: 1440, height: 900 },
    )

    expect(bounds).toEqual({ x: 80, y: 40, width: 1280, height: 820 })
  })
})
