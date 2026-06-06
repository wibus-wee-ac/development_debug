import { EventEmitter } from 'node:events'

import { app } from 'electron'
import type { AppUpdater, ProgressInfo, UpdateInfo } from 'electron-updater'
import { autoUpdater } from 'electron-updater'

const BACKGROUND_CHECK_INTERVAL_MS = 5 * 60 * 1000
const DEFAULT_RETRY_COUNT = 3
const DEFAULT_RETRY_DELAY_MS = 1000

declare const __CRADLE_DESKTOP_UPDATE_URL__: string

export type DesktopUpdateFile = {
  url: string
  size: number | null
  sha512: string | null
}

export type DesktopUpdateInfo = {
  version: string
  releaseName: string | null
  releaseNotes: string | null
  releaseDate: string | null
  files: DesktopUpdateFile[]
}

export type DesktopUpdateStatus = {
  unsupported: boolean
  currentVersion: string
  isCheckingForUpdates: boolean
  isDownloadingUpdate: boolean
  downloadingProgress: number
  updateDownloaded: boolean
  updateInfo: DesktopUpdateInfo | null
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

type CheckForUpdatesOptions = {
  autoDownload?: boolean
  quiet?: boolean
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

function readReleaseNotes(updateInfo: UpdateInfo): string | null {
  if (Array.isArray(updateInfo.releaseNotes)) {
    const notes = updateInfo.releaseNotes
      .map(note => [note.version, note.note].filter(Boolean).join('\n'))
      .filter(Boolean)
      .join('\n\n')
    return notes || null
  }
  return updateInfo.releaseNotes ?? null
}

function projectUpdateInfo(updateInfo: UpdateInfo): DesktopUpdateInfo {
  return {
    version: updateInfo.version,
    releaseName: updateInfo.releaseName ?? null,
    releaseNotes: readReleaseNotes(updateInfo),
    releaseDate: updateInfo.releaseDate ?? null,
    files: updateInfo.files.map(file => ({
      url: file.url,
      size: typeof file.size === 'number' ? file.size : null,
      sha512: file.sha512 ?? null,
    })),
  }
}

function readProgressPercent(progress: ProgressInfo): number {
  if (Number.isFinite(progress.percent)) {
    return Math.max(0, Math.min(100, progress.percent))
  }
  return 0
}

export class DesktopUpdateManager {
  private readonly events = new EventEmitter()
  private readonly updateFeedUrl: string | null
  private readonly updater: AppUpdater | null
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
      currentVersion: app.getVersion(),
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
        await this.checkForUpdates({ autoDownload: false, quiet: true })
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

  async checkForUpdates(options: CheckForUpdatesOptions = {}): Promise<DesktopUpdateStatus> {
    if (!this.updater || this.statusSnapshot.isCheckingForUpdates) {
      return this.statusSnapshot
    }

    this.setStatus({
      isCheckingForUpdates: true,
      errorMessage: null,
    })

    try {
      const result = await retryWithBackoff(() => this.updater!.checkForUpdates())
      const updateInfo = result?.isUpdateAvailable ? projectUpdateInfo(result.updateInfo) : null
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
        errorMessage: options.quiet ? this.statusSnapshot.errorMessage : readErrorMessage(error),
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
      await retryWithBackoff(() => this.updater!.downloadUpdate())
      this.setStatus({
        isDownloadingUpdate: false,
        downloadingProgress: 100,
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
    if (!this.updater || !this.statusSnapshot.updateDownloaded) {
      return
    }

    try {
      await this.beforeApplyUpdate()
      this.updater.quitAndInstall(false, true)
    }
    catch (error) {
      this.setStatus({
        errorMessage: readErrorMessage(error),
      })
    }
  }

  private createUpdater(updateFeedUrl: string | null): AppUpdater | null {
    if (!updateFeedUrl) {
      return null
    }
    if (!app.isPackaged && process.env.CRADLE_DESKTOP_ALLOW_DEV_UPDATES !== 'true') {
      return null
    }

    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.allowDowngrade = false
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: updateFeedUrl,
    })

    this.bindUpdaterEvents(autoUpdater)
    return autoUpdater
  }

  private bindUpdaterEvents(updater: AppUpdater): void {
    updater.on('checking-for-update', () => {
      this.setStatus({
        isCheckingForUpdates: true,
        errorMessage: null,
      })
    })
    updater.on('update-available', (info) => {
      this.setStatus({
        isCheckingForUpdates: false,
        updateInfo: projectUpdateInfo(info),
        updateDownloaded: false,
        downloadingProgress: 0,
      })
    })
    updater.on('update-not-available', () => {
      this.setStatus({
        isCheckingForUpdates: false,
        updateInfo: null,
        updateDownloaded: false,
        downloadingProgress: 0,
      })
    })
    updater.on('download-progress', (progress) => {
      this.setStatus({
        isDownloadingUpdate: true,
        downloadingProgress: readProgressPercent(progress),
      })
    })
    updater.on('update-downloaded', (info) => {
      this.setStatus({
        isDownloadingUpdate: false,
        downloadingProgress: 100,
        updateDownloaded: true,
        updateInfo: projectUpdateInfo(info),
      })
    })
    updater.on('error', (error) => {
      this.setStatus({
        isCheckingForUpdates: false,
        isDownloadingUpdate: false,
        errorMessage: readErrorMessage(error),
      })
    })
  }

  private getUnsupportedReason(updateFeedUrl: string | null): string | null {
    if (!updateFeedUrl) {
      return 'CRADLE_DESKTOP_UPDATE_URL is not configured'
    }
    if (!app.isPackaged && process.env.CRADLE_DESKTOP_ALLOW_DEV_UPDATES !== 'true') {
      return 'Desktop updates are only available in packaged builds'
    }
    return 'electron-updater is unavailable in the current runtime'
  }

  private setStatus(patch: Partial<DesktopUpdateStatus>): void {
    this.statusSnapshot = {
      ...this.statusSnapshot,
      ...patch,
    }
    this.events.emit('statusChanged', this.statusSnapshot)
  }
}
