/**
 * Footer — minimal, generous.
 */

import { Container } from './primitives'

export function Footer() {
  return (
    <footer style={{ borderTop: '1px solid var(--border-subtle)', padding: '32px 0' }}>
      <Container
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src="/icon-64.webp" alt="" width={18} height={18} style={{ borderRadius: 5 }} />
          <span style={{ fontSize: 13, color: 'var(--text-secondary)', letterSpacing: '-0.01em' }}>
            Cradle — orchestrate your AI tools.
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <a
            href="https://github.com/wibus-wee/Cradle"
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 12.5, color: 'var(--text-muted)', textDecoration: 'none' }}
          >
            GitHub
          </a>
          <a
            href="https://x.com/wibus_wee"
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 12.5, color: 'var(--text-muted)', textDecoration: 'none' }}
          >
            By wibus
          </a>
        </div>
      </Container>
    </footer>
  )
}
