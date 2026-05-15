// Input: HTTP shell APIs, SSE stream, xterm Terminal + full addon suite, app CSS theme vars
// Output: ShellView — interactive shell terminal for the bottom panel
// Position: Rendered as the bottom panel for chat sessions; ptyId is session-scoped

import '@xterm/xterm/css/xterm.css'

import { ClipboardAddon } from '@xterm/addon-clipboard'
import { FitAddon } from '@xterm/addon-fit'
import { ImageAddon } from '@xterm/addon-image'
import { LigaturesAddon } from '@xterm/addon-ligatures'
import { ProgressAddon } from '@xterm/addon-progress'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import { useEffect, useRef } from 'react'

import { getAppTerminalTheme } from './app-theme'
import { attachMacKeyboardHandler } from './keyboard-handler'
import { getShellStreamUrl, resizeShell, sendShellInput, startShell } from './shell-api'

interface ShellViewProps {
  /** Stable ID for this shell PTY — typically `shell:<sessionId>:<generation>` */
  ptyId: string
  /** Working directory for the shell. Must be an absolute path. */
  cwd: string
  /** Called when the shell process exits, so the parent can reset the key. */
  onExited?: () => void
}

export function ShellView({ ptyId, cwd, onExited }: ShellViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) {
      return
    }

    const el = containerRef.current
    const darkMq = window.matchMedia('(prefers-color-scheme: dark)')
    const terminal = new Terminal({
      theme: getAppTerminalTheme(),
      fontFamily: '"GeistMono", "Cascadia Code", "Fira Mono", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      allowTransparency: false,
      allowProposedApi: true,
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(el)

    // ── Always-on addons ──────────────────────────────────────────────────────
    terminal.loadAddon(new Unicode11Addon())
    terminal.unicode.activeVersion = '11'
    terminal.loadAddon(new ClipboardAddon())
    terminal.loadAddon(new ProgressAddon())
    const searchAddon = new SearchAddon()
    terminal.loadAddon(searchAddon)

    // ── GPU-accelerated renderer ──────────────────────────────────────────────
    let webglLoaded = false
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => {
        webgl.dispose()
      })
      terminal.loadAddon(webgl)
      webglLoaded = true
      terminal.loadAddon(new ImageAddon())
    }
    catch { /* WebGL unavailable — fall back to DOM renderer */ }

    if (!webglLoaded) {
      try {
        terminal.loadAddon(new LigaturesAddon())
      }
      catch { /* ligatures unavailable */ }
    }

    // ── Unified resize debounce ───────────────────────────────────────────────
    let lastCols = 0
    let lastRows = 0
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    let pendingCols = 0
    let pendingRows = 0
    let shellStarted = false
    let initDebounceTimer: ReturnType<typeof setTimeout> | null = null
    let eventSource: EventSource | null = null

    function applyResize(cols: number, rows: number) {
      if (cols <= 0 || rows <= 0) {
        return
      }
      pendingCols = cols
      pendingRows = rows
      if (resizeTimer) {
        clearTimeout(resizeTimer)
      }
      resizeTimer = setTimeout(() => {
        resizeTimer = null
        if (pendingCols === lastCols && pendingRows === lastRows) {
          return
        }
        terminal.resize(pendingCols, pendingRows)
        lastCols = pendingCols
        lastRows = pendingRows
        void resizeShell(ptyId, lastCols, lastRows)
      }, 100)
    }

    async function initShell(cols: number, rows: number) {
      terminal.resize(cols, rows)
      lastCols = cols
      lastRows = rows

      await startShell({ ptyId, cwd, cols, rows })

      // Connect SSE stream for output
      eventSource = new EventSource(getShellStreamUrl(ptyId))
      eventSource.onmessage = (ev) => {
        try {
          const event = JSON.parse(ev.data) as { type: string, data?: string, exitCode?: number }
          if (event.type === 'terminal.buffer' || event.type === 'terminal.data') {
            if (event.data) {
              terminal.write(event.data)
            }
          }
          else if (event.type === 'terminal.exit') {
            terminal.write('\r\n\x1B[2m[Process exited]\x1B[0m\r\n')
            onExited?.()
          }
        }
        catch { /* ignore parse errors */ }
      }
    }

    function fitAndNotify() {
      const dims = fitAddon.proposeDimensions()
      if (!dims || dims.cols <= 0 || dims.rows <= 0) {
        return
      }

      if (!shellStarted) {
        if (initDebounceTimer) {
          clearTimeout(initDebounceTimer)
        }
        initDebounceTimer = setTimeout(() => {
          initDebounceTimer = null
          if (shellStarted) {
            return
          }
          const final = fitAddon.proposeDimensions()
          if (!final || final.cols <= 0 || final.rows <= 0) {
            return
          }
          shellStarted = true
          void initShell(final.cols, final.rows)
        }, 100)
        return
      }

      applyResize(dims.cols, dims.rows)
    }

    // ── Initial setup ────────────────────────────────────────────────────────
    void (async () => {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

      const dims = fitAddon.proposeDimensions()
      if (!dims || dims.cols <= 0 || dims.rows <= 0) {
        return
      }

      if (initDebounceTimer) {
        clearTimeout(initDebounceTimer)
        initDebounceTimer = null
      }
      shellStarted = true
      await initShell(dims.cols, dims.rows)
    })()

    // ── Live updates ─────────────────────────────────────────────────────────
    attachMacKeyboardHandler(terminal)

    const onColorSchemeChange = (_e: MediaQueryListEvent) => {
      terminal.options.theme = getAppTerminalTheme()
    }
    darkMq.addEventListener('change', onColorSchemeChange)

    const dataDisposable = terminal.onData((data) => {
      void sendShellInput(ptyId, data)
    })

    const resizeObserver = new ResizeObserver(() => {
      fitAndNotify()
    })
    resizeObserver.observe(el)

    return () => {
      if (resizeTimer) {
        clearTimeout(resizeTimer)
      }
      if (initDebounceTimer) {
        clearTimeout(initDebounceTimer)
      }
      eventSource?.close()
      dataDisposable.dispose()
      resizeObserver.disconnect()
      darkMq.removeEventListener('change', onColorSchemeChange)
      terminal.dispose()
    }
  }, [ptyId, cwd, onExited])

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden bg-background"
      data-shell-view="true"
      style={{ padding: '4px 8px' }}
    />
  )
}
