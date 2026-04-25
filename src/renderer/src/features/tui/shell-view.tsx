// Input: window.ptyPush push API, ipc.pty IPC methods, xterm Terminal + FitAddon + WebglAddon + full addon suite, app CSS theme vars
// Output: ShellView — interactive shell terminal for the bottom panel
// Position: Rendered as the bottom panel for chat sessions; ptyId is session-scoped

import '@xterm/xterm/css/xterm.css'

import { ipc } from '@renderer/lib/ipc'
import { useLayoutStore } from '@renderer/store/layout'
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
    if (!containerRef.current || !ipc) { return }

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
    // Unicode 11: correct cell widths for emojis and wide CJK characters
    terminal.loadAddon(new Unicode11Addon())
    terminal.unicode.activeVersion = '11'

    // Clipboard: OSC 52 clipboard read/write support
    terminal.loadAddon(new ClipboardAddon())

    // Progress: OSC 9;4 progress sequences (e.g. from pnpm, cargo, etc.)
    terminal.loadAddon(new ProgressAddon())

    // Search: terminal text search (used by search UI when implemented)
    const searchAddon = new SearchAddon()
    terminal.loadAddon(searchAddon)

    // ── GPU-accelerated renderer ──────────────────────────────────────────────
    let webglLoaded = false
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => { webgl.dispose() })
      terminal.loadAddon(webgl)
      webglLoaded = true

      // Image rendering (Sixel / iTerm2 inline images) — requires WebGL
      terminal.loadAddon(new ImageAddon())
    }
    catch { /* WebGL unavailable — fall back to DOM renderer */ }

    // Ligatures: font ligature support (works in both WebGL and DOM renderer)
    if (!webglLoaded) {
      // Only load in non-WebGL mode as ligatures addon handles canvas internally
      try {
        terminal.loadAddon(new LigaturesAddon())
      }
      catch { /* ligatures unavailable */ }
    }

    // ── Unified resize debounce ───────────────────────────────────────────────
    // terminal.resize() clears the WebGL canvas on every call, even for a 1-row change.
    // The panel uses a spring height animation (0 → target), firing ResizeObserver on
    // every frame (~60fps). Calling terminal.resize() on each frame causes the visible
    // "full-terminal redraw flash". A unified 100ms debounce ensures we only resize once
    // after the layout stabilises — during animation the terminal canvas stays at its
    // last valid dimensions and the container reveals existing content smoothly.
    let lastCols = 0
    let lastRows = 0
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    let pendingCols = 0
    let pendingRows = 0
    // shellStarted: true once startShell / first resizePty has been dispatched.
    // Prevents double-start when the initial async and the first ResizeObserver
    // callback race (e.g. panel was hidden on mount and becomes visible quickly).
    let shellStarted = false
    // initDebounceTimer: debounces the first shell start until the open animation
    // has settled, so we don't start the shell at intermediate/invalid dimensions.
    let initDebounceTimer: ReturnType<typeof setTimeout> | null = null

    function applyResize(cols: number, rows: number) {
      if (cols <= 0 || rows <= 0) { return }
      // Track latest pending dimensions even while debouncing
      pendingCols = cols
      pendingRows = rows
      // Each new event resets the 100ms window; terminal.resize() fires only once
      // after the layout (animation, drag, window resize) stabilises.
      if (resizeTimer) { clearTimeout(resizeTimer) }
      resizeTimer = setTimeout(() => {
        resizeTimer = null
        if (pendingCols === lastCols && pendingRows === lastRows) { return }
        terminal.resize(pendingCols, pendingRows)
        lastCols = pendingCols
        lastRows = pendingRows
        void ipc?.pty.resizePty(ptyId, lastCols, lastRows)
      }, 100)
    }

    /** Start or reattach the shell once we have valid terminal dimensions. */
    async function initShell(cols: number, rows: number) {
      terminal.resize(cols, rows)
      lastCols = cols
      lastRows = rows

      const running = await ipc!.pty.isPtyRunning(ptyId)
      if (running) {
        const buf = await ipc!.pty.getPtyBuffer(ptyId)
        if (buf) { terminal.write(buf) }
        await ipc!.pty.resizePty(ptyId, cols, rows)
      }
      else {
        await ipc!.pty.startShell(ptyId, cwd, cols, rows)
      }
    }

    function fitAndNotify() {
      const dims = fitAddon.proposeDimensions()
      if (!dims || dims.cols <= 0 || dims.rows <= 0) { return }

      if (!shellStarted) {
        // Debounce the initial shell start to let open-animation layout settle,
        // matching VS Code's disableLayout pattern for terminal transitions.
        // Each ResizeObserver callback during animation resets the 100ms window.
        if (initDebounceTimer) { clearTimeout(initDebounceTimer) }
        initDebounceTimer = setTimeout(() => {
          initDebounceTimer = null
          if (shellStarted) { return } // initial async may have won the race
          const final = fitAddon.proposeDimensions()
          if (!final || final.cols <= 0 || final.rows <= 0) { return }
          shellStarted = true
          void initShell(final.cols, final.rows)
        }, 100)
        return
      }

      applyResize(dims.cols, dims.rows)
    }

    // ── Initial setup ────────────────────────────────────────────────────────
    // One rAF lets xterm measure its character dimensions before proposeDimensions().
    // If the panel is hidden on mount (height: 0), dimensions will be invalid here;
    // the first ResizeObserver callback (fired when the panel opens) handles startup.
    void (async () => {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

      const dims = fitAddon.proposeDimensions()
      if (!dims || dims.cols <= 0 || dims.rows <= 0) {
        // Container is hidden — ResizeObserver will call fitAndNotify when visible
        return
      }

      // Panel is already visible — cancel any debounce and start immediately
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
      void ipc?.pty.writePty(ptyId, data)
    })

    const unsubData = window.ptyPush.onData((id, data) => {
      if (id === ptyId) { terminal.write(data) }
    })

    const unsubExit = window.ptyPush.onExit((id) => {
      if (id !== ptyId) { return }
      terminal.write('\r\n\x1B[2m[Process exited]\x1B[0m\r\n')
      setBottomPanelOpen(false)
      onExited?.()
    })

    const resizeObserver = new ResizeObserver(() => {
      fitAndNotify()
    })
    resizeObserver.observe(el)

    return () => {
      if (resizeTimer) { clearTimeout(resizeTimer) }
      if (initDebounceTimer) { clearTimeout(initDebounceTimer) }
      dataDisposable.dispose()
      unsubData()
      unsubExit()
      resizeObserver.disconnect()
      darkMq.removeEventListener('change', onColorSchemeChange)
      terminal.dispose()
    }
  }, [ptyId, cwd])

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden bg-background"
      data-shell-view="true"
      style={{ padding: '4px 8px' }}
    />
  )
}
