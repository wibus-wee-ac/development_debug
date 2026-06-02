/**
 * Features — sticky scroll panel (Linear/Stripe/Vercel style)
 *
 * Left column: feature text blocks scroll normally.
 * Right column: demo panel is position:sticky — swaps via AnimatePresence
 * as the matching left block enters view (IntersectionObserver).
 */
import { useState, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Zap, Clock, Shield, Puzzle,
  CheckCircle2, RefreshCw, Plus,
  Play, Square,
} from 'lucide-react'

/* ─── Orchestration demo ─────────────────────────────────────── */

const ORCH_AGENTS = [
  { id: 1, name: 'Claude Code', task: 'refactor auth', progress: 68, accent: 'var(--color-accent)' },
  { id: 2, name: 'Codex', task: 'write tests', progress: 41, accent: 'var(--color-accent-session)' },
  { id: 3, name: 'Cursor', task: 'update docs', progress: 83, accent: 'var(--color-accent-scope)' },
]

function OrchestrationDemo() {
  const [running, setRunning] = useState(true)
  const [agents, setAgents] = useState(ORCH_AGENTS)

  const toggle = () => setRunning(r => !r)
  const reset = () => {
    setAgents(ORCH_AGENTS.map(a => ({ ...a, progress: Math.floor(Math.random() * 55) + 20 })))
    setRunning(true)
  }

  return (
    <div style={{
      borderRadius: 10, background: 'var(--color-neutral-3)',
      border: '1px solid var(--color-border)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)', overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', padding: '8px 14px',
        borderBottom: '1px solid var(--color-border)', gap: 8,
      }}>
        <span style={{ fontSize: 11, color: 'var(--color-neutral-6)', flex: 1, fontFamily: 'var(--font-mono)' }}>
          {agents.length} parallel agents
        </span>
        <motion.button whileTap={{ scale: 0.92 }} onClick={toggle} style={{
          padding: '2px 8px', borderRadius: 4,
          border: '1px solid var(--color-border)', background: 'var(--color-neutral-4)',
          color: 'var(--color-neutral-7)', fontSize: 10, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono)',
        }}>
          {running ? <><Square style={{ width: 8, height: 8 }} /> pause</> : <><Play style={{ width: 8, height: 8 }} /> resume</>}
        </motion.button>
        <motion.button whileTap={{ scale: 0.92 }} onClick={reset} style={{
          padding: '2px 6px', borderRadius: 4,
          border: '1px solid var(--color-border)', background: 'var(--color-neutral-4)',
          color: 'var(--color-neutral-6)', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center',
        }}>
          <RefreshCw style={{ width: 8, height: 8 }} />
        </motion.button>
      </div>
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {agents.map(a => (
          <div key={a.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <motion.span style={{ width: 7, height: 7, borderRadius: '50%', background: a.accent, flexShrink: 0, display: 'block' }}
                animate={running ? { opacity: [1, 0.3, 1] } : {}}
                transition={{ duration: 1.5, repeat: Infinity }} />
              <span style={{ fontSize: 11, color: a.accent, fontFamily: 'var(--font-mono)', fontWeight: 600, flex: 1 }}>{a.name}</span>
              <span style={{ fontSize: 10, color: 'var(--color-neutral-5)', fontFamily: 'var(--font-mono)' }}>{a.task}</span>
            </div>
            <div style={{ height: 3, borderRadius: 2, background: 'var(--color-neutral-4)', overflow: 'hidden' }}>
              <motion.div style={{ height: '100%', background: a.accent, borderRadius: 2 }}
                animate={{ width: running ? `${Math.min(100, a.progress + 15)}%` : `${a.progress}%` }}
                transition={{ duration: running ? 2.8 : 0.3, ease: 'linear', repeat: running ? Infinity : 0 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── Session Await demo ─────────────────────────────────────── */

function SessionAwaitDemo() {
  const [phase, setPhase] = useState<'waiting' | 'passed' | 'resumed'>('waiting')
  const advance = () => setPhase(p => p === 'waiting' ? 'passed' : p === 'passed' ? 'resumed' : 'waiting')
  const steps = [
    { label: 'PR #142 pushed', done: true },
    { label: 'Waiting for CI…', done: phase !== 'waiting', active: phase === 'waiting' },
    { label: 'CI passed ✓', done: phase === 'resumed', active: phase === 'passed' },
    { label: 'Session resumed', done: false, active: phase === 'resumed' },
  ]

  return (
    <div style={{
      borderRadius: 10, background: 'var(--color-neutral-3)',
      border: '1px solid var(--color-border)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)', padding: 16,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 14 }}>
        {steps.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: !s.done && !s.active ? 0.3 : 1 }}>
            <div style={{
              width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
              background: s.done ? 'rgba(16,185,129,0.15)' : s.active ? 'rgba(245,158,11,0.1)' : 'var(--color-neutral-4)',
              border: `1px solid ${s.done ? 'rgba(16,185,129,0.4)' : s.active ? 'rgba(245,158,11,0.4)' : 'var(--color-border)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {s.done
                ? <CheckCircle2 style={{ width: 10, height: 10, color: 'var(--color-accent-scope)' }} />
                : s.active
                  ? <motion.span
                      style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--color-accent-legacy)', display: 'block' }}
                      animate={{ opacity: [1, 0.3, 1] }}
                      transition={{ duration: 1.2, repeat: Infinity }} />
                  : null
              }
            </div>
            <span style={{ fontSize: 11, color: s.done || s.active ? 'var(--color-neutral-7)' : 'var(--color-neutral-5)', fontFamily: 'var(--font-mono)' }}>
              {s.label}
            </span>
          </div>
        ))}
      </div>
      <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.96 }} onClick={advance}
        style={{
          width: '100%', padding: '8px', borderRadius: 7,
          border: '1px solid var(--color-border)', background: 'var(--color-neutral-4)',
          color: 'var(--color-neutral-7)', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font-mono)',
        }}>
        {phase === 'waiting' ? '→ Simulate CI pass' : phase === 'passed' ? '→ Resume session' : '↺ Reset'}
      </motion.button>
    </div>
  )
}

/* ─── Local-first demo ───────────────────────────────────────── */

function LocalFirstDemo() {
  const [hovered, setHovered] = useState<string | null>(null)
  const rows = [
    { key: 'API keys', val: 'Keychain encrypted' },
    { key: 'Session history', val: 'Local SQLite' },
    { key: 'Agent output', val: 'On-disk only' },
    { key: 'Telemetry', val: 'None — ever' },
  ]
  return (
    <div style={{
      borderRadius: 10, background: 'var(--color-neutral-3)',
      border: '1px solid var(--color-border)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)', overflow: 'hidden',
    }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Shield style={{ width: 12, height: 12, color: 'var(--color-accent-scope)' }} />
        <span style={{ fontSize: 11, color: 'var(--color-neutral-6)', fontFamily: 'var(--font-mono)' }}>Data stays on your machine</span>
      </div>
      {rows.map(r => (
        <motion.div key={r.key}
          onHoverStart={() => setHovered(r.key)}
          onHoverEnd={() => setHovered(null)}
          animate={{ background: hovered === r.key ? 'rgba(16,185,129,0.04)' : 'transparent' }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '9px 14px', borderBottom: '1px solid var(--color-border)', cursor: 'default',
          }}>
          <span style={{ fontSize: 11, color: 'var(--color-neutral-6)', fontFamily: 'var(--font-mono)' }}>{r.key}</span>
          <span style={{
            fontSize: 10, padding: '2px 8px', borderRadius: 4,
            background: 'rgba(16,185,129,0.08)', color: 'var(--color-accent-scope)',
            border: '1px solid rgba(16,185,129,0.14)', fontFamily: 'var(--font-mono)',
          }}>{r.val}</span>
        </motion.div>
      ))}
    </div>
  )
}

/* ─── Plugins demo ───────────────────────────────────────────── */

const PLUGINS_DATA = [
  { name: 'browser-use', desc: 'Web automation', accent: 'var(--color-accent)', installed: true },
  { name: 'system-info', desc: 'System metrics', accent: 'var(--color-accent-session)', installed: true },
  { name: 'cc-switch', desc: 'Context switching', accent: 'var(--color-accent-scope)', installed: false },
]

function PluginsDemo() {
  const [plugins, setPlugins] = useState(PLUGINS_DATA)
  const toggle = useCallback((name: string) => {
    setPlugins(prev => prev.map(p => p.name === name ? { ...p, installed: !p.installed } : p))
  }, [])

  return (
    <div style={{
      borderRadius: 10, background: 'var(--color-neutral-3)',
      border: '1px solid var(--color-border)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)', overflow: 'hidden',
    }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--color-border)' }}>
        <span style={{ fontSize: 11, color: 'var(--color-neutral-6)', fontFamily: 'var(--font-mono)' }}>Plugin registry</span>
      </div>
      {plugins.map(p => (
        <div key={p.name} style={{
          display: 'flex', alignItems: 'center', padding: '10px 14px',
          borderBottom: '1px solid var(--color-border)', gap: 12,
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7, background: 'var(--color-neutral-4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <Puzzle style={{ width: 12, height: 12, color: p.accent }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-neutral-8)', fontFamily: 'var(--font-mono)', marginBottom: 2 }}>{p.name}</p>
            <p style={{ fontSize: 10, color: 'var(--color-neutral-5)' }}>{p.desc}</p>
          </div>
          <motion.button whileTap={{ scale: 0.9 }} onClick={() => toggle(p.name)}
            style={{
              padding: '3px 10px', borderRadius: 5,
              border: `1px solid ${p.installed ? 'rgba(16,185,129,0.3)' : 'var(--color-border)'}`,
              background: p.installed ? 'rgba(16,185,129,0.08)' : 'var(--color-neutral-4)',
              color: p.installed ? 'var(--color-accent-scope)' : 'var(--color-neutral-6)',
              fontSize: 10, cursor: 'pointer', fontFamily: 'var(--font-mono)',
              display: 'flex', alignItems: 'center', gap: 4,
              transition: 'background 0.2s, border-color 0.2s, color 0.2s',
            }}>
            {p.installed
              ? <><CheckCircle2 style={{ width: 9, height: 9 }} /> installed</>
              : <><Plus style={{ width: 9, height: 9 }} /> install</>
            }
          </motion.button>
        </div>
      ))}
      <div style={{ padding: '10px 14px' }}>
        <span style={{ fontSize: 10, color: 'var(--color-neutral-5)', fontFamily: 'var(--font-mono)' }}>
          + build your own with the plugin SDK →
        </span>
      </div>
    </div>
  )
}

/* ─── Features config ────────────────────────────────────────── */

const FEATURES = [
  {
    id: 'orchestration',
    Icon: Zap,
    accent: 'var(--color-accent)',
    badge: 'Multi-agent',
    title: 'Run four agents on the same codebase. Simultaneously.',
    desc: 'Love Claude Code? Run four of them at once. Cradle orchestrates every agent as a parallel worker — each with its own task, Kanban card, and live status.',
    Demo: OrchestrationDemo,
  },
  {
    id: 'session-await',
    Icon: Clock,
    accent: 'var(--color-accent-legacy)',
    badge: 'Session Await',
    title: "Your agent pushed a PR. It's waiting for CI. You don't have to be.",
    desc: 'Set a condition — "resume when CI passes" — and Cradle suspends the session. When the condition fires, the agent picks up exactly where it left off.',
    Demo: SessionAwaitDemo,
  },
  {
    id: 'local-first',
    Icon: Shield,
    accent: 'var(--color-accent-scope)',
    badge: 'Local-first',
    title: 'Your code is yours. It never leaves your machine.',
    desc: 'No cloud relay, no telemetry, no third-party logging. API keys in system keychain. Session history in local SQLite.',
    Demo: LocalFirstDemo,
  },
  {
    id: 'plugins',
    Icon: Puzzle,
    accent: 'var(--color-accent-session)',
    badge: 'Extensible',
    title: "A plugin system built for what we haven't imagined yet.",
    desc: 'Cradle ships with a plugin SDK. Add new runtimes, tools, workflow triggers — the surface area is yours.',
    Demo: PluginsDemo,
  },
]

/* ─── Features section — sticky scroll ──────────────────────── */

export function Features() {
  const [activeId, setActiveId] = useState(FEATURES[0].id)
  const activeFeature = FEATURES.find(f => f.id === activeId) ?? FEATURES[0]

  /* IntersectionObserver: set active feature as its text block enters center */
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = (entry.target as HTMLElement).dataset.feature
            if (id) setActiveId(id)
          }
        }
      },
      { threshold: 0.55 },
    )
    const nodes = document.querySelectorAll('[data-feature]')
    nodes.forEach(n => observer.observe(n))
    return () => observer.disconnect()
  }, [])

  return (
    <section
      id="features"
      style={{
        padding: '96px 24px',
        borderTop: '1px solid var(--color-border)',
      }}
    >
      <div style={{ maxWidth: 960, margin: '0 auto' }}>

        {/* Section header */}
        <div style={{ textAlign: 'center', marginBottom: 80 }}>
          <p style={{
            fontFamily: 'var(--font-mono)', fontSize: 11,
            letterSpacing: '0.06em', color: 'var(--color-neutral-5)', marginBottom: 16,
          }}>What Cradle does</p>
          <h2 style={{
            fontSize: 'clamp(1.6rem, 3.5vw, 2.4rem)', fontWeight: 600,
            lineHeight: 1.15, letterSpacing: '-0.025em', color: 'var(--color-neutral-9)',
          }}>
            Everything you need to orchestrate AI.
            <br />
            <span style={{ color: 'var(--color-neutral-5)' }}>Nothing you don't.</span>
          </h2>
        </div>

        {/* Sticky scroll layout */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 64, alignItems: 'start' }}>

          {/* Left — text blocks scroll */}
          <div>
            {FEATURES.map((f, i) => (
              <div
                key={f.id}
                data-feature={f.id}
                style={{
                  minHeight: '70vh',
                  paddingTop: i === 0 ? 0 : 80,
                  paddingBottom: 80,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  transition: 'opacity 0.3s',
                  opacity: activeId === f.id ? 1 : 0.35,
                }}
              >
                {/* Badge */}
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 7, background: 'var(--color-neutral-4)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
                  }}>
                    <f.Icon style={{ width: 13, height: 13, color: f.accent }} />
                  </div>
                  <span style={{
                    fontSize: 11, fontFamily: 'var(--font-mono)',
                    color: f.accent, letterSpacing: '0.04em',
                  }}>{f.badge}</span>
                </div>

                <h3 style={{
                  fontSize: 'clamp(1.1rem, 2vw, 1.4rem)', fontWeight: 600,
                  lineHeight: 1.3, letterSpacing: '-0.02em',
                  color: 'var(--color-neutral-9)', marginBottom: 14,
                }}>{f.title}</h3>

                <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--color-neutral-6)' }}>
                  {f.desc}
                </p>
              </div>
            ))}
          </div>

          {/* Right — sticky demo panel */}
          <div style={{
            position: 'sticky',
            top: 100,
            alignSelf: 'flex-start',
          }}>
            {/* Feature indicator dots */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
              {FEATURES.map(f => (
                <motion.div
                  key={f.id}
                  animate={{
                    width: activeId === f.id ? 20 : 6,
                    background: activeId === f.id ? f.accent : 'var(--color-neutral-5)',
                  }}
                  transition={{ duration: 0.3 }}
                  style={{ height: 4, borderRadius: 2 }}
                />
              ))}
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={activeFeature.id}
                initial={{ opacity: 0, y: 12, filter: 'blur(4px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -12, filter: 'blur(4px)' }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              >
                <activeFeature.Demo />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  )
}
