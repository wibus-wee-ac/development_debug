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

// ── Desktop Chat Stream Bridge ────────────────────────────────────────────────

export interface DesktopChatStartResponseRequest {
  sessionId: string
  body: {
    text: string
    files?: unknown[]
    messages?: unknown[]
    providerTargetId?: string
    modelId?: string
    thinkingEffort?: 'low' | 'medium' | 'high'
    permissionMode?: 'bypassPermissions' | 'plan'
  }
}

export interface DesktopChatSubscribeSessionRequest {
  sessionId: string
}

export interface DesktopChatAbortRequest {
  streamId: string
}

export interface DesktopChatStreamHandle {
  streamId: string
  sessionId: string
  runId: string | null
  assistantMessageId?: string
  userMessageId?: string
}

export interface DesktopChatStreamChunkEvent {
  streamId: string
  sessionId: string
  runId: string | null
  chunk: unknown
}

export interface DesktopChatStreamClosedEvent {
  streamId: string
  sessionId: string
  runId: string | null
  reason: 'done' | 'aborted' | 'upstream-closed'
}

export interface DesktopChatStreamErrorEvent {
  streamId: string
  sessionId: string
  runId: string | null
  message: string
}

export interface DesktopChatStreamDiagnostics {
  streams: Array<{
    sessionId: string
    mode: 'response' | 'session'
    runId: string | null
    assistantMessageId?: string
    userMessageId?: string
    subscriberCount: number
    replayChunkCount: number
    keepAliveWithoutSubscribers: boolean
    startedAtMs: number
  }>
}

export interface DesktopChatStreamBridge {
  startResponse: (request: DesktopChatStartResponseRequest) => Promise<DesktopChatStreamHandle>
  subscribeSession: (request: DesktopChatSubscribeSessionRequest) => Promise<DesktopChatStreamHandle>
  abort: (request: DesktopChatAbortRequest) => Promise<void>
  diagnostics: () => Promise<DesktopChatStreamDiagnostics>
  onChunk: (handler: (event: DesktopChatStreamChunkEvent) => void) => () => void
  onClosed: (handler: (event: DesktopChatStreamClosedEvent) => void) => () => void
  onError: (handler: (event: DesktopChatStreamErrorEvent) => void) => () => void
}

export function readDesktopChatStreamBridge(): DesktopChatStreamBridge | null {
  return window.cradle?.chatStream ?? null
}

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
  openPath: (fullPath: string) => Promise<void>
  showItemInFolder: (fullPath: string) => Promise<void>
  openPathInEditor: (fullPath: string) => Promise<{ editor: string }>
  getCradleDataPaths: () => Promise<{
    userDataPath: string
    serverDataPath: string
    databasePath: string
    serverLogPath: string
  }>
  scanExternalWorkImportFiles: (options?: {
    limitPerSource?: number
    workspacePaths?: string[]
  }) => Promise<{
    files: Array<{
      sourceApp: 'claude' | 'codex'
      path: string
      content: string
      workspacePath: string | null
      modifiedAt: number | null
    }>
    warnings: string[]
  }>
}

interface WindowServiceMethods {
  tearOffSession: (sessionId: string, screenX: number, screenY: number) => Promise<void>
  focusSession: (sessionId: string) => Promise<boolean>
  closeSession: (sessionId: string) => Promise<void>
  getOpenSessions: () => Promise<string[]>
  startPointerMonitor: () => Promise<void>
  stopPointerMonitor: () => Promise<void>
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

export type BrowserTabScriptRunAt = 'document-start' | 'document-end' | 'document-idle'

export interface BrowserTabScriptPayload {
  id: string
  label?: string
  runAt: BrowserTabScriptRunAt
  source: string
}

interface BrowserTabScriptsServiceMethods {
  setScripts: (input: {
    webContentsId: number
    scripts: BrowserTabScriptPayload[]
  }) => Promise<{ scriptIds: string[] }>
  runScript: (input: {
    webContentsId: number
    script: BrowserTabScriptPayload
  }) => Promise<{ result: unknown }>
  clearScripts: (input: {
    webContentsId: number
  }) => Promise<void>
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
    captureBackend?: 'screen-capture-kit' | 'screencapture-fallback' | 'screencapture'
    captureImageSize?: {
      pixelWidth: number
      pixelHeight: number
    } | null
    screenCaptureKitError?: unknown
    window: {
      windowId: number
      appName: string | null
      bundleId: string | null
      appIconDataUrl?: string | null
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
  coordinateSpace?: 'viewportPixels' | 'screenPoints' | 'pixels'
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

export interface MacAppshotFrontmostContext {
  window: MacCaptureResponse['capture']['window']
  bundleIdentifier: string | null
  animationTarget: MacAppshotAnimationTarget
}

export interface MacAppshotHotkeyEvent {
  trigger: 'bothCommand'
  capturedAt: string
  targetWindow?: MacCaptureWindowTarget
  sourceWindow?: MacCaptureResponse['capture']['window']
  bundleIdentifier?: string | null
  context?: MacAppshotFrontmostContext
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
      transitionSnapshotImageSize?: {
        pixelWidth: number
        pixelHeight: number
      } | null
      transitionSpringDampingFraction: number | null
      transitionSpringResponse: number | null
      transitionGeometry?: Record<string, unknown>
    }
  }
  asset: MacAppshotImageAsset | null
  transitionSnapshotAsset: MacAppshotImageAsset | null
  sink: MacCaptureResponse['sink']
}

export type MacAppshotCaptureResponse = MacCradleAppshotCaptureResponse

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
    strategy?: 'cradle-native'
    targetWindow?: MacCaptureWindowTarget
    animationTarget?: MacAppshotAnimationTarget
    animationDuration?: number
    requestId?: string
    soundEnabled?: boolean
    transitionSnapshotHeight?: number
    transitionSpringDampingFraction?: number
    transitionSpringResponse?: number
    privacySensitiveAppBundleIds?: string[]
    privacySensitiveTitlePatterns?: string[]
  }) => Promise<MacAppshotCaptureResponse>
  captureAppshotParityProbe: (options?: {
    sink?: 'file' | 'clipboard' | 'cleanshot'
    targetWindow?: MacCaptureWindowTarget
    soundEnabled?: boolean
    animationTarget?: MacAppshotAnimationTarget
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
  browserTabScripts: BrowserTabScriptsServiceMethods
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

export function subscribePointerOutsideWindow(
  handler: (screenX: number, screenY: number) => void,
): () => void {
  return window.cradle?.window.onPointerOutsideWindow(handler) ?? (() => {})
}
