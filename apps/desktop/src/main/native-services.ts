// Input: @cradle/ipc IpcService/IpcMethod, Electron dialog/shell APIs, WindowManager
// Output: Native IPC services for Electron-only features
// Position: apps/desktop/src/main/native-services.ts

import { dialog, shell } from 'electron'

import { createServices, IpcMethod, IpcService } from '@cradle/ipc'

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
    await shell.openExternal(url)
  }

  @IpcMethod()
  async showItemInFolder(fullPath: string): Promise<void> {
    shell.showItemInFolder(fullPath)
  }
}

// ── Window Management Service ─────────────────────────────────────────────────

let windowManagerRef: WindowManager | null = null

class WindowService extends IpcService {
  static readonly groupName = 'window'

  @IpcMethod()
  async tearOffSession(sessionId: string, screenX: number, screenY: number): Promise<void> {
    if (!windowManagerRef) {
      throw new Error('WindowManager not initialized')
    }
    await windowManagerRef.openSessionWindow(sessionId, screenX, screenY)
  }

  @IpcMethod()
  async focusSession(sessionId: string): Promise<boolean> {
    if (!windowManagerRef) {
      return false
    }
    return windowManagerRef.focusSessionWindow(sessionId)
  }

  @IpcMethod()
  async closeSession(sessionId: string): Promise<void> {
    windowManagerRef?.closeSessionWindow(sessionId)
  }

  @IpcMethod()
  async getOpenSessions(): Promise<string[]> {
    return windowManagerRef?.getOpenSessionIds() ?? []
  }

  @IpcMethod()
  async openDevtool(): Promise<void> {
    if (!windowManagerRef) {
      throw new Error('WindowManager not initialized')
    }
    await windowManagerRef.openDevtoolWindow()
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createNativeServices(windowManager: WindowManager) {
  windowManagerRef = windowManager
  return createServices([NativeService, WindowService] as const)
}
