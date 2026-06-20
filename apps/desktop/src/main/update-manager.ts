import { EventEmitter } from 'node:events'

import { app } from 'electron'

import { DesktopUpdateDownloader } from './update-downloader'
import { DesktopUpdateInstaller } from './update-installer'
import { readUpdateFeedUrl, DesktopUpdateSource } from './update-source'
import type {
  DesktopUpdateCandidate,
  DesktopUpdateInstallerPlan,
  DesktopUpdatePreferences,
  DesktopUpdateStatus,
} from './update-types'
import { readErrorMessage } from './update-types'

export type {
  DesktopUpdateFile,
  DesktopUpdateInfo,
  DesktopUpdatePreferences,
  DesktopUpdateStatus,
} from './update-types'

const BACKGROUND_CHECK_INTERVAL_MS = 5 * 60 * 1000
const DEFAULT_RETRY_COUNT = 3
const DEFAULT_RETRY_DELAY_MS = 1000

export type DesktopUpdateManagerEvents = {
  statusChanged: [status: DesktopUpdateStatus]
}

type DesktopUpdateEventName = keyof DesktopUpdateManagerEvents

export type DesktopUpdateManagerOptions = {
  updateFeedUrl?: string | null
  preferences?: Partial<DesktopUpdatePreferences>
  requestQuitForUpdate?: () => void | Promise<void>
}

