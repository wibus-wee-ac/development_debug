import { createServices, IpcMethod, IpcService } from '@cradle/ipc'
import { app, dialog, shell } from 'electron'
import { join } from 'node:path'

import type { MacBridgeManager } from './mac-bridge-manager'
import type {
  MacCaptureFrontmostWindowResult,
  MacPermissionSettingsRequest,
  MacPermissionSettingsResult,
  MacPermissionsRequest,
  MacPermissionsRequestResult,
  MacPermissionsStatus,
} from './mac-bridge-protocol'
import type { MacScreenshotSinkId, MacScreenshotSinkResult } from './mac-screenshot-sinks'
import { runMacScreenshotSink } from './mac-screenshot-sinks'
import type { DesktopUpdateManager, DesktopUpdateStatus } from './update-manager'
import type { WindowManager } from './window-manager'

const DEFAULT_PRIVACY_SENSITIVE_APP_BUNDLE_IDS = [
  'com.apple.keychainaccess',
  'com.1password.1password',
  'com.agilebits.onepassword7',
  'com.bitwarden.desktop',
]

const DEFAULT_PRIVACY_SENSITIVE_TITLE_PATTERNS = [
  'password',
  'passkey',
  'secret',
  'recovery key',
  'one-time code',
]

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
  getMacBridgeManager: () => MacBridgeManager | null
}

let nativeServicesContext: NativeServicesContext | null = null

function getWindowManager(): WindowManager | undefined {
  return nativeServicesContext?.getWindowManager()
}

function getUpdateManager(): DesktopUpdateManager | null {
  return nativeServicesContext?.getUpdateManager() ?? null
}

function getMacBridgeManager(): MacBridgeManager | null {
  return nativeServicesContext?.getMacBridgeManager() ?? null
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

// ── Mac Capture Service ──────────────────────────────────────────────────────

export interface MacCaptureRequest {
  sink?: MacScreenshotSinkId
  privacySensitiveAppBundleIds?: string[]
  privacySensitiveTitlePatterns?: string[]
}

export interface MacCaptureResponse {
  capture: MacCaptureFrontmostWindowResult
  sink: MacScreenshotSinkResult
}

class MacCaptureService extends IpcService {
  static readonly groupName = 'macCapture'

  @IpcMethod()
  async getStatus() {
    return getMacBridgeManager()?.getStatus() ?? {
      available: false,
      running: false,
      platform: process.platform,
      binaryPath: null,
      pid: null,
      startedAt: null,
      lastError: 'Mac Bridge manager is not initialized',
    }
  }

  @IpcMethod()
  async getPermissions(): Promise<MacPermissionsStatus> {
    const manager = this.readManager()
    return manager.readPermissions()
  }

  @IpcMethod()
  async requestPermissions(options: MacPermissionsRequest = {}): Promise<MacPermissionsRequestResult> {
    const manager = this.readManager()
    return manager.requestPermissions(options)
  }

  @IpcMethod()
  async openPermissionSettings(options: MacPermissionSettingsRequest = {}): Promise<MacPermissionSettingsResult> {
    const manager = this.readManager()
    return manager.openPermissionSettings(options)
  }

  @IpcMethod()
  async configureBothCommandHotkey(enabled: boolean) {
    const manager = this.readManager()
    return manager.configureInput({
      trigger: 'bothCommand',
      enabled,
    })
  }

  @IpcMethod()
  async captureFrontmostWindow(options: MacCaptureRequest = {}): Promise<MacCaptureResponse> {
    return captureFrontmostWindowWithMacBridge(options)
  }

  private readManager(): MacBridgeManager {
    const manager = getMacBridgeManager()
    if (!manager) {
      throw new Error('Mac Bridge manager is not initialized')
    }
    return manager
  }
}

export async function captureFrontmostWindowWithMacBridge(options: MacCaptureRequest = {}): Promise<MacCaptureResponse> {
  const manager = getMacBridgeManager()
  if (!manager) {
    throw new Error('Mac Bridge manager is not initialized')
  }
  const outputDir = join(app.getPath('userData'), 'mac-captures')
  const capture = await manager.captureFrontmostWindow({
    outputDir,
    privacySensitiveAppBundleIds: [
      ...DEFAULT_PRIVACY_SENSITIVE_APP_BUNDLE_IDS,
      ...(options.privacySensitiveAppBundleIds ?? []),
    ],
    privacySensitiveTitlePatterns: [
      ...DEFAULT_PRIVACY_SENSITIVE_TITLE_PATTERNS,
      ...(options.privacySensitiveTitlePatterns ?? []),
    ],
  })
  const sink = await runMacScreenshotSink({
    sink: options.sink ?? 'file',
    capture,
  })
  return {
    capture,
    sink,
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createNativeServices(context: NativeServicesContext) {
  nativeServicesContext = context
  return createServices([NativeService, WindowService, DesktopUpdateService, MacCaptureService] as const)
}
