// Input: unified signal bridge push API, ipc.pty IPC methods, xterm Terminal + FitAddon + WebglAddon, app CSS theme vars
// Output: TuiView — live terminal rendering for cli-tui sessions
// Position: Session view rendered when session.agent resolves to a CliAgent
//
// Lifecycle: PTY runs in main process independently of this component.
// On mount: attach to an existing PTY (if running) or start a new one.
//           If attaching: replay the output buffer so the user sees history.
// On unmount: dispose xterm instance only — PTY keeps running.
// PTY is only stopped when the session is explicitly deleted.

import '@xterm/xterm/css/xterm.css'

import { ipc } from '@renderer/lib/ipc'
import { subscribe } from '@renderer/lib/signal'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import { useEffect, useRef } from 'react'

import { getAppTerminalTheme } from './app-theme'
import { attachMacKeyboardHandler } from './keyboard-handler'

interface TuiViewProps {
  sessionId: string
}

export function TuiView({ sessionId }: TuiViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current || !ipc) {
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
      webgl.onContextLoss(() => { webgl.dispose() })
      terminal.loadAddon(webgl)
    }
    catch { /* WebGL unavailable — xterm falls back to canvas */ }

    // Attach to PTY: start new or replay buffer from existing
    let lastCols = 0
    let lastRows = 0
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    let pendingCols = 0
    let pendingRows = 0

    function applyResize(cols: number, rows: number) {
      if (cols <= 0 || rows <= 0) { return }
      pendingCols = cols
      pendingRows = rows
      if (resizeTimer) { clearTimeout(resizeTimer) }
      resizeTimer = setTimeout(() => {
        resizeTimer = null
        if (pendingCols === lastCols && pendingRows === lastRows) { return }
        terminal.resize(pendingCols, pendingRows)
        lastCols = pendingCols
        lastRows = pendingRows
        void ipc?.pty.resizePty(sessionId, lastCols, lastRows)
      }, 100)
    }

    void (async () => {
      const running = await ipc!.pty.isPtyRunning(sessionId)
      if (running) {
        // Replay historical output so user sees the current state
        const buf = await ipc!.pty.getPtyBuffer(sessionId)
        if (buf) {
          terminal.write(buf)
        }
        // Sync terminal size to existing PTY
        const dims = fitAddon.proposeDimensions()
        if (dims && dims.cols > 0 && dims.rows > 0) {
          terminal.resize(dims.cols, dims.rows)
          lastCols = dims.cols
          lastRows = dims.rows
          await ipc!.pty.resizePty(sessionId, dims.cols, dims.rows)
        }
      }
      else {
        // First mount — start the PTY
        const dims = fitAddon.proposeDimensions()
        if (dims && dims.cols > 0 && dims.rows > 0) {
          terminal.resize(dims.cols, dims.rows)
          lastCols = dims.cols
          lastRows = dims.rows
          await ipc!.pty.startPty(sessionId, dims.cols, dims.rows)
        }
      }
    })()

    attachMacKeyboardHandler(terminal)

    // Live theme update on dark/light switch
    const onColorSchemeChange = (_e: MediaQueryListEvent) => {
      terminal.options.theme = getAppTerminalTheme()
    }
    darkMq.addEventListener('change', onColorSchemeChange)

    // Forward keystrokes to the PTY
    const dataDisposable = terminal.onData((data) => {
      void ipc?.pty.writePty(sessionId, data)
    })

    // Receive raw PTY output
    const unsubData = subscribe('pty:data', ({ sessionId: sid, data }) => {
      if (sid === sessionId) {
        terminal.write(data)
      }
    })

    // Show exit message
    const unsubExit = subscribe('pty:exit', ({ sessionId: sid }) => {
      if (sid === sessionId) {
        terminal.write('\r\n\x1B[2m[Process exited]\x1B[0m\r\n')
      }
    })

    // Resize observer: refit on container size change — unified debounce to prevent
    // terminal.resize() flicker during route transitions and layout animations.
    const resizeObserver = new ResizeObserver(() => {
      const dims = fitAddon.proposeDimensions()
      if (!dims || dims.cols <= 0 || dims.rows <= 0) { return }
      applyResize(dims.cols, dims.rows)
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      if (resizeTimer) { clearTimeout(resizeTimer) }
      dataDisposable.dispose()
      unsubData()
      unsubExit()
      resizeObserver.disconnect()
      darkMq.removeEventListener('change', onColorSchemeChange)
      // DO NOT stopPty — PTY runs independently of this view.
      // Only dispose the xterm instance (which is cheap to recreate).
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
          void ipc?.pty.writePty(sessionId, `${path} `)
        }
      }}
      onDragOver={e => e.preventDefault()}
    />
  )
}
