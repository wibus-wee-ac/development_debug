import type { BrowserWindow } from 'electron'
import { app, ipcMain, Menu, nativeImage, Tray } from 'electron'

export type TrayActionId
  = | 'open-app'
    | 'open-chat'
    | 'new-chat'
    | 'global-search'
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
const TRAY_COUNTS_PATH = '/desktop/tray/counts'
const TRAY_RECENT_SESSIONS_PATH = '/desktop/tray/recent-sessions'
const TRAY_HEALTH_PATH = '/desktop/tray/health'
const TRAY_REFRESH_INTERVAL_MS = 30 * 1000

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
  updatedAt: number
  state: 'running' | 'awaiting' | 'pinned' | 'recent'
  detail: string
}

interface TrayHealthItem {
  id: string
  label: string
  value: string
  status: 'ok' | 'active' | 'warning' | 'danger' | 'unknown'
  detail: string | null
}

interface TrayCounts {
  running: number
  recentSessions: number
  pinnedSessions: number
  pendingAwaits: number
  enabledAutomations: number
  runningAutomations: number
  workspaces: number
}

interface TrayData {
  counts: TrayCounts
  recentSessions: TraySessionItem[]
  health: TrayHealthItem[]
}

const TRAY_ICON_SIZE = 18
const MENU_ICON_SIZE = 10
const MAX_SESSION_LABEL_LENGTH = 52

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

function createStatusIcon(status: TrayHealthItem['status'] | TraySessionItem['state']): Electron.NativeImage {
  if (status === 'active' || status === 'running') {
    return createMenuDotIcon(16, 185, 129)
  }
  if (status === 'warning' || status === 'awaiting') {
    return createMenuDotIcon(245, 158, 11)
  }
  if (status === 'danger') {
    return createMenuDotIcon(239, 68, 68)
  }
  if (status === 'pinned') {
    return createMenuDotIcon(59, 130, 246)
  }
  return createMenuDotIcon(115, 115, 115)
}

function isAttentionItem(item: TrayHealthItem): boolean {
  return item.status === 'warning' || item.status === 'danger'
}

