/**
 * Nav — minimal fixed header with blur-on-scroll.
 */

import { useEffect, useState } from 'react'
import { Container, ThemeToggle } from './primitives'

export function Nav() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <nav
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        height: 52,
        display: 'flex',
        alignItems: 'center',
        transition:
          'background 0.35s ease, border-color 0.35s ease, backdrop-filter 0.35s ease',
        background: scrolled ? 'var(--nav-bg)' : 'transparent',
        backdropFilter: scrolled ? 'saturate(180%) blur(20px)' : 'none',
        WebkitBackdropFilter: scrolled ? 'saturate(180%) blur(20px)' : 'none',
        borderBottom: scrolled
          ? '1px solid var(--border-subtle)'
          : '1px solid transparent',
      }}
    >
      <Container
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <a
          href="/"
          style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none' }}
        >
          <img
            src="/icon-64.webp"
            alt="Cradle"
            width={22}
            height={22}
            decoding="async"
            style={{ borderRadius: 6, display: 'block' }}
          />
          <span
            style={{
              fontSize: 14,
              fontWeight: 560,
              letterSpacing: '-0.02em',
              color: 'var(--text)',
            }}
          >
            Cradle
          </span>
        </a>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <a
            href="https://github.com/wibus-wee/Cradle"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 36,
              padding: '0 16px',
              borderRadius: 980,
              border: '1px solid var(--border)',
              background: 'var(--fill)',
              color: 'var(--text-secondary)',
              fontSize: 13,
              fontWeight: 500,
              textDecoration: 'none',
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
            GitHub
          </a>
          <ThemeToggle />
        </div>
      </Container>
    </nav>
  )
}
