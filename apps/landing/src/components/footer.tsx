import { Code2, ExternalLink } from 'lucide-react'

const LINKS = {
  Product: [
    { label: 'Features', href: '#features' },
    { label: 'How it works', href: '#how-it-works' },
    { label: 'Download', href: '#download' },
  ],
  Developer: [
    { label: 'GitHub', href: 'https://github.com/wibus-wee/Cradle' },
    { label: 'Documentation', href: '#docs' },
    { label: 'Plugin SDK', href: '#sdk' },
  ],
}

export function Footer() {
  return (
    <footer
      style={{
        padding: '48px 24px 32px',
        borderTop: '1px solid var(--color-border)',
      }}
    >
      <div
        style={{
          maxWidth: 880,
          margin: '0 auto',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 40,
            justifyContent: 'space-between',
            marginBottom: 40,
          }}
        >
          {/* Logo + tagline */}
          <div style={{ minWidth: 180 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 5,
                  background: 'var(--color-accent)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12)',
                }}
              >
                <Code2 style={{ width: 11, height: 11, color: 'var(--color-neutral-9)' }} />
              </div>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: '-0.01em',
                  color: 'var(--color-neutral-9)',
                }}
              >
                Cradle
              </span>
            </div>
            <p
              style={{
                fontSize: 12,
                lineHeight: 1.6,
                color: 'var(--color-neutral-5)',
                maxWidth: 200,
              }}
            >
              The neutral orchestration layer for AI coding tools.
            </p>
          </div>

          {/* Link groups */}
          <div style={{ display: 'flex', gap: 48, flexWrap: 'wrap' }}>
            {Object.entries(LINKS).map(([group, items]) => (
              <div key={group}>
                <p
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: 'var(--color-neutral-6)',
                    marginBottom: 12,
                    fontFamily: 'var(--font-mono)',
                    letterSpacing: '0.04em',
                  }}
                >
                  {group}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {items.map(item => (
                    <a
                      key={item.label}
                      href={item.href}
                      target={item.href.startsWith('http') ? '_blank' : undefined}
                      rel={item.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: 12,
                        color: 'var(--color-neutral-6)',
                        textDecoration: 'none',
                        transition: 'color 0.15s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-neutral-8)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-neutral-6)')}
                    >
                      {item.label}
                      {item.href.startsWith('http') && (
                        <ExternalLink style={{ width: 10, height: 10 }} />
                      )}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom bar */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            paddingTop: 20,
            borderTop: '1px solid var(--color-border)',
          }}
        >
          <p style={{ fontSize: 11, color: 'var(--color-neutral-5)' }}>
            © {new Date().getFullYear()} Cradle. Open source under MIT license.
          </p>
          <p
            style={{
              fontSize: 11,
              color: 'var(--color-neutral-5)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            Local-first · Private · Extensible
          </p>
        </div>
      </div>
    </footer>
  )
}
