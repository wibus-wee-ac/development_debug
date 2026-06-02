import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { ArrowRight, Download } from 'lucide-react'

gsap.registerPlugin(useGSAP, ScrollTrigger)

export function CTASection() {
  const sectionRef = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      gsap.from('.cta-inner', {
        y: 28, opacity: 0, duration: 0.8, ease: 'power3.out',
        scrollTrigger: { trigger: '.cta-inner', start: 'top 82%' },
      })
    },
    { scope: sectionRef }
  )

  return (
    <section
      ref={sectionRef}
      style={{
        padding: '96px 24px',
        borderTop: '1px solid var(--color-border)',
      }}
    >
      <div
        className="cta-inner"
        style={{
          maxWidth: 600,
          margin: '0 auto',
          textAlign: 'center',
        }}
      >
        <h2
          style={{
            fontSize: 'clamp(1.6rem, 3.5vw, 2.4rem)',
            fontWeight: 600,
            lineHeight: 1.15,
            letterSpacing: '-0.025em',
            color: 'var(--color-neutral-9)',
            marginBottom: 14,
          }}
        >
          Your agents are waiting.
        </h2>
        <p
          style={{
            fontSize: 14,
            lineHeight: 1.7,
            color: 'var(--color-neutral-6)',
            maxWidth: 380,
            margin: '0 auto 36px',
          }}
        >
          Download Cradle and go from scattered tools to a unified command center in minutes.
        </p>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
          }}
        >
          {/* Primary CTA */}
          <a
            href="#download"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '9px 20px',
              borderRadius: 8,
              background: 'var(--color-neutral-9)',
              color: 'var(--color-neutral-1)',
              fontSize: 13,
              fontWeight: 600,
              textDecoration: 'none',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            <Download style={{ width: 13, height: 13 }} />
            Download for macOS
          </a>

          {/* Secondary CTA */}
          <a
            href="https://github.com/wibus-wee/Cradle"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '9px 20px',
              borderRadius: 8,
              background: 'var(--color-fill)',
              color: 'var(--color-neutral-7)',
              border: '1px solid var(--color-border)',
              fontSize: 13,
              fontWeight: 500,
              textDecoration: 'none',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
              transition: 'color 0.15s, background 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color = 'var(--color-neutral-9)'
              e.currentTarget.style.background = 'var(--color-neutral-3)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = 'var(--color-neutral-7)'
              e.currentTarget.style.background = 'var(--color-fill)'
            }}
          >
            View on GitHub
            <ArrowRight style={{ width: 12, height: 12 }} />
          </a>
        </div>

        <p
          style={{
            marginTop: 20,
            fontSize: 11,
            color: 'var(--color-neutral-5)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          macOS 14+ · Apple Silicon & Intel · Open source
        </p>
      </div>
    </section>
  )
}
