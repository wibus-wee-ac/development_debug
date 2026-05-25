import { join, resolve } from 'node:path'

import { app, BrowserWindow, dialog, screen } from 'electron'
import windowStateKeeper from 'electron-window-state'

import { resolveDesktopPreloadPath, resolveDesktopRendererIndexPath } from './desktop-assets'
import { MacBridgeManager } from './mac-bridge-manager'
import { captureAppshotWithMacBridge, createNativeServices } from './native-services'
import type { PluginInstallResult, PluginInstallSummary } from './plugin-install-links'
import {
  collectPluginInstallUrls,
  installPluginFromRequest,
  parsePluginInstallUrl,
  PluginInstallLinkError,
} from './plugin-install-links'
import { activateDesktopPlugins, deactivateDesktopPlugins, notifyWebviewCreated } from './plugin-loader'
import { resolveDesktopPrimaryPluginsDir } from './plugin-paths'
import { startServer, stopServer } from './server-process'
import { TrayManager } from './tray-manager'
import { DesktopUpdateManager } from './update-manager'
import { WindowManager } from './window-manager'
import { readStoredWindowBounds, resolveVisibleWindowBounds } from './window-state'

let mainWindow: BrowserWindow | null = null
let windowManager: WindowManager | undefined
let updateManager: DesktopUpdateManager | null = null
let trayManager: TrayManager | null = null
let macBridgeManager: MacBridgeManager | null = null
let isQuitting = false

const MAIN_WINDOW_DEFAULT_WIDTH = 1280
const MAIN_WINDOW_DEFAULT_HEIGHT = 820
const MAIN_WINDOW_MIN_WIDTH = 800
const MAIN_WINDOW_MIN_HEIGHT = 600
const MAIN_WINDOW_STATE_FILE = 'main-window-state.json'
const DEEP_LINK_PROTOCOL = 'cradle'
const BROWSER_PANEL_WEBVIEW_TAB_SHORTCUT_CHANNEL = 'browser-panel:webview-tab-shortcut'
const BROWSER_PANEL_WEBVIEW_TAB_SHORTCUT_KEY_PATTERN = /^\d$/

let installQueue = Promise.resolve()
let canProcessPluginInstallLinks = false
const pendingPluginInstallUrls: string[] = []

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
      preload: resolveDesktopPreloadPath(__dirname),
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
    await win.loadFile(resolveDesktopRendererIndexPath())
  }

  return win
}

function setMainWindow(win: BrowserWindow): void {
  mainWindow = win
  windowManager?.setMainWindow(win)

  win.webContents.on('will-attach-webview', (_event, webPreferences, _params) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
  })

  win.webContents.on('did-attach-webview', (_event, webviewContents) => {
    const tabId = `tab-${Date.now()}`
    notifyWebviewCreated(webviewContents, tabId)
    webviewContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') {
        return
      }

      const key = input.key.toLowerCase()
      const isTabShortcut = key === 'w' || BROWSER_PANEL_WEBVIEW_TAB_SHORTCUT_KEY_PATTERN.test(key)
      if (!input.meta || input.alt || input.control || input.shift || !isTabShortcut) {
        return
      }

      event.preventDefault()
      win.webContents.send(BROWSER_PANEL_WEBVIEW_TAB_SHORTCUT_CHANNEL, {
        key: input.key,
        metaKey: input.meta,
        altKey: input.alt,
        ctrlKey: input.control,
        shiftKey: input.shift,
      })
    })
  })

  win.webContents.once('did-finish-load', () => {
    if (updateManager) {
      broadcastUpdateStatus(updateManager.status)
    }
  })

  win.on('close', (event) => {
    if (!isQuitting && trayManager) {
      event.preventDefault()
      win.hide()
    }
  })

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null
    }
    if (!isQuitting && !trayManager && process.platform !== 'darwin') {
      app.quit()
    }
  })
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show()
  }
  mainWindow.focus()
}

function broadcastUpdateStatus(status: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('desktop-update:status-changed', status)
    }
  }
}

function registerPluginInstallProtocol(): void {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL, process.execPath, [resolve(process.argv[1]!)])
    return
  }
  app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL)
}

function describePluginInstallSummary(summary: PluginInstallSummary): string {
  const capabilities = summary.declaredCapabilities.length > 0
    ? summary.declaredCapabilities
        .map(capability => `- ${capability.type}:${capability.localId}${capability.layer ? ` (${capability.layer})` : ''}`)
        .join('\n')
    : '- None declared'
  const permissions = summary.requiredPermissions.length > 0
    ? summary.requiredPermissions.map(permission => `- ${permission}`).join('\n')
    : '- None required'

  return [
    `Package: ${summary.packageName}`,
    `Version: ${summary.version}`,
    `Display name: ${summary.displayName ?? summary.packageName}`,
    `Mode: ${summary.mode}`,
    `Repository: ${summary.request.repository}`,
    `Path: ${summary.request.path}`,
    `Ref: ${summary.request.ref}`,
    '',
    'Required permissions:',
    permissions,
    '',
    'Declared capabilities:',
    capabilities,
  ].join('\n')
}

