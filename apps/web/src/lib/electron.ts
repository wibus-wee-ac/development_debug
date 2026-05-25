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

export interface MacCaptureWindowTarget {
  windowId: number
  processId?: number
  bundleId?: string
}

export interface MacAppshotAnimationTarget {
  codexDisplay: {
    id: number
    scaleFactor: number
    bounds: {
      x: number
      y: number
      width: number
      height: number
    }
    workArea: {
      x: number
      y: number
      width: number
      height: number
    }
  }
  destinationBackgroundColor: string
  destinationCornerRadius: number
  destinationFrame: {
    x: number
    y: number
    width: number
    height: number
  }
  destinationPrimaryTextColor: string
  transitionSnapshotScale?: number
}

export interface MacAppshotTransitionStyle {
  transitionBackgroundOpacity?: number
  shutterPeakOpacity?: number
  shutterPeakProgress?: number
  backgroundPeakProgress?: number
  snapshotFadeInProgress?: number
  appIconFadeStartProgress?: number
  appIconVisibleProgress?: number
  titleFadeStartProgress?: number
  titleVisibleProgress?: number
  completionDelay?: number
  shadowRadius?: number
  shadowYOffset?: number
  shadowOpacity?: number
  shadowFillOpacity?: number
  accessoryIconSize?: number
  accessoryIconYOffset?: number
  accessoryTitleYOffset?: number
}

export interface MacAppshotFrontmostContext {
  window: MacCaptureResponse['capture']['window']
  bundleIdentifier: string | null
  animationTarget: MacAppshotAnimationTarget
}

export interface MacAppshotImageAsset {
  path: string
  dataURL: string
  mimeType: 'image/png' | 'image/jpeg'
}

export interface MacCradleAppshotCaptureResponse {
  strategy: 'cradle-native'
  capture: MacCaptureResponse['capture'] & {
    appshot: {
      strategy: 'cradle-native'
      animationDuration: number
      transitionSnapshotPath: string | null
      transitionSnapshotHeight: number | null
      transitionSpringDampingFraction: number | null
      transitionSpringResponse: number | null
      transitionStyle: Required<MacAppshotTransitionStyle>
    }
  }
  asset: MacAppshotImageAsset | null
  sink: MacCaptureResponse['sink']
}

export interface MacCodexAppshotCaptureResponse {
  strategy: 'codex-private'
  requestId: string
  start: {
    animationDuration: number | null
    transitionSnapshotHeight: number | null
    transitionSpringDampingFraction: number | null
    transitionSpringResponse: number | null
  }
  updates: Array<{
    type: 'metadata' | 'axText' | 'screenshot' | 'completed' | 'failed'
    screenshotAsset?: MacAppshotImageAsset | null
    transitionSnapshotAsset?: MacAppshotImageAsset | null
  }>
}

export type MacAppshotCaptureResponse = MacCradleAppshotCaptureResponse | MacCodexAppshotCaptureResponse

export interface MacCodexAppshotObservedAsset extends MacAppshotImageAsset {
  relativePath: string
  size: number
  modifiedAtMs: number
  sha256: string
}

export interface MacCodexAppshotObserveResponse {
  rootPath: string
  startedAtMs: number
  durationMs: number
  assets: MacCodexAppshotObservedAsset[]
}

export interface MacAppshotParityProbeResponse {
  context: MacAppshotFrontmostContext
  animationTarget: MacAppshotAnimationTarget
  codex: MacCodexAppshotCaptureResponse
  cradle: MacCradleAppshotCaptureResponse
  appliedCalibration: {
    animationDuration?: number
    transitionSnapshotHeight?: number
    transitionSpringDampingFraction?: number
    transitionSpringResponse?: number
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
    targetWindow?: MacCaptureWindowTarget
    privacySensitiveAppBundleIds?: string[]
    privacySensitiveTitlePatterns?: string[]
  }) => Promise<MacCaptureResponse>
  captureAppshot: (options?: {
    sink?: 'file' | 'clipboard' | 'cleanshot'
    strategy?: 'auto' | 'cradle-native' | 'codex-private'
    targetWindow?: MacCaptureWindowTarget
    animationTarget?: MacAppshotAnimationTarget
    animationDuration?: number
    requestId?: string
    bundleIdentifier?: string
    soundEnabled?: boolean
    transitionSnapshotHeight?: number
    transitionSpringDampingFraction?: number
    transitionSpringResponse?: number
    transitionStyle?: MacAppshotTransitionStyle
    privacySensitiveAppBundleIds?: string[]
    privacySensitiveTitlePatterns?: string[]
  }) => Promise<MacAppshotCaptureResponse>
  captureAppshotParityProbe: (options?: {
    sink?: 'file' | 'clipboard' | 'cleanshot'
    targetWindow?: MacCaptureWindowTarget
    requestId?: string
    soundEnabled?: boolean
    animationTarget?: MacAppshotAnimationTarget
    transitionStyle?: MacAppshotTransitionStyle
    privacySensitiveAppBundleIds?: string[]
    privacySensitiveTitlePatterns?: string[]
  }) => Promise<MacAppshotParityProbeResponse>
  observeCodexAppshotAssets: (options?: {
    durationMs?: number
    pollIntervalMs?: number
    baselinePaths?: string[]
    startedAtMs?: number
  }) => Promise<MacCodexAppshotObserveResponse>
  getAppshotFrontmostContext: () => Promise<MacAppshotFrontmostContext>
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
