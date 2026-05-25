/*
 * Output: Pure Appshot animation-target helpers for desktop-owned native capture orchestration.
 * Input: Mac Bridge frontmost Appshot context.
 * Position: Electron main owns strategy-level Appshot target synthesis outside renderer UI context.
 */

import type {
  MacAppshotAnimationTarget,
  MacAppshotFrontmostContext,
} from './mac-bridge-protocol'

export function createParityAppshotAnimationTarget(context: MacAppshotFrontmostContext): MacAppshotAnimationTarget {
  const workArea = context.animationTarget.codexDisplay.workArea
  const scaleFactor = context.animationTarget.codexDisplay.scaleFactor
  const geometryScale = context.animationTarget.coordinateSpace === 'pixels' || context.animationTarget.coordinateSpace === 'viewportPixels'
    ? scaleFactor
    : 1
  const width = 232 * geometryScale
  const height = 140 * geometryScale
  return {
    ...context.animationTarget,
    destinationBackgroundColor: '#ffffff',
    destinationCornerRadius: 0,
    destinationFrame: {
      x: workArea.x + (workArea.width - width) / 2,
      y: workArea.y + workArea.height - height - 36,
      width,
      height,
    },
    destinationPrimaryTextColor: '#111111',
    transitionSnapshotScale: scaleFactor,
  }
}
