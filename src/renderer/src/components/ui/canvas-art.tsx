// Input: DOM theme classes, devicePixelRatio
// Output: HalftoneArt, FlowField, GridWave, SineRipple, RainDots — canvas animation components
// Position: Universal UI canvas art primitives for decorative panel backgrounds

import { cn } from '@renderer/lib/cn'
import { useEffect, useRef } from 'react'

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

// ── 1. HalftoneArt ─────────────────────────────────────────────────────────────
// Radial sine wave breathing dot grid. Dots grow and shrink with a wave that
// travels outward from the center. Classic dither / halftone print aesthetic.

const HALFTONE_GRID = 18
const HALFTONE_MAX_R = 5.5

export function HalftoneArt({ className }: { className?: string }) {
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
          const radius = Math.max(0.5, HALFTONE_MAX_R * (wave * 0.5 + 0.5))
          const alpha = 0.10 + (wave * 0.5 + 0.5) * 0.28
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
  }, [])

  return (
    <div className={cn('relative size-full', className)}>
      <canvas ref={canvasRef} aria-hidden className="absolute inset-0 block size-full" />
    </div>
  )
}

// ── 2. FlowField ───────────────────────────────────────────────────────────────
// Particles drifting along a smooth vector field derived from sine-cosine noise.
// Each particle follows a locally computed angle — gives organic, fluid motion.

const FLOW_PARTICLE_COUNT = 180

export function FlowField({ className }: { className?: string }) {
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
  }, [])

  return (
    <div className={cn('relative size-full', className)}>
      <canvas ref={canvasRef} aria-hidden className="absolute inset-0 block size-full" />
    </div>
  )
}

// ── 3. GridWave ────────────────────────────────────────────────────────────────
// Dots on a regular grid whose brightness and size oscillate in a diagonal wave.
// Creates a field-of-wheat effect — every column is slightly phase-shifted.

const GRIDWAVE_SPACING = 22
const GRIDWAVE_MAX_R = 3.8

export function GridWave({ className }: { className?: string }) {
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
          const wave = Math.sin(col * 0.5 - row * 0.3 + t * 2.2)
          const r = 0.5 + GRIDWAVE_MAX_R * (wave * 0.5 + 0.5)
          const alpha = 0.06 + 0.28 * (wave * 0.5 + 0.5)
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
  }, [])

  return (
    <div className={cn('relative size-full', className)}>
      <canvas ref={canvasRef} aria-hidden className="absolute inset-0 block size-full" />
    </div>
  )
}

// ── 4. SineRipple ──────────────────────────────────────────────────────────────
// Concentric rings that expand outward from the center at a constant speed.
// Multiple rings are phase-offset, giving a continuous ripple / radar effect.

const RIPPLE_RING_COUNT = 7
const RIPPLE_SPACING = 40

export function SineRipple({ className }: { className?: string }) {
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

    let animId: number
    let t = 0

    const draw = () => {
      const { W, H } = syncCanvas(canvas, ctx)
      ctx.clearRect(0, 0, W, H)
      const [cr, cg, cb] = getDrawColor()

      const cx = W / 2
      const cy = H / 2
      const maxR = Math.sqrt(cx * cx + cy * cy)

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
  }, [])

  return (
    <div className={cn('relative size-full', className)}>
      <canvas ref={canvasRef} aria-hidden className="absolute inset-0 block size-full" />
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