type CheckForUpdatesOptions = {
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

export class DesktopUpdateManager {
  private readonly events = new EventEmitter()
  private readonly requestQuitForUpdate: (() => void | Promise<void>) | null
  private readonly source: DesktopUpdateSource | null
  private readonly downloader: DesktopUpdateDownloader | null
  private readonly installer: DesktopUpdateInstaller
  private preferences: DesktopUpdatePreferences
  private statusSnapshot: DesktopUpdateStatus
  private backgroundTimer: NodeJS.Timeout | null = null
  private backgroundCheckRunning = false
  private availableUpdate: DesktopUpdateCandidate | null = null
  private installerPlan: DesktopUpdateInstallerPlan | null = null

  constructor(options: DesktopUpdateManagerOptions = {}) {
    const currentVersion = app.getVersion()
    const updateFeedUrl = options.updateFeedUrl ?? readUpdateFeedUrl()
    const unsupportedReason = readUnsupportedReason(updateFeedUrl)

    this.requestQuitForUpdate = options.requestQuitForUpdate ?? null
    this.source = unsupportedReason
      ? null
      : new DesktopUpdateSource({
          updateFeedUrl,
          currentVersion,
        })
    this.downloader = unsupportedReason ? null : new DesktopUpdateDownloader()
    this.installer = new DesktopUpdateInstaller()
    this.preferences = {
      autoCheckForUpdates: options.preferences?.autoCheckForUpdates ?? true,
      autoDownloadUpdates: options.preferences?.autoDownloadUpdates ?? false,
    }
    this.statusSnapshot = {
      unsupported: unsupportedReason !== null,
      currentVersion,
      isCheckingForUpdates: false,
      isDownloadingUpdate: false,
      downloadingProgress: 0,
      updateDownloaded: false,
      downloadedFilePath: null,
      updateInfo: null,
      errorMessage: unsupportedReason,
    }

    void this.loadLastApplyResult()
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
    if (
      !this.source
      || this.backgroundTimer
      || this.backgroundCheckRunning
      || !this.preferences.autoCheckForUpdates
    ) {
      return
    }

    const check = async () => {
      this.backgroundCheckRunning = true
      try {
        await this.checkForUpdates({ quiet: true })
        if (this.preferences.autoDownloadUpdates && this.statusSnapshot.updateInfo) {
          await this.downloadUpdate()
        }
      }
      finally {
        this.backgroundCheckRunning = false
        this.backgroundTimer = this.preferences.autoCheckForUpdates
          ? setTimeout(check, BACKGROUND_CHECK_INTERVAL_MS)
          : null
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

  configurePreferences(preferences: DesktopUpdatePreferences): DesktopUpdateStatus {
    this.preferences = preferences

    if (!preferences.autoCheckForUpdates) {
      this.stopBackgroundChecks()
      return this.statusSnapshot
    }

    this.startBackgroundChecks()
    return this.statusSnapshot
  }

  async checkForUpdates(options: CheckForUpdatesOptions = {}): Promise<DesktopUpdateStatus> {
    if (!this.source || this.statusSnapshot.isCheckingForUpdates || this.statusSnapshot.isDownloadingUpdate) {
      return this.statusSnapshot
    }

    this.setStatus({
      isCheckingForUpdates: true,
      errorMessage: null,
    })

    try {
      const candidate = await retryWithBackoff(() => this.source!.checkForUpdates())
      this.availableUpdate = candidate
      this.installerPlan = null
      this.setStatus({
        isCheckingForUpdates: false,
        updateInfo: candidate?.info ?? null,
        updateDownloaded: false,
        downloadedFilePath: null,
        downloadingProgress: 0,
      })
    }
    catch (error) {
      this.availableUpdate = null
      this.installerPlan = null
      this.setStatus({
        isCheckingForUpdates: false,
        updateInfo: null,
        updateDownloaded: false,
        downloadedFilePath: null,
        downloadingProgress: 0,
        errorMessage: options.quiet ? this.statusSnapshot.errorMessage : readErrorMessage(error),
      })
    }

    return this.statusSnapshot
  }

  async downloadUpdate(): Promise<DesktopUpdateStatus> {
    if (
      !this.downloader
      || this.statusSnapshot.isDownloadingUpdate
      || !this.availableUpdate
    ) {
      return this.statusSnapshot
    }

    this.setStatus({
      isDownloadingUpdate: true,
      updateDownloaded: false,
      downloadedFilePath: null,
      downloadingProgress: 0,
      errorMessage: null,
    })

    try {
      const download = await retryWithBackoff(() => this.downloader!.download(this.availableUpdate!, (progress) => {
        this.setStatus({
          isDownloadingUpdate: true,
          downloadingProgress: progress.percent,
        })
      }))
      const plan = await this.installer.prepare(download, this.availableUpdate.info.version)
      this.installerPlan = plan
      this.setStatus({
        isDownloadingUpdate: false,
        downloadingProgress: 100,
        updateDownloaded: true,
        downloadedFilePath: plan.archivePath,
      })
    }
    catch (error) {
      this.installerPlan = null
      this.setStatus({
        isDownloadingUpdate: false,
        updateDownloaded: false,
        downloadedFilePath: null,
        errorMessage: readErrorMessage(error),
      })
    }

    return this.statusSnapshot
  }

  async applyUpdate(): Promise<void> {
    if (!this.installerPlan) {
      this.setStatus({
        errorMessage: 'No prepared desktop update is available',
      })
      return
    }
    if (!this.requestQuitForUpdate) {
      this.setStatus({
        errorMessage: 'Desktop update quit hook is not configured',
      })
      return
    }

    try {
      this.installer.launch(this.installerPlan)
      await this.requestQuitForUpdate()
    }
    catch (error) {
      this.setStatus({
        errorMessage: readErrorMessage(error),
      })
    }
  }

  private async loadLastApplyResult(): Promise<void> {
    const result = await this.installer.readLastResult()
    if (!result || result.ok) {
      return
    }

    this.setStatus({
      errorMessage: result.error ?? `Desktop update ${result.version} failed`,
    })
  }

  private setStatus(patch: Partial<DesktopUpdateStatus>): void {
    this.statusSnapshot = {
      ...this.statusSnapshot,
      ...patch,
    }
    this.events.emit('statusChanged', this.statusSnapshot)
  }
}

function readUnsupportedReason(updateFeedUrl: string | null): string | null {
  if (process.platform !== 'darwin') {
    return 'Desktop self-updates are only available on macOS'
  }
  if (!updateFeedUrl) {
    return 'CRADLE_DESKTOP_UPDATE_URL is not configured'
  }
  if (!app.isPackaged && process.env.CRADLE_DESKTOP_ALLOW_DEV_UPDATES !== 'true') {
    return 'Desktop updates are only available in packaged builds'
  }
  return null
}
