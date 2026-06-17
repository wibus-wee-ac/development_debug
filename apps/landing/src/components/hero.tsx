/**
 * Hero — Swiss-grid editorial.
 *
 * One 12-column grid: a giant left-aligned headline (normal case) on the left,
 * a rule + body + text-link CTA on the right, a meta strip at the foot. Motion
 * is GSAP and deliberately quiet — per-line mask reveal, a rule that draws
 * left-to-right, and a fade for the rest. No parallax, no glow: the page is
 * meant to read like a well-set print sheet.
 */

import { useRef } from 'react'
import { gsap, useGSAP } from '../hooks/use-gsap'
import { Container } from './primitives'

const HEADLINE = ['One layer', 'above your', 'AI tools.']

export function Hero() {
  const sectionRef = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reduce) return

      const tl = gsap.timeline({ defaults: { ease: 'expo.out' } })

      // Per-line mask reveal — `from` sets the offset, the natural state is
      // untransformed, so there's no CSS/JSAP transform conflict (the bug that
      // hid the title before).
      tl.from('.hero-line-inner', { yPercent: 118, duration: 1.15, stagger: 0.11, delay: 0.2 })
        .from('.hero-index', { opacity: 0, y: 10, duration: 0.7 }, 0.2)
        // Rule draws from the left.
        .from('.hero-rule', { scaleX: 0, duration: 0.9, transformOrigin: 'left center' }, '-=0.8')
        .from('.hero-side-line', { opacity: 0, y: 14, duration: 0.8, stagger: 0.08 }, '-=0.6')
        .from('.hero-meta', { opacity: 0, duration: 0.9 }, '-=0.5')
    },
    { scope: sectionRef },
  )

  return (
    <section
      ref={sectionRef}
      style={{
        position: 'relative',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        // paddingTop: 'calc(52px + clamp(48px, 12vh, 120px))',
        paddingBottom: 'clamp(32px, 6vh, 64px)',
      }}
    >
      <Container style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div className="hero-grid">
          {/* Left — headline */}
          <div className="hero-title-col">
            <span
              className="hero-index"
              style={{
                display: 'block',
                fontSize: 13,
                fontWeight: 500,
                letterSpacing: '0.04em',
                color: 'var(--text-muted)',
                fontVariantNumeric: 'tabular-nums',
                marginBottom: 'clamp(20px, 3vh, 32px)',
              }}
            >
              {/* — 01 */}
            </span>

            <h1
              style={{
                fontSize: 'clamp(2.8rem, 9.5vw, 6.75rem)',
                fontWeight: 600,
                lineHeight: 0.98,
                letterSpacing: '-0.045em',
                color: 'var(--text)',
              }}
            >
              {HEADLINE.map((line) => (
                <span key={line} className="hero-line" style={{ display: 'block', overflow: 'hidden' }}>
                  <span className="hero-line-inner" style={{ display: 'block', willChange: 'transform' }}>
                    {line}
                  </span>
                </span>
              ))}
            </h1>
          </div>

          {/* Right — rule, body, CTA */}
          <div className="hero-side-col" style={{ paddingTop: '0.72em' }}>
            <div
              className="hero-rule"
              style={{
                height: 1,
                background: 'var(--text)',
                width: '100%',
                marginBottom: 28,
                transformOrigin: 'left center',
              }}
            />

            <p
              className="hero-side-line"
              style={{
                fontSize: 'clamp(1rem, 1.4vw, 1.15rem)',
                lineHeight: 1.6,
                letterSpacing: '-0.01em',
                color: 'var(--text-secondary)',
                marginBottom: 32,
              }}
            >
              Your AI coding tools are brilliant. Managing them is a mess. Cradle is
              the command center that coordinates all of them — in parallel, on your
              machine.
            </p>

            <div className="hero-side-line" style={{ marginBottom: 14 }}>
              <a
                href="#download"
                className="hero-link"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 'clamp(1.05rem, 1.5vw, 1.25rem)',
                  fontWeight: 500,
                  letterSpacing: '-0.015em',
                  color: 'var(--text)',
                  paddingBottom: 2,
                }}
              >
                Download for macOS
                <span aria-hidden style={{ fontSize: '1.1em' }}>⟶</span>
              </a>
            </div>

            <div className="hero-side-line" style={{ marginBottom: 28 }}>
              <a
                href="https://github.com/wibus-wee/Cradle"
                target="_blank"
                rel="noopener noreferrer"
                className="hero-link"
                style={{
                  fontSize: 13.5,
                  color: 'var(--text-muted)',
                  paddingBottom: 1,
                }}
              >
                View on GitHub
              </a>
            </div>

            <p
              className="hero-side-line"
              style={{
                fontSize: 12,
                lineHeight: 1.7,
                color: 'var(--text-muted)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              macOS 14+ · Apple Silicon &amp; Intel
              <br />
              Free forever
            </p>
          </div>
        </div>
      </Container>
    </section>
  )
}
