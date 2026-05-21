import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
    destroyed = false

    constructor() {
      FakeTray.instances.push(this)
    }

    setToolTip(tooltip: string): void {
      this.tooltip = tooltip
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

    getBounds() {
      return { x: 80, y: 20, width: 24, height: 24 }
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
    },
    screen: {
      getDisplayNearestPoint: vi.fn(() => ({
        workArea: { x: 0, y: 0, width: 1440, height: 900 },
      })),
    },
    Tray: FakeTray,
  }
})

vi.mock('electron', () => electronMocks)

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
  })

  afterEach(() => {
    if (originalRendererUrl === undefined) {
      delete process.env.ELECTRON_RENDERER_URL
    }
    else {
      process.env.ELECTRON_RENDERER_URL = originalRendererUrl
    }
  })

  it('opens a tray popover surface when the tray icon is clicked', async () => {
    const { TrayManager } = await import('./tray-manager')
    const manager = new TrayManager({
      serverUrl: 'http://127.0.0.1:21423',
      getMainWindow: () => null,
      createMainWindow: vi.fn(),
    })

    manager.initialize()
    electronMocks.Tray.instances[0]?.emit('click')

    await vi.waitFor(() => {
      expect(electronMocks.BrowserWindow.instances).toHaveLength(1)
      expect(electronMocks.BrowserWindow.instances[0]?.show).toHaveBeenCalled()
    })

    const popover = electronMocks.BrowserWindow.instances[0]!
    expect(electronMocks.Tray.instances[0]?.tooltip).toBe('Cradle')
    expect(popover.options).toMatchObject({
      width: 380,
      height: 640,
      frame: false,
      skipTaskbar: true,
      alwaysOnTop: true,
    })
    expect(popover.loadURL).toHaveBeenCalledWith('http://localhost:5173/?surface=tray')
    expect(popover.focus).toHaveBeenCalled()

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
