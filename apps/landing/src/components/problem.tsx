import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { MessageSquare, Terminal, Layers, Eye } from 'lucide-react'

gsap.registerPlugin(useGSAP, ScrollTrigger)

const PAIN_POINTS = [
  {
    Icon: Layers,
    accent: 'var(--color-accent-agent)',
    title: 'Six tools, six windows',
    desc: 'Claude Code in one terminal. Cursor in another. Copilot somewhere in VS Code. Codex in its own UI. Context is scattered.',
  },
  {
    Icon: Eye,
    accent: 'var(--color-accent-legacy)',
    title: 'Zero visibility',
    desc: 'Which agent is still running? Which one got stuck? What did it do while you were in a meeting?',
  },
  {
    Icon: MessageSquare,
    accent: 'var(--color-accent-session)',
    title: 'Manual coordination',
    desc: 'Wait for CI? Check it yourself. PR merged? Go back and tell the agent. You\'re doing the agent\'s job.',
  },
  {
    Icon: Terminal,
    accent: 'var(--color-accent)',
    title: 'Context dies with the session',
    desc: 'Close the tab and the work is gone. No history, no checkpoints, no way to resume where the agent left off.',
  },
]

export function ProblemSection() {
  const sectionRef = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      gsap.from('.prob-header', {
        y: 24, opacity: 0, duration: 0.7, ease: 'power3.out',
        scrollTrigger: { trigger: '.prob-header', start: 'top 82%' },
      })
      gsap.from('.pain-card', {
        y: 24, opacity: 0, duration: 0.6, stagger: 0.1, ease: 'power3.out',
        scrollTrigger: { trigger: '.pain-grid', start: 'top 78%' },
      })
    },
    { scope: sectionRef }
  )

  return (
    <section
      ref={sectionRef}
      id="problem"
      style={{
        padding: '96px 24px',
        borderTop: '1px solid var(--color-border)',
      }}
    >
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        {/* Header */}
        <div className="prob-header" style={{ textAlign: 'center', marginBottom: 56 }}>
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              letterSpacing: '0.06em',
              color: 'var(--color-neutral-5)',
              marginBottom: 16,
            }}
          >
            The problem
          </p>
          <h2
            style={{
              fontSize: 'clamp(1.6rem, 3.5vw, 2.4rem)',
              fontWeight: 600,
              lineHeight: 1.15,
              letterSpacing: '-0.025em',
              color: 'var(--color-neutral-9)',
              marginBottom: 16,
            }}
          >
            Your AI tools are brilliant.
            <br />
            <span style={{ color: 'var(--color-neutral-5)' }}>Managing them is a mess.</span>
          </h2>
          <p
            style={{
              fontSize: 14,
              lineHeight: 1.7,
              color: 'var(--color-neutral-6)',
              maxWidth: 440,
              margin: '0 auto',
            }}
          >
            You spend more time coordinating tools than actually shipping. That's not a you problem — it's a missing layer problem.
          </p>
        </div>

        {/* Grid */}
        <div
          className="pain-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 12,
          }}
        >
          {PAIN_POINTS.map(p => (
            <div
              key={p.title}
              className="pain-card"
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
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 16,
                  background: 'var(--color-neutral-4)',
                }}
              >
                <p.Icon style={{ width: 15, height: 15, color: p.accent }} />
              </div>
              <h3
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--color-neutral-8)',
                  marginBottom: 8,
                }}
              >
                {p.title}
              </h3>
              <p
                style={{
                  fontSize: 13,
                  lineHeight: 1.65,
                  color: 'var(--color-neutral-6)',
                }}
              >
                {p.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
