// Output: Smooth animated cursor that follows real product targets for onboarding previews.
// Input: Target-backed waypoints and an active flag.
// Position: Presentation-only; used by onboarding right panel overlay.

import { animate, m, useMotionValue, useSpring, useTransform } from 'motion/react'
import { useEffect, useRef } from 'react'

export interface CursorWaypoint {
  /** Optional fallback percentage (0-100) from the left edge of the cursor layer. */
  x?: number
  /** Optional fallback percentage (0-100) from the top edge of the cursor layer. */
  y?: number
  /** data-onboarding-target or data-testid value inside the cursor layer parent. */
  target?: string
  /** Horizontal target anchor, from 0 (left) to 1 (right). */
  anchorX?: number
  /** Vertical target anchor, from 0 (top) to 1 (bottom). */
  anchorY?: number
  /** Pixel adjustment after target anchoring. */
  offsetX?: number
  /** Pixel adjustment after target anchoring. */
  offsetY?: number
  /** How long to pause at this waypoint (ms) */
  dwell?: number
  /** Optional semantic action fired after the synthetic click animation */
  action?: string
}

interface AnimatedCursorLayerProps {
  waypoints: CursorWaypoint[]
  active?: boolean
  startDelay?: number
  onLoopStart?: () => void
  onWaypointClick?: (waypoint: CursorWaypoint, index: number) => void
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function findWaypointTarget(layer: HTMLElement, target: string): HTMLElement | null {
  const root = layer.closest('[data-onboarding-cursor-root]') ?? layer.parentElement ?? layer
  const onboardingTarget = root.querySelector(`[data-onboarding-target="${target}"]`)
  if (onboardingTarget instanceof HTMLElement) {
    return onboardingTarget
  }
  const testTarget = root.querySelector(`[data-testid="${target}"]`)
  if (testTarget instanceof HTMLElement) {
    return testTarget
  }
  return null
}

function readWaypointPosition(layer: HTMLElement, waypoint: CursorWaypoint): { x: number, y: number } {
  const layerRect = layer.getBoundingClientRect()
  const fallbackX = ((waypoint.x ?? 50) / 100) * layerRect.width
  const fallbackY = ((waypoint.y ?? 50) / 100) * layerRect.height

  if (!waypoint.target) {
    return { x: fallbackX, y: fallbackY }
  }

  const target = findWaypointTarget(layer, waypoint.target)
  if (!target) {
    return { x: fallbackX, y: fallbackY }
  }

  const targetRect = target.getBoundingClientRect()
  if (targetRect.width === 0 && targetRect.height === 0) {
    return { x: fallbackX, y: fallbackY }
  }

  const anchorX = waypoint.anchorX ?? 0.5
  const anchorY = waypoint.anchorY ?? 0.5

  return {
    x: targetRect.left - layerRect.left + targetRect.width * anchorX + (waypoint.offsetX ?? 0),
    y: targetRect.top - layerRect.top + targetRect.height * anchorY + (waypoint.offsetY ?? 0),
  }
}

/**
 * Renders an absolutely-positioned cursor + spotlight that animate through waypoints.
 * The parent must be `position: relative` (or `absolute`) with explicit dimensions.
 * Target-backed waypoints are measured from live DOM rects inside the parent.
 */
export function AnimatedCursorLayer({
  waypoints,
  active = true,
  startDelay = 600,
  onLoopStart,
  onWaypointClick,
}: AnimatedCursorLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null)
  const xPx = useMotionValue(0)
  const yPx = useMotionValue(0)
  const cursorScale = useMotionValue(1)
  const rippleOpacity = useMotionValue(0)
  const rippleScale = useMotionValue(0.5)

  const xSpring = useSpring(xPx, { stiffness: 600, damping: 40 })
  const ySpring = useSpring(yPx, { stiffness: 600, damping: 40 })
  const spotlightX = useSpring(xPx, { stiffness: 240, damping: 36 })
  const spotlightY = useSpring(yPx, { stiffness: 240, damping: 36 })

  const leftCss = useTransform(xSpring, v => `${v}px`)
  const topCss = useTransform(ySpring, v => `${v}px`)
  const spotlightLeftCss = useTransform(spotlightX, v => `${v}px`)
  const spotlightTopCss = useTransform(spotlightY, v => `${v}px`)

  useEffect(() => {
    const layerElement = layerRef.current
    if (!active || waypoints.length === 0 || !layerElement) return
    const measuredLayer: HTMLElement = layerElement

    let stopped = false

    async function triggerClick() {
      // Cursor shrinks like a real click
      animate(cursorScale, 0.82, { duration: 0.08, ease: 'easeIn' })
      // Ripple appears and expands
      rippleOpacity.set(0.6)
      animate(rippleScale, 1.8, { duration: 0.38, ease: 'easeOut' })
      await sleep(80)
      animate(cursorScale, 1, { duration: 0.14, ease: 'easeOut' })
      await sleep(200)
      animate(rippleOpacity, 0, { duration: 0.18 })
      rippleScale.set(0.5)
    }

    async function run() {
      const first = waypoints[0]
      if (first) {
        const point = readWaypointPosition(measuredLayer, first)
        xPx.set(point.x)
        yPx.set(point.y)
      }

      await sleep(startDelay)

      while (!stopped) {
        onLoopStart?.()
        await sleep(180)
        for (let index = 0; index < waypoints.length; index += 1) {
          const wp = waypoints[index]!
          if (stopped) return
          const point = readWaypointPosition(measuredLayer, wp)
          xPx.set(point.x)
          yPx.set(point.y)

          const dwell = wp.dwell ?? 900
          // Wait for cursor to mostly arrive (spring settle ~400ms) then click
          await sleep(Math.min(440, dwell * 0.48))
          if (!stopped) {
            await triggerClick()
            onWaypointClick?.(wp, index)
          }
          await sleep(Math.max(0, dwell - 440))
        }
        await sleep(1600)
      }
    }

    void run()

    return () => { stopped = true }
  }, [active, startDelay, waypoints, xPx, yPx, cursorScale, rippleOpacity, rippleScale, onLoopStart, onWaypointClick])

  return (
    <m.div
      ref={layerRef}
      className="pointer-events-none absolute inset-0 z-50"
      initial={{ opacity: 0 }}
      animate={{ opacity: active ? 1 : 0 }}
      transition={{ duration: 0.4 }}
    >
      {/* Spotlight glow — lags slightly behind cursor for a natural feel */}
      <m.div
        className="absolute -translate-x-1/2 -translate-y-1/2 size-24 rounded-full bg-foreground/8 blur-md"
        style={{
          left: spotlightLeftCss,
          top: spotlightTopCss,
        }}
      />

      {/* Click ripple ring */}
      <m.div
        className="absolute -translate-x-1/2 -translate-y-1/2 size-8 rounded-full border border-white/50"
        style={{
          left: leftCss,
          top: topCss,
          opacity: rippleOpacity,
          scale: rippleScale,
        }}
      />

      {/* Cursor SVG */}
      <m.div
        className="absolute"
        style={{
          left: leftCss,
          top: topCss,
          scale: cursorScale,
          transformOrigin: '3px 2px',
        }}
      >
        <CursorSvg />
      </m.div>
    </m.div>
  )
}

function CursorSvg() {
  return (
    <svg
      width="18"
      height="20"
      viewBox="0 0 18 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ filter: 'drop-shadow(0 1.5px 4px rgba(0,0,0,0.5))' }}
    >
      <path
        d="M3 1.5L3 15.5L6.5 12L9 17.5L11.5 16.5L9 11L14 11L3 1.5Z"
        fill="white"
        stroke="#111111"
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
