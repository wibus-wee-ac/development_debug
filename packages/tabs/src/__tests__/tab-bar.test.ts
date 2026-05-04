// Input: Vitest assertions and TabBar tear-off helper functions
// Output: Regression tests for drag activator coordinate handling in TabBar
// Position: Unit tests protecting tab tear-off behavior from false positives on plain clicks

import { describe, expect, it } from 'vitest'

import { getEventScreenCoordinates, isPointerOutsideWindow } from '../components/tab-bar'

describe('TabBar tear-off helpers', () => {
  it('reads screen coordinates from pointer-like events', () => {
    const event = {
      screenX: 320,
      screenY: 180,
    } as Event

    expect(getEventScreenCoordinates(event)).toEqual({ screenX: 320, screenY: 180 })
  })

  it('returns null when an event has no screen coordinates', () => {
    expect(getEventScreenCoordinates({} as Event)).toBeNull()
  })

  it('does not tear off when pointer coordinates are missing', () => {
    expect(isPointerOutsideWindow(null, {
      screenX: 100,
      screenY: 100,
      outerWidth: 800,
      outerHeight: 600,
    })).toBe(false)
  })

  it('reports pointers outside the current window bounds', () => {
    const windowBounds = {
      screenX: 100,
      screenY: 100,
      outerWidth: 800,
      outerHeight: 600,
    }

    expect(isPointerOutsideWindow({ screenX: 250, screenY: 250 }, windowBounds)).toBe(false)
    expect(isPointerOutsideWindow({ screenX: 50, screenY: 250 }, windowBounds)).toBe(true)
    expect(isPointerOutsideWindow({ screenX: 250, screenY: 750 }, windowBounds)).toBe(true)
  })
})
