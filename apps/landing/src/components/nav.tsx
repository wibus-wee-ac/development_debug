import { useEffect, useRef, useState } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { Code2 } from 'lucide-react'

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
    gsap.from(navRef.current, { y: -16, opacity: 0, duration: 0.6, ease: 'power3.out' })
  }, { scope: navRef })

  return (
    <nav
      ref={navRef}
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0,
        zIndex: 50,
        height: 48,
        display: 'flex',
        alignItems: 'center',
        transition: 'background 0.2s, border-color 0.2s',
        background: scrolled ? 'rgba(17,17,17,0.82)' : 'transparent',
        backdropFilter: scrolled ? 'blur(20px) saturate(160%)' : 'none',
        WebkitBackdropFilter: scrolled ? 'blur(20px) saturate(160%)' : 'none',
        borderBottom: scrolled ? '1px solid var(--color-border)' : '1px solid transparent',
      }}
    >
      <div
        style={{
          maxWidth: 960,
          margin: '0 auto',
          padding: '0 24px',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              background: 'var(--color-accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.15)',
            }}
          >
            <span style={{ fontSize: 9, fontWeight: 700, color: '#fff' }}>C</span>
          </div>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-neutral-8)' }}>
            Cradle
          </span>
        </div>

        {/* Links */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          {['Features', 'How it works'].map(link => (
            <a
              key={link}
              href={`#${link.toLowerCase().replace(/ /g, '-')}`}
              style={{
                fontSize: 13,
                color: 'var(--color-neutral-6)',
                textDecoration: 'none',
                transition: 'color 0.12s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.color = 'var(--color-neutral-8)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.color = 'var(--color-neutral-6)' }}
            >
              {link}
            </a>
          ))}
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              color: 'var(--color-neutral-6)',
              textDecoration: 'none',
              transition: 'color 0.12s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.color = 'var(--color-neutral-8)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.color = 'var(--color-neutral-6)' }}
          >
            <Code2 style={{ width: 14, height: 14 }} />
            <span>GitHub</span>
          </a>
          <a
            href="#get-started"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              height: 30,
              padding: '0 14px',
              borderRadius: 7,
              fontSize: 12,
              fontWeight: 500,
              background: 'var(--color-neutral-9)',
              color: 'var(--color-neutral-1)',
              textDecoration: 'none',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1)',
              transition: 'opacity 0.12s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.opacity = '0.88' }}
            onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.opacity = '1' }}
          >
            Early access
          </a>
        </div>
      </div>
    </nav>
  )
}
