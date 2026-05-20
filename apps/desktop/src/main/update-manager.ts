// Input: Velopack native updater and Electron app lifecycle
// Output: Desktop-owned update manager state, commands, and status events
// Position: apps/desktop/src/main/update-manager.ts

import type { UpdateInfo } from 'velopack'
import { EventEmitter } from 'node:events'

import { app } from 'electron'
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
  return url ? url : null
}

export class DesktopUpdateManager {
  private readonly events = new EventEmitter()
  private readonly updateFeedUrl: string | null
  private readonly updater: VelopackUpdateManager | null
  private statusSnapshot: DesktopUpdateStatus
  private backgroundTimer: NodeJS.Timeout | null = null

  constructor(updateFeedUrl = readUpdateFeedUrl()) {
    this.updateFeedUrl = updateFeedUrl
    this.updater = this.createUpdater(updateFeedUrl)
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

      if (updateInfo && options.autoDownload !== false) {
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
        }),
      )
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

    this.updater.waitExitThenApplyUpdate(this.statusSnapshot.updateInfo)
    app.exit()
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
