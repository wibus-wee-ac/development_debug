import { describe, expect, it } from 'vitest'

import { shouldCaptureIpcStack } from './ipc-options'

describe('shouldCaptureIpcStack', () => {
  it('captures stacks only for the dedicated devtool route in development', () => {
    expect(shouldCaptureIpcStack({ isDev: true, hash: '#/devtool' })).toBe(true)
    expect(shouldCaptureIpcStack({ isDev: true, hash: '#/chat/session-1' })).toBe(false)
    expect(shouldCaptureIpcStack({ isDev: false, hash: '#/devtool' })).toBe(false)
  })
})