// Input: DOM theme classes, devicePixelRatio
// Output: HalftoneArt, FlowField, GridWave, SineRipple, RainDots, ConnectionMesh, SpotlightGradient, DitheredGradientDecoration
// Position: Universal UI canvas art primitives for decorative panel backgrounds

import { cn } from '~/lib/cn'
import { useCallback, useEffect, useRef } from 'react'

// ── Shared utilities ───────────────────────────────────────────────────────────

function getDrawColor(): [number, number, number] {
  const hasDark = document.documentElement.classList.contains('dark')
  const hasLight = document.documentElement.classList.contains('light')
  const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const isDark = hasDark || (!hasLight && sysDark)
  return isDark ? [210, 210, 210] : [60, 60, 60]
}

function syncCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): { W: number, H: number } {
  const dpr = window.devicePixelRatio || 1
  const W = canvas.offsetWidth
  const H = canvas.offsetHeight
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { W, H }
}

// ── Shared mouse tracking hook ──────────────────────────────────────────────────

function useCanvasMouse(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  active: boolean,
) {
  const mouseRef = useRef({ x: -9999, y: -9999 })

  useEffect(() => {
    if (!active) return
    const canvas = canvasRef.current
    if (!canvas) return

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }
    const onLeave = () => {
      mouseRef.current = { x: -9999, y: -9999 }
    }

    canvas.addEventListener('mousemove', onMove)
    canvas.addEventListener('mouseleave', onLeave)
    return () => {
      canvas.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('mouseleave', onLeave)
    }
  }, [active])

  return mouseRef
}

// ── 1. HalftoneArt ─────────────────────────────────────────────────────────────
// Radial sine wave breathing dot grid. Dots grow and shrink with a wave that
// travels outward from the center. Classic dither / halftone print aesthetic.

const HALFTONE_GRID = 18
const HALFTONE_MAX_R = 5.5

