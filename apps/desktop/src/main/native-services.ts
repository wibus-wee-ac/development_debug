import { createServices, IpcMethod, IpcService } from '@cradle/ipc'
import { app, dialog, shell } from 'electron'
import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, relative } from 'node:path'

import type { MacBridgeManager } from './mac-bridge-manager'
import type {
  MacAppshotAnimationTarget,
  MacAppshotCaptureFrontmostWindowResult,
  MacAppshotFrontmostContext,
  MacAppshotTransitionStyle,
  MacCaptureWindowTarget,
  MacCaptureFrontmostWindowResult,
  MacCodexAppshotStartResult,
  MacCodexAppshotUpdate,
  MacPermissionSettingsRequest,
  MacPermissionSettingsResult,
  MacPermissionsRequest,
  MacPermissionsRequestResult,
  MacPermissionsStatus,
} from './mac-bridge-protocol'
import type { MacScreenshotSinkId, MacScreenshotSinkResult } from './mac-screenshot-sinks'
import { runMacScreenshotSink } from './mac-screenshot-sinks'
import type { CodexAppshotObservedAsset, CodexAppshotObserveResult } from './native-appshot-codex-assets'
import { observeCodexAppshotAssets, readCodexAppshotAsset as readCodexPrivateAppshotAsset } from './native-appshot-codex-assets'
import { createParityAppshotAnimationTarget } from './native-appshot-target'
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

const AUTO_CODEX_PRIVATE_TIMEOUT_SECONDS = 3
const MAX_CODEX_APP_CAPTURE_BYTES = 25 * 1024 * 1024

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
  targetWindow?: MacCaptureWindowTarget
  privacySensitiveAppBundleIds?: string[]
  privacySensitiveTitlePatterns?: string[]
}

export interface MacCaptureResponse {
  capture: MacCaptureFrontmostWindowResult
  sink: MacScreenshotSinkResult
}

export type MacAppshotStrategy = 'auto' | 'cradle-native' | 'codex-private'

export interface MacAppshotCaptureRequest extends MacCaptureRequest {
  strategy?: MacAppshotStrategy
  animationTarget?: MacAppshotAnimationTarget
  animationDuration?: number
  requestId?: string
  bundleIdentifier?: string
  soundEnabled?: boolean
  transitionSnapshotHeight?: number
  transitionSpringDampingFraction?: number
  transitionSpringResponse?: number
  transitionStyle?: MacAppshotTransitionStyle
}

export interface MacCodexAppshotCaptureResponse {
  strategy: 'codex-private'
  requestId: string
  start: MacCodexAppshotStartResult
  updates: MacCodexAppshotResolvedUpdate[]
}

export interface MacAppshotImageAsset {
  path: string
  dataURL: string
  mimeType: 'image/png' | 'image/jpeg'
}

export interface MacCradleAppshotCaptureResponse {
  strategy: 'cradle-native'
  capture: MacAppshotCaptureFrontmostWindowResult
  asset: MacAppshotImageAsset | null
  sink: MacScreenshotSinkResult
}

export type MacAppshotCaptureResponse = MacCodexAppshotCaptureResponse | MacCradleAppshotCaptureResponse

export type MacCodexAppshotAsset = MacAppshotImageAsset

export type MacCodexAppshotResolvedUpdate = MacCodexAppshotUpdate & {
  screenshotAsset?: MacCodexAppshotAsset | null
  transitionSnapshotAsset?: MacCodexAppshotAsset | null
}

export interface MacAppshotParityProbeRequest extends MacCaptureRequest {
  requestId?: string
  soundEnabled?: boolean
  animationTarget?: MacAppshotAnimationTarget
  transitionStyle?: MacAppshotTransitionStyle
}

export interface MacCodexAppshotObserveRequest {
  durationMs?: number
  pollIntervalMs?: number
  baselinePaths?: string[]
  startedAtMs?: number
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
    transitionStyle?: MacAppshotTransitionStyle
  }
}

export interface MacCodexAppshotObserveResponse extends CodexAppshotObserveResult {
  assets: CodexAppshotObservedAsset[]
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

  @IpcMethod()
  async captureAppshot(options: MacAppshotCaptureRequest = {}): Promise<MacAppshotCaptureResponse> {
    return captureAppshotWithMacBridge(options)
  }

