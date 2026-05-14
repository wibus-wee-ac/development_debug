// Input: HTTP terminal APIs, SSE stream, xterm Terminal + FitAddon + WebglAddon, app CSS theme vars
// Output: TuiView — live terminal rendering for cli-tui sessions
// Position: Session view rendered when session.agent resolves to a CliAgent
//
// Lifecycle: PTY runs in the server independently of this component.
// On mount: call startOrAttach (starts new or reuses existing), then connect SSE stream.
//           Buffer replay comes via the SSE 'terminal.buffer' event.
// On unmount: dispose xterm instance and close SSE — PTY keeps running.
// PTY is only stopped when the session is explicitly deleted.

import '@xterm/xterm/css/xterm.css'

import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import { useEffect, useRef } from 'react'

import { postTerminalSessionsBySessionIdInput, postTerminalSessionsBySessionIdResize, postTerminalSessionsBySessionIdStartOrAttach } from '~/api-gen'
import { getServerUrl } from '~/lib/electron'

import { getAppTerminalTheme } from './app-theme'
import { attachMacKeyboardHandler } from './keyboard-handler'

const SERVER_BASE = getServerUrl()

interface TuiViewProps {
  sessionId: string
}

export function TuiView({ sessionId }: TuiViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) {
      return
    }

    const darkMq = window.matchMedia('(prefers-color-scheme: dark)')
    const terminal = new Terminal({
      theme: getAppTerminalTheme(),
      fontFamily: '"GeistMono", "Cascadia Code", "Fira Mono", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      allowTransparency: false,
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(containerRef.current)

    // Try WebGL renderer
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => {
        webgl.dispose()
      })
      terminal.loadAddon(webgl)
    }
    catch { /* WebGL unavailable — xterm falls back to canvas */ }

    let lastCols = 0
    let lastRows = 0
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    let pendingCols = 0
    let pendingRows = 0

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
        void postTerminalSessionsBySessionIdResize({ path: { sessionId }, body: { cols: lastCols, rows: lastRows } })
      }, 100)
    }

    let eventSource: EventSource | null = null

    void (async () => {
      // Start or attach to terminal, then connect SSE stream
      const dims = fitAddon.proposeDimensions()
      const cols = dims && dims.cols > 0 ? dims.cols : 80
      const rows = dims && dims.rows > 0 ? dims.rows : 24
      terminal.resize(cols, rows)
      lastCols = cols
      lastRows = rows

      await postTerminalSessionsBySessionIdStartOrAttach({
        path: { sessionId },
        body: { cols, rows },
      })

      // Connect to SSE stream for output
      eventSource = new EventSource(`${SERVER_BASE}/terminal-sessions/${sessionId}/stream`)
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
          }
        }
        catch { /* ignore parse errors */ }
      }
    })()

    attachMacKeyboardHandler(terminal)

    // Live theme update on dark/light switch
    const onColorSchemeChange = (_e: MediaQueryListEvent) => {
      terminal.options.theme = getAppTerminalTheme()
    }
    darkMq.addEventListener('change', onColorSchemeChange)

    // Forward keystrokes to the server
    const dataDisposable = terminal.onData((data) => {
      void postTerminalSessionsBySessionIdInput({ path: { sessionId }, body: { data } })
    })

    // Resize observer: refit on container size change
    const resizeObserver = new ResizeObserver(() => {
      const dims = fitAddon.proposeDimensions()
      if (!dims || dims.cols <= 0 || dims.rows <= 0) {
        return
      }
      applyResize(dims.cols, dims.rows)
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      if (resizeTimer) {
        clearTimeout(resizeTimer)
      }
      eventSource?.close()
      dataDisposable.dispose()
      resizeObserver.disconnect()
      darkMq.removeEventListener('change', onColorSchemeChange)
      terminal.dispose()
    }
  }, [sessionId])

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden"
      style={{ padding: '4px 8px' }}
      onDrop={(e) => {
        e.preventDefault()
        const path = e.dataTransfer.getData('text/plain')
        if (path) {
          void postTerminalSessionsBySessionIdInput({ path: { sessionId }, body: { data: `${path} ` } })
        }
      }}
      onDragOver={e => e.preventDefault()}
    />
  )
}
