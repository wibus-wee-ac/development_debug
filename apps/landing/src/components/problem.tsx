/**
 * Problem section — 4 pain point cards with cursor spotlight effect
 */
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Eye, Layers, MessageSquare, Terminal } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

gsap.registerPlugin(useGSAP, ScrollTrigger)

const PAIN_POINTS = [
  {
    Icon: Layers,
    accent: 'var(--color-accent-agent)',
    accentRgb: '244,63,94',
    title: 'Six tools, six windows',
    desc: 'Claude Code in one terminal. Cursor in another. Copilot somewhere in VS Code. Codex in its own UI. Context is scattered.',
  },
  {
    Icon: Eye,
    accent: 'var(--color-accent-legacy)',
    accentRgb: '245,158,11',
    title: 'Zero visibility',
    desc: 'Which agent is still running? Which one got stuck? What did it do while you were in a meeting?',
  },
  {
    Icon: MessageSquare,
    accent: 'var(--color-accent-session)',
    accentRgb: '139,92,246',
    title: 'Manual coordination',
    desc: 'Wait for CI? Check it yourself. PR merged? Go back and tell the agent. You\'re doing the agent\'s job.',
  },
  {
    Icon: Terminal,
    accent: 'var(--color-accent)',
    accentRgb: '59,130,246',
    title: 'Context dies with the session',
    desc: 'Close the tab and the work is gone. No history, no checkpoints, no way to resume where the agent left off.',
  },
]

function PainCard({ Icon, accent, accentRgb, title, desc }: typeof PAIN_POINTS[0]) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [spot, setSpot] = useState<{ x: number, y: number } | null>(null)

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = cardRef.current?.getBoundingClientRect()
    if (!rect) { return }
    setSpot({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }, [])

  const onMouseLeave = useCallback(() => setSpot(null), [])

  return (
    <div
      ref={cardRef}
      className="pain-card"
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      style={{
        position: 'relative',
        padding: '24px',
        borderRadius: 10,
        background: 'var(--color-neutral-3)',
        border: `1px solid ${spot ? `rgba(${accentRgb},0.18)` : 'var(--color-border)'}`,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
        overflow: 'hidden',
        cursor: 'default',
        transition: 'border-color 0.25s',
      }}
    >
      {spot && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background: `radial-gradient(180px circle at ${spot.x}px ${spot.y}px, rgba(${accentRgb},0.09), transparent 70%)`,
          }}
        />
      )}
      <div style={{ position: 'relative' }}>
        <div style={{
          width: 32,
height: 32,
borderRadius: 8,
          display: 'flex',
alignItems: 'center',
justifyContent: 'center',
          marginBottom: 16,
background: 'var(--color-neutral-4)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
        }}
        >
          <Icon style={{ width: 15, height: 15, color: accent }} />
        </div>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-neutral-8)', marginBottom: 8 }}>
          {title}
        </h3>
        <p style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--color-neutral-6)' }}>
          {desc}
        </p>
      </div>
    </div>
  )
}

export function ProblemSection() {
  const sectionRef = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      gsap.from('.prob-header', {
        y: 24,
opacity: 0,
duration: 0.7,
ease: 'power3.out',
        scrollTrigger: { trigger: '.prob-header', start: 'top 82%' },
      })
      gsap.from('.pain-card', {
        y: 24,
opacity: 0,
duration: 0.6,
stagger: 0.1,
ease: 'power3.out',
        scrollTrigger: { trigger: '.pain-grid', start: 'top 78%' },
      })
    },
    { scope: sectionRef },
  )

  return (
    <section
      ref={sectionRef}
      id="problem"
      style={{ padding: '96px 24px', borderTop: '1px solid var(--color-border)' }}
    >
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <div className="prob-header" style={{ textAlign: 'center', marginBottom: 56 }}>
          <p style={{
            fontFamily: 'var(--font-mono)',
fontSize: 11,
            letterSpacing: '0.06em',
color: 'var(--color-neutral-5)',
marginBottom: 16,
          }}
          >
The problem
          </p>
          <h2 style={{
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
          <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--color-neutral-6)', maxWidth: 440, margin: '0 auto' }}>
            You spend more time coordinating tools than actually shipping. That's not a you problem — it's a missing layer problem.
          </p>
        </div>
        <div className="pain-grid" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 12,
        }}
        >
          {PAIN_POINTS.map(p => (
            <PainCard key={p.title} {...p} />
          ))}
        </div>
      </div>
    </section>
  )
}
