import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { app, BrowserWindow, ipcMain, nativeImage, screen, Tray } from 'electron'

export type TrayActionId =
  | 'open-app'
  | 'open-chat'
  | 'new-chat'
  | 'global-search'
  | 'open-resident'
  | 'open-running'
  | 'open-approvals'
  | 'open-awaits'
  | 'open-automation'
  | 'open-workspaces'
  | 'open-agents'
  | 'open-providers'
  | 'open-chronicle'
  | 'open-usage'
  | 'open-plugins'
  | 'open-desktop-settings'
  | 'quit'

interface TrayManagerOptions {
  serverUrl: string
  getMainWindow: () => BrowserWindow | null
  createMainWindow: () => Promise<BrowserWindow>
}

const POPOVER_WIDTH = 380
const POPOVER_HEIGHT = 640
const TRAY_ACTION_CHANNEL = 'desktop-tray:perform-action'
const TRAY_PENDING_ACTIONS_CHANNEL = 'desktop-tray:consume-pending-actions'

interface TrayActionRequest {
  actionId: TrayActionId
  payload?: unknown
}

function readIconPath(): string | null {
  const candidates = [
    join(process.resourcesPath ?? '', 'icon.png'),
    join(process.resourcesPath ?? '', 'icon.icns'),
    join(__dirname, '../../../../build/icon.png'),
    join(__dirname, '../../../../resources/icon.png'),
  ]

  return candidates.find(candidate => candidate && existsSync(candidate)) ?? null
}

function createTrayImage(): Electron.NativeImage {
  const iconPath = readIconPath()
  const image = iconPath
    ? nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 })
    : nativeImage.createEmpty()
  image.setTemplateImage(process.platform === 'darwin')
  return image
}

function getPopoverBounds(tray: Tray): Electron.Rectangle {
  const trayBounds = tray.getBounds()
  const display = screen.getDisplayNearestPoint({
    x: Math.round(trayBounds.x + trayBounds.width / 2),
    y: Math.round(trayBounds.y + trayBounds.height / 2),
  })
  const workArea = display.workArea
  const x = Math.min(
    Math.max(Math.round(trayBounds.x + trayBounds.width / 2 - POPOVER_WIDTH / 2), workArea.x + 8),
    workArea.x + workArea.width - POPOVER_WIDTH - 8,
  )
  const opensDown = trayBounds.y < workArea.y + workArea.height / 2
  const y = opensDown
    ? Math.min(trayBounds.y + trayBounds.height + 6, workArea.y + workArea.height - POPOVER_HEIGHT - 8)
    : Math.max(trayBounds.y - POPOVER_HEIGHT - 6, workArea.y + 8)

  return {
    x,
    y: Math.round(y),
    width: POPOVER_WIDTH,
    height: POPOVER_HEIGHT,
  }
}

function isTrayActionId(value: unknown): value is TrayActionId {
  return typeof value === 'string' && (
    value === 'open-app'
    || value === 'open-chat'
    || value === 'new-chat'
    || value === 'global-search'
    || value === 'open-resident'
    || value === 'open-running'
    || value === 'open-approvals'
    || value === 'open-awaits'
    || value === 'open-automation'
    || value === 'open-workspaces'
    || value === 'open-agents'
    || value === 'open-providers'
    || value === 'open-chronicle'
    || value === 'open-usage'
    || value === 'open-plugins'
    || value === 'open-desktop-settings'
    || value === 'quit'
  )
}

export class TrayManager {
  private tray: Tray | null = null
  private popoverWindow: BrowserWindow | null = null
  private pendingActionRequests: TrayActionRequest[] = []
  private readonly options: TrayManagerOptions

  constructor(options: TrayManagerOptions) {
    this.options = options
  }

