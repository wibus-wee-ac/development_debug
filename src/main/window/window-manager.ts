// Input: Electron BrowserWindow, SignalBroadcaster, and subscribeRuntimeDevtools
// Output: WindowManager singleton — creates and manages session tear-off windows
// Position: Window capability manager for spawning independent session windows

import { join } from 'node:path'

import { is } from '@electron-toolkit/utils'
import { BrowserWindow } from 'electron'

import { subscribeRuntimeDevtools } from '../devtools/ipc-devtool'
import { getSignalBroadcaster } from '../signal/broadcaster'
import { revealOrFocusExistingWindow, revealWindow } from './window-activation'

export class WindowManager {
  private readonly sessionWindows = new Map<string, BrowserWindow>()

  /**
   * Open a tear-off window for a session.
   * If a window already exists for this session, focus it instead.
   * x, y are screen coordinates where the user dropped the item — the window is centered there.
   */
  openSessionWindow(sessionId: string, x?: number, y?: number): void {
    const existing = this.sessionWindows.get(sessionId)
    if (existing && !existing.isDestroyed()) {
      revealOrFocusExistingWindow(existing)
      return
    }

    const width = 900
    const height = 650

    const win = new BrowserWindow({
      width,
      height,
      minWidth: 600,
      minHeight: 450,
      show: false,
      autoHideMenuBar: true,
      ...(x !== undefined && y !== undefined
        ? { x: Math.round(x - width / 2), y: Math.round(y - height / 2) }
        : {}),
      ...(process.platform === 'darwin'
        ? { titleBarStyle: 'hiddenInset' }
        : {}),
      webPreferences: {
        preload: join(__dirname, '../../preload/index.js'),
        sandbox: false,
      },
    })

    this.sessionWindows.set(sessionId, win)

    win.on('ready-to-show', () => {
      revealWindow(win)
    })

    win.on('closed', () => {
      if (this.sessionWindows.get(sessionId) === win) {
        this.sessionWindows.delete(sessionId)
      }
    })

    win.webContents.once('did-finish-load', () => {
      // Subscribe unified push events so chat and runtime updates reach this window.
      getSignalBroadcaster().subscribe(win.webContents)
      subscribeRuntimeDevtools(win.webContents)
    })

    const hash = `/chat/${sessionId}?tearoff=true`
    if (is.dev && process.env.ELECTRON_RENDERER_URL) {
      void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/#${hash}`)
    }
    else {
      void win.loadFile(join(__dirname, '../../renderer/index.html'), { hash })
    }
  }

  closeSessionWindow(sessionId: string): void {
    const win = this.sessionWindows.get(sessionId)
    if (win && !win.isDestroyed()) {
      win.close()
    }
  }
}

export const windowManager = new WindowManager()
