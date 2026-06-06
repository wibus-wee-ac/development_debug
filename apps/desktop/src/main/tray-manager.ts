import type { BrowserWindow } from 'electron'
import { app, ipcMain, Menu, nativeImage, Tray } from 'electron'

export type TrayActionId
  = | 'open-app'
    | 'open-chat'
    | 'new-chat'
    | 'global-search'
    | 'open-resident'
    | 'open-running'
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

const TRAY_ACTION_CHANNEL = 'desktop-tray:perform-action'
const TRAY_PENDING_ACTIONS_CHANNEL = 'desktop-tray:consume-pending-actions'
const TRAY_SNAPSHOT_PATH = '/desktop/tray'

interface TrayActionRequest {
  actionId: TrayActionId
  payload?: unknown
}

interface TraySessionItem {
  sessionId: string
  title: string
  workspaceName: string
  runtimeKind: string
  modelId: string | null
  detail: string
}

interface TrayMetric {
  label: string
  value: string
  tone: 'neutral' | 'active' | 'warning' | 'danger'
}

interface TrayQuickAction {
  id: TrayActionId
  label: string
  description: string
  accelerator: string | null
  badge: string | null
  enabled: boolean
}

interface TraySnapshot {
  metrics: TrayMetric[]
  running: TraySessionItem[]
  resident: TraySessionItem[]
  quickActions: TrayQuickAction[]
}

const TRAY_ICON_SIZE = 18
const MENU_ICON_SIZE = 10

function createCircleImage(size: number, red: number, green: number, blue: number, alpha = 255): Electron.NativeImage {
  const buffer = Buffer.alloc(size * size * 4, 0)
  const center = size / 2
  const radius = size / 2 - 1.5

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - center + 0.5
      const dy = y - center + 0.5
      if (Math.sqrt(dx * dx + dy * dy) <= radius) {
        const idx = (y * size + x) * 4
        buffer[idx] = red
        buffer[idx + 1] = green
        buffer[idx + 2] = blue
        buffer[idx + 3] = alpha
      }
    }
  }

  return nativeImage.createFromBuffer(buffer, { width: size, height: size })
}

function createTrayImage(alpha = 255): Electron.NativeImage {
  const image = createCircleImage(TRAY_ICON_SIZE, 0, 0, 0, alpha)
  if (process.platform === 'darwin') {
    image.setTemplateImage(true)
  }
  return image
}

function createMenuDotIcon(red: number, green: number, blue: number): Electron.NativeImage {
  return createCircleImage(MENU_ICON_SIZE, red, green, blue)
}

function createMetricIcon(tone: TrayMetric['tone']): Electron.NativeImage {
  if (tone === 'active') {
    return createMenuDotIcon(16, 185, 129)
  }
  if (tone === 'warning') {
    return createMenuDotIcon(245, 158, 11)
  }
  if (tone === 'danger') {
    return createMenuDotIcon(239, 68, 68)
  }
  return createMenuDotIcon(115, 115, 115)
}

export class TrayManager {
  private tray: Tray | null = null
  private pendingActionRequests: TrayActionRequest[] = []
  private readonly options: TrayManagerOptions

  constructor(options: TrayManagerOptions) {
    this.options = options
  }

  initialize(): void {
    console.log('Initializing TrayManager')
    if (this.tray) {
      return
    }

    const trayImage = createTrayImage()
    this.tray = new Tray(trayImage)
    this.tray.setImage(trayImage)
    this.tray.setPressedImage(createTrayImage(180))
    this.tray.setToolTip('Cradle')
    this.tray.setIgnoreDoubleClickEvents(true)
    this.updateTrayPresentation(null)
    this.tray.setContextMenu(this.buildTrayMenu(null))
    this.tray.on('click', () => {
      void this.openNativeMenu()
    })
    this.tray.on('right-click', () => {
      void this.openNativeMenu()
    })

    ipcMain.handle(TRAY_ACTION_CHANNEL, async (_event, actionId: unknown, payload: unknown) => {
      await this.performAction(actionId as TrayActionId, payload)
    })
    ipcMain.handle(TRAY_PENDING_ACTIONS_CHANNEL, () => this.pendingActionRequests.splice(0))
  }

