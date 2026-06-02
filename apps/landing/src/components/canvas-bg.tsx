import { useEffect, useRef } from 'react'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  opacity: number
  phase: number
}

function createParticles(w: number, h: number): Particle[] {
  const count = Math.min(60, Math.floor((w * h) / 22000))
  return Array.from({ length: count }, (_, i) => ({
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.12,
    vy: -0.04 - Math.random() * 0.08,
    r: 0.8 + Math.random() * 0.8,
    opacity: 0.06 + Math.random() * 0.1,
    phase: (Math.PI * 2 * i) / count,
  }))
}

export function CanvasBg() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mouseRef = useRef({ x: 0.5, y: 0.4 })

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) return

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!

    let w = 0, h = 0
    let particles: Particle[] = []
    let raf = 0
    let dead = false

    function resize() {
      const dpr = Math.min(window.devicePixelRatio, 2)
      w = window.innerWidth
      h = window.innerHeight
      canvas!.width = w * dpr
      canvas!.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      particles = createParticles(w, h)
    }

    const onMouse = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX / w, y: e.clientY / h }
    }

    let resizeT: ReturnType<typeof setTimeout>
    const onResize = () => { clearTimeout(resizeT); resizeT = setTimeout(resize, 140) }

    function render(t: number) {
      if (dead) return
      ctx.clearRect(0, 0, w, h)

      // Base fill — matches design system neutral-1
      ctx.fillStyle = '#141414'
      ctx.fillRect(0, 0, w, h)

      // One very soft, large accent glow — NOT a gradient bg, just ambience
      const mx = w * (0.25 + mouseRef.current.x * 0.5)
      const my = h * (0.05 + mouseRef.current.y * 0.3)
      const gr = ctx.createRadialGradient(mx, my, 0, mx, my, w * 0.6)
      gr.addColorStop(0, 'rgba(59,130,246,0.022)')
      gr.addColorStop(1, 'rgba(59,130,246,0)')
      ctx.fillStyle = gr
      ctx.fillRect(0, 0, w, h)

      // Floating particles
      const time = t * 0.001
      for (const p of particles) {
        p.x += p.vx
        p.y += p.vy
        if (p.x < 0) p.x = w
        if (p.x > w) p.x = 0
        if (p.y < -4) p.y = h + 4

        const fade = 0.7 + 0.3 * Math.sin(time * 0.3 + p.phase)
        ctx.globalAlpha = p.opacity * fade
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = '#ffffff'
        ctx.fill()
      }

      ctx.globalAlpha = 1
      raf = requestAnimationFrame(render)
    }

    resize()
    window.addEventListener('resize', onResize)
    window.addEventListener('mousemove', onMouse, { passive: true })
    raf = requestAnimationFrame(render)

    return () => {
      dead = true
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('mousemove', onMouse)
      clearTimeout(resizeT)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: -1 }}
    />
  )
}
