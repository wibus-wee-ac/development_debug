// Input: process environment and display lifecycle signals from Electron BrowserWindow owners
// Output: Window display policy helpers for whether windows should reveal, activate, or stay hidden
// Position: Window capability policy module consumed by main and tear-off window creation flows

export type WindowRevealAction = 'show' | 'showInactive' | 'hidden'

export function shouldHideWindows(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CRADLE_E2E_HIDE_WINDOWS === '1'
}

/**
 * Return true when running in an E2E-friendly mode where windows should not steal
 * foreground focus from the currently active application.
 */
export function shouldSuppressWindowActivation(env: NodeJS.ProcessEnv = process.env): boolean {
  if (shouldHideWindows(env)) {
    return true
  }
  if (env.CRADLE_E2E_NO_ACTIVATE === '1') {
    return true
  }
  if (env.NODE_ENV === 'test') {
    return true
  }
  if (env.CI === '1' || env.CI === 'true') {
    return true
  }
  return false
}

export function resolveWindowRevealAction(
  env: NodeJS.ProcessEnv = process.env,
): WindowRevealAction {
  if (shouldHideWindows(env)) {
    return 'hidden'
  }
  return shouldSuppressWindowActivation(env) ? 'showInactive' : 'show'
}
