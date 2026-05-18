// Input: BrowserWindow management, session tracking
// Output: WindowManager — create/manage/tearoff session windows
// Position: apps/desktop/src/main/window-manager.ts

import { join } from 'node:path'

import { BrowserWindow } from 'electron'

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

    const win = new BrowserWindow({
      width: 720,
      height: 640,
      x: Math.round(x - 360),
      y: Math.round(y - 40),
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 18 },
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
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

    win.once('ready-to-show', () => {
      win.show()
    })

    // Load the same renderer but with session query param
    if (process.env.ELECTRON_RENDERER_URL) {
      await win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?session=${sessionId}&tearoff=true`)
    }
    else {
      await win.loadFile(join(__dirname, '../renderer/index.html'), {
        query: { session: sessionId, tearoff: 'true' },
      })
    }

    this.sessionWindows.set(sessionId, win)

    win.on('closed', () => {
      this.sessionWindows.delete(sessionId)
    })

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
        preload: join(__dirname, '../preload/index.js'),
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
      await win.loadFile(join(__dirname, '../renderer/index.html'), {
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
