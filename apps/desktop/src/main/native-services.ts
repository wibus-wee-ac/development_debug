import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, isAbsolute, join, relative } from 'node:path'

import { createServices, getIpcContext, IpcMethod, IpcService } from '@cradle/ipc'
import { app, BrowserWindow, dialog, screen, shell as nativeLauncher } from 'electron'

import { BrowserTabScriptsService } from './browser-tab-scripts'
import type { MacBridgeManager } from './mac-bridge-manager'
import type {
  MacAppshotAnimationTarget,
  MacAppshotCaptureFrontmostWindowResult,
  MacAppshotFrontmostContext,
  MacCaptureFrontmostWindowResult,
  MacCaptureWindowTarget,
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
import { launchPathInEditor } from './native-editor-launcher'
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
const MAX_EXTERNAL_WORK_IMPORT_BYTES = 8 * 1024 * 1024
const TEXT_EXTERNAL_WORK_IMPORT_EXTENSIONS = new Set(['.md', '.json', '.toml'])

type ExternalWorkImportSourceApp = 'claude' | 'codex'

interface ExternalWorkImportFile {
  sourceApp: ExternalWorkImportSourceApp
  path: string
  content: string
  workspacePath: string | null
  modifiedAt: number | null
}

async function readExternalWorkImportFile(
  sourceApp: ExternalWorkImportSourceApp,
  path: string,
  workspacePath: string | null = null,
): Promise<ExternalWorkImportFile | null> {
  try {
    const fileStat = await stat(path)
    if (!fileStat.isFile() || fileStat.size > MAX_EXTERNAL_WORK_IMPORT_BYTES) {
      return null
    }
    return {
      sourceApp,
      path,
      content: await readFile(path, 'utf8'),
      workspacePath,
      modifiedAt: Math.floor(fileStat.mtimeMs / 1000),
    }
  }
  catch {
    return null
  }
}

async function collectExternalWorkImportFiles(input: {
  sourceApp: ExternalWorkImportSourceApp
  root: string
  extensions: string | Set<string>
  limit: number
  workspacePath?: string | null
}): Promise<ExternalWorkImportFile[]> {
  const allowedExtensions = typeof input.extensions === 'string' ? new Set([input.extensions]) : input.extensions
  const found: Array<{ path: string, modifiedAt: number }> = []

  async function visit(dir: string, depth: number): Promise<void> {
    if (depth > 4 || found.length > input.limit * 8) {
      return
    }
    let children: Array<{ name: string, isDirectory: () => boolean, isFile: () => boolean }>
    try {
      children = await readdir(dir, { withFileTypes: true })
    }
    catch {
      return
    }

    await Promise.all(children.map(async (entry) => {
      const childPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        await visit(childPath, depth + 1)
        return
      }
      if (!entry.isFile() || !allowedExtensions.has(extname(childPath).toLowerCase())) {
        return
      }
      try {
        const fileStat = await stat(childPath)
        found.push({ path: childPath, modifiedAt: Math.floor(fileStat.mtimeMs / 1000) })
      }
      catch {
        // Ignore unreadable candidates.
      }
    }))
  }

  await visit(input.root, 0)
  const files = await Promise.all(
    found
      .sort((left, right) => right.modifiedAt - left.modifiedAt)
      .slice(0, input.limit)
      .map(entry => readExternalWorkImportFile(input.sourceApp, entry.path, input.workspacePath ?? null)),
  )
  return files.filter((file): file is ExternalWorkImportFile => Boolean(file))
}