  @IpcMethod()
  async captureAppshotParityProbe(options: MacAppshotParityProbeRequest = {}): Promise<MacAppshotParityProbeResponse> {
    return captureAppshotParityProbeWithMacBridge(options)
  }

  @IpcMethod()
  async observeCodexAppshotAssets(options: MacCodexAppshotObserveRequest = {}): Promise<MacCodexAppshotObserveResponse> {
    return observeCodexAppshotAssetsWithDesktop(options)
  }

  @IpcMethod()
  async getAppshotFrontmostContext(): Promise<MacAppshotFrontmostContext> {
    const manager = this.readManager()
    return manager.readAppshotFrontmostContext()
  }

  private readManager(): MacBridgeManager {
    const manager = getMacBridgeManager()
    if (!manager) {
      throw new Error('Mac Bridge manager is not initialized')
    }
    return manager
  }
}

function readMacCaptureOutputDir(): string {
  return join(app.getPath('userData'), 'mac-captures')
}

function readPrivacySensitiveAppBundleIds(options: MacCaptureRequest): string[] {
  return [
    ...DEFAULT_PRIVACY_SENSITIVE_APP_BUNDLE_IDS,
    ...(options.privacySensitiveAppBundleIds ?? []),
  ]
}

function readPrivacySensitiveTitlePatterns(options: MacCaptureRequest): string[] {
  return [
    ...DEFAULT_PRIVACY_SENSITIVE_TITLE_PATTERNS,
    ...(options.privacySensitiveTitlePatterns ?? []),
  ]
}

