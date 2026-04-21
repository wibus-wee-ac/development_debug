// Input: window.ptyPush push API, ipc.pty IPC methods, xterm Terminal + FitAddon + WebglAddon, app CSS theme vars
// Output: ShellView — interactive shell terminal for the bottom panel
// Position: Rendered as the bottom panel for chat sessions; ptyId is session-scoped

import '@xterm/xterm/css/xterm.css'

import { ipc } from '@renderer/lib/ipc'
import { useLayoutStore } from '@renderer/store/layout'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import { useEffect, useRef } from 'react'

import { getAppTerminalTheme } from './app-theme'
import { attachMacKeyboardHandler } from './keyboard-handler'

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
  const setBottomPanelOpen = useLayoutStore(s => s.setBottomPanelOpen)

  useEffect(() => {
    if (!containerRef.current || !ipc) return

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

    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => { webgl.dispose() })
      terminal.loadAddon(webgl)
    }
    catch { /* WebGL unavailable */ }

    void (async () => {
      const running = await ipc!.pty.isPtyRunning(ptyId)
      if (running) {
        const buf = await ipc!.pty.getPtyBuffer(ptyId)
        if (buf) terminal.write(buf)
        fitAddon.fit()
        await ipc!.pty.resizePty(ptyId, terminal.cols, terminal.rows)
      }
      else {
        fitAddon.fit()
        await ipc!.pty.startShell(ptyId, cwd, terminal.cols, terminal.rows)
      }
    })()

    attachMacKeyboardHandler(terminal)

    // Live theme update on dark/light switch
    const onColorSchemeChange = (_e: MediaQueryListEvent) => {
      terminal.options.theme = getAppTerminalTheme()
    }
    darkMq.addEventListener('change', onColorSchemeChange)

    const dataDisposable = terminal.onData((data) => {
      void ipc?.pty.writePty(ptyId, data)
    })

    const unsubData = window.ptyPush.onData((id, data) => {
      if (id === ptyId) terminal.write(data)
    })

    const unsubExit = window.ptyPush.onExit((id) => {
      if (id !== ptyId) return
      terminal.write('\r\n\x1B[2m[Process exited]\x1B[0m\r\n')
      // Close the panel and signal parent to reset generation so next open starts fresh
      setBottomPanelOpen(false)
      onExited?.()
    })

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry || entry.contentRect.width === 0 || entry.contentRect.height === 0) return
      fitAddon.fit()
      void ipc?.pty.resizePty(ptyId, terminal.cols, terminal.rows)
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      dataDisposable.dispose()
      unsubData()
      unsubExit()
      resizeObserver.disconnect()
      darkMq.removeEventListener('change', onColorSchemeChange)
      // DO NOT stopPty — shell persists across panel open/close cycles
      terminal.dispose()
    }
  }, [ptyId, cwd])

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden bg-[#ffffff] dark:bg-[#0d1117]" data-shell-view="true"
      style={{ padding: '4px 8px' }}
    />
  )
}
