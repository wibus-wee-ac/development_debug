import { join } from 'node:path'

import { createServices } from '@cradle/ipc'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, shell } from 'electron'

import icon from '../../resources/icon.png?asset'
import { initDb } from './db'
import { ChatEngine } from './lib/chat-engine'
import { initializeIpcDevtool, subscribeRuntimeDevtools } from './lib/ipc-devtool'
import { PtyManager } from './lib/pty-manager'
import { AcpService } from './services/acp'
import { ChatService } from './services/chat'
import { DevService } from './services/dev'
import { IpcDevtoolService } from './services/ipc-devtool'
import { PreferencesService } from './services/preferences'
import { PtyService } from './services/pty'
import { CliService } from './services/cli'
import { SearchService } from './services/search'
import { SessionService } from './services/session'
import { WorkspaceService } from './services/workspace'
import { restoreWindowState, saveWindowState } from './store/app'

function createWindow(): BrowserWindow {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 700,
    minHeight: 500,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset',
          vibrancy: 'sidebar',
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    restoreWindowState('main', mainWindow)
    mainWindow.show()
  })

  mainWindow.on('close', () => {
    saveWindowState('main', mainWindow)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  }
 else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Initialise database
  const dbPath = join(app.getPath('userData'), 'cradle.db')
  initDb(dbPath)

  initializeIpcDevtool()

  // Bootstrap chat engine (crash recovery + transport hooks)
  ChatEngine.getInstance().initialize()

  // Register IPC services
  createServices([
    WorkspaceService,
    SessionService,
    AcpService,
    PreferencesService,
    IpcDevtoolService,
    DevService,
    ChatService,
    SearchService,
    PtyService,
    CliService,
  ] as const)

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const mainWindow = createWindow()
  ChatEngine.getInstance().subscribe(mainWindow.webContents)
  subscribeRuntimeDevtools(mainWindow.webContents)
  PtyManager.getInstance().subscribe(mainWindow.webContents)

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      const win = createWindow()
      ChatEngine.getInstance().subscribe(win.webContents)
      subscribeRuntimeDevtools(win.webContents)
      PtyManager.getInstance().subscribe(win.webContents)
    }
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
