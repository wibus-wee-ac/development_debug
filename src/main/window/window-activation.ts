// Input: BrowserWindow-like API plus process env-based display policy
// Output: Deterministic helpers for revealing, focusing, or hiding windows without test-time foreground steals
// Position: Window capability helper shared by root and tear-off window managers

import { resolveWindowRevealAction } from './window-display-policy'

interface WindowRevealLike {
  hide?: () => void
  show: () => void
  showInactive: () => void
}

interface WindowFocusLike extends WindowRevealLike {
  focus: () => void
}

export function revealWindow(win: WindowRevealLike, env: NodeJS.ProcessEnv = process.env): void {
  const action = resolveWindowRevealAction(env)
  if (action === 'hidden') {
    win.hide?.()
    return
  }
  if (action === 'showInactive') {
    win.showInactive()
    return
  }
  win.show()
}

export function revealOrFocusExistingWindow(
  win: WindowFocusLike,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const action = resolveWindowRevealAction(env)
  if (action === 'hidden') {
    win.hide?.()
    return
  }
  if (action === 'showInactive') {
    win.showInactive()
    return
  }
  win.focus()
}
