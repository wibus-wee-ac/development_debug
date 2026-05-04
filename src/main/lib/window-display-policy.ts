// Input: process environment and display lifecycle signals from Electron BrowserWindow owners
// Output: Window display policy helpers for whether windows should activate foreground in current runtime
// Position: Main-process shared policy module consumed by main/tear-off window creation flows

/**
 * Return true when running in an E2E-friendly mode where windows should not steal
 * foreground focus from the currently active application.
 */
export function shouldSuppressWindowActivation(env: NodeJS.ProcessEnv = process.env): boolean {
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

export function resolveWindowRevealAction(env: NodeJS.ProcessEnv = process.env): 'show' | 'showInactive' {
  return shouldSuppressWindowActivation(env) ? 'showInactive' : 'show'
}
