/**
 * Nav — minimal fixed header
 *
 * Logo + product name, right side: GitHub + Download CTA.
 */
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { Download } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

gsap.registerPlugin(useGSAP)

export function Nav() {
  const [scrolled, setScrolled] = useState(false)
  const navRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useGSAP(() => {
    gsap.from(navRef.current, { y: -16, opacity: 0, duration: 0.6, delay: 3.2, ease: 'power3.out' })
  }, { scope: navRef })

  return (
    <nav
      ref={navRef}
      style={{
        position: 'fixed',
        top: 0,
left: 0,
right: 0,
        zIndex: 50,
        height: 68,
        display: 'flex',
        alignItems: 'center',
        transition: 'background 0.25s, border-color 0.25s',
        background: scrolled ? 'rgba(20,20,20,0.88)' : 'transparent',
        backdropFilter: scrolled ? 'blur(20px) saturate(160%)' : 'none',
        WebkitBackdropFilter: scrolled ? 'blur(20px) saturate(160%)' : 'none',
        borderBottom: scrolled ? '1px solid var(--color-border)' : '1px solid transparent',
      }}
    >
      <div style={{
        maxWidth: 1100,
        margin: '0 auto',
        padding: '0 40px',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
      >
        {/* Logo */}
        <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none' }}>
          <img
            src="/icon-64.webp"
            alt="Cradle"
            width={34}
            height={34}
            decoding="async"
            style={{ borderRadius: 10 }}
          />
          <span style={{
            fontSize: 17,
            fontWeight: 700,
            color: 'var(--color-neutral-9)',
            letterSpacing: '-0.03em',
          }}
          >
            Cradle
          </span>
        </a>

        {/* Right */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* <span
            style={{
              fontSize: 12,
              color: 'var(--color-neutral-4)',
              letterSpacing: '0.01em',
            }}
          >
            Free forever
          </span> */}
          <a
            href="#download"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              height: 38,
              padding: '0 20px',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              background: 'var(--color-neutral-9)',
              color: 'var(--color-neutral-1)',
              textDecoration: 'none',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12)',
              transition: 'opacity 0.12s',
              letterSpacing: '-0.01em',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.opacity = '0.85' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.opacity = '1' }}
          >
            <Download style={{ width: 14, height: 14 }} />
            Download for macOS
          </a>
        </div>
      </div>
    </nav>
  )
}
