// Output: Smooth animated cursor that follows waypoint sequences for onboarding previews.
// Input: List of { x%, y% } waypoints and an active flag.
// Position: Presentation-only; used by onboarding right panel overlay.

import { animate, m, useMotionValue, useSpring, useTransform } from 'motion/react'
import { useEffect } from 'react'

export interface CursorWaypoint {
  /** Percentage (0–100) from left edge of the container */
  x: number
  /** Percentage (0–100) from top edge of the container */
  y: number
  /** How long to pause at this waypoint (ms) */
  dwell?: number
}

interface AnimatedCursorLayerProps {
  waypoints: CursorWaypoint[]
  active?: boolean
  startDelay?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Renders an absolutely-positioned cursor + spotlight that animate through waypoints.
 * The parent must be `position: relative` (or `absolute`) with explicit dimensions.
 * Waypoints are percentages of the parent container, not the viewport.
 */
export function AnimatedCursorLayer({
  waypoints,
  active = true,
  startDelay = 600,
}: AnimatedCursorLayerProps) {
  const xPct = useMotionValue(waypoints[0]?.x ?? 50)
  const yPct = useMotionValue(waypoints[0]?.y ?? 50)
  const cursorScale = useMotionValue(1)
  const rippleOpacity = useMotionValue(0)
  const rippleScale = useMotionValue(0.5)

  const xSpring = useSpring(xPct, { stiffness: 90, damping: 18, mass: 0.5 })
  const ySpring = useSpring(yPct, { stiffness: 90, damping: 18, mass: 0.5 })
  const spotlightX = useSpring(xPct, { stiffness: 60, damping: 20, mass: 0.8 })
  const spotlightY = useSpring(yPct, { stiffness: 60, damping: 20, mass: 0.8 })

  const leftCss = useTransform(xSpring, v => `${v}%`)
  const topCss = useTransform(ySpring, v => `${v}%`)
  const spotlightLeftCss = useTransform(spotlightX, v => `${v}%`)
  const spotlightTopCss = useTransform(spotlightY, v => `${v}%`)

  useEffect(() => {
    if (!active || waypoints.length === 0) return

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
      await sleep(startDelay)

      while (!stopped) {
        for (const wp of waypoints) {
          if (stopped) return
          xPct.set(wp.x)
          yPct.set(wp.y)

          const dwell = wp.dwell ?? 900
          // Wait for cursor to mostly arrive (spring settle ~400ms) then click
          await sleep(Math.min(440, dwell * 0.48))
          if (!stopped) await triggerClick()
          await sleep(Math.max(0, dwell - 440))
        }
        await sleep(1600)
      }
    }

    void run()

    return () => { stopped = true }
  }, [active, startDelay, waypoints, xPct, yPct, cursorScale, rippleOpacity, rippleScale])

  return (
    <m.div
      className="pointer-events-none absolute inset-0 z-50"
      initial={{ opacity: 0 }}
      animate={{ opacity: active ? 1 : 0 }}
      transition={{ duration: 0.4 }}
    >
      {/* Spotlight glow — lags slightly behind cursor for a natural feel */}
      <m.div
        className="absolute -translate-x-1/2 -translate-y-1/2 size-32 rounded-full"
        style={{
          left: spotlightLeftCss,
          top: spotlightTopCss,
          background:
            'radial-gradient(circle, rgba(255,255,255,0.14) 0%, transparent 68%)',
          filter: 'blur(6px)',
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
