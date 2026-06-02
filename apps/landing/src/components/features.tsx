import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Zap, Clock, Shield, Puzzle, ArrowRight } from 'lucide-react'

gsap.registerPlugin(useGSAP, ScrollTrigger)

/* ─── Feature visuals ─────────────────────────────────────── */

function OrchestrationVisual() {
  const agents = [
    { name: 'Claude Code', task: 'refactor auth', progress: 72, accent: 'var(--color-accent)' },
    { name: 'Codex',        task: 'write tests',   progress: 47, accent: 'var(--color-accent-session)' },
    { name: 'Cursor',       task: 'update docs',   progress: 83, accent: 'var(--color-accent-scope)' },
  ]
  return (
    <div
      style={{
        borderRadius: 10,
        background: 'var(--color-neutral-3)',
        border: '1px solid var(--color-border)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
        padding: 20,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: 11, color: 'var(--color-neutral-6)', flex: 1 }}>Parallel agents — same workspace</span>
        <span
          style={{
            fontSize: 10,
            color: 'var(--color-accent)',
            background: 'rgba(59,130,246,0.08)',
            border: '1px solid rgba(59,130,246,0.14)',
            borderRadius: 4,
            padding: '1px 8px',
          }}
        >
          3 running
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {agents.map(a => (
          <div key={a.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: a.accent,
                width: 88,
                flexShrink: 0,
                fontFamily: 'var(--font-mono)',
              }}
            >
              {a.name}
            </span>
            <span style={{ fontSize: 11, color: 'var(--color-neutral-6)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {a.task}
            </span>
            <div
              style={{
                width: 60,
                height: 3,
                borderRadius: 2,
                background: 'var(--color-neutral-4)',
                flexShrink: 0,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${a.progress}%`,
                  background: a.accent,
                  borderRadius: 2,
                  opacity: 0.85,
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginTop: 16,
          paddingTop: 14,
          borderTop: '1px solid var(--color-border)',
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--color-neutral-6)', flex: 1 }}>Kanban tracking across all tasks</span>
        <ArrowRight style={{ width: 12, height: 12, color: 'var(--color-neutral-5)' }} />
      </div>
    </div>
  )
}

function SessionAwaitVisual() {
  const steps = [
    { label: 'Agent pushed PR #142',        accent: 'var(--color-accent-scope)',  done: true,  time: '14:22' },
    { label: 'Waiting for CI to pass…',     accent: 'var(--color-accent-legacy)', active: true, time: '14:23' },
    { label: 'Resume and merge on success', accent: 'var(--color-accent)',        faded: true,  time: '—' },
  ]
  return (
    <div
      style={{
        borderRadius: 10,
        background: 'var(--color-neutral-3)',
        border: '1px solid var(--color-border)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
        padding: 20,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
        {steps.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, opacity: s.faded ? 0.35 : 1 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: s.done ? `color-mix(in srgb, ${s.accent} 15%, transparent)` : 'var(--color-neutral-4)',
                  border: `1px solid ${s.done || s.active ? s.accent : 'var(--color-neutral-4)'}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {s.done
                  ? <span style={{ fontSize: 9, color: s.accent }}>✓</span>
                  : s.active
                    ? <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.accent, animation: 'pulse 2s infinite', display: 'block' }} />
                    : null
                }
              </div>
              {i < steps.length - 1 && (
                <div
                  style={{
                    width: 1,
                    height: 14,
                    marginTop: 2,
                    background: s.done ? s.accent : 'var(--color-border)',
                    opacity: s.done ? 0.3 : 1,
                  }}
                />
              )}
            </div>
            <div style={{ paddingTop: 2 }}>
              <p style={{ fontSize: 12, color: 'var(--color-neutral-7)', marginBottom: 2 }}>{s.label}</p>
              <p style={{ fontSize: 10, color: 'var(--color-neutral-5)', fontFamily: 'var(--font-mono)' }}>{s.time}</p>
            </div>
          </div>
        ))}
      </div>
      <div
        style={{
          padding: '10px 12px',
          borderRadius: 7,
          background: 'rgba(245,158,11,0.06)',
          border: '1px solid rgba(245,158,11,0.14)',
        }}
      >
        <p style={{ fontSize: 11, color: 'var(--color-accent-legacy)' }}>
          Session paused · waiting for CI · auto-resumes on success
        </p>
      </div>
    </div>
  )
}

function LocalFirstVisual() {
  const rows = [
    { key: 'API keys',        val: 'Keychain encrypted' },
    { key: 'Session history', val: 'Local SQLite' },
    { key: 'Agent output',    val: 'On-disk only' },
    { key: 'Telemetry',       val: 'None' },
  ]
  return (
    <div
      style={{
        borderRadius: 10,
        background: 'var(--color-neutral-3)',
        border: '1px solid var(--color-border)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          borderRadius: 7,
          background: 'var(--color-neutral-4)',
          marginBottom: 8,
        }}
      >
        <Shield style={{ width: 14, height: 14, color: 'var(--color-accent-scope)', flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: 'var(--color-neutral-7)' }}>Data never leaves your machine</span>
      </div>
      {rows.map(r => (
        <div key={r.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: 'var(--color-neutral-6)' }}>{r.key}</span>
          <span
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 4,
              background: 'rgba(16,185,129,0.08)',
              color: 'var(--color-accent-scope)',
              border: '1px solid rgba(16,185,129,0.14)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {r.val}
          </span>
        </div>
      ))}
    </div>
  )
}

