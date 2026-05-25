/*
 * Verifies native service Appshot orchestration helpers.
 */
import { describe, expect, it } from 'vitest'

import type { MacAppshotFrontmostContext } from './mac-bridge-protocol'
import { createParityAppshotAnimationTarget } from './native-appshot-target'

function frontmostContext(): MacAppshotFrontmostContext {
  return {
    window: {
      windowId: 42,
      appName: 'Safari',
      bundleId: 'com.apple.Safari',
      processId: 123,
      title: 'Example',
      bounds: { x: 10, y: 20, width: 800, height: 600 },
    },
    bundleIdentifier: 'com.apple.Safari',
    animationTarget: {
      codexDisplay: {
        id: 1,
        scaleFactor: 2,
        bounds: { x: 0, y: 0, width: 1440, height: 900 },
        workArea: { x: 0, y: 0, width: 1440, height: 875 },
      },
      destinationBackgroundColor: '#ffffff',
      destinationCornerRadius: 12,
      destinationFrame: { x: 10, y: 20, width: 800, height: 600 },
      destinationPrimaryTextColor: '#000000',
      transitionSnapshotScale: 2,
    },
  }
}

describe('createParityAppshotAnimationTarget', () => {
  it('uses a composer-like destination instead of the frontmost window fallback', () => {
    const context = frontmostContext()
    const target = createParityAppshotAnimationTarget(context)

    expect(target.codexDisplay).toEqual(context.animationTarget.codexDisplay)
    expect(target.destinationFrame).not.toEqual(context.animationTarget.destinationFrame)
    expect(target.destinationFrame).toEqual({
      x: 604,
      y: 699,
      width: 232,
      height: 140,
    })
    expect(target.destinationCornerRadius).toBe(0)
    expect(target.transitionSnapshotScale).toBe(2)
  })
})
