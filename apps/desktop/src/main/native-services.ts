import { createServices, IpcMethod, IpcService } from '@cradle/ipc'
import { app, dialog, shell } from 'electron'
import { join } from 'node:path'

import type { DesktopUpdateManager, DesktopUpdateStatus } from './update-manager'
import type { WindowManager } from './window-manager'

// ── Native File System Service ────────────────────────────────────────────────

class NativeService extends IpcService {
  static readonly groupName = 'native'

  @IpcMethod()
  async showOpenDialog(options: {
    title?: string
    defaultPath?: string
    properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles'>
    filters?: Array<{ name: string, extensions: string[] }>
  }): Promise<{ canceled: boolean, filePaths: string[] }> {
    const result = await dialog.showOpenDialog({
      title: options.title,
      defaultPath: options.defaultPath,
      properties: options.properties ?? ['openDirectory'],
      filters: options.filters,
    })
    return { canceled: result.canceled, filePaths: result.filePaths }
  }

  @IpcMethod()
  async showSaveDialog(options: {
    title?: string
    defaultPath?: string
    filters?: Array<{ name: string, extensions: string[] }>
  }): Promise<{ canceled: boolean, filePath?: string }> {
    const result = await dialog.showSaveDialog({
      title: options.title,
      defaultPath: options.defaultPath,
      filters: options.filters,
    })
    return { canceled: result.canceled, filePath: result.filePath }
  }

  @IpcMethod()
  async openExternal(url: string): Promise<void> {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:' && parsed.protocol !== 'mailto:') {
      throw new Error(`Unsupported external URL scheme: ${parsed.protocol}`)
    }
    await shell.openExternal(url)
  }

  @IpcMethod()
  async showItemInFolder(fullPath: string): Promise<void> {
    shell.showItemInFolder(fullPath)
  }

  @IpcMethod()
  async getCradleDataPaths(): Promise<{
    userDataPath: string
    serverDataPath: string
    databasePath: string
    serverLogPath: string
  }> {
    const userDataPath = app.getPath('userData')
    const serverDataPath = join(userDataPath, 'data')
    return {
      userDataPath,
      serverDataPath,
      databasePath: join(serverDataPath, 'cradle.db'),
      serverLogPath: join(serverDataPath, 'server.log'),
    }
  }
}

// ── Window Management Service ─────────────────────────────────────────────────

interface NativeServicesContext {
  getWindowManager: () => WindowManager | undefined
  getUpdateManager: () => DesktopUpdateManager | null
}

let nativeServicesContext: NativeServicesContext | null = null

function getWindowManager(): WindowManager | undefined {
  return nativeServicesContext?.getWindowManager()
}

function getUpdateManager(): DesktopUpdateManager | null {
  return nativeServicesContext?.getUpdateManager() ?? null
}

class WindowService extends IpcService {
  static readonly groupName = 'window'

  @IpcMethod()
  async tearOffSession(sessionId: string, screenX: number, screenY: number): Promise<void> {
    const windowManager = getWindowManager()
    if (!windowManager) {
      throw new Error('WindowManager not initialized')
    }
    await windowManager.openSessionWindow(sessionId, screenX, screenY)
  }

  @IpcMethod()
  async focusSession(sessionId: string): Promise<boolean> {
    const windowManager = getWindowManager()
    if (!windowManager) {
      return false
    }
    return windowManager.focusSessionWindow(sessionId)
  }

  @IpcMethod()
  async closeSession(sessionId: string): Promise<void> {
    getWindowManager()?.closeSessionWindow(sessionId)
  }

  @IpcMethod()
  async getOpenSessions(): Promise<string[]> {
    return getWindowManager()?.getOpenSessionIds() ?? []
  }

  @IpcMethod()
  async openDevtool(): Promise<void> {
    const windowManager = getWindowManager()
    if (!windowManager) {
      throw new Error('WindowManager not initialized')
    }
    await windowManager.openDevtoolWindow()
  }

  @IpcMethod()
  async minimize(): Promise<void> {
    getWindowManager()?.getMainWindow()?.minimize()
  }

  @IpcMethod()
  async maximize(): Promise<void> {
    const win = getWindowManager()?.getMainWindow()
    if (!win) {
      return
    }
    if (win.isMaximized()) {
      win.unmaximize()
      return
    }
    win.maximize()
  }

  @IpcMethod()
  async close(): Promise<void> {
    getWindowManager()?.getMainWindow()?.close()
  }
}

// ── Desktop Update Service ────────────────────────────────────────────────────

class DesktopUpdateService extends IpcService {
  static readonly groupName = 'desktopUpdate'

  @IpcMethod()
  async getStatus(): Promise<DesktopUpdateStatus> {
    const updateManager = this.readUpdateManager()
    return updateManager.status
  }

  @IpcMethod()
  async checkForUpdates(): Promise<DesktopUpdateStatus> {
    const updateManager = this.readUpdateManager()
    return updateManager.checkForUpdates()
  }

  @IpcMethod()
  async downloadUpdate(): Promise<DesktopUpdateStatus> {
    const updateManager = this.readUpdateManager()
    return updateManager.downloadUpdate()
  }

  @IpcMethod()
  async applyUpdate(): Promise<void> {
    const updateManager = this.readUpdateManager()
    await updateManager.applyUpdate()
  }

  private readUpdateManager(): DesktopUpdateManager {
    const updateManager = getUpdateManager()
    if (!updateManager) {
      throw new Error('Desktop update manager is not initialized')
    }
    return updateManager
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createNativeServices(context: NativeServicesContext) {
  nativeServicesContext = context
  return createServices([NativeService, WindowService, DesktopUpdateService] as const)
}