function pluralize(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`
}

function truncateLabel(label: string): string {
  if (label.length <= MAX_SESSION_LABEL_LENGTH) {
    return label
  }
  return `${label.slice(0, MAX_SESSION_LABEL_LENGTH - 1)}...`
}

export class TrayManager {
  private tray: Tray | null = null
  private pendingActionRequests: TrayActionRequest[] = []
  private refreshTimer: NodeJS.Timeout | null = null
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
    this.startPresentationRefresh()
  }

  async openNativeMenu(): Promise<void> {
    if (!this.tray) {
      return
    }

    const snapshot = await this.readTrayData()
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
    this.stopPresentationRefresh()
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

  private startPresentationRefresh(): void {
    if (this.refreshTimer) {
      return
    }
    void this.refreshTrayPresentation()
    this.refreshTimer = setInterval(() => {
      void this.refreshTrayPresentation()
    }, TRAY_REFRESH_INTERVAL_MS)
    this.refreshTimer.unref?.()
  }

  private stopPresentationRefresh(): void {
    if (!this.refreshTimer) {
      return
    }
    clearInterval(this.refreshTimer)
    this.refreshTimer = null
  }

  private async refreshTrayPresentation(): Promise<void> {
    if (!this.tray) {
      return
    }
    const snapshot = await this.readTrayData()
    this.updateTrayPresentation(snapshot)
  }

  private async readTrayData(): Promise<TrayData | null> {
    try {
      const [counts, recentSessions, health] = await Promise.all([
        this.readTrayJson<TrayCounts>(TRAY_COUNTS_PATH),
        this.readTrayJson<TraySessionItem[]>(TRAY_RECENT_SESSIONS_PATH),
        this.readTrayJson<TrayHealthItem[]>(TRAY_HEALTH_PATH),
      ])
      return { counts, recentSessions, health }
    }
    catch {
      return null
    }
  }

  private async readTrayJson<T>(path: string): Promise<T> {
    const response = await fetch(new URL(path, this.options.serverUrl))
    if (!response.ok) {
      throw new Error(`Tray data request failed: ${response.status}`)
    }
    return await response.json() as T
  }

  private buildTrayMenu(snapshot: TrayData | null): Electron.Menu {
    return Menu.buildFromTemplate([
      {
        id: 'header',
        type: 'header',
        label: this.buildHeaderLabel(snapshot),
        sublabel: snapshot ? this.buildHeaderSublabel(snapshot) : 'Desktop status unavailable',
        enabled: false,
        visible: true,
      },
      { type: 'separator' },
      this.buildActionMenuItem('new-chat', 'New Chat', {
        accelerator: 'CommandOrControl+N',
      }),
      this.buildActionMenuItem('global-search', 'Search', {
        accelerator: 'CommandOrControl+K',
      }),
      this.buildActionMenuItem('open-app', 'Open Cradle'),
      { type: 'separator' },
      {
        id: 'recent-sessions-header',
        type: 'header',
        label: 'Recent Sessions',
        enabled: false,
        visible: true,
      },
      ...this.buildRecentSessionMenuItems(snapshot?.recentSessions ?? []),
      { type: 'separator' },
      {
        id: 'health',
        type: 'submenu',
        label: snapshot ? `Health (${this.buildHealthLabel(snapshot)})` : 'Health',
        enabled: Boolean(snapshot),
        visible: true,
        submenu: this.buildHealthMenuItems(snapshot?.health ?? []),
      },
      { type: 'separator' },
      {
        id: 'quick-header',
        type: 'header',
        label: 'Quick',
        enabled: false,
        visible: true,
      },
      this.buildActionMenuItem('open-awaits', this.buildBadgeLabel('Awaits', snapshot?.counts.pendingAwaits ?? 0)),
      this.buildActionMenuItem('open-automation', this.buildAutomationLabel(snapshot?.counts)),
      this.buildActionMenuItem('open-workspaces', this.buildBadgeLabel('Workspaces', snapshot?.counts.workspaces ?? 0)),
      this.buildActionMenuItem('open-desktop-settings', 'Settings'),
      ...(snapshot
        ? []
        : [{
            label: 'Tray data unavailable',
            enabled: false,
          }]),
      { type: 'separator' },
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

  private buildActionMenuItem(
    actionId: TrayActionId,
    label: string,
    options: {
      accelerator?: string
      enabled?: boolean
      payload?: unknown
    } = {},
  ): Electron.MenuItemConstructorOptions {
    return {
      id: actionId,
      type: 'normal',
      label,
      accelerator: options.accelerator,
      enabled: options.enabled ?? true,
      visible: true,
      registerAccelerator: Boolean(options.accelerator),
      acceleratorWorksWhenHidden: false,
      click: () => {
        void this.performAction(actionId, options.payload)
      },
    }
  }

  private buildRecentSessionMenuItems(items: TraySessionItem[]): Electron.MenuItemConstructorOptions[] {
    if (items.length === 0) {
      return [{ label: 'No recent sessions', enabled: false }]
    }

    return items.map(item => ({
      id: `session-${item.sessionId}`,
      type: 'normal',
      label: truncateLabel(item.title),
      sublabel: this.buildSessionSublabel(item),
      icon: createStatusIcon(item.state),
      toolTip: item.detail,
      enabled: true,
      visible: true,
      click: () => {
        void this.performAction('open-chat', { sessionId: item.sessionId })
      },
    }))
  }

  private buildHealthMenuItems(items: TrayHealthItem[]): Electron.MenuItemConstructorOptions[] {
    if (items.length === 0) {
      return [{ label: 'Health unavailable', enabled: false }]
    }

    return items.map(item => ({
      id: `health-${item.id}`,
      type: 'normal',
      label: `${item.label}: ${item.value}`,
      icon: createStatusIcon(item.status),
      enabled: false,
      visible: true,
      toolTip: item.detail ?? `${item.label} is ${item.value}`,
    }))
  }

  private buildSessionSublabel(item: TraySessionItem): string {
    const stateLabel = this.readSessionStateLabel(item)
    if (item.modelId) {
      return `${stateLabel} - ${item.workspaceName} - ${item.modelId}`
    }
    return `${stateLabel} - ${item.workspaceName}`
  }

  private readSessionStateLabel(item: TraySessionItem): string {
    if (item.state === 'running') {
      return 'Running'
    }
    if (item.state === 'awaiting') {
      return 'Awaiting'
    }
    if (item.state === 'pinned') {
      return 'Pinned'
    }
    return 'Recent'
  }

  private buildBadgeLabel(label: string, count: number): string {
    return count > 0 ? `${label} (${count})` : label
  }

  private buildAutomationLabel(counts: TrayCounts | undefined): string {
    if (!counts) {
      return 'Automations'
    }
    if (counts.runningAutomations > 0) {
      return this.buildBadgeLabel('Automations', counts.runningAutomations)
    }
    return this.buildBadgeLabel('Automations', counts.enabledAutomations)
  }

  private buildHeaderLabel(snapshot: TrayData | null): string {
    if (!snapshot) {
      return 'Cradle'
    }
    return `Cradle - ${this.buildHealthLabel(snapshot)}`
  }

  private buildHeaderSublabel(snapshot: TrayData): string {
    return [
      pluralize(snapshot.counts.running, 'running'),
      pluralize(snapshot.counts.recentSessions, 'recent'),
      pluralize(snapshot.counts.pendingAwaits, 'await'),
    ].join(' | ')
  }

  private buildHealthLabel(snapshot: TrayData): string {
    const attentionCount = snapshot.health.filter(isAttentionItem).length
    return attentionCount > 0 ? pluralize(attentionCount, 'issue') : 'Healthy'
  }

  private updateTrayPresentation(snapshot: TrayData | null): void {
    if (!this.tray) {
      return
    }

    this.tray.setToolTip(snapshot
      ? `Cradle - ${this.buildHealthLabel(snapshot)}: ${snapshot.counts.running} running, ${snapshot.counts.pendingAwaits} awaits`
      : 'Cradle')

    if (process.platform === 'darwin') {
      this.tray.setTitle(this.readTrayTitle(snapshot))
    }
  }

  private readTrayTitle(snapshot: TrayData | null): string {
    if (!snapshot) {
      return ''
    }
    if (snapshot.counts.pendingAwaits > 0) {
      return String(snapshot.counts.pendingAwaits)
    }
    if (snapshot.health.some(isAttentionItem)) {
      return '!'
    }
    return snapshot.counts.running > 0 ? String(snapshot.counts.running) : ''
  }

  private updatePlatformNotification(snapshot: TrayData | null): void {
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
}

export { TRAY_ACTION_CHANNEL, TRAY_PENDING_ACTIONS_CHANNEL }
