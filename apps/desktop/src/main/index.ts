// Input: Electron app, server bootstrap, window manager
// Output: Main process entry — starts server, creates window
// Position: apps/desktop/src/main/index.ts

import { join } from 'node:path'

import { app, BrowserWindow } from 'electron'

import { createNativeServices } from './native-services'
import { activateDesktopPlugins, deactivateDesktopPlugins, notifyWebviewCreated } from './plugin-loader'
import { startServer, stopServer } from './server-process'
import { WindowManager } from './window-manager'

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null
let windowManager: WindowManager

async function createMainWindow(serverUrl: string): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 600,
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

  win.once('ready-to-show', () => {
    win.show()
  })

  // In dev, load the web vite dev server; in prod, load built files
  if (process.env.ELECTRON_RENDERER_URL) {
    await win.loadURL(process.env.ELECTRON_RENDERER_URL)
  }
  else {
    await win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(async () => {
  // Activate desktop plugins before server start (shared config flows via env)
  await activateDesktopPlugins()

  // Start the Elysia server on a free port
  const serverUrl = await startServer()

  // Initialize window manager
  windowManager = new WindowManager(serverUrl)

  // Register native IPC services
  createNativeServices(windowManager)

  // Create main window
  mainWindow = await createMainWindow(serverUrl)
  windowManager.setMainWindow(mainWindow)

  // Security: validate webview creation — strip dangerous preferences
  mainWindow.webContents.on('will-attach-webview', (_event, webPreferences, _params) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
  })

  // Register webview with plugin system for agent control
  mainWindow.webContents.on('did-attach-webview', (_event, webviewContents) => {
    const tabId = `tab-${Date.now()}`
    notifyWebviewCreated(webviewContents, tabId)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // macOS: re-create window on dock click
  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = await createMainWindow(serverUrl)
      windowManager.setMainWindow(mainWindow)
    }
  })
})

// Quit when all windows are closed (except macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', async () => {
  await deactivateDesktopPlugins()
  stopServer()
})

// Focus existing window on second instance launch
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.focus()
  }
})