export async function captureFrontmostWindowWithMacBridge(options: MacCaptureRequest = {}): Promise<MacCaptureResponse> {
  const manager = getMacBridgeManager()
  if (!manager) {
    throw new Error('Mac Bridge manager is not initialized')
  }
  const outputDir = readMacCaptureOutputDir()
  const capture = await manager.captureFrontmostWindow({
    outputDir,
    targetWindow: options.targetWindow,
    privacySensitiveAppBundleIds: readPrivacySensitiveAppBundleIds(options),
    privacySensitiveTitlePatterns: readPrivacySensitiveTitlePatterns(options),
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

export async function captureAppshotWithMacBridge(
  options: MacAppshotCaptureRequest = {},
): Promise<MacAppshotCaptureResponse> {
  const manager = getMacBridgeManager()
  if (!manager) {
    throw new Error('Mac Bridge manager is not initialized')
  }

  const strategy = options.strategy ?? 'auto'
  const context = await readAppshotContextForStrategy(manager, options, strategy)
  const captureOptions = context
    ? {
        ...options,
        animationTarget: options.animationTarget ?? context.animationTarget,
        bundleIdentifier: options.bundleIdentifier ?? context.bundleIdentifier ?? undefined,
      }
    : options
  if (strategy === 'codex-private' || strategy === 'auto') {
    const codexCapture = await tryCaptureWithCodexPrivateAdapter(captureOptions, strategy).catch((error: unknown) => {
      if (strategy === 'codex-private') {
        throw error
      }
      console.warn('[mac-capture] Codex private Appshot failed; falling back to Cradle native Appshot.', error)
      return null
    })
    if (codexCapture || strategy === 'codex-private') {
      if (!codexCapture) {
        throw new Error('Codex private Appshot adapter is unavailable')
      }
      return codexCapture
    }
  }

  const capture = await manager.captureAppshotFrontmostWindow({
    outputDir: readMacCaptureOutputDir(),
    targetWindow: captureOptions.targetWindow,
    animationTarget: captureOptions.animationTarget,
    animationDuration: captureOptions.animationDuration,
    soundEnabled: captureOptions.soundEnabled,
    transitionSnapshotHeight: captureOptions.transitionSnapshotHeight,
    transitionSpringDampingFraction: captureOptions.transitionSpringDampingFraction,
    transitionSpringResponse: captureOptions.transitionSpringResponse,
    transitionStyle: captureOptions.transitionStyle,
    privacySensitiveAppBundleIds: readPrivacySensitiveAppBundleIds(captureOptions),
    privacySensitiveTitlePatterns: readPrivacySensitiveTitlePatterns(captureOptions),
  })
  const sink = await runMacScreenshotSink({
    sink: options.sink ?? 'file',
    capture,
  })
  return {
    strategy: 'cradle-native',
    capture,
    asset: await readCradleAppshotAsset(capture.filePath),
    sink,
  }
}

async function readAppshotContextForStrategy(
  manager: MacBridgeManager,
  options: MacAppshotCaptureRequest,
  strategy: MacAppshotStrategy,
): Promise<MacAppshotFrontmostContext | null> {
  if (strategy === 'cradle-native') {
    return null
  }
  if (options.animationTarget && options.bundleIdentifier) {
    return null
  }

  try {
    return await manager.readAppshotFrontmostContext()
  }
  catch (error) {
    if (strategy === 'codex-private') {
      throw error
    }
    return null
  }
}

export async function captureAppshotParityProbeWithMacBridge(
  options: MacAppshotParityProbeRequest = {},
): Promise<MacAppshotParityProbeResponse> {
  const manager = getMacBridgeManager()
  if (!manager) {
    throw new Error('Mac Bridge manager is not initialized')
  }

  const context = await manager.readAppshotFrontmostContext()
  if (!context.bundleIdentifier) {
    throw new Error('Appshot parity probe requires a frontmost app bundle identifier')
  }
  const animationTarget = options.animationTarget ?? createParityAppshotAnimationTarget(context)
  const targetWindow = readCaptureTargetWindow(context)

  const codex = await tryCaptureWithCodexPrivateAdapter({
    ...options,
    strategy: 'codex-private',
    animationTarget,
    bundleIdentifier: context.bundleIdentifier,
  }, 'codex-private')
  if (!codex) {
    throw new Error('Codex private Appshot adapter is unavailable')
  }

  const appliedCalibration: MacAppshotParityProbeResponse['appliedCalibration'] = {}
  const animationDuration = readPositiveNumber(codex.start.animationDuration)
  const transitionSnapshotHeight = readPositiveNumber(codex.start.transitionSnapshotHeight)
  const transitionSpringDampingFraction = readPositiveNumber(codex.start.transitionSpringDampingFraction)
  const transitionSpringResponse = readPositiveNumber(codex.start.transitionSpringResponse)
  if (animationDuration !== undefined) {
    appliedCalibration.animationDuration = animationDuration
  }
  if (transitionSnapshotHeight !== undefined) {
    appliedCalibration.transitionSnapshotHeight = transitionSnapshotHeight
  }
  if (transitionSpringDampingFraction !== undefined) {
    appliedCalibration.transitionSpringDampingFraction = transitionSpringDampingFraction
  }
  if (transitionSpringResponse !== undefined) {
    appliedCalibration.transitionSpringResponse = transitionSpringResponse
  }
  if (options.transitionStyle) {
    appliedCalibration.transitionStyle = options.transitionStyle
  }
  const cradle = await captureAppshotWithMacBridge({
    ...options,
    strategy: 'cradle-native',
    targetWindow,
    animationTarget,
    bundleIdentifier: context.bundleIdentifier,
    animationDuration: appliedCalibration.animationDuration,
    transitionSnapshotHeight: appliedCalibration.transitionSnapshotHeight,
    transitionSpringDampingFraction: appliedCalibration.transitionSpringDampingFraction,
    transitionSpringResponse: appliedCalibration.transitionSpringResponse,
  })
  if (cradle.strategy !== 'cradle-native') {
    throw new Error('Appshot parity probe expected Cradle native capture')
  }

  return {
    context,
    animationTarget,
    codex,
    cradle,
    appliedCalibration,
  }
}

function readCaptureTargetWindow(context: MacAppshotFrontmostContext): MacCaptureWindowTarget {
  return {
    windowId: context.window.windowId,
    processId: context.window.processId,
    bundleId: context.window.bundleId ?? undefined,
  }
}

async function tryCaptureWithCodexPrivateAdapter(
  options: MacAppshotCaptureRequest,
  strategy: MacAppshotStrategy,
): Promise<MacCodexAppshotCaptureResponse | null> {
  const manager = getMacBridgeManager()
  if (!manager || !options.animationTarget || !options.bundleIdentifier) {
    return null
  }

  const service = await manager.readCodexAppshotService().catch((error: unknown) => {
    if (strategy === 'codex-private') {
      throw error
    }
    return null
  })
  if (!service) {
    return null
  }
  if (!service.running || !service.processIdentifier) {
    return null
  }

  const requestId = options.requestId ?? `cradle-codex-appshot-${Date.now()}`
  const timeoutSeconds = strategy === 'auto' ? AUTO_CODEX_PRIVATE_TIMEOUT_SECONDS : undefined
  const start = await manager.startCodexAppshotCapture({
    requestId,
    bundleIdentifier: options.bundleIdentifier,
    animationTarget: options.animationTarget,
    serviceProcessIdentifier: service.processIdentifier,
    ...(timeoutSeconds ? { timeoutSeconds } : {}),
  })

  const updates: MacCodexAppshotResolvedUpdate[] = []
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const update = await manager.readCodexAppshotCaptureUpdate({
      requestId,
      serviceProcessIdentifier: service.processIdentifier,
      ...(timeoutSeconds ? { timeoutSeconds } : {}),
    })
    updates.push(await resolveCodexAppshotUpdate(update))
    if (update.type === 'completed' || update.type === 'failed') {
      break
    }
  }

  return {
    strategy: 'codex-private',
    requestId,
    start,
    updates,
  }
}

async function resolveCodexAppshotUpdate(update: MacCodexAppshotUpdate): Promise<MacCodexAppshotResolvedUpdate> {
  if (update.type === 'screenshot') {
    return {
      ...update,
      screenshotAsset: await readCodexPrivateAppshotAsset(update.screenshotURL ?? update.screenshot?.url ?? null),
    }
  }
  if (update.type === 'completed') {
    return {
      ...update,
      transitionSnapshotAsset: await readCodexPrivateAppshotAsset(update.transitionSnapshotURL ?? null),
    }
  }
  return update
}

export async function observeCodexAppshotAssetsWithDesktop(
  options: MacCodexAppshotObserveRequest = {},
): Promise<MacCodexAppshotObserveResponse> {
  return observeCodexAppshotAssets({
    durationMs: readCodexObserveDurationMs(options.durationMs),
    pollIntervalMs: readCodexObservePollIntervalMs(options.pollIntervalMs),
    baselinePaths: options.baselinePaths,
    startedAtMs: options.startedAtMs,
  })
}

async function readCradleAppshotAsset(filePath: string): Promise<MacAppshotImageAsset | null> {
  return readAppshotImageAsset(filePath, readMacCaptureOutputDir())
}

async function readAppshotImageAsset(filePath: string, rootPath: string): Promise<MacAppshotImageAsset | null> {
  const mimeType = readCaptureMimeType(filePath)
  if (!mimeType) {
    return null
  }

  try {
    const [resolvedCapturePath, resolvedRootPath] = await Promise.all([
      realpath(filePath),
      realpath(rootPath),
    ])
    const relativePath = relative(resolvedRootPath, resolvedCapturePath)
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      return null
    }
    const metadata = await stat(resolvedCapturePath)
    if (!metadata.isFile() || metadata.size > MAX_CODEX_APP_CAPTURE_BYTES) {
      return null
    }
    const dataURL = `data:${mimeType};base64,${(await readFile(resolvedCapturePath)).toString('base64')}`
    return {
      path: resolvedCapturePath,
      dataURL,
      mimeType,
    }
  }
  catch {
    return null
  }
}

function readPositiveNumber(value: number | null | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined
  }
  return value
}

function readCodexObserveDurationMs(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 8_000
  }
  return Math.min(Math.max(value, 0), 60_000)
}

function readCodexObservePollIntervalMs(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 250
  }
  return Math.min(Math.max(value, 100), 5_000)
}

function readCaptureMimeType(filePath: string): MacCodexAppshotAsset['mimeType'] | null {
  const extension = extname(filePath).toLowerCase()
  if (extension === '.png') {
    return 'image/png'
  }
  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg'
  }
  return null
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createNativeServices(context: NativeServicesContext) {
  nativeServicesContext = context
  return createServices([NativeService, WindowService, DesktopUpdateService, MacCaptureService] as const)
}
