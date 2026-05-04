// Input: window display policy helpers and explicit env fixtures
// Output: Regression tests for E2E/non-interactive foreground activation policy decisions
// Position: Unit tests guarding main-process window activation behavior contract

import { describe, expect, it } from 'vitest'

import { resolveWindowRevealAction, shouldSuppressWindowActivation } from '../window-display-policy'

describe('windowDisplayPolicy', () => {
  it('suppresses activation when NODE_ENV=test', () => {
    expect(shouldSuppressWindowActivation({ NODE_ENV: 'test' })).toBe(true)
  })

  it('suppresses activation when explicit E2E flag is enabled', () => {
    expect(shouldSuppressWindowActivation({ CRADLE_E2E_NO_ACTIVATE: '1', NODE_ENV: 'production' })).toBe(true)
  })

  it('does not suppress activation in regular interactive runs', () => {
    expect(shouldSuppressWindowActivation({ NODE_ENV: 'production', CI: '0' })).toBe(false)
  })

  it('reveals by showInactive in test/e2e runs', () => {
    expect(resolveWindowRevealAction({ NODE_ENV: 'test' })).toBe('showInactive')
  })

  it('reveals by show in normal interactive runs', () => {
    expect(resolveWindowRevealAction({ NODE_ENV: 'production' })).toBe('show')
  })
})
