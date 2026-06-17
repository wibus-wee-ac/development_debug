import { EventEmitter } from 'node:events'
import { access, copyFile, mkdir } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

import { app, shell } from 'electron'
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
  downloadedFilePath: string | null
  updateInfo: DesktopUpdateInfo | null
  errorMessage: string | null
}

export type DesktopUpdateManagerEvents = {
  statusChanged: [status: DesktopUpdateStatus]
}

type DesktopUpdateEventName = keyof DesktopUpdateManagerEvents

export type DesktopUpdatePreferences = {
  autoCheckForUpdates: boolean
  autoDownloadUpdates: boolean
}

export type DesktopUpdateManagerOptions = {
  updateFeedUrl?: string | null
  preferences?: Partial<DesktopUpdatePreferences>
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
  private preferences: DesktopUpdatePreferences
  private statusSnapshot: DesktopUpdateStatus
  private backgroundTimer: NodeJS.Timeout | null = null
  private backgroundCheckRunning = false

  constructor(options: DesktopUpdateManagerOptions = {}) {
    const updateFeedUrl = options.updateFeedUrl ?? readUpdateFeedUrl()
    this.updateFeedUrl = updateFeedUrl
    this.updater = this.createUpdater(updateFeedUrl)
    this.preferences = {
      autoCheckForUpdates: options.preferences?.autoCheckForUpdates ?? true,
      autoDownloadUpdates: options.preferences?.autoDownloadUpdates ?? false,
    }
    this.statusSnapshot = {
      unsupported: this.updater === null,
      currentVersion: app.getVersion(),
      isCheckingForUpdates: false,
      isDownloadingUpdate: false,
      downloadingProgress: 0,
      updateDownloaded: false,
      downloadedFilePath: null,
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
    if (
      !this.updater
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
    if (!this.updater || this.statusSnapshot.isCheckingForUpdates || this.statusSnapshot.isDownloadingUpdate) {
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
        downloadedFilePath: null,
        downloadingProgress: 0,
      })
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
      downloadedFilePath: null,
      downloadingProgress: 0,
      errorMessage: null,
    })

    try {
      const downloadedPaths = await retryWithBackoff(() => this.updater!.downloadUpdate())
      const desktopPath = await this.copyInstallerToDesktop(downloadedPaths)
      await this.openDownloadedInstaller(desktopPath)
      this.setStatus({
        isDownloadingUpdate: false,
        downloadingProgress: 100,
        updateDownloaded: true,
        downloadedFilePath: desktopPath,
      })
    }
    catch (error) {
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
    if (!this.statusSnapshot.downloadedFilePath) {
      return
    }

    try {
      await this.openDownloadedInstaller(this.statusSnapshot.downloadedFilePath)
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
        downloadedFilePath: null,
        downloadingProgress: 0,
      })
    })
    updater.on('update-not-available', () => {
      this.setStatus({
        isCheckingForUpdates: false,
        updateInfo: null,
        updateDownloaded: false,
        downloadedFilePath: null,
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
        updateDownloaded: this.statusSnapshot.downloadedFilePath !== null,
        downloadedFilePath: this.statusSnapshot.downloadedFilePath,
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

  private async copyInstallerToDesktop(downloadedPaths: string[]): Promise<string> {
    const sourcePath = this.pickInstallerPath(downloadedPaths)
    const desktopDir = app.getPath('desktop')
    await mkdir(desktopDir, { recursive: true })

    const fileName = basename(sourcePath)
    const desktopPath = await this.resolveAvailableDesktopPath(desktopDir, fileName)
    await copyFile(sourcePath, desktopPath)
    return desktopPath
  }

  private pickInstallerPath(downloadedPaths: string[]): string {
    const installerPath = downloadedPaths.find((filePath) => {
      const extension = extname(filePath).toLowerCase()
      return ['.dmg', '.pkg', '.zip', '.exe', '.msi', '.appimage'].includes(extension)
    }) ?? downloadedPaths[0]

    if (!installerPath) {
      throw new Error('Update download did not produce an installer file')
    }
    return installerPath
  }

  private async resolveAvailableDesktopPath(desktopDir: string, fileName: string): Promise<string> {
    const extension = extname(fileName)
    const stem = extension ? fileName.slice(0, -extension.length) : fileName

    for (let index = 0; index < 100; index++) {
      const candidateName = index === 0 ? fileName : `${stem} ${index + 1}${extension}`
      const candidatePath = join(desktopDir, candidateName)
      try {
        await access(candidatePath)
      }
      catch {
        return candidatePath
      }
    }

    return join(desktopDir, `${stem} ${Date.now()}${extension}`)
  }

  private async openDownloadedInstaller(filePath: string): Promise<void> {
    const openError = await shell.openPath(filePath)
    if (openError) {
      throw new Error(openError)
    }
  }

  private setStatus(patch: Partial<DesktopUpdateStatus>): void {
    this.statusSnapshot = {
      ...this.statusSnapshot,
      ...patch,
    }
    this.events.emit('statusChanged', this.statusSnapshot)
  }
}
