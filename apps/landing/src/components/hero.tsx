import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ArrowRight, Zap, GitBranch, Clock } from 'lucide-react'

gsap.registerPlugin(useGSAP)

/* ─── App mockup ──────────────────────────────────────────── */

const AGENTS = [
  { name: 'Claude Code', task: 'Refactoring auth module', status: 'running',  accent: 'var(--color-accent)',         progress: 72 },
  { name: 'Codex',       task: 'Writing unit tests',      status: 'running',  accent: 'var(--color-accent-session)', progress: 45 },
  { name: 'Cursor',      task: 'Awaiting CI → resume',    status: 'awaiting', accent: 'var(--color-accent-legacy)',  progress: 100 },
  { name: 'Claude Code', task: 'Updating docs',           status: 'done',     accent: 'var(--color-accent-scope)',   progress: 100 },
]

function RunDot({ status }: { status: string }) {
  if (status === 'running')
    return (
      <span className="relative inline-flex w-2 h-2">
        <span
          className="absolute inset-0 rounded-full animate-ping"
          style={{ background: 'var(--color-accent)', opacity: 0.4 }}
        />
        <span
          className="relative block w-2 h-2 rounded-full"
          style={{ background: 'var(--color-accent)' }}
        />
      </span>
    )
  if (status === 'awaiting')
    return <span className="block w-2 h-2 rounded-full" style={{ background: 'var(--color-accent-legacy)' }} />
  return <span className="block w-2 h-2 rounded-full" style={{ background: 'var(--color-accent-scope)' }} />
}