async function validateNativePath(targetPath: string): Promise<string> {
  if (!targetPath || !isAbsolute(targetPath)) {
    throw new Error('Native file actions require an absolute path')
  }
  return realpath(targetPath)
}

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
    await nativeLauncher.openExternal(url)
  }

  @IpcMethod()
  async openPath(fullPath: string): Promise<void> {
    const resolvedPath = await validateNativePath(fullPath)
    const errorMessage = await nativeLauncher.openPath(resolvedPath)
    if (errorMessage) {
      throw new Error(errorMessage)
    }
  }

  @IpcMethod()
  async showItemInFolder(fullPath: string): Promise<void> {
    const resolvedPath = await validateNativePath(fullPath)
    nativeLauncher.showItemInFolder(resolvedPath)
  }

  @IpcMethod()
  async openPathInEditor(fullPath: string): Promise<{ editor: string }> {
    const resolvedPath = await validateNativePath(fullPath)
    const editor = await launchPathInEditor(resolvedPath)
    return { editor }
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

  @IpcMethod()
  async scanExternalWorkImportFiles(options: {
    limitPerSource?: number
    workspacePaths?: string[]
  } = {}): Promise<{ files: ExternalWorkImportFile[], warnings: string[] }> {
    const limit = Math.min(Math.max(options.limitPerSource ?? 500, 1), 500)
    const home = homedir()
    const files: ExternalWorkImportFile[] = []
    const warnings: string[] = []
    const fixedCandidates: Array<{ sourceApp: ExternalWorkImportSourceApp, path: string }> = [
      { sourceApp: 'claude', path: join(home, '.claude', 'settings.json') },
      { sourceApp: 'claude', path: join(home, '.claude', 'settings.local.json') },
      { sourceApp: 'claude', path: join(home, '.claude', 'config.json') },
      { sourceApp: 'codex', path: join(home, '.codex', 'config.toml') },
      { sourceApp: 'codex', path: join(home, '.codex', 'AGENTS.md') },
      { sourceApp: 'codex', path: join(home, '.codex', 'history.jsonl') },
    ]

    for (const candidate of fixedCandidates) {
      const file = await readExternalWorkImportFile(candidate.sourceApp, candidate.path)
      if (file) {
        files.push(file)
      }
    }

    for (const workspacePath of options.workspacePaths ?? []) {
      const agentsFile = await readExternalWorkImportFile(
        'codex',
        join(workspacePath, 'AGENTS.md'),
        workspacePath,
      )
      if (agentsFile) {
        files.push(agentsFile)
      }
      const claudeFile = await readExternalWorkImportFile(
        'claude',
        join(workspacePath, 'CLAUDE.md'),
        workspacePath,
      )
      if (claudeFile) {
        files.push(claudeFile)
      }
    }

    files.push(...await collectExternalWorkImportFiles({
      sourceApp: 'claude',
      root: join(home, '.claude', 'projects'),
      extensions: '.jsonl',
      limit,
    }))
    files.push(...await collectExternalWorkImportFiles({
      sourceApp: 'claude',
      root: join(home, '.claude', 'commands'),
      extensions: TEXT_EXTERNAL_WORK_IMPORT_EXTENSIONS,
      limit,
    }))
    files.push(...await collectExternalWorkImportFiles({
      sourceApp: 'claude',
      root: join(home, '.claude', 'hooks'),
      extensions: TEXT_EXTERNAL_WORK_IMPORT_EXTENSIONS,
      limit,
    }))
    files.push(...await collectExternalWorkImportFiles({
      sourceApp: 'claude',
      root: join(home, '.claude', 'agents'),
      extensions: TEXT_EXTERNAL_WORK_IMPORT_EXTENSIONS,
      limit,
    }))
    files.push(...await collectExternalWorkImportFiles({
      sourceApp: 'claude',
      root: join(home, '.claude', 'skills'),
      extensions: TEXT_EXTERNAL_WORK_IMPORT_EXTENSIONS,
      limit,
    }))
    files.push(...await collectExternalWorkImportFiles({
      sourceApp: 'codex',
      root: join(home, '.codex', 'archived_sessions'),
      extensions: '.jsonl',
      limit,
    }))
    files.push(...await collectExternalWorkImportFiles({
      sourceApp: 'codex',
      root: join(home, '.codex', 'commands'),
      extensions: TEXT_EXTERNAL_WORK_IMPORT_EXTENSIONS,
      limit,
    }))
    files.push(...await collectExternalWorkImportFiles({
      sourceApp: 'codex',
      root: join(home, '.codex', 'hooks'),
      extensions: TEXT_EXTERNAL_WORK_IMPORT_EXTENSIONS,
      limit,
    }))
    files.push(...await collectExternalWorkImportFiles({
      sourceApp: 'codex',
      root: join(home, '.codex', 'subagents'),
      extensions: TEXT_EXTERNAL_WORK_IMPORT_EXTENSIONS,
      limit,
    }))
    files.push(...await collectExternalWorkImportFiles({
      sourceApp: 'codex',
      root: join(home, '.codex', 'skills'),
      extensions: TEXT_EXTERNAL_WORK_IMPORT_EXTENSIONS,
      limit,
    }))
    files.push(...await collectExternalWorkImportFiles({
      sourceApp: 'codex',
      root: join(home, '.codex', 'plugins'),
      extensions: TEXT_EXTERNAL_WORK_IMPORT_EXTENSIONS,
      limit,
    }))

    for (const workspacePath of options.workspacePaths ?? []) {
      files.push(...await collectExternalWorkImportFiles({
        sourceApp: 'codex',
        root: join(workspacePath, '.codex', 'commands'),
        extensions: TEXT_EXTERNAL_WORK_IMPORT_EXTENSIONS,
        limit,
        workspacePath,
      }))
      files.push(...await collectExternalWorkImportFiles({
        sourceApp: 'codex',
        root: join(workspacePath, '.codex', 'hooks'),
        extensions: TEXT_EXTERNAL_WORK_IMPORT_EXTENSIONS,
        limit,
        workspacePath,
      }))
      files.push(...await collectExternalWorkImportFiles({
        sourceApp: 'codex',
        root: join(workspacePath, '.codex', 'subagents'),
        extensions: TEXT_EXTERNAL_WORK_IMPORT_EXTENSIONS,
        limit,
        workspacePath,
      }))
      files.push(...await collectExternalWorkImportFiles({
        sourceApp: 'claude',
        root: join(workspacePath, '.claude', 'commands'),
        extensions: TEXT_EXTERNAL_WORK_IMPORT_EXTENSIONS,
        limit,
        workspacePath,
      }))
      files.push(...await collectExternalWorkImportFiles({
        sourceApp: 'claude',
        root: join(workspacePath, '.claude', 'hooks'),
        extensions: TEXT_EXTERNAL_WORK_IMPORT_EXTENSIONS,
        limit,
        workspacePath,
      }))
      files.push(...await collectExternalWorkImportFiles({
        sourceApp: 'claude',
        root: join(workspacePath, '.claude', 'agents'),
        extensions: TEXT_EXTERNAL_WORK_IMPORT_EXTENSIONS,
        limit,
        workspacePath,
      }))
    }

    if (files.length === 0) {
      warnings.push('No supported Claude or Codex work files were found on this device.')
    }

    return { files, warnings }
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

function readIpcSenderWindow(): BrowserWindow | null {
  try {
    return BrowserWindow.fromWebContents(getIpcContext().sender)
  }
  catch {
    return null
  }
}

function serializeAppshotBrowserWindowForLog(window: BrowserWindow | null | undefined) {
  if (!window || window.isDestroyed()) {
    return null
  }
  return {
    id: window.id,
    bounds: window.getBounds(),
    contentBounds: window.getContentBounds(),
    url: window.webContents.getURL(),
    isFocused: window.isFocused(),
  }
}

function readScreenAppshotAnimationTarget(
  target: MacAppshotAnimationTarget | undefined,
  rendererWindow: BrowserWindow | null = readIpcSenderWindow(),
): MacAppshotAnimationTarget | undefined {
  if (!target || target.coordinateSpace !== 'viewportPixels') {
    return target
  }
  const windowManager = getWindowManager()
  const window = rendererWindow && !rendererWindow.isDestroyed()
    ? rendererWindow
    : windowManager?.getMainWindow()
  if (!window || window.isDestroyed()) {
    return target
  }
  const scaleFactor = target.codexDisplay.scaleFactor
  const windowBounds = window.getBounds()
  const contentBounds = window.getContentBounds()
  const destinationFrame = readScreenPointAppshotDestinationFrame(target, contentBounds)
  const display = screen.getDisplayMatching(destinationFrame)
  const convertedTarget = readScreenPointAppshotAnimationTarget(target, contentBounds, display)
  console.debug('[mac-capture] Appshot destination converted:', {
    inputCoordinateSpace: target.coordinateSpace,
    inputScaleFactor: scaleFactor,
    rendererWindow: serializeAppshotBrowserWindowForLog(rendererWindow),
    selectedWindow: serializeAppshotBrowserWindowForLog(window),
    windowBounds,
    contentBounds,
    displays: screen.getAllDisplays(),
    inputDestinationFrame: target.destinationFrame,
    convertedDestinationFrame: convertedTarget.destinationFrame,
    display: convertedTarget.codexDisplay,
  })
  return convertedTarget
}

const pointerMonitors = new Map<number, ReturnType<typeof setInterval>>()

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
  async startPointerMonitor(): Promise<void> {
    const ctx = getIpcContext()
    const webContents = ctx.sender
    const contentsId = webContents.id

    // Stop any existing monitor for this webContents
    const existing = pointerMonitors.get(contentsId)
    if (existing) {
      clearInterval(existing)
    }

    let wasOutside = false

    const interval = setInterval(() => {
      if (webContents.isDestroyed()) {
        clearInterval(interval)
        pointerMonitors.delete(contentsId)
        return
      }

      const cursor = screen.getCursorScreenPoint()
      const win = BrowserWindow.fromWebContents(webContents)
      if (!win || win.isDestroyed()) {
        return
      }

      const bounds = win.getBounds()
      const isOutside = (
        cursor.x < bounds.x
        || cursor.x > bounds.x + bounds.width
        || cursor.y < bounds.y
        || cursor.y > bounds.y + bounds.height
      )

      if (isOutside && !wasOutside) {
        wasOutside = true
        webContents.send('window:pointer-outside-window', cursor.x, cursor.y)
      }
      else if (!isOutside && wasOutside) {
        wasOutside = false
      }
    }, 16)

    pointerMonitors.set(contentsId, interval)
  }

  @IpcMethod()
  async stopPointerMonitor(): Promise<void> {
    const ctx = getIpcContext()
    const contentsId = ctx.sender.id
    const existing = pointerMonitors.get(contentsId)
    if (existing) {
      clearInterval(existing)
      pointerMonitors.delete(contentsId)
    }
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
  const rendererWindow = readIpcSenderWindow()
  const manager = getMacBridgeManager()
  if (!manager) {
    throw new Error('Mac Bridge manager is not initialized')
  }

  const strategy = options.strategy ?? 'cradle-native'
  if (strategy !== 'cradle-native') {
    throw new Error(`Unsupported Appshot strategy: ${strategy}`)
  }
  if (options.targetWindow && !options.animationTarget) {
    throw new Error('Appshot capture requires an animation target when a target window is provided.')
  }
  const context = await readAppshotContext(manager, options)
  const captureOptions = context
    ? {
        ...options,
        targetWindow: options.targetWindow ?? readCaptureTargetWindow(context),
        animationTarget: options.animationTarget ?? context.animationTarget,
      }
    : options
  const animationTarget = readScreenAppshotAnimationTarget(captureOptions.animationTarget, rendererWindow)
  console.debug('[mac-capture] Appshot capture starting:', {
    strategy,
    requestId: options.requestId,
    hasContext: Boolean(context),
    targetWindow: captureOptions.targetWindow,
    rendererWindow: serializeAppshotBrowserWindowForLog(rendererWindow),
    mainWindow: serializeAppshotBrowserWindowForLog(getWindowManager()?.getMainWindow()),
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
    transitionSnapshotImageSize: capture.appshot.transitionSnapshotImageSize,
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
  return createServices([NativeService, WindowService, DesktopUpdateService, MacCaptureService, BrowserTabScriptsService] as const)
}
