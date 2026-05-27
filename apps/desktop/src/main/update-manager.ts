import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { app } from 'electron'
import type { UpdateInfo } from 'velopack'
import { UpdateManager as VelopackUpdateManager } from 'velopack'

const BACKGROUND_CHECK_INTERVAL_MS = 5 * 60 * 1000
const DEFAULT_RETRY_COUNT = 3
const DEFAULT_RETRY_DELAY_MS = 1000

declare const __CRADLE_DESKTOP_UPDATE_URL__: string

export type DesktopUpdateStatus = {
  unsupported: boolean
  currentVersion: string
  isCheckingForUpdates: boolean
  isDownloadingUpdate: boolean
  downloadingProgress: number
  updateDownloaded: boolean
  updateInfo: UpdateInfo | null
  errorMessage: string | null
}

export type DesktopUpdateManagerEvents = {
  statusChanged: [status: DesktopUpdateStatus]
}

type DesktopUpdateEventName = keyof DesktopUpdateManagerEvents
type BeforeApplyUpdate = () => Promise<void> | void

export type DesktopUpdateManagerOptions = {
  updateFeedUrl?: string | null
  beforeApplyUpdate?: BeforeApplyUpdate
}

async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  retryCount = DEFAULT_RETRY_COUNT,
  delayMs = DEFAULT_RETRY_DELAY_MS,
): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    try {
      return await operation()
    }
    catch (error) {
      lastError = error
      if (attempt === retryCount) {
        break
      }
      await new Promise(resolve => setTimeout(resolve, delayMs * 2 ** attempt))
    }
  }

  throw lastError
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function readUpdateFeedUrl(): string | null {
  const url = (process.env.CRADLE_DESKTOP_UPDATE_URL ?? __CRADLE_DESKTOP_UPDATE_URL__).trim()
  return url || null
}

function readRestartArgs(): string[] {
  return process.argv.slice(1)
}

function readTargetPackageName(updateInfo: UpdateInfo): string {
  return updateInfo.TargetFullRelease.FileName
}

export class DesktopUpdateManager {
  private readonly events = new EventEmitter()
  private readonly updateFeedUrl: string | null
  private readonly updater: VelopackUpdateManager | null
  private readonly beforeApplyUpdate: BeforeApplyUpdate
  private statusSnapshot: DesktopUpdateStatus
  private backgroundTimer: NodeJS.Timeout | null = null

  constructor(options: DesktopUpdateManagerOptions = {}) {
    const updateFeedUrl = options.updateFeedUrl ?? readUpdateFeedUrl()
    this.updateFeedUrl = updateFeedUrl
    this.updater = this.createUpdater(updateFeedUrl)
    this.beforeApplyUpdate = options.beforeApplyUpdate ?? (() => {})
    this.statusSnapshot = {
      unsupported: this.updater === null,
      currentVersion: this.getCurrentVersion(),
      isCheckingForUpdates: false,
      isDownloadingUpdate: false,
      downloadingProgress: 0,
      updateDownloaded: false,
      updateInfo: null,
      errorMessage: this.updater === null ? this.getUnsupportedReason(updateFeedUrl) : null,
    }
  }

  get status(): DesktopUpdateStatus {
    return this.statusSnapshot
  }

  on<K extends DesktopUpdateEventName>(
    event: K,
    listener: (...args: DesktopUpdateManagerEvents[K]) => void,
  ): this {
    this.events.on(event, listener)
    return this
  }

  off<K extends DesktopUpdateEventName>(
    event: K,
    listener: (...args: DesktopUpdateManagerEvents[K]) => void,
  ): this {
    this.events.off(event, listener)
    return this
  }

  startBackgroundChecks(): void {
    if (!this.updater || this.backgroundTimer) {
      return
    }

    const check = async () => {
      try {
        const updateInfo = await this.updater!.checkForUpdatesAsync()
        if (updateInfo && !this.statusSnapshot.updateInfo) {
          await this.checkForUpdates({ autoDownload: false })
        }
      }
      catch {
        // Background checks should stay quiet; explicit checks surface errors.
      }
      finally {
        this.backgroundTimer = setTimeout(check, BACKGROUND_CHECK_INTERVAL_MS)
      }
    }

    void check()
  }

  stopBackgroundChecks(): void {
    if (!this.backgroundTimer) {
      return
    }
    clearTimeout(this.backgroundTimer)
    this.backgroundTimer = null
  }

