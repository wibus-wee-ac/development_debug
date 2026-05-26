import { createServices, IpcMethod, IpcService } from '@cradle/ipc'
import { app, dialog, screen, shell } from 'electron'
import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, relative } from 'node:path'

import type { MacBridgeManager } from './mac-bridge-manager'
import type {
  MacAppshotAnimationTarget,
  MacAppshotCaptureFrontmostWindowResult,
  MacAppshotFrontmostContext,
  MacCaptureWindowTarget,
  MacCaptureFrontmostWindowResult,
  MacPermissionSettingsRequest,
  MacPermissionSettingsResult,
  MacPermissionsRequest,
  MacPermissionsRequestResult,
  MacPermissionsStatus,
} from './mac-bridge-protocol'
import type { MacScreenshotSinkId, MacScreenshotSinkResult } from './mac-screenshot-sinks'
import { runMacScreenshotSink } from './mac-screenshot-sinks'
import type { CodexAppshotObservedAsset, CodexAppshotObserveResult } from './native-appshot-codex-assets'
import { observeCodexAppshotAssets } from './native-appshot-codex-assets'
import {
  createParityAppshotAnimationTarget,
  readScreenPointAppshotAnimationTarget,
  readScreenPointAppshotDestinationFrame,
} from './native-appshot-target'
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

function readScreenAppshotAnimationTarget(target: MacAppshotAnimationTarget | undefined): MacAppshotAnimationTarget | undefined {
  if (!target || target.coordinateSpace !== 'viewportPixels') {
    return target
  }
  const windowManager = getWindowManager()
  const mainWindow = windowManager?.getMainWindow()
  if (!mainWindow || mainWindow.isDestroyed()) {
    return target
  }
  const scaleFactor = target.codexDisplay.scaleFactor
  const windowBounds = mainWindow.getBounds()
  const contentBounds = mainWindow.getContentBounds()
  const destinationFrame = readScreenPointAppshotDestinationFrame(target, contentBounds)
  const display = screen.getDisplayMatching(destinationFrame)
  const convertedTarget = readScreenPointAppshotAnimationTarget(target, contentBounds, display)
  console.debug('[mac-capture] Appshot destination converted:', {
    inputCoordinateSpace: target.coordinateSpace,
    inputScaleFactor: scaleFactor,
    windowBounds,
    contentBounds,
    displays: screen.getAllDisplays(),
    inputDestinationFrame: target.destinationFrame,
    convertedDestinationFrame: convertedTarget.destinationFrame,
    display: convertedTarget.codexDisplay,
  })
  return convertedTarget
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

export type MacAppshotStrategy = 'cradle-native'

export interface MacAppshotCaptureRequest extends MacCaptureRequest {
  strategy?: MacAppshotStrategy
  animationTarget?: MacAppshotAnimationTarget
  animationDuration?: number
  requestId?: string
  soundEnabled?: boolean
  transitionSnapshotHeight?: number
  transitionSpringDampingFraction?: number
  transitionSpringResponse?: number
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
  transitionSnapshotAsset: MacAppshotImageAsset | null
  sink: MacScreenshotSinkResult
}

export type MacAppshotCaptureResponse = MacCradleAppshotCaptureResponse

export interface MacAppshotParityProbeRequest extends MacCaptureRequest {
  soundEnabled?: boolean
  animationTarget?: MacAppshotAnimationTarget
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
  cradle: MacCradleAppshotCaptureResponse
  appliedCalibration: {
    animationDuration?: number
    transitionSnapshotHeight?: number
    transitionSpringDampingFraction?: number
    transitionSpringResponse?: number
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

  const strategy = options.strategy ?? 'cradle-native'
  if (strategy !== 'cradle-native') {
    throw new Error(`Unsupported Appshot strategy: ${strategy}`)
  }
  const context = await readAppshotContext(manager, options)
  const captureOptions = context
    ? {
        ...options,
        targetWindow: options.targetWindow ?? readCaptureTargetWindow(context),
        animationTarget: options.animationTarget ?? context.animationTarget,
      }
    : options
  const animationTarget = readScreenAppshotAnimationTarget(captureOptions.animationTarget)
  console.debug('[mac-capture] Appshot capture starting:', {
    strategy,
    requestId: options.requestId,
    hasContext: Boolean(context),
    targetWindow: captureOptions.targetWindow,
    animationTarget,
  })

  const capture = await manager.captureAppshotFrontmostWindow({
    outputDir: readMacCaptureOutputDir(),
    targetWindow: captureOptions.targetWindow,
    animationTarget,
    animationDuration: captureOptions.animationDuration,
    soundEnabled: captureOptions.soundEnabled,
    transitionSnapshotHeight: captureOptions.transitionSnapshotHeight,
    transitionSpringDampingFraction: captureOptions.transitionSpringDampingFraction,
    transitionSpringResponse: captureOptions.transitionSpringResponse,
    privacySensitiveAppBundleIds: readPrivacySensitiveAppBundleIds(captureOptions),
    privacySensitiveTitlePatterns: readPrivacySensitiveTitlePatterns(captureOptions),
  })
  console.debug('[mac-capture] Appshot capture completed:', {
    strategy: 'cradle-native',
    requestId: options.requestId,
    filePath: capture.filePath,
    window: capture.window,
    transitionGeometry: capture.appshot.transitionGeometry,
  })
  const sink = await runMacScreenshotSink({
    sink: options.sink ?? 'file',
    capture,
  })
  return {
    strategy: 'cradle-native',
    capture,
    asset: await readCradleAppshotAsset(capture.filePath),
    transitionSnapshotAsset: capture.appshot.transitionSnapshotPath
      ? await readCradleAppshotAsset(capture.appshot.transitionSnapshotPath)
      : null,
    sink,
  }
}

async function readAppshotContext(
  manager: MacBridgeManager,
  options: MacAppshotCaptureRequest,
): Promise<MacAppshotFrontmostContext | null> {
  if (options.animationTarget && options.targetWindow) {
    return null
  }

  try {
    return await manager.readAppshotFrontmostContext()
  }
  catch {
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
  const animationTarget = options.animationTarget ?? createParityAppshotAnimationTarget(context)
  const targetWindow = readCaptureTargetWindow(context)

  const appliedCalibration: MacAppshotParityProbeResponse['appliedCalibration'] = {}
  const cradle = await captureAppshotWithMacBridge({
    ...options,
    strategy: 'cradle-native',
    targetWindow,
    animationTarget,
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

function readCaptureMimeType(filePath: string): MacAppshotImageAsset['mimeType'] | null {
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
