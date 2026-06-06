import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { CheckCircle2, Minus, X } from 'lucide-react'
import { useRef } from 'react'

gsap.registerPlugin(useGSAP, ScrollTrigger)

const TOOLS = ['Cursor', 'Claude Code', 'Devin', 'Cradle']
const ROWS = [
  { label: 'Multi-agent orchestration', vals: [false, false, false, true] },
  { label: 'Parallel agents, same codebase', vals: [false, false, 'partial', true] },
  { label: 'Session Await / Resume', vals: [false, false, 'partial', true] },
  { label: 'Local-first, data on device', vals: [false, false, false, true] },
  { label: 'Works with any AI tool', vals: [false, false, false, true] },
  { label: 'Live agent observability', vals: [false, 'partial', false, true] },
  { label: 'Plugin / extension system', vals: ['partial', false, false, true] },
]

function CellIcon({ val }: { val: boolean | string }) {
  if (val === true) { return <CheckCircle2 style={{ width: 14, height: 14, color: 'var(--color-accent-scope)' }} /> }
  if (val === 'partial') { return <Minus style={{ width: 14, height: 14, color: 'var(--color-accent-legacy)' }} /> }
  return <X style={{ width: 12, height: 12, color: 'var(--color-neutral-5)' }} />
}

export function ComparisonSection() {
  const sectionRef = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      gsap.from('.comp-header', {
        y: 20,
opacity: 0,
duration: 0.7,
ease: 'power3.out',
        scrollTrigger: { trigger: '.comp-header', start: 'top 82%' },
      })
      gsap.from('.comp-table', {
        y: 28,
opacity: 0,
duration: 0.7,
ease: 'power3.out',
        scrollTrigger: { trigger: '.comp-table', start: 'top 80%' },
      })
    },
    { scope: sectionRef },
  )

  return (
    <section
      ref={sectionRef}
      id="comparison"
      style={{
        padding: '96px 24px',
        borderTop: '1px solid var(--color-border)',
      }}
    >
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <div className="comp-header" style={{ textAlign: 'center', marginBottom: 48 }}>
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              letterSpacing: '0.06em',
              color: 'var(--color-neutral-5)',
              marginBottom: 16,
            }}
          >
            Why Cradle
          </p>
          <h2
            style={{
              fontSize: 'clamp(1.6rem, 3.5vw, 2.4rem)',
              fontWeight: 600,
              lineHeight: 1.15,
              letterSpacing: '-0.025em',
              color: 'var(--color-neutral-9)',
              marginBottom: 14,
            }}
          >
            Not a replacement. A command center.
          </h2>
          <p
            style={{
              fontSize: 14,
              lineHeight: 1.7,
              color: 'var(--color-neutral-6)',
              maxWidth: 420,
              margin: '0 auto',
            }}
          >
            Cradle doesn't compete with your tools. It sits above them — the neutral orchestration layer no one else is building.
          </p>
        </div>

        <div
          className="comp-table"
          style={{
            borderRadius: 10,
            border: '1px solid var(--color-border)',
            overflow: 'hidden',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr
                style={{
                  background: 'var(--color-neutral-3)',
                  borderBottom: '1px solid var(--color-border)',
                }}
              >
                <th
                  style={{
                    padding: '10px 16px',
                    textAlign: 'left',
                    fontSize: 11,
                    fontWeight: 500,
                    color: 'var(--color-neutral-6)',
                    width: '42%',
                    fontFamily: 'var(--font-sans)',
                  }}
                >
                  Capability
                </th>
                {TOOLS.map(tool => (
                  <th
                    key={tool}
                    style={{
                      padding: '10px 16px',
                      textAlign: 'center',
                      fontSize: 11,
                      fontWeight: 500,
                      color: tool === 'Cradle' ? 'var(--color-accent)' : 'var(--color-neutral-5)',
                      fontFamily: 'var(--font-sans)',
                    }}
                  >
                    {tool}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, i) => (
                <tr
                  key={row.label}
                  style={{
                    background: i % 2 === 0 ? 'var(--color-neutral-1)' : 'var(--color-neutral-3)',
                    borderBottom: i < ROWS.length - 1 ? '1px solid var(--color-border)' : 'none',
                  }}
                >
                  <td
                    style={{
                      padding: '10px 16px',
                      fontSize: 12,
                      color: 'var(--color-neutral-7)',
                    }}
                  >
                    {row.label}
                  </td>
                  {row.vals.map((v, j) => (
                    <td key={j} style={{ padding: '10px 16px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <CellIcon val={v} />
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 24,
            marginTop: 16,
          }}
        >
          {[
            { Icon: CheckCircle2, color: 'var(--color-accent-scope)', label: 'Supported' },
            { Icon: Minus, color: 'var(--color-accent-legacy)', label: 'Partial / cloud only' },
            { Icon: X, color: 'var(--color-neutral-5)', label: 'Not available' },
          ].map(l => (
            <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <l.Icon style={{ width: 12, height: 12, color: l.color }} />
              <span style={{ fontSize: 11, color: 'var(--color-neutral-6)' }}>{l.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
