import { createIpcProxy } from '@cradle/ipc/client'

/**
 * Whether we're running inside Electron.
 */
export const isElectron = !!window.cradle?.env?.isElectron

/**
 * The server URL — from Electron preload or Vite env.
 * WARNING: Unless you need to bypass api-gen's react-query integration, do not use this client directly.
 */
export function getServerUrl(): string {
  if (window.cradle?.env?.serverUrl) {
    return window.cradle.env.serverUrl
  }
  return import.meta.env.VITE_SERVER_URL ?? 'http://127.0.0.1:21423'
}

/**
 * Build a WebSocket URL from the configured server base URL.
 */
export function getServerWebSocketUrl(
  path: string,
  query?: Record<string, string | number | boolean | null | undefined>,
): string {
  const url = new URL(path, getServerUrl())
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === null || value === undefined) {
        continue
      }
      url.searchParams.set(key, String(value))
    }
  }

  return url.toString()
}

/**
 * Whether this is a tearoff window (session-specific).
 */
export const isTearoffWindow = !!window.cradle?.env?.isTearoff

/**
 * The session ID for tearoff windows.
 */
export const tearoffSessionId = window.cradle?.env?.sessionId ?? null

/**
 * The OS platform.
 */
export const platform = window.cradle?.env?.platform ?? 'darwin'

// ── IPC Proxy (typed) ─────────────────────────────────────────────────────────

interface NativeServiceMethods {
  showOpenDialog: (options: {
    title?: string
    defaultPath?: string
    properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles'>
    filters?: Array<{ name: string, extensions: string[] }>
  }) => Promise<{ canceled: boolean, filePaths: string[] }>

  showSaveDialog: (options: {
    title?: string
    defaultPath?: string
    filters?: Array<{ name: string, extensions: string[] }>
  }) => Promise<{ canceled: boolean, filePath?: string }>

  openExternal: (url: string) => Promise<void>
  showItemInFolder: (fullPath: string) => Promise<void>
  getCradleDataPaths: () => Promise<{
    userDataPath: string
    serverDataPath: string
    databasePath: string
    serverLogPath: string
  }>
}

interface WindowServiceMethods {
  tearOffSession: (sessionId: string, screenX: number, screenY: number) => Promise<void>
  focusSession: (sessionId: string) => Promise<boolean>
  closeSession: (sessionId: string) => Promise<void>
  getOpenSessions: () => Promise<string[]>
}

export interface DesktopUpdateAsset {
  PackageId: string
  Version: string
  Type: string
  FileName: string
  Size: number
  NotesMarkdown: string
  NotesHtml: string
}

export interface DesktopUpdateInfo {
  TargetFullRelease: DesktopUpdateAsset
  BaseRelease?: DesktopUpdateAsset
  DeltasToTarget: DesktopUpdateAsset[]
  IsDowngrade: boolean
}

export interface DesktopUpdateStatus {
  unsupported: boolean
  currentVersion: string
  isCheckingForUpdates: boolean
  isDownloadingUpdate: boolean
  downloadingProgress: number
  updateDownloaded: boolean
  updateInfo: DesktopUpdateInfo | null
  errorMessage: string | null
}

interface DesktopUpdateServiceMethods {
  getStatus: () => Promise<DesktopUpdateStatus>
  checkForUpdates: () => Promise<DesktopUpdateStatus>
  downloadUpdate: () => Promise<DesktopUpdateStatus>
  applyUpdate: () => Promise<void>
}

export interface MacBridgeRuntimeStatus {
  available: boolean
  running: boolean
  platform: 'darwin' | 'win32' | 'linux' | string
  binaryPath: string | null
  pid: number | null
  startedAt: string | null
  lastError: string | null
}

export interface MacPermissionsStatus {
  accessibility: 'granted' | 'denied' | 'notDetermined' | 'unsupported' | 'unknown'
  screenRecording: 'granted' | 'denied' | 'notDetermined' | 'unsupported' | 'unknown'
  inputMonitoring: 'granted' | 'denied' | 'notDetermined' | 'unsupported' | 'unknown'
}

export type MacPermissionKind = 'accessibility' | 'screenRecording' | 'inputMonitoring'

export type MacPermissionSettingsTarget
  = | 'privacy'
    | 'accessibility'
    | 'screenRecording'
    | 'inputMonitoring'

export interface MacPermissionsRequestResult {
  requested: MacPermissionKind[]
  status: MacPermissionsStatus
}

export interface MacPermissionSettingsResult {
  target: MacPermissionSettingsTarget
  url: string
  opened: boolean
}

export interface MacCaptureResponse {
  capture: {
    filePath: string
    metadataPath: string
    capturedAt: string
    window: {
      windowId: number
      appName: string | null
      bundleId: string | null
      processId: number
      title: string | null
      bounds: {
        x: number
        y: number
        width: number
        height: number
      } | null
    }
  }
  sink: {
    sink: 'file' | 'clipboard' | 'cleanshot'
    ok: boolean
    message: string | null
  }
}

interface MacCaptureServiceMethods {
  getStatus: () => Promise<MacBridgeRuntimeStatus>
  getPermissions: () => Promise<MacPermissionsStatus>
  requestPermissions: (options?: { permissions?: MacPermissionKind[] }) => Promise<MacPermissionsRequestResult>
  openPermissionSettings: (options?: { target?: MacPermissionSettingsTarget }) => Promise<MacPermissionSettingsResult>
  configureBothCommandHotkey: (enabled: boolean) => Promise<{ trigger: 'bothCommand', enabled: boolean }>
  captureFrontmostWindow: (options?: {
    sink?: 'file' | 'clipboard' | 'cleanshot'
    privacySensitiveAppBundleIds?: string[]
    privacySensitiveTitlePatterns?: string[]
  }) => Promise<MacCaptureResponse>
}

interface CradleIpcServices {
  native: NativeServiceMethods
  window: WindowServiceMethods
  desktopUpdate: DesktopUpdateServiceMethods
  macCapture: MacCaptureServiceMethods
}

/**
 * Typed IPC proxy for native services.
 * Returns null when not in Electron.
 */
export const nativeIpc = createIpcProxy<CradleIpcServices>(
  window.cradle?.ipc ?? null,
)

export function subscribeDesktopUpdateStatus(
  handler: (status: DesktopUpdateStatus) => void,
): () => void {
  return window.cradle?.desktopUpdate.onStatusChanged((status) => {
    handler(status as DesktopUpdateStatus)
  }) ?? (() => {})
}

export function subscribeTearoffSessionClosed(
  handler: (sessionId: string) => void,
): () => void {
  return window.cradle?.window.onTearoffSessionClosed(handler) ?? (() => {})
}