export function HalftoneArt({ className, interactive = false }: { className?: string; interactive?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mouseRef = useCanvasMouse(canvasRef, interactive)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }

    let animId: number
    let t = 0

    const draw = () => {
      const { W, H } = syncCanvas(canvas, ctx)
      ctx.clearRect(0, 0, W, H)
      const [cr, cg, cb] = getDrawColor()

      const cols = Math.ceil(W / HALFTONE_GRID) + 1
      const rows = Math.ceil(H / HALFTONE_GRID) + 1

      for (let row = 0; row <= rows; row++) {
        for (let col = 0; col <= cols; col++) {
          const x = col * HALFTONE_GRID
          const y = row * HALFTONE_GRID
          const dx = x / W - 0.5
          const dy = y / H - 0.5
          const dist = Math.sqrt(dx * dx + dy * dy)
          const wave = Math.sin(t - dist * 10 + col * 0.25 + row * 0.18)
          let radius = Math.max(0.5, HALFTONE_MAX_R * (wave * 0.5 + 0.5))
          let alpha = 0.10 + (wave * 0.5 + 0.5) * 0.28

          // Mouse spotlight: dots near cursor grow larger and brighter
          if (interactive) {
            const mdx = (x - mouseRef.current.x) / 130
            const mdy = (y - mouseRef.current.y) / 130
            const mdist = Math.sqrt(mdx * mdx + mdy * mdy)
            const spot = Math.max(0, 1 - mdist)
            radius *= 1 + spot * 0.7
            alpha = Math.min(1, alpha + spot * 0.18)
          }

          ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`
          ctx.beginPath()
          ctx.arc(x, y, radius, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      t += 0.013
      animId = requestAnimationFrame(draw)
    }

    draw()
    return () => cancelAnimationFrame(animId)
  }, [interactive])

  return (
    <div className={cn('relative size-full', className)}>
      <canvas ref={canvasRef} aria-hidden className={cn('absolute inset-0 block size-full', interactive && 'pointer-events-auto')} />
    </div>
  )
}

// ── 2. FlowField ───────────────────────────────────────────────────────────────
// Particles drifting along a smooth vector field derived from sine-cosine noise.
// Each particle follows a locally computed angle — gives organic, fluid motion.

const FLOW_PARTICLE_COUNT = 180

export function FlowField({ className, interactive = false }: { className?: string; interactive?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mouseRef = useCanvasMouse(canvasRef, interactive)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }

    type P = { x: number, y: number }
    let particles: P[] = []
    let W = 0
    let H = 0
    let animId: number
    let t = 0

    const init = (w: number, h: number) => {
      W = w
      H = h
      particles = Array.from({ length: FLOW_PARTICLE_COUNT }).map(() => ({
        x: Math.random() * w,
        y: Math.random() * h,
      }))
    }

    const draw = () => {
      const dims = syncCanvas(canvas, ctx)
      ctx.clearRect(0, 0, dims.W, dims.H)

      if (W !== dims.W || H !== dims.H) {
        init(dims.W, dims.H)
      }

      const [cr, cg, cb] = getDrawColor()

      for (const p of particles) {
        // Two independent sine waves for x/y velocity — clean Lissajous-like flow
        const vx = Math.sin(p.x * 0.018 + t * 0.6) * 0.75
        const vy = Math.sin(p.y * 0.014 - t * 0.45) * 0.75

        // Mouse repulsion: particles gently pushed away from cursor
        if (interactive) {
          const mx = mouseRef.current.x
          const my = mouseRef.current.y
          const pdx = p.x - mx
          const pdy = p.y - my
          const pdist = Math.sqrt(pdx * pdx + pdy * pdy)
          const influence = Math.max(0, 1 - pdist / 150)
          p.x += (pdx / (pdist + 0.001)) * influence * 1.0
          p.y += (pdy / (pdist + 0.001)) * influence * 1.0
        }

        p.x += vx
        p.y += vy
        if (p.x < 0) {
          p.x = W
        }
        if (p.x > W) {
          p.x = 0
        }
        if (p.y < 0) {
          p.y = H
        }
        if (p.y > H) {
          p.y = 0
        }
        ctx.fillStyle = `rgba(${cr},${cg},${cb},0.4)`
        ctx.beginPath()
        ctx.arc(p.x, p.y, 2.0, 0, Math.PI * 2)
        ctx.fill()
      }

      t += 0.014
      animId = requestAnimationFrame(draw)
    }

    draw()
    return () => cancelAnimationFrame(animId)
  }, [interactive])

  return (
    <div className={cn('relative size-full', className)}>
      <canvas ref={canvasRef} aria-hidden className={cn('absolute inset-0 block size-full', interactive && 'pointer-events-auto')} />
    </div>
  )
}

// ── 3. GridWave ────────────────────────────────────────────────────────────────
// Dots on a regular grid whose brightness and size oscillate in a diagonal wave.
// Creates a field-of-wheat effect — every column is slightly phase-shifted.

const GRIDWAVE_SPACING = 22
const GRIDWAVE_MAX_R = 3.8

export function GridWave({ className, interactive = false }: { className?: string; interactive?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mouseRef = useCanvasMouse(canvasRef, interactive)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }

    let animId: number
    let t = 0

    const draw = () => {
      const { W, H } = syncCanvas(canvas, ctx)
      ctx.clearRect(0, 0, W, H)
      const [cr, cg, cb] = getDrawColor()

      const cols = Math.ceil(W / GRIDWAVE_SPACING) + 1
      const rows = Math.ceil(H / GRIDWAVE_SPACING) + 1

      for (let row = 0; row <= rows; row++) {
        for (let col = 0; col <= cols; col++) {
          const x = col * GRIDWAVE_SPACING
          const y = row * GRIDWAVE_SPACING

          // Mouse proximity boosts local wave amplitude (like touching water)
          let boost = 0
          if (interactive) {
            const mdx = (x - mouseRef.current.x) / 140
            const mdy = (y - mouseRef.current.y) / 140
            boost = Math.max(0, 1 - Math.sqrt(mdx * mdx + mdy * mdy))
          }

          const wave = Math.sin(col * 0.5 - row * 0.3 + t * 2.2 + boost * 2.5)
          const r = 0.5 + GRIDWAVE_MAX_R * (wave * 0.5 + 0.5)
          const alpha = 0.06 + (0.28 + boost * 0.15) * (wave * 0.5 + 0.5)
          ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`
          ctx.beginPath()
          ctx.arc(x, y, r, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      t += 0.02
      animId = requestAnimationFrame(draw)
    }

    draw()
    return () => cancelAnimationFrame(animId)
  }, [interactive])

  return (
    <div className={cn('relative size-full', className)}>
      <canvas ref={canvasRef} aria-hidden className={cn('absolute inset-0 block size-full', interactive && 'pointer-events-auto')} />
    </div>
  )
}

// ── 4. SineRipple ──────────────────────────────────────────────────────────────
// Concentric rings that expand outward from the center at a constant speed.
// Multiple rings are phase-offset, giving a continuous ripple / radar effect.

const RIPPLE_RING_COUNT = 7
const RIPPLE_SPACING = 40

export function SineRipple({ className, interactive = false }: { className?: string; interactive?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mouseRef = useCanvasMouse(canvasRef, interactive)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }

    let animId: number
    let t = 0

    const draw = () => {
      const { W, H } = syncCanvas(canvas, ctx)
      ctx.clearRect(0, 0, W, H)
      const [cr, cg, cb] = getDrawColor()

      // Mouse-driven origin with smooth fallback to center
      const mx = mouseRef.current.x
      const my = mouseRef.current.y
      const hasMouse = interactive && mx > -9998
      const cx = hasMouse ? mx : W / 2
      const cy = hasMouse ? my : H / 2
      const maxR = Math.sqrt(W * W + H * H) / 2

      for (let i = 0; i < RIPPLE_RING_COUNT; i++) {
        const r = (t * 28 + i * RIPPLE_SPACING) % maxR
        const progress = r / maxR
        const alpha = (1 - progress) * 0.26 * Math.sin(t * 1.5 + i * 0.8)
        if (alpha <= 0) {
          continue
        }
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`
        ctx.lineWidth = 0.8
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.stroke()
      }

      t += 0.009
      animId = requestAnimationFrame(draw)
    }

    draw()
    return () => cancelAnimationFrame(animId)
  }, [interactive])

  return (
    <div className={cn('relative size-full', className)}>
      <canvas ref={canvasRef} aria-hidden className={cn('absolute inset-0 block size-full', interactive && 'pointer-events-auto')} />
    </div>
  )
}

// ── 5. RainDots ────────────────────────────────────────────────────────────────
// Evenly-spaced columns of dots cascade downward at varying speeds.
// Each dot has a fading 2-step tail. Subtle and organic — not Matrix-like.

const RAIN_COL_SPACING = 14

export function RainDots({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }

    type Drop = { x: number, y: number, speed: number, alpha: number }
    let drops: Drop[] = []
    let H = 0
    let animId: number

    const init = (w: number, h: number) => {
      H = h
      const cols = Math.floor(w / RAIN_COL_SPACING)
      drops = Array.from({ length: cols }).map((_, i) => ({
        x: i * RAIN_COL_SPACING + RAIN_COL_SPACING / 2 + (Math.random() - 0.5) * 6,
        y: Math.random() * h,
        speed: 0.45 + Math.random() * 0.55,
        alpha: 0.18 + Math.random() * 0.28,
      }))
    }

    let initialized = false

    const draw = () => {
      const { W, H: curH } = syncCanvas(canvas, ctx)
      if (!initialized) {
        init(W, curH)
        initialized = true
      }
      ctx.clearRect(0, 0, W, curH)
      const [cr, cg, cb] = getDrawColor()

      for (const d of drops) {
        d.y += d.speed
        if (d.y > H + 8) {
          d.y = -8
        }

        ctx.fillStyle = `rgba(${cr},${cg},${cb},${d.alpha.toFixed(3)})`
        ctx.beginPath()
        ctx.arc(d.x, d.y, 2.8, 0, Math.PI * 2)
        ctx.fill()

        ctx.fillStyle = `rgba(${cr},${cg},${cb},${(d.alpha * 0.3).toFixed(3)})`
        ctx.beginPath()
        ctx.arc(d.x, d.y - 12, 1.8, 0, Math.PI * 2)
        ctx.fill()

        ctx.fillStyle = `rgba(${cr},${cg},${cb},${(d.alpha * 0.1).toFixed(3)})`
        ctx.beginPath()
        ctx.arc(d.x, d.y - 24, 1.1, 0, Math.PI * 2)
        ctx.fill()
      }

      animId = requestAnimationFrame(draw)
    }

    draw()
    return () => cancelAnimationFrame(animId)
  }, [])

  return (
    <div className={cn('relative size-full', className)}>
      <canvas ref={canvasRef} aria-hidden className="absolute inset-0 block size-full" />
    </div>
  )
}

// ── 6. ConnectionMesh ──────────────────────────────────────────────────────────
// Random nodes drift with Brownian motion; nearby nodes are connected by faint
// lines. Mouse attracts nodes within range — subtle interactive network mesh.

const MESH_NODE_COUNT = 55
const MESH_CONNECT_DIST = 100
const MESH_INFLUENCE_DIST = 150

export function ConnectionMesh({ className, interactive = true }: { className?: string; interactive?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mouseRef = useCanvasMouse(canvasRef, interactive)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    type Node = { x: number; y: number; vx: number; vy: number }
    let nodes: Node[] = []
    let W = 0
    let H = 0
    let animId: number

    const init = (w: number, h: number) => {
      W = w; H = h
      nodes = Array.from({ length: MESH_NODE_COUNT }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
      }))
    }

    const draw = () => {
      const dims = syncCanvas(canvas, ctx)
      ctx.clearRect(0, 0, dims.W, dims.H)
      if (W !== dims.W || H !== dims.H) init(dims.W, dims.H)

      const [cr, cg, cb] = getDrawColor()

      for (const n of nodes) {
        n.vx += (Math.random() - 0.5) * 0.04
        n.vy += (Math.random() - 0.5) * 0.04
        n.vx *= 0.995
        n.vy *= 0.995
        const speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy)
        if (speed > 0.6) {
          n.vx = (n.vx / speed) * 0.6
          n.vy = (n.vy / speed) * 0.6
        }

        if (interactive) {
          const mx = mouseRef.current.x
          const my = mouseRef.current.y
          const dx = mx - n.x
          const dy = my - n.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < MESH_INFLUENCE_DIST) {
            const force = (1 - dist / MESH_INFLUENCE_DIST) * 0.025
            n.vx += (dx / (dist + 0.001)) * force
            n.vy += (dy / (dist + 0.001)) * force
          }
        }

        n.x += n.vx
        n.y += n.vy
        if (n.x < 0) n.x = W
        if (n.x > W) n.x = 0
        if (n.y < 0) n.y = H
        if (n.y > H) n.y = 0
      }

      // Draw connections
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x
          const dy = nodes[i].y - nodes[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < MESH_CONNECT_DIST) {
            const alpha = (1 - dist / MESH_CONNECT_DIST) * 0.1
            ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`
            ctx.lineWidth = 0.5
            ctx.beginPath()
            ctx.moveTo(nodes[i].x, nodes[i].y)
            ctx.lineTo(nodes[j].x, nodes[j].y)
            ctx.stroke()
          }
        }
      }

      // Draw nodes
      for (const n of nodes) {
        ctx.fillStyle = `rgba(${cr},${cg},${cb},0.25)`
        ctx.beginPath()
        ctx.arc(n.x, n.y, 1.5, 0, Math.PI * 2)
        ctx.fill()
      }

      animId = requestAnimationFrame(draw)
    }

    draw()
    return () => cancelAnimationFrame(animId)
  }, [interactive])

  return (
    <div className={cn('relative size-full', className)}>
      <canvas ref={canvasRef} aria-hidden className={cn('absolute inset-0 block size-full', interactive && 'pointer-events-auto')} />
    </div>
  )
}

