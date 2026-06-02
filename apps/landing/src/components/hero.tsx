/**
 * Hero — Icon reveal → position transition → content appear
 *
 * Sequence: Icon appears dead-center → moves up to final position →
 * headline, subline, CTAs fade in staggered.
 */
import { useRef } from 'react'
import { motion } from 'motion/react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Download } from 'lucide-react'

gsap.registerPlugin(useGSAP, ScrollTrigger)

/* ─── Hero ───────────────────────────────────────────────────── */

export function Hero() {
  const sectionRef = useRef<HTMLElement>(null)
  const iconRef = useRef<HTMLDivElement>(null)

  useGSAP(() => {
    // Calculate how far icon needs to move from center to final position
    const section = sectionRef.current
    const icon = iconRef.current
    if (!section || !icon) return

    const sectionH = section.offsetHeight
    const iconH = icon.offsetHeight
    // Read icon's actual rendered position within the section
    const sectionTop = section.getBoundingClientRect().top
    const iconTop = icon.getBoundingClientRect().top
    const targetTop = iconTop - sectionTop
    const centerY = (sectionH - iconH) / 2
    const offsetY = centerY - targetTop

    // Set initial state — everything hidden
    gsap.set('.hero-icon', { y: offsetY, scale: 0.6, opacity: 0, filter: 'blur(12px)' })
    gsap.set(['.hero-title', '.hero-sub', '.hero-ctas', '.hero-scroll'], { opacity: 0, y: 30 })

    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })

    // Phase 1: Icon appears at center
    tl.to('.hero-icon', {
      scale: 1, opacity: 1, filter: 'blur(0px)',
      duration: 0.8, ease: 'expo.out',
    })
    // Phase 2: Icon moves up to final position
    .to('.hero-icon', {
      y: 0,
      duration: 1, ease: 'power3.inOut',
    }, '+=0.3')
    // Phase 3: Content reveals
    .to('.hero-title', { opacity: 1, y: 0, duration: 0.8 }, '-=0.3')
    .to('.hero-sub', { opacity: 1, y: 0, duration: 0.7 }, '-=0.4')
    .to('.hero-ctas', { opacity: 1, y: 0, duration: 0.6 }, '-=0.3')
    .to('.hero-scroll', { opacity: 1, y: 0, duration: 0.5 }, '-=0.2')

    // Parallax on scroll — targets the WRAPPER, not the icon itself
    gsap.to('.hero-icon-wrap', {
      y: -50,
      scrollTrigger: {
        trigger: section,
        start: 'top top',
        end: 'bottom top',
        scrub: 1,
      },
    })
  }, { scope: sectionRef })

  return (
    <section
      ref={sectionRef}
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        textAlign: 'center',
        paddingTop: 'clamp(48px, 18dvh, 180px)',
        paddingBottom: 60,
        paddingLeft: 24,
        paddingRight: 24,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* App Icon — wrapper for parallax, inner for intro animation */}
      <div className="hero-icon-wrap">
        <div
          ref={iconRef}
          className="hero-icon"
          style={{
            position: 'relative',
            marginBottom: 'clamp(20px, 3dvh, 48px)',
          }}
        >
        {/* Ambient glow */}
        <motion.div
          animate={{ opacity: [0.3, 0.6, 0.3], scale: [1, 1.08, 1] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            position: 'absolute',
            inset: -24,
            borderRadius: 52,
            background: 'radial-gradient(circle, rgba(255,255,255,0.07) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />
        <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 40, width: 180, height: 180 }}>
          <img
            src="/icon.png"
            alt="Cradle"
            width={180}
            height={180}
            fetchPriority="high"
            decoding="async"
            style={{ display: 'block', borderRadius: 40 }}
          />
          {/* Shine sweep */}
          <motion.div
            animate={{ x: ['-130%', '230%'] }}
            transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 5, ease: 'easeInOut' }}
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.13) 50%, transparent 60%)',
              pointerEvents: 'none',
            }}
          />
        </div>
      </div>
      </div>

      {/* Headline */}
      <h1
        className="hero-title"
        style={{
          fontSize: 'clamp(3rem, 9vw, 7rem)',
          fontWeight: 700,
          lineHeight: 0.95,
          letterSpacing: '-0.04em',
          color: 'var(--color-neutral-9)',
          marginBottom: 'clamp(14px, 2dvh, 24px)',
        }}
      >
        One layer above
        <br />
        <span style={{ color: 'var(--color-neutral-5)' }}>your AI tools.</span>
      </h1>

      {/* Subline */}
      <p
        className="hero-sub"
        style={{
          fontSize: 'clamp(1rem, 1.8vw, 1.25rem)',
          lineHeight: 1.6,
          color: 'var(--color-neutral-6)',
          maxWidth: 520,
          marginBottom: 'clamp(20px, 3dvh, 40px)',
        }}
      >
        Your AI coding tools are brilliant. Managing them is a mess. Cradle is the command center
        that coordinates all of them.
      </p>

      {/* CTAs */}
      <div className="hero-ctas" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <motion.a
          href="#download"
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.97 }}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '12px 28px', borderRadius: 9,
            background: 'var(--color-neutral-9)',
            color: 'var(--color-neutral-1)',
            fontWeight: 600, fontSize: 14,
            textDecoration: 'none',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.15)',
          }}
        >
          <Download style={{ width: 15, height: 15 }} />
          Download for macOS
        </motion.a>
      </div>
    </section>
  )
}