  initialize(): void {
    if (this.tray) {
      return
    }

    this.tray = new Tray(createTrayImage())
    this.tray.setToolTip('Cradle')
    this.tray.on('click', () => {
      void this.togglePopover()
    })
    this.tray.on('right-click', () => {
      void this.togglePopover()
    })

    ipcMain.handle(TRAY_ACTION_CHANNEL, async (_event, actionId: unknown, payload: unknown) => {
      if (!isTrayActionId(actionId)) {
        throw new Error(`Unsupported tray action: ${String(actionId)}`)
      }
      await this.performAction(actionId, payload)
    })
    ipcMain.handle(TRAY_PENDING_ACTIONS_CHANNEL, () => this.pendingActionRequests.splice(0))
  }

  async togglePopover(): Promise<void> {
    if (this.popoverWindow && !this.popoverWindow.isDestroyed() && this.popoverWindow.isVisible()) {
      this.popoverWindow.hide()
      return
    }

    const popover = await this.createPopoverWindow()
    if (this.tray) {
      popover.setBounds(getPopoverBounds(this.tray), false)
    }
    popover.show()
    popover.focus()
  }

  hidePopover(): void {
    if (this.popoverWindow && !this.popoverWindow.isDestroyed()) {
      this.popoverWindow.hide()
    }
  }

  async performAction(actionId: TrayActionId, payload?: unknown): Promise<void> {
    if (actionId === 'quit') {
      app.quit()
      return
    }

    const previousMainWindow = this.options.getMainWindow()
    const shouldQueueAction = !previousMainWindow
      || previousMainWindow.isDestroyed()
      || previousMainWindow.webContents.isLoadingMainFrame()
    const mainWindow = await this.focusMainWindow()
    this.hidePopover()

    if (actionId === 'open-app') {
      return
    }

    const request = { actionId, payload }
    if (shouldQueueAction) {
      this.pendingActionRequests.push(request)
    }
    mainWindow.webContents.send('desktop-tray:action-requested', request)
  }

  destroy(): void {
    ipcMain.removeHandler(TRAY_ACTION_CHANNEL)
    ipcMain.removeHandler(TRAY_PENDING_ACTIONS_CHANNEL)
    this.pendingActionRequests = []
    if (this.popoverWindow && !this.popoverWindow.isDestroyed()) {
      this.popoverWindow.destroy()
      this.popoverWindow = null
    }
    this.tray?.destroy()
    this.tray = null
  }

  private async focusMainWindow(): Promise<BrowserWindow> {
    let mainWindow = this.options.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = await this.options.createMainWindow()
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    if (!mainWindow.isVisible()) {
      mainWindow.show()
    }
    mainWindow.focus()
    return mainWindow
  }

  private async createPopoverWindow(): Promise<BrowserWindow> {
    if (this.popoverWindow && !this.popoverWindow.isDestroyed()) {
      return this.popoverWindow
    }

    const popover = new BrowserWindow({
      width: POPOVER_WIDTH,
      height: POPOVER_HEIGHT,
      minWidth: POPOVER_WIDTH,
      minHeight: 420,
      maxWidth: POPOVER_WIDTH,
      maxHeight: 720,
      frame: false,
      resizable: false,
      movable: false,
      show: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: 'Cradle Tray',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        additionalArguments: [
          `--server-url=${this.options.serverUrl}`,
          '--surface=tray',
        ],
      },
    })

    popover.on('blur', () => {
      if (!popover.webContents.isDevToolsOpened()) {
        popover.hide()
      }
    })
    popover.on('closed', () => {
      this.popoverWindow = null
    })

    if (process.env.ELECTRON_RENDERER_URL) {
      await popover.loadURL(`${process.env.ELECTRON_RENDERER_URL}?surface=tray`)
    }
    else {
      await popover.loadFile(join(__dirname, '../renderer/index.html'), {
        query: { surface: 'tray' },
      })
    }

    this.popoverWindow = popover
    return popover
  }
}

export { TRAY_ACTION_CHANNEL, TRAY_PENDING_ACTIONS_CHANNEL }
