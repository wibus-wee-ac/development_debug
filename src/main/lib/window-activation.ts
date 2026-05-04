// Input: BrowserWindow-like API plus process env-based display policy
// Output: Deterministic helpers for revealing/focusing windows without unintended foreground steals in tests
// Position: Main-process window lifecycle utility shared by root and tear-off window managers

import { resolveWindowRevealAction, shouldSuppressWindowActivation } from './window-display-policy'

interface WindowRevealLike {
  show: () => void
  showInactive: () => void
}

interface WindowFocusLike extends WindowRevealLike {
  focus: () => void
}

export function revealWindow(win: WindowRevealLike, env: NodeJS.ProcessEnv = process.env): void {
  if (resolveWindowRevealAction(env) === 'showInactive') {
    win.showInactive()
    return
  }
  win.show()
}

export function revealOrFocusExistingWindow(
  win: WindowFocusLike,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (shouldSuppressWindowActivation(env)) {
    win.showInactive()
    return
  }
  win.focus()
}
