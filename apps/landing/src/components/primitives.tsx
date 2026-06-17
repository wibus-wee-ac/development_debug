/**
 * Primitives — shared layout & motion building blocks for the landing page.
 *
 * Flat, Apple-industrial-minimal: hairline borders, generous whitespace,
 * restrained reveal animations. No decorative clutter.
 */

import { motion } from 'motion/react'
import type { CSSProperties, ReactNode } from 'react'

/* ─── Layout ────────────────────────────────────────────────────── */

export const CONTAINER_MAX = 1080

export function Container({
  children,
  style,
  wide = false,
}: {
  children: ReactNode
  style?: CSSProperties
  wide?: boolean
}) {
  return (
    <div
      style={{
        maxWidth: wide ? 1280 : CONTAINER_MAX,
        margin: '0 auto',
        padding: '0 24px',
        width: '100%',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

/* ─── Reveal — fade-up on scroll into view ──────────────────────── */

const EASE = [0.22, 1, 0.36, 1] as const

export function Reveal({
  children,
  delay = 0,
  y = 24,
  style,
  as = 'div',
}: {
  children: ReactNode
  delay?: number
  y?: number
  style?: CSSProperties
  as?: 'div' | 'section' | 'li' | 'span'
}) {
  const MotionTag = motion[as] as typeof motion.div
  return (
    <MotionTag
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.8, delay, ease: EASE }}
      style={style}
    >
      {children}
    </MotionTag>
  )
}

/* ─── Eyebrow — small uppercase label ───────────────────────────── */

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 12,
        fontWeight: 500,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--text-muted)',
      }}
    >
      {children}
    </span>
  )
}

/* ─── Buttons ───────────────────────────────────────────────────── */

export function ButtonPrimary({
  href,
  children,
  style,
}: {
  href: string
  children: ReactNode
  style?: CSSProperties
}) {
  return (
    <motion.a
      href={href}
      whileHover={{ scale: 1.015 }}
      whileTap={{ scale: 0.985 }}
      transition={{ duration: 0.2, ease: EASE }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        height: 44,
        padding: '0 24px',
        borderRadius: 980,
        background: 'var(--accent)',
        color: 'var(--bg)',
        fontSize: 15,
        fontWeight: 500,
        letterSpacing: '-0.01em',
        textDecoration: 'none',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </motion.a>
  )
}

export function ButtonGhost({
  href,
  children,
  style,
}: {
  href: string
  children: ReactNode
  style?: CSSProperties
}) {
  return (
    <motion.a
      href={href}
      whileHover={{ scale: 1.015 }}
      whileTap={{ scale: 0.985 }}
      transition={{ duration: 0.2, ease: EASE }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        height: 44,
        padding: '0 24px',
        borderRadius: 980,
        background: 'transparent',
        color: 'var(--text)',
        border: '1px solid var(--border-strong)',
        fontSize: 15,
        fontWeight: 500,
        letterSpacing: '-0.01em',
        textDecoration: 'none',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </motion.a>
  )
}

/* ─── Theme Toggle ──────────────────────────────────────────────── */

export function ThemeToggle() {
  const toggle = () => document.documentElement.classList.toggle('dark')

  return (
    <button
      onClick={toggle}
      aria-label="Toggle theme"
      style={{
        width: 36,
        height: 36,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 980,
        border: '1px solid var(--border)',
        background: 'var(--fill)',
        cursor: 'pointer',
        color: 'var(--text-secondary)',
        transition: 'background 0.2s ease, color 0.2s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--fill-hover)'
        e.currentTarget.style.color = 'var(--text)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--fill)'
        e.currentTarget.style.color = 'var(--text-secondary)'
      }}
    >
      <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <circle cx={12} cy={12} r={4.2} />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    </button>
  )
}