// ── 7. SpotlightGradient ───────────────────────────────────────────────────────
// A soft radial glow that follows the cursor — the simplest possible mouse
// decoration. Renders a single large gradient at ~6% opacity.

export function SpotlightGradient({ className, interactive = true, radius = 300 }: { className?: string; interactive?: boolean; radius?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mouseRef = useCanvasMouse(canvasRef, interactive)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animId: number

    const draw = () => {
      const { W, H } = syncCanvas(canvas, ctx)
      ctx.clearRect(0, 0, W, H)
      const [cr, cg, cb] = getDrawColor()

      const mx = mouseRef.current.x
      const my = mouseRef.current.y
      if (mx > -9998) {
        const gradient = ctx.createRadialGradient(mx, my, 0, mx, my, radius)
        gradient.addColorStop(0, `rgba(${cr},${cg},${cb},0.06)`)
        gradient.addColorStop(0.5, `rgba(${cr},${cg},${cb},0.03)`)
        gradient.addColorStop(1, `rgba(${cr},${cg},${cb},0)`)
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, W, H)
      }

      animId = requestAnimationFrame(draw)
    }

    draw()
    return () => cancelAnimationFrame(animId)
  }, [interactive, radius])

  return (
    <div className={cn('relative size-full', className)}>
      <canvas ref={canvasRef} aria-hidden className={cn('absolute inset-0 block size-full', interactive && 'pointer-events-auto')} />
    </div>
  )
}

