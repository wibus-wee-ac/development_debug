// Input: window.ptyPush push API, ipc.pty IPC methods, xterm Terminal + FitAddon + WebglAddon, app CSS theme vars
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
    void (async () => {
      const running = await ipc!.pty.isPtyRunning(sessionId)
      if (running) {
        // Replay historical output so user sees the current state
        const buf = await ipc!.pty.getPtyBuffer(sessionId)
        if (buf) {
          terminal.write(buf)
        }
        // Sync terminal size to existing PTY
        fitAddon.fit()
        await ipc!.pty.resizePty(sessionId, terminal.cols, terminal.rows)
      }
      else {
        // First mount — start the PTY
        fitAddon.fit()
        await ipc!.pty.startPty(sessionId, terminal.cols, terminal.rows)
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
    const unsubData = window.ptyPush.onData((sid, data) => {
      if (sid === sessionId) {
        terminal.write(data)
      }
    })

    // Show exit message
    const unsubExit = window.ptyPush.onExit((sid) => {
      if (sid === sessionId) {
        terminal.write('\r\n\x1B[2m[Process exited]\x1B[0m\r\n')
      }
    })

    // Resize observer: refit on container size change
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry || entry.contentRect.width === 0 || entry.contentRect.height === 0) {
        return
      }
      fitAddon.fit()
      void ipc?.pty.resizePty(sessionId, terminal.cols, terminal.rows)
    })
    resizeObserver.observe(containerRef.current)

    return () => {
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
      className="h-full w-full overflow-hidden bg-[#ffffff] dark:bg-[#0d1117]"
      style={{ padding: '4px 8px' }}
      onDrop={(e) => {
        e.preventDefault()
        const path = e.dataTransfer.getData('text/plain')
        if (path) {
          void ipc?.pty.writePty(sessionId, `${path} `)
        }
      }}
      onDragOver={(e) => e.preventDefault()}
    />
  )
}
