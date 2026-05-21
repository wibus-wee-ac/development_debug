import type { ITheme } from '@xterm/xterm'

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/**
 * Build an xterm ITheme from the app's current CSS variable palette.
 * Call this at mount-time and on dark/light changes to keep the terminal
 * colours in sync with the rest of the UI.
 */
export function getAppTerminalTheme(): ITheme {
  const bg = cssVar('--background')
  const fg = cssVar('--foreground')
  const muted = cssVar('--muted-foreground')
  const primary = cssVar('--primary')
  const border = cssVar('--border')
  const destructive = cssVar('--destructive')

  return {
    background: bg || '#ffffff',
    foreground: fg || '#1f1f1f',
    cursor: primary || fg || '#1f1f1f',
    cursorAccent: bg || '#ffffff',
    selectionBackground: border || 'rgba(0,0,0,0.12)',
    selectionForeground: fg || '#1f1f1f',

    // ANSI colours — map to app palette where sensible
    black: '#1e1e1e',
    brightBlack: muted || '#737373',
    red: destructive || '#ef4444',
    brightRed: '#f87171',
    green: cssVar('--success') || '#10b981',
    brightGreen: '#34d399',
    yellow: cssVar('--warning') || '#f59e0b',
    brightYellow: '#fbbf24',
    blue: cssVar('--info') || '#3b82f6',
    brightBlue: '#60a5fa',
    magenta: '#a855f7',
    brightMagenta: '#c084fc',
    cyan: '#06b6d4',
    brightCyan: '#22d3ee',
    white: '#e5e5e5',
    brightWhite: '#ffffff',
  }
}