interface DitheredGradientDecorationProps {
  /** Number of rows. @default 16 */
  rows?: number
  /** Cell size in px. @default 10 */
  cellSize?: number
  /** Gap between cells in px. @default 3 */
  gap?: number
  /** Border radius of cells in px. @default 2 */
  radius?: number
  /** Mouse glow radius in px. @default 100 */
  glowRadius?: number
  /** Fraction of cells that are visible (0-1). @default 0.6 */
  density?: number
  /** Whether to fade out at the bottom. @default true */
  fadeBottom?: boolean
  /** Track mouse via window listener instead of canvas-only events.
   *  Use when the canvas is a top decoration and content overlaps it. @default false */
  trackGlobal?: boolean
  className?: string
  style?: React.CSSProperties
}

/**
 * GitHub-style contribution graph decoration — Canvas-based, monochrome dither
 * pattern where cells trade brightness levels over time. Mouse proximity creates
 * a localized glow. Pattern is position-stable: resizing the window does not
 * reshuffle the layout.
 */
export function DitheredGradientDecoration({
  rows = 16,
  cellSize = 10,
  gap = 3,
  radius = 2,
  glowRadius = 100,
  density = 0.6,
  fadeBottom = true,
  trackGlobal = false,
  className,
  style,
}: DitheredGradientDecorationProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mouseRef = useRef({ x: -9999, y: -9999 })
  const targetMouseRef = useRef({ x: -9999, y: -9999 })
  const rafRef = useRef<number>(0)

  const step = cellSize + gap

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    let cleanupMouse: (() => void) | undefined
    if (trackGlobal) {
      const onMove = (e: MouseEvent) => {
        const rect = canvas.getBoundingClientRect()
        targetMouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      }
      window.addEventListener('mousemove', onMove)
      cleanupMouse = () => window.removeEventListener('mousemove', onMove)
    }

    // Position-based hash: same (col, row) always produces the same value.
    // This keeps the pattern stable across window / container resizes.
    function posHash(col: number, row: number): number {
      const x = Math.sin(col * 127.1 + row * 311.7) * 43758.5453
      return x - Math.floor(x)
    }

    const invThreshold = 1 - density
    const t1 = invThreshold + density * (1 / 3)
    const t2 = invThreshold + density * (2 / 3)
    const t3 = invThreshold + density * 0.867

    // Lazy cell lookup keyed by grid position — deterministic, resize-stable
    const cellCache = new Map<string, { level: number; phase: number; speed: number }>()
    function getCell(col: number, row: number) {
      const key = `${col},${row}`
      const cached = cellCache.get(key)
      if (cached) return cached
      const v = posHash(col, row)
      let level = 0
      if (v >= invThreshold && v < t1) level = 1
      else if (v >= t1 && v < t2) level = 2
      else if (v >= t2 && v < t3) level = 3
      else if (v >= t3) level = 4
      const cell = {
        level,
        phase: posHash(col * 3 + 7, row * 3 + 7) * Math.PI * 2,
        speed: 0.8 + posHash(col * 5 + 13, row * 5 + 13) * 0.8,
      }
      cellCache.set(key, cell)
      return cell
    }

    function draw(time: number) {
      const w = canvas!.getBoundingClientRect().width
      const h = canvas!.getBoundingClientRect().height
      ctx!.clearRect(0, 0, w, h)

      const isDark = document.documentElement.classList.contains('dark') ||
        (!document.documentElement.classList.contains('light') &&
          window.matchMedia('(prefers-color-scheme: dark)').matches)
      // Wider range per level → visible "alternating bright" contrast
      const baseLightness = isDark
        ? [0, 0.65, 0.50, 0.38, 0.25]
        : [0, 0.86, 0.72, 0.58, 0.44]

      const t = time / 1000

      // Lazy mouse — lerp current toward target for inertia
      const ease = 0.06
      if (targetMouseRef.current.x > -9998) {
        mouseRef.current.x += (targetMouseRef.current.x - mouseRef.current.x) * ease
        mouseRef.current.y += (targetMouseRef.current.y - mouseRef.current.y) * ease
      } else {
        mouseRef.current.x += (-9999 - mouseRef.current.x) * 0.15
        mouseRef.current.y += (-9999 - mouseRef.current.y) * 0.15
      }

      const mx = mouseRef.current.x
      const my = mouseRef.current.y
      const cols = Math.ceil(w / step)

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const cell = getCell(col, row)
          if (cell.level === 0) continue

          // Dither swap: each cell oscillates between its base level and an
          // adjacent level. Nearby cells run at different phases, so brightness
          // "trades places" across the grid — like real dithering.
          const wave = Math.sin(t * cell.speed + cell.phase)
          const dir = wave > 0 ? 1 : -1
          const blend = Math.abs(wave)
          const targetLevel = Math.max(1, Math.min(4, cell.level + dir))
          const l = baseLightness[cell.level] + (baseLightness[targetLevel] - baseLightness[cell.level]) * blend

          // Mouse glow — sharp falloff, direction-correct per theme
          const cx = col * step + cellSize / 2
          const cy = row * step + cellSize / 2
          const dist = Math.sqrt((mx - cx) ** 2 + (my - cy) ** 2)
          const glow = Math.max(0, 1 - dist / glowRadius) ** 1.5
          const finalL = isDark
            ? Math.min(0.95, l + glow * 0.35)
            : Math.max(0.05, l - glow * 0.35)

          ctx!.globalAlpha = 1
          ctx!.fillStyle = `oklch(${finalL.toFixed(3)} 0 0)`
          ctx!.beginPath()
          ctx!.roundRect(col * step, row * step, cellSize, cellSize, radius)
          ctx!.fill()
        }
      }

      if (fadeBottom) {
        const grad = ctx!.createLinearGradient(0, 0, 0, h)
        grad.addColorStop(0, 'rgba(255,255,255,0)')
        grad.addColorStop(0.3, 'rgba(255,255,255,0)')
        grad.addColorStop(1, 'rgba(255,255,255,1)')
        ctx!.globalAlpha = 1
        ctx!.globalCompositeOperation = 'destination-out'
        ctx!.fillStyle = grad
        ctx!.fillRect(0, 0, w, h)
        ctx!.globalCompositeOperation = 'source-over'
      }

      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', resize)
      cleanupMouse?.()
    }
  }, [rows, cellSize, gap, radius, glowRadius, density, fadeBottom, step, trackGlobal])

  const handleMouseMove = useCallback((e: { clientX: number, clientY: number }) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    targetMouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }, [])

  const handleMouseLeave = useCallback(() => {
    targetMouseRef.current = { x: -9999, y: -9999 }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn(trackGlobal ? 'pointer-events-none' : 'pointer-events-auto', 'absolute inset-x-0 top-0', className)}
      style={{ height: rows * step + gap, width: '100%', ...style }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    />
  )
}