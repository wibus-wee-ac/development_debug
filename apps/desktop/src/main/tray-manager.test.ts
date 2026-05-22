import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const MenuItemSchema: z.ZodType<Record<string, unknown>> = z.lazy(() =>
  z.object({
    submenu: z.array(MenuItemSchema).optional(),
  }).passthrough(),
)
const MenuItemsSchema = z.array(MenuItemSchema).optional().default([])

const electronMocks = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void

  class FakeBrowserWindow {
    static instances: FakeBrowserWindow[] = []

    readonly options: Record<string, unknown>
    readonly handlers = new Map<string, Listener[]>()
    readonly webContents = {
      isLoadingMainFrame: vi.fn(() => false),
      isDevToolsOpened: vi.fn(() => false),
      send: vi.fn(),
    }

    bounds: unknown = null
    visible = false
    destroyed = false
    minimized = false
    hidden = false
    loadURL = vi.fn(() => Promise.resolve())
    loadFile = vi.fn(() => Promise.resolve())
    setBounds = vi.fn((bounds: unknown) => {
      this.bounds = bounds
    })
    show = vi.fn(() => {
      this.visible = true
      this.hidden = false
    })
    focus = vi.fn()
    hide = vi.fn(() => {
      this.visible = false
      this.hidden = true
    })
    destroy = vi.fn(() => {
      this.destroyed = true
      this.emit('closed')
    })
    restore = vi.fn(() => {
      this.minimized = false
    })

    constructor(options: Record<string, unknown>) {
      this.options = options
      FakeBrowserWindow.instances.push(this)
    }

    on(eventName: string, listener: Listener): void {
      const listeners = this.handlers.get(eventName) ?? []
      listeners.push(listener)
      this.handlers.set(eventName, listeners)
    }

    emit(eventName: string, ...args: unknown[]): void {
      for (const listener of this.handlers.get(eventName) ?? []) {
        listener(...args)
      }
    }

    isDestroyed(): boolean {
      return this.destroyed
    }

    isVisible(): boolean {
      return this.visible
    }

    isMinimized(): boolean {
      return this.minimized
    }
  }

  class FakeTray {
    static instances: FakeTray[] = []

    readonly handlers = new Map<string, Listener[]>()
    tooltip: string | null = null
    title: string | null = null
    image: unknown = null
    pressedImage: unknown = null
    contextMenu: unknown = null
    popupMenu: unknown = null
    popupPosition: unknown = null
    balloon: unknown = null
    ignoreDoubleClickEvents = false
    focused = false
    contextMenuClosed = false
    balloonRemoved = false
    destroyed = false

    constructor() {
      FakeTray.instances.push(this)
    }

    setToolTip(tooltip: string): void {
      this.tooltip = tooltip
    }

    setImage(image: unknown): void {
      this.image = image
    }

    setPressedImage(image: unknown): void {
      this.pressedImage = image
    }

    setTitle(title: string): void {
      this.title = title
    }

    setIgnoreDoubleClickEvents(ignore: boolean): void {
      this.ignoreDoubleClickEvents = ignore
    }

    setContextMenu(menu: unknown): void {
      this.contextMenu = menu
    }

    popUpContextMenu(menu: unknown, position?: unknown): void {
      this.popupMenu = menu
      this.popupPosition = position
    }

    closeContextMenu(): void {
      this.contextMenuClosed = true
    }

    displayBalloon(options: unknown): void {
      this.balloon = options
    }

    removeBalloon(): void {
      this.balloonRemoved = true
    }

    focus(): void {
      this.focused = true
    }

    getBounds() {
      return { x: 80, y: 20, width: 24, height: 24 }
    }

    on(eventName: string, listener: Listener): void {
      const listeners = this.handlers.get(eventName) ?? []
      listeners.push(listener)
      this.handlers.set(eventName, listeners)
    }

    emit(eventName: string): void {
      for (const listener of this.handlers.get(eventName) ?? []) {
        listener()
      }
    }

    destroy(): void {
      this.destroyed = true
    }
  }

  const ipcHandlers = new Map<string, Listener>()
  const nativeImageValue = {
    resize: vi.fn(() => nativeImageValue),
    setTemplateImage: vi.fn(),
  }

  return {
    app: {
      quit: vi.fn(),
    },
    BrowserWindow: FakeBrowserWindow,
    ipcHandlers,
    ipcMain: {
      handle: vi.fn((channel: string, handler: Listener) => {
        ipcHandlers.set(channel, handler)
      }),
      removeHandler: vi.fn((channel: string) => {
        ipcHandlers.delete(channel)
      }),
    },
    nativeImage: {
      createFromPath: vi.fn(() => nativeImageValue),
      createEmpty: vi.fn(() => nativeImageValue),
      createFromBuffer: vi.fn(() => nativeImageValue),
    },
    Menu: {
      buildFromTemplate: vi.fn((template: unknown[]) => ({ template })),
    },
    Tray: FakeTray,
  }
})