function PluginsVisual() {
  const plugins = [
    { name: 'browser-use',  desc: 'Web automation',    accent: 'var(--color-accent)' },
    { name: 'system-info',  desc: 'System metrics',    accent: 'var(--color-accent-session)' },
    { name: 'cc-switch',    desc: 'Context switching',  accent: 'var(--color-accent-scope)' },
    { name: 'your-plugin',  desc: 'Build anything…',   accent: 'var(--color-neutral-5)', custom: true },
  ]
  return (
    <div
      style={{
        borderRadius: 10,
        background: 'var(--color-neutral-3)',
        border: '1px solid var(--color-border)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
        padding: 20,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 8,
      }}
    >
      {plugins.map(p => (
        <div
          key={p.name}
          style={{
            padding: '12px',
            borderRadius: 7,
            background: p.custom ? 'transparent' : 'var(--color-neutral-4)',
            border: `1px solid ${p.custom ? 'var(--color-neutral-4)' : 'var(--color-border)'}`,
            borderStyle: p.custom ? 'dashed' : 'solid',
          }}
        >
          <Puzzle
            style={{
              width: 12,
              height: 12,
              color: p.accent,
              marginBottom: 8,
              opacity: p.custom ? 0.4 : 1,
            }}
          />
          <p
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: p.custom ? 'var(--color-neutral-5)' : 'var(--color-neutral-8)',
              fontFamily: 'var(--font-mono)',
              marginBottom: 3,
            }}
          >
            {p.name}
          </p>
          <p
            style={{
              fontSize: 10,
              color: p.custom ? 'var(--color-neutral-4)' : 'var(--color-neutral-6)',
            }}
          >
            {p.desc}
          </p>
        </div>
      ))}
    </div>
  )
}

/* ─── Features section ────────────────────────────────────── */

