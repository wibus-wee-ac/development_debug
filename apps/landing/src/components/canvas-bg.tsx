/**
 * Background — Vercel/Linear-style CSS orb blobs
 *
 * Three blurred gradient circles breathing slowly with Motion.
 * Grain overlay via SVG feTurbulence data URI (no canvas).
 */
import { motion } from 'motion/react'

interface OrbProps {
  style: React.CSSProperties
  animate: Record<string, number[]>
  duration: number
  delay?: number
}

function Orb({ style, animate, duration, delay = 0 }: OrbProps) {
  return (
    <motion.div
      aria-hidden
      animate={animate}
      transition={{
        duration,
        ease: 'easeInOut',
        repeat: Infinity,
        repeatType: 'mirror',
        delay,
      }}
      style={{
        position: 'absolute',
        borderRadius: '50%',
        filter: 'blur(140px)',
        pointerEvents: 'none',
        willChange: 'transform, opacity',
        ...style,
      }}
    />
  )
}

export function CanvasBg() {
  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: -1,
        overflow: 'hidden',
        background: 'var(--color-neutral-1)',
      }}
    >
      {/* Blue orb — top-left */}
      <Orb
        style={{
          width: 700,
          height: 700,
          top: '-15%',
          left: '-10%',
          background: 'rgba(59, 130, 246, 0.11)',
        }}
        animate={{ scale: [1, 1.12, 1], opacity: [0.8, 1, 0.8] }}
        duration={14}
        delay={0}
      />

      {/* Purple orb — top-right */}
      <Orb
        style={{
          width: 600,
          height: 600,
          top: '-5%',
          right: '-12%',
          background: 'rgba(139, 92, 246, 0.09)',
        }}
        animate={{ scale: [1, 1.08, 1], opacity: [0.7, 1, 0.7] }}
        duration={18}
        delay={3}
      />

      {/* Teal orb — bottom-center */}
      <Orb
        style={{
          width: 800,
          height: 500,
          bottom: '5%',
          left: '20%',
          background: 'rgba(16, 185, 129, 0.06)',
        }}
        animate={{ scale: [1, 1.15, 1], opacity: [0.6, 0.9, 0.6] }}
        duration={22}
        delay={6}
      />

      {/* Grain overlay — SVG feTurbulence */}
      <svg
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          opacity: 0.4,
          mixBlendMode: 'overlay',
          pointerEvents: 'none',
        }}
      >
        <filter id="grain">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.65"
            numOctaves="3"
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
    </div>
  )
}