vi.mock('electron', () => electronMocks)

function lastMenuTemplate(): Array<Record<string, unknown>> {
  const calls = electronMocks.Menu.buildFromTemplate.mock.calls
  return calls.at(-1)?.[0] as Array<Record<string, unknown>>
}

function findMenuItem(
  items: Array<Record<string, unknown>>,
  label: string,
): Record<string, unknown> | undefined {
  for (const item of items) {
    if (item.label === label) {
      return item
    }
    const childItems = MenuItemsSchema.parse(item.submenu)
    if (childItems.length > 0) {
      const child = findMenuItem(childItems, label)
      if (child) {
        return child
      }
    }
  }
  return undefined
}

function submenuItems(
  items: Array<Record<string, unknown>>,
  label: string,
): Array<Record<string, unknown>> {
  const item = findMenuItem(items, label)
  return MenuItemsSchema.parse(item?.submenu)
}

describe('TrayManager', () => {
  const originalRendererUrl = process.env.ELECTRON_RENDERER_URL

  beforeEach(() => {
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173/'
    electronMocks.BrowserWindow.instances.length = 0
    electronMocks.Tray.instances.length = 0
    electronMocks.ipcHandlers.clear()
    electronMocks.app.quit.mockClear()
    electronMocks.ipcMain.handle.mockClear()
    electronMocks.ipcMain.removeHandler.mockClear()
    electronMocks.nativeImage.createFromPath.mockClear()
    electronMocks.nativeImage.createEmpty.mockClear()
    electronMocks.nativeImage.createFromBuffer.mockClear()
    electronMocks.Menu.buildFromTemplate.mockClear()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      metrics: [
        { label: 'Running', value: '1', tone: 'active' },
        { label: 'Resident', value: '1', tone: 'active' },
        { label: 'Approvals', value: '2', tone: 'warning' },
        { label: 'Awaits', value: '3', tone: 'warning' },
        { label: 'Automations', value: '1 active', tone: 'active' },
        { label: 'Chronicle', value: 'Running', tone: 'active' },
      ],
      running: [
        {
          sessionId: 'running-session',
          title: 'Active run',
          workspaceName: 'Cradle',
          runtimeKind: 'codex',
          modelId: 'gpt-5.5',
          detail: 'Running codex',
        },
      ],
      resident: [
        {
          sessionId: 'resident-session',
          title: 'Resident chat',
          workspaceName: 'Cradle',
          runtimeKind: 'claude',
          modelId: null,
          detail: 'Resident claude',
        },
      ],
      quickActions: [
        {
          id: 'open-app',
          label: 'Open Cradle',
          description: 'Bring the main desktop window forward.',
          accelerator: null,
          badge: null,
          enabled: true,
        },
        {
          id: 'new-chat',
          label: 'New Chat',
          description: 'Start a fresh agent conversation.',
          accelerator: '⌘N',
          badge: null,
          enabled: true,
        },
        {
          id: 'global-search',
          label: 'Search Threads',
          description: 'Open the command palette for threads, files, and issues.',
          accelerator: '⌘K',
          badge: null,
          enabled: true,
        },
        {
          id: 'open-resident',
          label: 'Resident Chats',
          description: 'Jump to pinned sessions kept close at hand.',
          accelerator: null,
          badge: '1',
          enabled: true,
        },
        {
          id: 'open-running',
          label: 'Running Agents',
          description: 'Focus the most recent active agent run.',
          accelerator: null,
          badge: '1',
          enabled: true,
        },
        {
          id: 'open-approvals',
          label: 'Approvals',
          description: 'Review pending tool approvals.',
          accelerator: null,
          badge: '2',
          enabled: true,
        },
        {
          id: 'open-awaits',
          label: 'Awaits',
          description: 'Check sessions waiting on external signals.',
          accelerator: null,
          badge: '3',
          enabled: true,
        },
        {
          id: 'open-automation',
          label: 'Automations',
          description: 'Inspect scheduled agent work and recent runs.',
          accelerator: null,
          badge: '1',
          enabled: true,
        },
        {
          id: 'open-workspaces',
          label: 'Workspaces',
          description: 'Open the workspace hub.',
          accelerator: null,
          badge: '4',
          enabled: true,
        },
        {
          id: 'open-agents',
          label: 'Agents',
          description: 'Manage resident agent profiles and runtime defaults.',
          accelerator: null,
          badge: null,
          enabled: true,
        },
        {
          id: 'open-providers',
          label: 'Providers',
          description: 'Review model providers and connection settings.',
          accelerator: null,
          badge: null,
          enabled: true,
        },
        {
          id: 'open-chronicle',
          label: 'Chronicle',
          description: 'View local activity memory and capture status.',
          accelerator: null,
          badge: null,
          enabled: true,
        },
        {
          id: 'open-usage',
          label: 'Usage',
          description: 'Review token and cost analytics.',
          accelerator: null,
          badge: null,
          enabled: true,
        },
        {
          id: 'open-plugins',
          label: 'Plugins',
          description: 'Inspect plugin capability surfaces.',
          accelerator: null,
          badge: null,
          enabled: true,
        },
        {
          id: 'open-desktop-settings',
          label: 'Desktop Updates',
          description: 'Check update status and desktop settings.',
          accelerator: null,
          badge: null,
          enabled: true,
        },
      ],
    }), { status: 200 })))
  })

  afterEach(() => {
    if (originalRendererUrl === undefined) {
      delete process.env.ELECTRON_RENDERER_URL
    }
    else {
      process.env.ELECTRON_RENDERER_URL = originalRendererUrl
    }
    vi.unstubAllGlobals()
  })

  it('opens a native tray menu when the tray icon is clicked', async () => {
    const { TrayManager } = await import('./tray-manager')
    const manager = new TrayManager({
      serverUrl: 'http://127.0.0.1:21423',
      getMainWindow: () => null,
      createMainWindow: vi.fn(),
    })

    manager.initialize()
    electronMocks.Tray.instances[0]?.emit('click')

    await vi.waitFor(() => {
      expect(electronMocks.Tray.instances[0]?.popupMenu).toBeTruthy()
    })

    expect(electronMocks.Tray.instances[0]?.tooltip).toBe('Cradle - 1 running, 1 resident')
    expect(electronMocks.Tray.instances[0]?.ignoreDoubleClickEvents).toBe(true)
    expect(electronMocks.Tray.instances[0]?.image).toBeTruthy()
    expect(electronMocks.Tray.instances[0]?.pressedImage).toBeTruthy()
    expect(electronMocks.BrowserWindow.instances).toHaveLength(0)
    expect(electronMocks.nativeImage.createFromBuffer).toHaveBeenCalledWith(expect.any(Buffer), {
      width: 18,
      height: 18,
    })
    expect(electronMocks.nativeImage.createFromPath).not.toHaveBeenCalled()
    expect(electronMocks.nativeImage.createEmpty).not.toHaveBeenCalled()
    expect(globalThis.fetch).toHaveBeenCalledWith(new URL('/desktop/tray', 'http://127.0.0.1:21423'))
    const template = lastMenuTemplate()
    expect(template).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Cradle - 1 running, 1 resident', enabled: false }),
      expect.objectContaining({ label: 'Open Cradle' }),
      expect.objectContaining({
        label: 'New Chat',
        accelerator: 'CommandOrControl+N',
        registerAccelerator: true,
        visible: true,
      }),
      expect.objectContaining({
        label: 'Search Threads',
        accelerator: 'CommandOrControl+K',
        registerAccelerator: true,
        visible: true,
      }),
      expect.objectContaining({ label: 'Status' }),
      expect.objectContaining({ label: 'Running Agents (1)' }),
      expect.objectContaining({ label: 'Resident Chats (1)' }),
      expect.objectContaining({ label: 'Actions' }),
      expect.objectContaining({
        label: 'Quit Cradle',
        role: 'quit',
        accelerator: 'CommandOrControl+Q',
        registerAccelerator: true,
      }),
    ]))
    expect(findMenuItem(template, 'Running: 1')).toEqual(expect.objectContaining({
      type: 'checkbox',
      checked: true,
      enabled: false,
      toolTip: 'Running is 1',
    }))
    expect(findMenuItem(template, 'Approvals: 2')).toEqual(expect.objectContaining({
      type: 'checkbox',
      checked: true,
      enabled: false,
      toolTip: 'Approvals is 2',
    }))
    expect(findMenuItem(template, 'Active run')).toEqual(expect.objectContaining({
      sublabel: 'Cradle',
      toolTip: 'Running codex',
    }))
    expect(findMenuItem(template, 'Resident chat')).toEqual(expect.objectContaining({
      sublabel: 'Cradle',
      toolTip: 'Resident claude',
    }))
    const actions = submenuItems(template, 'Actions')
    expect(findMenuItem(actions, 'Resident Chats (1)')).toEqual(expect.objectContaining({
      sublabel: 'Jump to pinned sessions kept close at hand.',
    }))
    expect(findMenuItem(actions, 'Running Agents (1)')).toEqual(expect.objectContaining({
      sublabel: 'Focus the most recent active agent run.',
    }))
    expect(findMenuItem(actions, 'Awaits (3)')).toEqual(expect.objectContaining({
      sublabel: 'Check sessions waiting on external signals.',
    }))
    expect(findMenuItem(actions, 'Automations (1)')).toBeTruthy()
    expect(findMenuItem(actions, 'Workspaces (4)')).toBeTruthy()
    expect(findMenuItem(actions, 'Agents')).toBeTruthy()
    expect(findMenuItem(actions, 'Providers')).toBeTruthy()
    expect(findMenuItem(actions, 'Chronicle')).toBeTruthy()
    expect(findMenuItem(actions, 'Usage')).toBeTruthy()
    expect(findMenuItem(actions, 'Plugins')).toBeTruthy()
    expect(findMenuItem(actions, 'Desktop Updates')).toBeTruthy()

    manager.destroy()
    expect(electronMocks.Tray.instances[0]?.contextMenuClosed).toBe(true)
  })

  it('opens a degraded native menu when tray data is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })))
    const { TrayManager } = await import('./tray-manager')
    const manager = new TrayManager({
      serverUrl: 'http://127.0.0.1:21423',
      getMainWindow: () => null,
      createMainWindow: vi.fn(),
    })

    manager.initialize()
    await manager.openNativeMenu()

    expect(electronMocks.Menu.buildFromTemplate).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ label: 'Tray data unavailable', enabled: false }),
      expect.objectContaining({ label: 'Quit Cradle' }),
    ]))

    manager.destroy()
  })

  it('forwards native menu item clicks with the same payloads as the former tray surface', async () => {
    const { TrayManager } = await import('./tray-manager')
    const mainWindow = new electronMocks.BrowserWindow({})
    const manager = new TrayManager({
      serverUrl: 'http://127.0.0.1:21423',
      getMainWindow: () => mainWindow as never,
      createMainWindow: vi.fn(),
    })

    manager.initialize()
    await manager.openNativeMenu()

    const template = lastMenuTemplate()
    const runningSession = findMenuItem(template, 'Active run')
    const actions = submenuItems(template, 'Actions')
    const runningAction = findMenuItem(actions, 'Running Agents (1)')
    const awaitsAction = findMenuItem(actions, 'Awaits (3)')

    await (runningSession?.click as () => Promise<void> | void)?.()
    await (runningAction?.click as () => Promise<void> | void)?.()
    await (awaitsAction?.click as () => Promise<void> | void)?.()

    expect(mainWindow.webContents.send).toHaveBeenCalledWith('desktop-tray:action-requested', {
      actionId: 'open-chat',
      payload: { sessionId: 'running-session' },
    })
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('desktop-tray:action-requested', {
      actionId: 'open-running',
      payload: { sessionId: 'running-session' },
    })
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('desktop-tray:action-requested', {
      actionId: 'open-awaits',
      payload: undefined,
    })

    manager.destroy()
  })

  it('focuses the main window and forwards non-quit actions to the renderer', async () => {
    const { TrayManager } = await import('./tray-manager')
    const mainWindow = new electronMocks.BrowserWindow({})
    const manager = new TrayManager({
      serverUrl: 'http://127.0.0.1:21423',
      getMainWindow: () => mainWindow as never,
      createMainWindow: vi.fn(),
    })

    manager.initialize()
    await manager.performAction('open-chat', { sessionId: 'session-1' })

    expect(mainWindow.show).toHaveBeenCalled()
    expect(mainWindow.focus).toHaveBeenCalled()
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('desktop-tray:action-requested', {
      actionId: 'open-chat',
      payload: { sessionId: 'session-1' },
    })

    manager.destroy()
  })

  it('queues actions while a new main window is loading and exposes pending requests', async () => {
    const { TrayManager, TRAY_PENDING_ACTIONS_CHANNEL } = await import('./tray-manager')
    const loadingWindow = new electronMocks.BrowserWindow({})
    loadingWindow.webContents.isLoadingMainFrame.mockReturnValue(true)
    const createMainWindow = vi.fn(async () => loadingWindow as never)
    const manager = new TrayManager({
      serverUrl: 'http://127.0.0.1:21423',
      getMainWindow: () => loadingWindow as never,
      createMainWindow,
    })

    manager.initialize()
    await manager.performAction('new-chat')

    const pendingHandler = electronMocks.ipcHandlers.get(TRAY_PENDING_ACTIONS_CHANNEL)
    expect(pendingHandler?.()).toEqual([{ actionId: 'new-chat', payload: undefined }])
    expect(pendingHandler?.()).toEqual([])

    manager.destroy()
  })

  it('quits without forwarding a quit action to the renderer', async () => {
    const { TrayManager } = await import('./tray-manager')
    const mainWindow = new electronMocks.BrowserWindow({})
    const manager = new TrayManager({
      serverUrl: 'http://127.0.0.1:21423',
      getMainWindow: () => mainWindow as never,
      createMainWindow: vi.fn(),
    })

    manager.initialize()
    await manager.performAction('quit')

    expect(electronMocks.app.quit).toHaveBeenCalled()
    expect(mainWindow.webContents.send).not.toHaveBeenCalled()

    manager.destroy()
  })
})