function AgentRow({ a }: { a: typeof AGENTS[0] }) {
  return (
    <div
      className="agent-row flex items-center gap-3 px-3 h-8 rounded-md"
      style={{
        background: 'var(--color-fill)',
        border: '1px solid var(--color-border)',
      }}
    >
      <RunDot status={a.status} />
      <span
        className="text-[11px] font-medium w-24 shrink-0 truncate"
        style={{ color: 'var(--color-neutral-8)' }}
      >
        {a.name}
      </span>
      <span
        className="text-[11px] flex-1 truncate"
        style={{ color: 'var(--color-neutral-6)' }}
      >
        {a.task}
      </span>
      {/* Progress bar */}
      <div
        className="w-16 h-0.5 rounded-full shrink-0"
        style={{ background: 'var(--color-neutral-4)' }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${a.progress}%`,
            background: a.accent,
            opacity: 0.8,
          }}
        />
      </div>
    </div>
  )
}

function AppMockup() {
  return (
    <div
      className="hero-mockup w-full rounded-xl overflow-hidden"
      style={{
        background: 'var(--color-neutral-2)',
        border: '1px solid var(--color-border)',
        /* inset-shadow for surface texture — design system rule */
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
      }}
    >
      {/* Window chrome */}
      <div
        className="flex items-center gap-3 h-9 px-4"
        style={{
          background: 'var(--color-neutral-2)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <div className="flex gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--color-neutral-4)' }} />
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--color-neutral-4)' }} />
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--color-neutral-4)' }} />
        </div>
        <div className="flex-1 flex items-center justify-center">
          <span
            className="text-[11px] px-3 h-5 flex items-center rounded-md"
            style={{
              background: 'var(--color-neutral-3)',
              color: 'var(--color-neutral-6)',
              border: '1px solid var(--color-border)',
            }}
          >
            Cradle — 4 agents active
          </span>
        </div>
      </div>

      {/* Layout */}
      <div className="flex" style={{ height: 300 }}>
        {/* Sidebar */}
        <div
          className="shrink-0 flex flex-col"
          style={{
            width: 160,
            background: 'var(--color-neutral-2)',
            borderRight: '1px solid var(--color-border)',
          }}
        >
          {/* Workspace */}
          <div
            className="flex items-center gap-2 px-3 h-10"
            style={{ borderBottom: '1px solid var(--color-border)' }}
          >
            <div
              className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
              style={{
                background: 'var(--color-accent)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.15)',
              }}
            >
              <span className="text-[8px] font-bold" style={{ color: '#fff' }}>C</span>
            </div>
            <span className="text-[11px] truncate" style={{ color: 'var(--color-neutral-7)' }}>my-saas-app</span>
          </div>

          {/* Nav */}
          <div className="flex flex-col gap-0.5 p-2">
            {[
              { icon: Zap, label: 'Agents', active: true },
              { icon: GitBranch, label: 'Sessions', active: false },
              { icon: Clock, label: 'Timeline', active: false },
            ].map(item => (
              <div
                key={item.label}
                className="flex items-center gap-2 px-2 h-7 rounded-md"
                style={{
                  background: item.active ? 'rgba(59,130,246,0.08)' : 'transparent',
                }}
              >
                <item.icon
                  className="w-3 h-3 shrink-0"
                  style={{ color: item.active ? 'var(--color-accent)' : 'var(--color-neutral-5)' }}
                />
                <span
                  className="text-[11px]"
                  style={{ color: item.active ? 'var(--color-neutral-8)' : 'var(--color-neutral-5)' }}
                >
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Content */}
        <div
          className="flex-1 flex flex-col"
          style={{ background: 'var(--color-neutral-1)' }}
        >
          {/* Breadcrumb bar */}
          <div
            className="flex items-center gap-1.5 px-4 h-8 shrink-0"
            style={{
              borderBottom: '1px solid var(--color-border)',
              background: 'var(--color-neutral-1)',
            }}
          >
            <span className="text-[11px]" style={{ color: 'var(--color-neutral-6)' }}>Agents</span>
            <span className="text-[10px]" style={{ color: 'var(--color-neutral-5)' }}>/</span>
            <span className="text-[11px]" style={{ color: 'var(--color-neutral-7)' }}>Running</span>
            <div className="flex-1" />
            <div
              className="flex items-center gap-1 text-[10px] px-2 h-5 rounded"
              style={{
                background: 'rgba(59,130,246,0.08)',
                color: 'var(--color-accent)',
                border: '1px solid rgba(59,130,246,0.14)',
              }}
            >
              <span>+</span>
              <span>New agent</span>
            </div>
          </div>

          {/* Agent list */}
          <div className="flex-1 overflow-hidden p-3 flex flex-col gap-1.5">
            {AGENTS.map((a, i) => (
              <AgentRow key={i} a={a} />
            ))}
          </div>
        </div>

        {/* Right panel — activity */}
        <div
          className="shrink-0 flex flex-col"
          style={{
            width: 180,
            background: 'var(--color-neutral-2)',
            borderLeft: '1px solid var(--color-border)',
          }}
        >
          <div
            className="flex items-center px-3 h-8"
            style={{ borderBottom: '1px solid var(--color-border)' }}
          >
            <span className="text-[11px]" style={{ color: 'var(--color-neutral-5)' }}>Activity</span>
          </div>
          <div className="flex flex-col gap-2.5 p-3">
            {[
              { when: 'now', text: 'PR #142 merged',          accent: 'var(--color-accent-scope)' },
              { when: '2m',  text: 'CI passed on main',       accent: 'var(--color-accent)' },
              { when: '5m',  text: 'Agent resumed task',      accent: 'var(--color-accent-session)' },
              { when: '11m', text: 'Codex: 3 tests written',  accent: 'var(--color-accent-legacy)' },
              { when: '18m', text: 'Session checkpoint saved', accent: 'var(--color-neutral-5)' },
            ].map((ev, i) => (
              <div key={i} className="flex items-start gap-2">
                <span
                  className="text-[10px] shrink-0 w-5"
                  style={{ color: 'var(--color-neutral-5)' }}
                >
                  {ev.when}
                </span>
                <div className="flex items-start gap-1.5 min-w-0">
                  <div
                    className="w-1 h-1 rounded-full shrink-0 mt-1"
                    style={{ background: ev.accent }}
                  />
                  <span
                    className="text-[10px] leading-tight"
                    style={{ color: 'var(--color-neutral-6)' }}
                  >
                    {ev.text}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Hero ────────────────────────────────────────────────── */

export function Hero() {
  const sectionRef = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })
      tl
        .from('.hero-eyebrow', { y: 10, opacity: 0, duration: 0.5 })
        .from('.hero-headline', { y: 18, opacity: 0, duration: 0.65 }, '-=0.25')
        .from('.hero-desc', { y: 14, opacity: 0, duration: 0.55 }, '-=0.35')
        .from('.hero-ctas', { y: 10, opacity: 0, duration: 0.45 }, '-=0.25')
        .from('.hero-meta', { y: 8, opacity: 0, duration: 0.4 }, '-=0.2')
        .from('.hero-mockup', { y: 28, opacity: 0, duration: 0.8, ease: 'power2.out' }, '-=0.4')
        .from('.agent-row', { y: 6, opacity: 0, duration: 0.3, stagger: 0.07 }, '-=0.5')
    },
    { scope: sectionRef }
  )

  return (
    <section
      ref={sectionRef}
      className="flex flex-col items-center justify-center text-center"
      style={{ paddingTop: 120, paddingBottom: 80 }}
    >
      <div style={{ maxWidth: 640, padding: '0 24px' }}>
        {/* Eyebrow */}
        <p
          className="hero-eyebrow"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: '0.06em',
            color: 'var(--color-accent)',
            marginBottom: 20,
          }}
        >
          AI Development Orchestrator
        </p>

        {/* Headline */}
        <h1
          className="hero-headline"
          style={{
            fontSize: 'clamp(2rem, 5vw, 3.25rem)',
            fontWeight: 600,
            lineHeight: 1.1,
            letterSpacing: '-0.03em',
            color: 'var(--color-neutral-9)',
            marginBottom: 20,
          }}
        >
          The command center
          <br />
          for all your AI coding tools.
        </h1>

        {/* Description */}
        <p
          className="hero-desc"
          style={{
            fontSize: 15,
            lineHeight: 1.7,
            color: 'var(--color-neutral-6)',
            maxWidth: 480,
            margin: '0 auto 36px',
          }}
        >
          You use Claude Code, Cursor, Copilot — maybe Codex too. Each has its own terminal, its own window, its own context. Cradle brings every agent into one command center.
        </p>

        {/* CTAs */}
        <div className="hero-ctas flex items-center justify-center gap-3 flex-wrap" style={{ marginBottom: 28 }}>
          <a
            href="#get-started"
            className="inline-flex items-center gap-2"
            style={{
              height: 36,
              padding: '0 18px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 500,
              background: 'var(--color-neutral-9)',
              color: 'var(--color-neutral-1)',
              /* inset-shadow for texture */
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12)',
              textDecoration: 'none',
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.opacity = '0.9' }}
            onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.opacity = '1' }}
          >
            Download for macOS
            <ArrowRight style={{ width: 14, height: 14 }} />
          </a>
          <a
            href="#how-it-works"
            style={{
              height: 36,
              padding: '0 18px',
              borderRadius: 8,
              fontSize: 13,
              color: 'var(--color-neutral-7)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-fill)',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.color = 'var(--color-neutral-8)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.color = 'var(--color-neutral-7)' }}
          >
            See how it works
          </a>
        </div>

        {/* Meta */}
        <div
          className="hero-meta flex items-center justify-center gap-6"
          style={{ color: 'var(--color-neutral-5)', fontSize: 12 }}
        >
          {['6+ AI runtimes', 'Local-first', 'Open source'].map(t => (
            <span key={t} className="flex items-center gap-1.5">
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--color-neutral-5)', display: 'inline-block' }} />
              {t}
            </span>
          ))}
        </div>
      </div>

      {/* Mockup */}
      <div style={{ width: '100%', maxWidth: 900, padding: '56px 24px 0' }}>
        <AppMockup />
      </div>
    </section>
  )
}
