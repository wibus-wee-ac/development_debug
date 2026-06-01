import { join } from 'node:path'

import { app, BrowserWindow, screen } from 'electron'

import { resolveDesktopPreloadPath, resolveDesktopRendererIndexPath, resolveDesktopRendererTearoffPath } from './desktop-assets'
import { readStoredWindowSize, resolveWindowBoundsNearPoint, resolveWindowSize, writeStoredWindowSize } from './window-state'

const TEAROFF_WINDOW_DEFAULT_WIDTH = 720
const TEAROFF_WINDOW_DEFAULT_HEIGHT = 640
const TEAROFF_WINDOW_MIN_WIDTH = 520
const TEAROFF_WINDOW_MIN_HEIGHT = 420
const TEAROFF_WINDOW_SIZE_FILE = 'tearoff-window-size.json'

export class WindowManager {
  private mainWindow: BrowserWindow | null = null
  private sessionWindows = new Map<string, BrowserWindow>()
  private devtoolWindow: BrowserWindow | null = null
  private serverUrl: string

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl
  }

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  getMainWindow(): BrowserWindow | null {
    return this.mainWindow
  }

  /**
   * Open a session in a new tearoff window.
   * If a window for this session already exists, focus it instead.
   */
  async openSessionWindow(sessionId: string, x: number, y: number): Promise<BrowserWindow> {
    const existing = this.sessionWindows.get(sessionId)
    if (existing && !existing.isDestroyed()) {
      existing.focus()
      return existing
    }

    const releasePoint = resolveTearoffReleasePoint(x, y)
    const targetDisplay = screen.getDisplayNearestPoint(releasePoint)
    const targetSize = resolveWindowSize(
      readStoredWindowSize(join(app.getPath('userData'), TEAROFF_WINDOW_SIZE_FILE)),
      {
        defaultWidth: TEAROFF_WINDOW_DEFAULT_WIDTH,
        defaultHeight: TEAROFF_WINDOW_DEFAULT_HEIGHT,
        minWidth: TEAROFF_WINDOW_MIN_WIDTH,
        minHeight: TEAROFF_WINDOW_MIN_HEIGHT,
      },
      targetDisplay.workArea,
    )
    const targetBounds = resolveWindowBoundsNearPoint(targetSize, releasePoint, targetDisplay.workArea)

    const win = new BrowserWindow({
      ...targetBounds,
      minWidth: TEAROFF_WINDOW_MIN_WIDTH,
      minHeight: TEAROFF_WINDOW_MIN_HEIGHT,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 18 },
      webPreferences: {
        preload: resolveDesktopPreloadPath(__dirname),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: true,
        additionalArguments: [
          `--server-url=${this.serverUrl}`,
          `--session-id=${sessionId}`,
          '--tearoff=true',
        ],
      },
      show: false,
    })

    this.sessionWindows.set(sessionId, win)

    let lastTearoffWindowSize = { width: targetBounds.width, height: targetBounds.height }
    const writeTearoffWindowSize = (): void => {
      if (win.isDestroyed()) {
        writeStoredWindowSize(join(app.getPath('userData'), TEAROFF_WINDOW_SIZE_FILE), lastTearoffWindowSize)
        return
      }
      const { width, height } = win.getBounds()
      lastTearoffWindowSize = { width, height }
      writeStoredWindowSize(join(app.getPath('userData'), TEAROFF_WINDOW_SIZE_FILE), lastTearoffWindowSize)
    }

    win.on('resize', writeTearoffWindowSize)
    win.on('close', writeTearoffWindowSize)

    win.once('ready-to-show', () => {
      win.show()
    })

    win.on('closed', () => {
      writeTearoffWindowSize()
      if (this.sessionWindows.get(sessionId) !== win) {
        return
      }
      this.sessionWindows.delete(sessionId)
      const mainWindow = this.mainWindow
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('window:tearoff-session-closed', sessionId)
      }
    })

    try {
      if (process.env.ELECTRON_RENDERER_URL) {
        const url = new URL('/tearoff.html', process.env.ELECTRON_RENDERER_URL)
        url.searchParams.set('session', sessionId)
        url.searchParams.set('tearoff', 'true')
        await win.loadURL(url.toString())
      }
      else {
        await win.loadFile(resolveDesktopRendererTearoffPath(), {
          query: { session: sessionId, tearoff: 'true' },
        })
      }
    }
    catch (error) {
      if (this.sessionWindows.get(sessionId) === win) {
        this.sessionWindows.delete(sessionId)
      }
      if (!win.isDestroyed()) {
        win.destroy()
      }
      throw error
    }

    return win
  }

  /**
   * Focus a session window if it exists.
   */
  focusSessionWindow(sessionId: string): boolean {
    const win = this.sessionWindows.get(sessionId)
    if (win && !win.isDestroyed()) {
      win.focus()
      return true
    }
    return false
  }

  /**
   * Close a specific session window.
   */
  closeSessionWindow(sessionId: string): void {
    const win = this.sessionWindows.get(sessionId)
    if (win && !win.isDestroyed()) {
      win.close()
    }
  }

  /**
   * Get all open session window IDs.
   */
  getOpenSessionIds(): string[] {
    return [...this.sessionWindows.keys()].filter((id) => {
      const win = this.sessionWindows.get(id)
      return win && !win.isDestroyed()
    })
  }

  /**
   * Open the devtool window (or focus if already open).
   */
  async openDevtoolWindow(): Promise<BrowserWindow> {
    if (this.devtoolWindow && !this.devtoolWindow.isDestroyed()) {
      this.devtoolWindow.focus()
      return this.devtoolWindow
    }

    const win = new BrowserWindow({
      width: 900,
      height: 600,
      title: 'Cradle DevTools',
      webPreferences: {
        preload: resolveDesktopPreloadPath(__dirname),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: true,
        additionalArguments: [
          `--server-url=${this.serverUrl}`,
          '--devtool=true',
        ],
      },
      show: false,
    })

    win.once('ready-to-show', () => {
      win.show()
    })

    if (process.env.ELECTRON_RENDERER_URL) {
      await win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#devtool`)
    }
    else {
      await win.loadFile(resolveDesktopRendererIndexPath(), {
        hash: 'devtool',
      })
    }

    this.devtoolWindow = win
    win.on('closed', () => {
      this.devtoolWindow = null
    })

    return win
  }
}

function resolveTearoffReleasePoint(x: number, y: number): { x: number, y: number } {
  if (!Number.isFinite(x) || !Number.isFinite(y) || (x === 0 && y === 0)) {
    return screen.getCursorScreenPoint()
  }

  return { x: Math.round(x), y: Math.round(y) }
}
