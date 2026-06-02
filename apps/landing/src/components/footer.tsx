/**
 * Footer — minimal one-liner
 */

export function Footer() {
  return (
    <footer style={{
      padding: '24px',
      borderTop: '1px solid var(--color-border)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <img src="/icon.png" alt="" width={16} height={16} style={{ borderRadius: 4 }} />
        <span style={{ fontSize: 12, color: 'var(--color-neutral-5)' }}>
          Cradle — orchestrate your AI tools.
        </span>
      </div>
      <span style={{ fontSize: 11, color: 'var(--color-neutral-4)' }}>·</span>
      <span style={{ fontSize: 12, color: 'var(--color-neutral-5)' }}>
        By wibus.Song
      </span>
    </footer>
  )
}