async function askPluginInstallConsent(summary: PluginInstallSummary): Promise<boolean> {
  const { response } = await dialog.showMessageBox({
    type: 'question',
    title: 'Install Cradle Plugin',
    message: `Install ${summary.packageName}?`,
    detail: `${describePluginInstallSummary(summary)}\n\nCradle will install this first-party plugin into the desktop Marketplace plugin directory. The plugin is activated after restart.`,
    buttons: ['Install', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  })
  return response === 0
}

async function showPluginInstallSuccess(result: PluginInstallResult): Promise<void> {
  const detail = result.mode === 'alreadyAvailable'
    ? 'This plugin is already available in the current Cradle plugin directory. Cradle recorded the Marketplace install request.'
    : 'Restart Cradle to activate the plugin in the desktop and server runtimes.'
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: 'Plugin Installed',
    message: `${result.request.packageName} was installed.`,
    detail,
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
    cancelId: 1,
  })
  if (response === 0) {
    app.relaunch()
    app.exit(0)
  }
}

async function showPluginInstallFailure(err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err)
  await dialog.showMessageBox({
    type: 'error',
    title: 'Plugin Install Failed',
    message: err instanceof PluginInstallLinkError ? 'The plugin install link is invalid.' : 'Cradle could not install the plugin.',
    detail: message,
    buttons: ['OK'],
  })
}

async function installPluginFromDeepLink(rawUrl: string): Promise<void> {
  showMainWindow()
  try {
    const request = parsePluginInstallUrl(rawUrl)

    const isDev = !!process.env.ELECTRON_RENDERER_URL
    const result = await installPluginFromRequest(request, {
      availablePluginsDir: resolveDesktopPrimaryPluginsDir({ isDev, moduleDir: __dirname }),
      confirmInstall: askPluginInstallConsent,
      userDataPath: app.getPath('userData'),
    })
    if (!result) {
      return
    }
    await showPluginInstallSuccess(result)
  }
  catch (err) {
    console.error('[plugin-marketplace] install link failed:', err)
    await showPluginInstallFailure(err)
  }
}

function handlePluginInstallUrls(urls: readonly string[]): void {
  if (!canProcessPluginInstallLinks) {
    pendingPluginInstallUrls.push(...urls)
    return
  }
  for (const url of urls) {
    installQueue = installQueue.then(() => installPluginFromDeepLink(url))
  }
}

function processPendingPluginInstallUrls(): void {
  canProcessPluginInstallLinks = true
  const urls = pendingPluginInstallUrls.splice(0)
  handlePluginInstallUrls(urls)
}

async function shutdownDesktopRuntime(): Promise<void> {
  updateManager?.stopBackgroundChecks()
  trayManager?.destroy()
  trayManager = null
  await macBridgeManager?.stop()
  macBridgeManager = null
  await deactivateDesktopPlugins()
  await stopServer()
}

export async function startDesktopApp(): Promise<void> {
  registerPluginInstallProtocol()
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
    return
  }

  updateManager = new DesktopUpdateManager({
    beforeApplyUpdate: shutdownDesktopRuntime,
  })
  macBridgeManager = new MacBridgeManager({
    moduleDir: __dirname,
  })
  macBridgeManager.on('hotkeyTriggered', () => {
    captureAppshotWithMacBridge({ sink: 'file', strategy: 'auto' }).catch((error) => {
      console.error('[mac-bridge] hotkey appshot capture failed:', error)
    })
  })
  createNativeServices({
    getWindowManager: () => windowManager,
    getUpdateManager: () => updateManager,
    getMacBridgeManager: () => macBridgeManager,
  })
  updateManager.on('statusChanged', broadcastUpdateStatus)

  app.on('open-url', (event, url) => {
    event.preventDefault()
    handlePluginInstallUrls([url])
  })

  app.whenReady().then(async () => {
    if (process.platform === 'darwin') {
      await macBridgeManager?.start()
      await macBridgeManager?.configureInput({ trigger: 'bothCommand', enabled: true }).catch((error) => {
        console.warn('[mac-bridge] both-command hotkey unavailable:', error)
      })
    }

    await activateDesktopPlugins()

    const serverUrl = await startServer()

    windowManager = new WindowManager(serverUrl)

    mainWindow = await createMainWindow(serverUrl)
    setMainWindow(mainWindow)
    trayManager = new TrayManager({
      serverUrl,
      getMainWindow: () => mainWindow,
      createMainWindow: async () => {
        const win = await createMainWindow(serverUrl)
        setMainWindow(win)
        return win
      },
    })
    trayManager.initialize()

    updateManager?.startBackgroundChecks()
    processPendingPluginInstallUrls()
    handlePluginInstallUrls(collectPluginInstallUrls(process.argv))

    app.on('activate', async () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        const restoredWindow = await createMainWindow(serverUrl)
        setMainWindow(restoredWindow)
        return
      }
      showMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (!trayManager && process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('before-quit', async () => {
    isQuitting = true
    await shutdownDesktopRuntime()
  })

  app.on('second-instance', (_event, argv) => {
    showMainWindow()
    handlePluginInstallUrls(collectPluginInstallUrls(argv))
  })
}
