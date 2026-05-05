// Input: window activation helper functions and BrowserWindow-like method spies
// Output: Unit tests proving focus-safe reveal behavior for e2e/test runs
// Position: Main-process regression tests for foreground activation suppression logic

import { describe, expect, it, vi } from 'vitest'

import { revealOrFocusExistingWindow, revealWindow } from '../window-activation'

function createWindowDouble() {
  return {
    hide: vi.fn(),
    show: vi.fn(),
    showInactive: vi.fn(),
    focus: vi.fn(),
  }
}

describe('windowActivation', () => {
  it('revealWindow keeps the window hidden in explicit E2E hidden mode', () => {
    const win = createWindowDouble()
    revealWindow(win, { CRADLE_E2E_HIDE_WINDOWS: '1' })
    expect(win.hide).toHaveBeenCalledTimes(1)
    expect(win.showInactive).not.toHaveBeenCalled()
    expect(win.show).not.toHaveBeenCalled()
  })

  it('revealWindow uses showInactive in test mode', () => {
    const win = createWindowDouble()
    revealWindow(win, { NODE_ENV: 'test' })
    expect(win.showInactive).toHaveBeenCalledTimes(1)
    expect(win.hide).not.toHaveBeenCalled()
    expect(win.show).not.toHaveBeenCalled()
  })

  it('revealWindow uses show in interactive mode', () => {
    const win = createWindowDouble()
    revealWindow(win, { NODE_ENV: 'production' })
    expect(win.show).toHaveBeenCalledTimes(1)
    expect(win.hide).not.toHaveBeenCalled()
    expect(win.showInactive).not.toHaveBeenCalled()
  })

  it('revealOrFocusExistingWindow keeps existing windows hidden in E2E hidden mode', () => {
    const win = createWindowDouble()
    revealOrFocusExistingWindow(win, { CRADLE_E2E_HIDE_WINDOWS: '1' })
    expect(win.hide).toHaveBeenCalledTimes(1)
    expect(win.showInactive).not.toHaveBeenCalled()
    expect(win.focus).not.toHaveBeenCalled()
  })

  it('revealOrFocusExistingWindow avoids focus in e2e mode', () => {
    const win = createWindowDouble()
    revealOrFocusExistingWindow(win, { CRADLE_E2E_NO_ACTIVATE: '1' })
    expect(win.showInactive).toHaveBeenCalledTimes(1)
    expect(win.hide).not.toHaveBeenCalled()
    expect(win.focus).not.toHaveBeenCalled()
  })
})
