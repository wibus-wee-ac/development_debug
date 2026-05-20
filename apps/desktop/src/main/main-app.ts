// Input: Electron app, server bootstrap, window manager, and update manager
// Output: Desktop app startup after Velopack bootstrap completes
// Position: apps/desktop/src/main/main-app.ts

import { join } from 'node:path'

import { app, BrowserWindow, screen } from 'electron'
import windowStateKeeper from 'electron-window-state'

import { createNativeServices } from './native-services'
import { activateDesktopPlugins, deactivateDesktopPlugins, notifyWebviewCreated } from './plugin-loader'
import { startServer, stopServer } from './server-process'
import { DesktopUpdateManager } from './update-manager'
import { WindowManager } from './window-manager'
import { readStoredWindowBounds, resolveVisibleWindowBounds } from './window-state'

let mainWindow: BrowserWindow | null = null
let windowManager: WindowManager | undefined
let updateManager: DesktopUpdateManager | null = null

const MAIN_WINDOW_DEFAULT_WIDTH = 1280
const MAIN_WINDOW_DEFAULT_HEIGHT = 820
const MAIN_WINDOW_MIN_WIDTH = 800
const MAIN_WINDOW_MIN_HEIGHT = 600
const MAIN_WINDOW_STATE_FILE = 'main-window-state.json'

async function createMainWindow(serverUrl: string): Promise<BrowserWindow> {
  const mainWindowStatePath = join(app.getPath('userData'), MAIN_WINDOW_STATE_FILE)
  const storedBounds = readStoredWindowBounds(mainWindowStatePath)
  const mainWindowState = windowStateKeeper({
    defaultWidth: MAIN_WINDOW_DEFAULT_WIDTH,
    defaultHeight: MAIN_WINDOW_DEFAULT_HEIGHT,
    file: MAIN_WINDOW_STATE_FILE,
  })
  const restoredBounds = resolveVisibleWindowBounds(
    storedBounds ?? {
      x: mainWindowState.x,
      y: mainWindowState.y,
      width: mainWindowState.width,
      height: mainWindowState.height,
    },
    screen.getAllDisplays().map(display => display.workArea),
    {
      defaultWidth: MAIN_WINDOW_DEFAULT_WIDTH,
      defaultHeight: MAIN_WINDOW_DEFAULT_HEIGHT,
      minWidth: MAIN_WINDOW_MIN_WIDTH,
      minHeight: MAIN_WINDOW_MIN_HEIGHT,
    },
    screen.getPrimaryDisplay().workArea,
  )

  const win = new BrowserWindow({
    x: restoredBounds.x,
    y: restoredBounds.y,
    width: restoredBounds.width,
    height: restoredBounds.height,
    minWidth: MAIN_WINDOW_MIN_WIDTH,
    minHeight: MAIN_WINDOW_MIN_HEIGHT,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      additionalArguments: [`--server-url=${serverUrl}`],
    },
    show: false,
  })
  mainWindowState.manage(win)

  win.once('ready-to-show', () => {
    win.show()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    await win.loadURL(process.env.ELECTRON_RENDERER_URL)
  }
  else {
    await win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

function broadcastUpdateStatus(status: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('desktop-update:status-changed', status)
    }
  }
}

export async function startDesktopApp(): Promise<void> {
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
    return
  }

  updateManager = new DesktopUpdateManager()
  createNativeServices({
    getWindowManager: () => windowManager,
    getUpdateManager: () => updateManager,
  })
  updateManager.on('statusChanged', broadcastUpdateStatus)

  app.whenReady().then(async () => {
    await activateDesktopPlugins()

    const serverUrl = await startServer()

    windowManager = new WindowManager(serverUrl)

    mainWindow = await createMainWindow(serverUrl)
    windowManager.setMainWindow(mainWindow)

    mainWindow.webContents.on('will-attach-webview', (_event, webPreferences, _params) => {
      delete webPreferences.preload
      webPreferences.nodeIntegration = false
      webPreferences.contextIsolation = true
    })

    mainWindow.webContents.on('did-attach-webview', (_event, webviewContents) => {
      const tabId = `tab-${Date.now()}`
      notifyWebviewCreated(webviewContents, tabId)
    })

    mainWindow.webContents.once('did-finish-load', () => {
      if (updateManager) {
        broadcastUpdateStatus(updateManager.status)
      }
    })

    mainWindow.on('closed', () => {
      mainWindow = null
    })

    updateManager?.startBackgroundChecks()

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        if (!windowManager) {
          return
        }
        mainWindow = await createMainWindow(serverUrl)
        windowManager.setMainWindow(mainWindow)
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('before-quit', async () => {
    updateManager?.stopBackgroundChecks()
    await deactivateDesktopPlugins()
    stopServer()
  })

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      mainWindow.focus()
    }
  })
}