const FEATURES = [
  {
    id: 'orchestration',
    Icon: Zap,
    accent: 'var(--color-accent)',
    badge: 'Multi-agent',
    title: 'Run four agents on the same codebase. Simultaneously.',
    desc: "Love Claude Code? Run four of them at once. Cradle orchestrates every agent as a parallel worker — each with its own task, Kanban card, and live status.",
    Visual: OrchestrationVisual,
  },
  {
    id: 'session-await',
    Icon: Clock,
    accent: 'var(--color-accent-legacy)',
    badge: 'Session Await',
    title: "Your agent pushed a PR. It's waiting for CI. You don't have to be.",
    desc: "Set a condition — \"resume when CI passes\", \"wait for PR review\" — and Cradle suspends the session. When the condition fires, the agent picks up exactly where it left off.",
    Visual: SessionAwaitVisual,
  },
  {
    id: 'local-first',
    Icon: Shield,
    accent: 'var(--color-accent-scope)',
    badge: 'Local-first',
    title: 'Your code is yours. It never leaves your machine.',
    desc: 'No cloud relay, no telemetry, no third-party logging. API keys in system keychain. Session history in local SQLite. Cradle runs entirely on your hardware.',
    Visual: LocalFirstVisual,
  },
  {
    id: 'plugins',
    Icon: Puzzle,
    accent: 'var(--color-accent-session)',
    badge: 'Extensible',
    title: "A plugin system built for what we haven't imagined yet.",
    desc: "Cradle ships with a plugin SDK. Add new agent runtimes, tools, workflow triggers, or integrations. Browser automation, CI hooks — the surface area is yours.",
    Visual: PluginsVisual,
  },
]

export function Features() {
  const sectionRef = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      FEATURES.forEach(f => {
        const sel = `.feat-${f.id}`
        gsap.from(`${sel} .feat-text`, {
          y: 24, opacity: 0, duration: 0.8, ease: 'power3.out',
          scrollTrigger: { trigger: sel, start: 'top 76%' },
        })
        gsap.from(`${sel} .feat-visual`, {
          y: 24, opacity: 0, duration: 0.8, delay: 0.12, ease: 'power3.out',
          scrollTrigger: { trigger: sel, start: 'top 76%' },
        })
      })
    },
    { scope: sectionRef }
  )

  return (
    <section
      ref={sectionRef}
      id="features"
      style={{
        padding: '96px 24px',
        borderTop: '1px solid var(--color-border)',
      }}
    >
      <div style={{ maxWidth: 880, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 80 }}>
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              letterSpacing: '0.06em',
              color: 'var(--color-neutral-5)',
              marginBottom: 16,
            }}
          >
            What Cradle does
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
            Everything you need to orchestrate AI.
            <br />
            <span style={{ color: 'var(--color-neutral-5)' }}>Nothing you don't.</span>
          </h2>
        </div>

        {/* Feature rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 80 }}>
          {FEATURES.map((f, i) => {
            const isEven = i % 2 === 0
            return (
              <div
                key={f.id}
                className={`feat-${f.id}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                  gap: 48,
                  alignItems: 'center',
                }}
              >
                <div
                  className="feat-text"
                  style={{ order: isEven ? 1 : 2 }}
                >
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      marginBottom: 20,
                    }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 7,
                        background: 'var(--color-neutral-4)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
                      }}
                    >
                      <f.Icon style={{ width: 13, height: 13, color: f.accent }} />
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        fontFamily: 'var(--font-mono)',
                        color: f.accent,
                        letterSpacing: '0.04em',
                      }}
                    >
                      {f.badge}
                    </span>
                  </div>
                  <h3
                    style={{
                      fontSize: 'clamp(1.1rem, 2vw, 1.4rem)',
                      fontWeight: 600,
                      lineHeight: 1.3,
                      letterSpacing: '-0.02em',
                      color: 'var(--color-neutral-9)',
                      marginBottom: 14,
                    }}
                  >
                    {f.title}
                  </h3>
                  <p
                    style={{
                      fontSize: 14,
                      lineHeight: 1.7,
                      color: 'var(--color-neutral-6)',
                    }}
                  >
                    {f.desc}
                  </p>
                </div>

                <div
                  className="feat-visual"
                  style={{ order: isEven ? 2 : 1 }}
                >
                  <f.Visual />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
