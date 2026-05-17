// Input: HTTP shell APIs, PTY WebSocket live channel, xterm Terminal + full addon suite, app CSS theme vars
// Output: ShellView — interactive shell terminal for the bottom panel
// Position: Rendered as the bottom panel for chat sessions; ptyId is panel-scoped

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
import { createPtyChannel } from './pty-channel'
import { startShell, stopShell } from './shell-api'

const EXIT_BANNER = '\r\n\x1B[2m[Process exited]\x1B[0m\r\n'
const MAX_TRANSCRIPT_CHARS = 8_000

// eslint-disable-next-line no-control-regex
const RE_OSC = /\u001B\][^\u0007]*(\u0007|\u001B\\)/g
// eslint-disable-next-line no-control-regex, regexp/no-obscure-range
const RE_CSI = /\u001B\[[0-?]*[ -/]*[@-~]/g
const RE_CR = /\r/g
// eslint-disable-next-line no-control-regex
const RE_BS = /\u0008/g

function toPlainTerminalText(value: string): string {
  return value
    .replace(RE_OSC, '')
    .replace(RE_CSI, '')
    .replace(RE_CR, '')
    .replace(RE_BS, '')
}

interface ShellViewProps {
  /** Stable ID for this shell PTY — typically `shell:<sessionId>:<generation>` */
  ptyId: string
  /** Working directory for the shell. Must be an absolute path. */
  cwd: string
  /** Whether the owning bottom panel is currently open. */
  active?: boolean
  /** Called when the shell process exits, so the parent can reset the key. */
  onExited?: () => void
}

export function ShellView({ ptyId, cwd, active = true, onExited }: ShellViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const transcriptRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (!active) {
      return
    }

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
    let exitShown = false

    function setTranscript(next: string) {
      const transcript = transcriptRef.current
      if (!transcript) {
        return
      }
      transcript.textContent = next.slice(-MAX_TRANSCRIPT_CHARS)
    }

    function appendTranscript(next: string) {
      const transcript = transcriptRef.current
      if (!transcript) {
        return
      }
      const current = transcript.textContent ?? ''
      transcript.textContent = `${current}${next}`.slice(-MAX_TRANSCRIPT_CHARS)
    }

    function writeSnapshot(buffer: string, running: boolean) {
      terminal.reset()
      setTranscript(toPlainTerminalText(buffer))
      if (buffer) {
        terminal.write(buffer)
      }
      if (!running && !exitShown) {
        exitShown = true
        appendTranscript(toPlainTerminalText(EXIT_BANNER))
        terminal.write(EXIT_BANNER)
      }
    }

    const channel = createPtyChannel({
      socketPath: `/terminal-sessions/shell/${encodeURIComponent(ptyId)}/socket`,
      onSnapshot(event) {
        writeSnapshot(event.buffer, event.running)
      },
      onOutput(event) {
        if (event.data) {
          appendTranscript(toPlainTerminalText(event.data))
          terminal.write(event.data)
        }
      },
      onExit() {
        if (!exitShown) {
          exitShown = true
          appendTranscript(toPlainTerminalText(EXIT_BANNER))
          terminal.write(EXIT_BANNER)
        }
        onExited?.()
      },
    })

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
        channel.sendResize(lastCols, lastRows)
      }, 100)
    }

    async function initShell(cols: number, rows: number) {
      terminal.resize(cols, rows)
      lastCols = cols
      lastRows = rows

      await startShell({ ptyId, cwd, cols, rows })
      channel.connect()
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
      channel.sendInput(data)
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
      void stopShell(ptyId).catch(() => {})
      channel.close()
      dataDisposable.dispose()
      resizeObserver.disconnect()
      darkMq.removeEventListener('change', onColorSchemeChange)
      terminal.dispose()
    }
  }, [ptyId, cwd, active, onExited])

  return (
    <div
      className="h-full w-full overflow-hidden bg-background"
      data-testid="shell-view"
      data-shell-view="true"
    >
      <div
        ref={containerRef}
        className="h-full w-full overflow-hidden"
        style={{ padding: '4px 8px' }}
      />
      <pre className="sr-only" data-testid="shell-view-transcript" ref={transcriptRef} />
    </div>
  )
}