  async openNativeMenu(): Promise<void> {
    if (!this.tray) {
      return
    }

    const snapshot = await this.readTraySnapshot()
    this.updateTrayPresentation(snapshot)
    this.updatePlatformNotification(snapshot)
    const menu = this.buildTrayMenu(snapshot)
    this.tray.setContextMenu(menu)
    this.tray.popUpContextMenu(menu, this.readPopupPosition())
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

    if (actionId === 'open-app') {
      this.refocusTrayNotificationArea()
      return
    }

    const request = { actionId, payload }
    if (shouldQueueAction) {
      this.pendingActionRequests.push(request)
    }
    mainWindow.webContents.send('desktop-tray:action-requested', request)
    this.refocusTrayNotificationArea()
  }

  destroy(): void {
    ipcMain.removeHandler(TRAY_ACTION_CHANNEL)
    ipcMain.removeHandler(TRAY_PENDING_ACTIONS_CHANNEL)
    this.pendingActionRequests = []
    this.tray?.closeContextMenu()
    if (process.platform === 'win32') {
      this.tray?.removeBalloon()
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

  private async readTraySnapshot(): Promise<TraySnapshot | null> {
    try {
      const response = await fetch(new URL(TRAY_SNAPSHOT_PATH, this.options.serverUrl))
      if (!response.ok) {
        return null
      }
      return await response.json() as TraySnapshot
    }
    catch {
      return null
    }
  }

  private buildTrayMenu(snapshot: TraySnapshot | null): Electron.Menu {
    const quickActions = snapshot?.quickActions ?? []
    const openAppAction = quickActions.find(action => action.id === 'open-app')
    const newChatAction = quickActions.find(action => action.id === 'new-chat')
    const searchAction = quickActions.find(action => action.id === 'global-search')
    const secondaryActions = quickActions.filter(action => (
      action.id !== 'open-app'
      && action.id !== 'new-chat'
      && action.id !== 'global-search'
      && action.id !== 'quit'
    ))

    return Menu.buildFromTemplate([
      {
        id: 'header',
        type: 'header',
        label: this.buildHeaderLabel(snapshot),
        sublabel: snapshot ? 'Native tray menu' : 'Native tray menu - offline',
        enabled: false,
        visible: true,
      },
      { type: 'separator' },
      this.buildQuickActionMenuItem(openAppAction ?? {
        id: 'open-app',
        label: 'Open Cradle',
        description: 'Bring the main desktop window forward.',
        accelerator: null,
        badge: null,
        enabled: true,
      }, snapshot),
      this.buildQuickActionMenuItem(newChatAction ?? {
        id: 'new-chat',
        label: 'New Chat',
        description: 'Start a fresh agent conversation.',
        accelerator: 'CommandOrControl+N',
        badge: null,
        enabled: true,
      }, snapshot),
      this.buildQuickActionMenuItem(searchAction ?? {
        id: 'global-search',
        label: 'Search Threads',
        description: 'Open the command palette for threads, files, and issues.',
        accelerator: 'CommandOrControl+K',
        badge: null,
        enabled: true,
      }, snapshot),
      { type: 'separator' },
      {
        id: 'status',
        type: 'submenu',
        label: 'Status',
        enabled: Boolean(snapshot),
        visible: true,
        submenu: this.buildMetricMenuItems(snapshot?.metrics ?? []),
      },
      {
        id: 'running',
        type: 'submenu',
        label: this.buildSectionLabel('Running Agents', snapshot?.running.length ?? 0),
        enabled: Boolean(snapshot),
        visible: true,
        submenu: this.buildSessionMenuItems(snapshot?.running ?? []),
      },
      {
        id: 'resident',
        type: 'submenu',
        label: this.buildSectionLabel('Resident Chats', snapshot?.resident.length ?? 0),
        enabled: Boolean(snapshot),
        visible: true,
        submenu: this.buildSessionMenuItems(snapshot?.resident ?? []),
      },
      { type: 'separator' },
      {
        id: 'actions',
        type: 'submenu',
        label: 'Actions',
        enabled: secondaryActions.length > 0,
        visible: true,
        submenu: secondaryActions.length > 0
          ? secondaryActions.map(action => this.buildQuickActionMenuItem(action, snapshot))
          : [{ label: 'No actions', enabled: false }],
      },
      ...(snapshot
        ? []
        : [{
            label: 'Tray data unavailable',
            enabled: false,
          }]),
      {
        id: 'quit',
        label: 'Quit Cradle',
        accelerator: 'CommandOrControl+Q',
        registerAccelerator: true,
        visible: true,
        click: () => {
          void this.performAction('quit')
        },
      },
    ])
  }

  private buildMetricMenuItems(items: TrayMetric[]): Electron.MenuItemConstructorOptions[] {
    if (items.length === 0) {
      return [{ label: 'Status unavailable', enabled: false }]
    }

    return items.map(item => ({
      id: `metric-${item.label.toLowerCase().replaceAll(' ', '-')}`,
      type: 'checkbox',
      label: `${item.label}: ${item.value}`,
      icon: createMetricIcon(item.tone),
      checked: item.tone === 'active' || item.tone === 'warning' || item.tone === 'danger',
      enabled: false,
      visible: true,
      toolTip: `${item.label} is ${item.value}`,
    }))
  }

  private buildSessionMenuItems(items: TraySessionItem[]): Electron.MenuItemConstructorOptions[] {
    if (items.length === 0) {
      return [{ label: 'No items', enabled: false }]
    }

    return items.map(item => ({
      id: `session-${item.sessionId}`,
      type: 'normal',
      label: item.title,
      sublabel: item.workspaceName,
      toolTip: item.detail,
      enabled: true,
      visible: true,
      click: () => {
        void this.performAction('open-chat', { sessionId: item.sessionId })
      },
    }))
  }

  private buildQuickActionMenuItem(
    action: TrayQuickAction,
    snapshot: TraySnapshot | null,
  ): Electron.MenuItemConstructorOptions {
    return {
      id: action.id,
      type: 'normal',
      label: this.buildActionLabel(action),
      sublabel: action.description,
      accelerator: this.normalizeAccelerator(action.accelerator),
      enabled: action.enabled,
      visible: true,
      registerAccelerator: Boolean(action.accelerator),
      acceleratorWorksWhenHidden: false,
      click: () => {
        void this.performAction(action.id, this.readListActionPayload(action.id, snapshot))
      },
    }
  }

  private buildActionLabel(action: TrayQuickAction): string {
    return action.badge ? `${action.label} (${action.badge})` : action.label
  }

  private buildSectionLabel(label: string, count: number): string {
    return `${label} (${count})`
  }

  private buildHeaderLabel(snapshot: TraySnapshot | null): string {
    if (!snapshot) {
      return 'Cradle'
    }
    const running = snapshot.running.length
    const resident = snapshot.resident.length
    return `Cradle - ${running} running, ${resident} resident`
  }

  private normalizeAccelerator(accelerator: string | null): string | undefined {
    if (!accelerator) {
      return undefined
    }
    if (accelerator.startsWith('CommandOrControl+')) {
      return accelerator
    }
    return accelerator.replaceAll('⌘', 'CommandOrControl+')
  }

  private updateTrayPresentation(snapshot: TraySnapshot | null): void {
    if (!this.tray) {
      return
    }

    const running = snapshot?.running.length ?? 0
    const resident = snapshot?.resident.length ?? 0
    this.tray.setToolTip(snapshot
      ? `Cradle - ${running} running, ${resident} resident`
      : 'Cradle')

    if (process.platform === 'darwin') {
      this.tray.setTitle(running > 0 ? String(running) : '')
    }
  }

  private updatePlatformNotification(snapshot: TraySnapshot | null): void {
    if (!this.tray || process.platform !== 'win32') {
      return
    }

    if (!snapshot) {
      this.tray.displayBalloon({
        title: 'Cradle',
        content: 'Tray data is unavailable.',
      })
      return
    }

    this.tray.removeBalloon()
  }

  private readPopupPosition(): Electron.Point | undefined {
    if (!this.tray || process.platform !== 'win32') {
      return undefined
    }

    const bounds = this.tray.getBounds()
    return {
      x: Math.round(bounds.x + bounds.width / 2),
      y: Math.round(bounds.y + bounds.height),
    }
  }

  private refocusTrayNotificationArea(): void {
    if (!this.tray || process.platform !== 'win32') {
      return
    }
    this.tray.focus()
  }

  private readListActionPayload(actionId: TrayActionId, snapshot: TraySnapshot | null): { sessionId: string } | undefined {
    if (actionId === 'open-running') {
      const firstRunning = snapshot?.running[0]
      return firstRunning ? { sessionId: firstRunning.sessionId } : undefined
    }

    if (actionId === 'open-resident') {
      const firstResident = snapshot?.resident[0]
      return firstResident ? { sessionId: firstResident.sessionId } : undefined
    }

    return undefined
  }
}

export { TRAY_ACTION_CHANNEL, TRAY_PENDING_ACTIONS_CHANNEL }
