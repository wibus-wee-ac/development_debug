import { useEffect, useRef } from 'react'

interface Blob {
  x: number
  y: number
  radius: number
  color: string
  speedX: number
  speedY: number
  phase: number
  frequency: number
}

const COLORS = [
  'rgba(168, 85, 247,',
  'rgba(99, 102, 241,',
  'rgba(129, 140, 248,',
  'rgba(124, 58, 237,',
  'rgba(168, 85, 247,',
  'rgba(99, 102, 241,',
]

function createBlobs(width: number, height: number): Blob[] {
  return COLORS.map((color, i) => ({
    x: Math.random() * width,
    y: Math.random() * height,
    radius: Math.max(width, height) * (0.3 + Math.random() * 0.3),
    color,
    speedX: 0.0002 + Math.random() * 0.0003,
    speedY: 0.0002 + Math.random() * 0.0003,
    phase: (Math.PI * 2 * i) / COLORS.length,
    frequency: 0.3 + Math.random() * 0.4,
  }))
}

function drawBlob(
  ctx: CanvasRenderingContext2D,
  blob: Blob,
  time: number,
  width: number,
  height: number
) {
  const cx =
    width / 2 +
    Math.sin(time * blob.speedX * 1000 + blob.phase) * width * 0.3
  const cy =
    height / 2 +
    Math.cos(time * blob.speedY * 1000 + blob.phase * 1.3) * height * 0.3

  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, blob.radius)
  const opacity =
    0.015 + Math.sin(time * blob.frequency + blob.phase) * 0.01
  gradient.addColorStop(
    0,
    `${blob.color} ${Math.max(0.01, opacity).toFixed(4)})`
  )
  gradient.addColorStop(1, `${blob.color} 0)`)

  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)
}

export function CanvasBg() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')!
    let width = 0
    let height = 0
    let blobs: Blob[] = []
    let animationId = 0
    let destroyed = false

    function resize() {
      const dpr = Math.min(window.devicePixelRatio, 2)
      width = window.innerWidth
      height = window.innerHeight
      canvas!.width = width * dpr
      canvas!.height = height * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      blobs = createBlobs(width, height)
    }

    let resizeTimer: ReturnType<typeof setTimeout>
    function onResize() {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(resize, 150)
    }

    function render(time: number) {
      if (destroyed) return

      ctx.clearRect(0, 0, width, height)
      ctx.fillStyle = '#0a0a0a'
      ctx.fillRect(0, 0, width, height)

      ctx.globalCompositeOperation = 'lighter'

      const t = time * 0.001
      for (const blob of blobs) {
        drawBlob(ctx, blob, t, width, height)
      }

      ctx.globalCompositeOperation = 'source-over'
      animationId = requestAnimationFrame(render)
    }

    resize()
    window.addEventListener('resize', onResize)
    animationId = requestAnimationFrame(render)

    return () => {
      destroyed = true
      cancelAnimationFrame(animationId)
      window.removeEventListener('resize', onResize)
      clearTimeout(resizeTimer)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full -z-10 pointer-events-none"
      style={{ filter: 'blur(60px)', willChange: 'transform' }}
    />
  )
}
