import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { PlugZap, Layers, Workflow } from 'lucide-react'

gsap.registerPlugin(useGSAP, ScrollTrigger)

const STEPS = [
  {
    Icon: PlugZap,
    accent: 'var(--color-accent)',
    n: '01',
    title: 'Connect your AI tools',
    desc: 'Point Cradle at your existing Claude Code, Cursor, or any other runtime. No migration, no lock-in — your tools stay exactly as they are.',
  },
  {
    Icon: Layers,
    accent: 'var(--color-accent-session)',
    n: '02',
    title: 'Dispatch tasks in parallel',
    desc: 'Create sessions for each agent with a specific goal. Watch them run simultaneously in a unified Kanban board with real-time logs.',
  },
  {
    Icon: Workflow,
    accent: 'var(--color-accent-scope)',
    n: '03',
    title: 'Set conditions and walk away',
    desc: 'Define triggers — "resume after CI passes", "await PR approval" — and Cradle handles coordination. Your agents work while you sleep.',
  },
]

export function HowItWorksSection() {
  const sectionRef = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      gsap.from('.how-header', {
        y: 20, opacity: 0, duration: 0.7, ease: 'power3.out',
        scrollTrigger: { trigger: '.how-header', start: 'top 82%' },
      })
      gsap.from('.how-step', {
        y: 24, opacity: 0, duration: 0.6, stagger: 0.12, ease: 'power3.out',
        scrollTrigger: { trigger: '.how-steps', start: 'top 78%' },
      })
    },
    { scope: sectionRef }
  )

  return (
    <section
      ref={sectionRef}
      id="how-it-works"
      style={{
        padding: '96px 24px',
        borderTop: '1px solid var(--color-border)',
      }}
    >
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <div className="how-header" style={{ textAlign: 'center', marginBottom: 56 }}>
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              letterSpacing: '0.06em',
              color: 'var(--color-neutral-5)',
              marginBottom: 16,
            }}
          >
            Getting started
          </p>
          <h2
            style={{
              fontSize: 'clamp(1.6rem, 3.5vw, 2.4rem)',
              fontWeight: 600,
              lineHeight: 1.15,
              letterSpacing: '-0.025em',
              color: 'var(--color-neutral-9)',
            }}
          >
            How it works
          </h2>
        </div>

        <div
          className="how-steps"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 16,
          }}
        >
          {STEPS.map((s, i) => (
            <div
              key={i}
              className="how-step"
              style={{
                padding: '24px',
                borderRadius: 10,
                background: 'var(--color-neutral-3)',
                border: '1px solid var(--color-border)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 20,
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: 'var(--color-neutral-4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
                  }}
                >
                  <s.Icon style={{ width: 14, height: 14, color: s.accent }} />
                </div>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    color: 'var(--color-neutral-5)',
                  }}
                >
                  {s.n}
                </span>
              </div>
              <h3
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--color-neutral-8)',
                  marginBottom: 8,
                  lineHeight: 1.4,
                }}
              >
                {s.title}
              </h3>
              <p
                style={{
                  fontSize: 13,
                  lineHeight: 1.65,
                  color: 'var(--color-neutral-6)',
                }}
              >
                {s.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