  async checkForUpdates(options: { autoDownload?: boolean } = {}): Promise<DesktopUpdateStatus> {
    if (!this.updater || this.statusSnapshot.isCheckingForUpdates) {
      return this.statusSnapshot
    }

    this.setStatus({
      isCheckingForUpdates: true,
      errorMessage: null,
    })

    try {
      const updateInfo = await retryWithBackoff(() => this.updater!.checkForUpdatesAsync())
      this.setStatus({
        isCheckingForUpdates: false,
        updateInfo,
        updateDownloaded: false,
        downloadingProgress: 0,
      })

      if (updateInfo && options.autoDownload === true) {
        await this.downloadUpdate()
      }
    }
    catch (error) {
      this.setStatus({
        isCheckingForUpdates: false,
        updateInfo: null,
        errorMessage: readErrorMessage(error),
      })
    }

    return this.statusSnapshot
  }

  async downloadUpdate(): Promise<DesktopUpdateStatus> {
    if (!this.updater || this.statusSnapshot.isDownloadingUpdate || !this.statusSnapshot.updateInfo) {
      return this.statusSnapshot
    }

    this.setStatus({
      isDownloadingUpdate: true,
      updateDownloaded: false,
      downloadingProgress: 0,
      errorMessage: null,
    })

    try {
      await retryWithBackoff(() =>
        this.updater!.downloadUpdateAsync(this.statusSnapshot.updateInfo!, (progress) => {
          this.setStatus({ downloadingProgress: progress })
        }))
      this.setStatus({
        isDownloadingUpdate: false,
        updateDownloaded: true,
      })
    }
    catch (error) {
      this.setStatus({
        isDownloadingUpdate: false,
        updateDownloaded: false,
        errorMessage: readErrorMessage(error),
      })
    }

    return this.statusSnapshot
  }

  async applyUpdate(): Promise<void> {
    if (!this.updater || !this.statusSnapshot.updateInfo) {
      return
    }

    try {
      await this.beforeApplyUpdate()
    }
    catch (error) {
      this.setStatus({
        errorMessage: readErrorMessage(error),
      })
      return
    }

    if (this.startMacUpdateApply(this.statusSnapshot.updateInfo)) {
      app.quit()
      return
    }

    try {
      this.updater.waitExitThenApplyUpdate(this.statusSnapshot.updateInfo, false, true, readRestartArgs())
    }
    catch (error) {
      this.setStatus({
        errorMessage: readErrorMessage(error),
      })
      return
    }

    app.quit()
  }

  private startMacUpdateApply(updateInfo: UpdateInfo): boolean {
    if (process.platform !== 'darwin' || !app.isPackaged || !this.updater) {
      return false
    }

    const appId = this.updater.getAppId()
    const packageDir = join(app.getPath('home'), 'Library', 'Caches', 'velopack', appId, 'packages')
    const packagePath = join(packageDir, readTargetPackageName(updateInfo))
    const updateExePath = join(dirname(process.execPath), 'UpdateMac')
    const rootAppDir = resolve(process.resourcesPath, '..', '..')
    const logPath = join(app.getPath('home'), 'Library', 'Logs', `velopack_${appId}.log`)

    if (!existsSync(updateExePath)) {
      return false
    }
    if (!existsSync(packagePath)) {
      this.setStatus({
        errorMessage: `Downloaded update package not found at ${packagePath}`,
      })
      return true
    }

    const args = [
      '--rootDir',
      rootAppDir,
      '--packageDir',
      packageDir,
      '--log',
      logPath,
      'apply',
      '--waitPid',
      String(process.pid),
      '--package',
      packagePath,
      '--',
      ...readRestartArgs(),
    ]

    try {
      const updaterProcess = spawn(updateExePath, args, {
        detached: true,
        stdio: 'ignore',
      })
      updaterProcess.unref()
      return true
    }
    catch (error) {
      this.setStatus({
        errorMessage: readErrorMessage(error),
      })
      return true
    }
  }

  private createUpdater(updateFeedUrl: string | null): VelopackUpdateManager | null {
    if (!updateFeedUrl) {
      return null
    }

    try {
      return new VelopackUpdateManager(updateFeedUrl)
    }
    catch {
      return null
    }
  }

  private getCurrentVersion(): string {
    try {
      return this.updater?.getCurrentVersion() ?? app.getVersion()
    }
    catch {
      return app.getVersion()
    }
  }

  private getUnsupportedReason(updateFeedUrl: string | null): string | null {
    if (!updateFeedUrl) {
      return 'CRADLE_DESKTOP_UPDATE_URL is not configured'
    }
    return 'Velopack updater is unavailable in the current runtime'
  }

  private setStatus(patch: Partial<DesktopUpdateStatus>): void {
    this.statusSnapshot = {
      ...this.statusSnapshot,
      ...patch,
    }
    this.events.emit('statusChanged', this.statusSnapshot)
  }
}
