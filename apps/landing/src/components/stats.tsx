/**
 * Stats — animated count-up numbers on scroll
 */
import { useEffect, useRef, useState } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(useGSAP, ScrollTrigger)

const STATS = [
  { value: 4,   suffix: 'x',  label: 'parallel agents per workspace' },
  { value: 0,   suffix: 'ms', label: 'data leaves your machine' },
  { value: 100, suffix: '%',  label: 'open source, MIT licensed' },
  { value: 1,   suffix: ' layer', label: 'above all your existing tools' },
]

function CountUp({ target, suffix, triggered }: { target: number; suffix: string; triggered: boolean }) {
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    if (!triggered) return
    let start = 0
    const duration = 1200
    const step = 1000 / 60
    const increment = (target / (duration / step))
    const id = setInterval(() => {
      start += increment
      if (start >= target) {
        setDisplay(target)
        clearInterval(id)
      } else {
        setDisplay(Math.floor(start))
      }
    }, step)
    return () => clearInterval(id)
  }, [triggered, target])

  return (
    <span>
      {display}{suffix}
    </span>
  )
}

export function StatsSection() {
  const sectionRef = useRef<HTMLElement>(null)
  const [triggered, setTriggered] = useState(false)

  useGSAP(
    () => {
      ScrollTrigger.create({
        trigger: sectionRef.current,
        start: 'top 80%',
        onEnter: () => setTriggered(true),
      })
      gsap.from('.stat-item', {
        y: 20, opacity: 0, duration: 0.6, stagger: 0.08, ease: 'power3.out',
        scrollTrigger: { trigger: '.stats-row', start: 'top 82%' },
      })
    },
    { scope: sectionRef }
  )

  return (
    <section
      ref={sectionRef}
      style={{ padding: '48px 24px', borderTop: '1px solid var(--color-border)' }}
    >
      <div
        className="stats-row"
        style={{
          maxWidth: 880,
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 1,
        }}
      >
        {STATS.map((s, i) => (
          <div
            key={i}
            className="stat-item"
            style={{
              padding: '20px 24px',
              borderRight: i < STATS.length - 1 ? '1px solid var(--color-border)' : 'none',
            }}
          >
            <p
              style={{
                fontSize: 'clamp(1.6rem, 3vw, 2.2rem)',
                fontWeight: 700,
                letterSpacing: '-0.03em',
                color: 'var(--color-neutral-9)',
                fontVariantNumeric: 'tabular-nums',
                lineHeight: 1,
                marginBottom: 6,
              }}
            >
              <CountUp target={s.value} suffix={s.suffix} triggered={triggered} />
            </p>
            <p style={{ fontSize: 11, color: 'var(--color-neutral-5)', fontFamily: 'var(--font-mono)' }}>
              {s.label}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
