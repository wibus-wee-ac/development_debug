import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  DesktopUpdateCandidate,
  DesktopUpdateDownload,
  DesktopUpdateInstallerPlan,
} from './update-types'

const electronMocks = vi.hoisted(() => ({
  app: {
    getVersion: vi.fn(() => '1.2.2'),
    isPackaged: true,
  },
}))

const updateSourceMocks = vi.hoisted(() => {
  const state = {
    candidate: null as DesktopUpdateCandidate | null,
    instances: [] as Array<{ options: unknown, checkForUpdates: ReturnType<typeof vi.fn> }>,
    readUpdateFeedUrl: vi.fn(() => 'https://updates.example.com/cradle'),
  }

  class DesktopUpdateSource {
    readonly options: unknown
    readonly checkForUpdates = vi.fn(async () => state.candidate)

    constructor(options: unknown) {
      this.options = options
      state.instances.push(this)
    }
  }

  return {
    DesktopUpdateSource,
    state,
  }
})

const updateDownloaderMocks = vi.hoisted(() => {
  const state = {
    download: {
      archivePath: '/tmp/Cradle-1.2.3-universal.zip',
      artifact: {
        url: 'https://updates.example.com/cradle/macos/Cradle-1.2.3-universal.zip',
        size: 10,
        sha256: 'a'.repeat(64),
        platform: 'darwin' as const,
        arch: 'universal' as const,
      },
    } satisfies DesktopUpdateDownload,
    instances: [] as Array<{ download: ReturnType<typeof vi.fn> }>,
  }

  class DesktopUpdateDownloader {
    readonly download = vi.fn(async (_candidate: DesktopUpdateCandidate, onProgress?: (progress: { percent: number }) => void) => {
      onProgress?.({ percent: 42 })
      return state.download
    })

    constructor() {
      state.instances.push(this)
    }
  }

  return {
    DesktopUpdateDownloader,
    state,
  }
})

const updateInstallerMocks = vi.hoisted(() => {
  const state = {
    plan: {
      version: '1.2.3',
      archivePath: '/tmp/Cradle-1.2.3-universal.zip',
      stagingRoot: '/tmp/staging',
      stagedAppPath: '/tmp/staging/Cradle.app',
      targetAppPath: '/Applications/Cradle.app',
      scriptPath: '/tmp/apply-1.2.3.sh',
      resultPath: '/tmp/last-update-result.json',
      usesAdministratorPrivileges: false,
    } satisfies DesktopUpdateInstallerPlan,
    instances: [] as Array<{
      prepare: ReturnType<typeof vi.fn>
      launch: ReturnType<typeof vi.fn>
      readLastResult: ReturnType<typeof vi.fn>
    }>,
  }

  class DesktopUpdateInstaller {
    readonly prepare = vi.fn(async () => state.plan)
    readonly launch = vi.fn()
    readonly readLastResult = vi.fn(async () => null)

    constructor() {
      state.instances.push(this)
    }
  }

  return {
    DesktopUpdateInstaller,
    state,
  }
})

vi.mock('electron', () => electronMocks)
vi.mock('./update-source', () => ({
  DesktopUpdateSource: updateSourceMocks.DesktopUpdateSource,
  readUpdateFeedUrl: updateSourceMocks.state.readUpdateFeedUrl,
}))
vi.mock('./update-downloader', () => ({
  DesktopUpdateDownloader: updateDownloaderMocks.DesktopUpdateDownloader,
}))
vi.mock('./update-installer', () => ({
  DesktopUpdateInstaller: updateInstallerMocks.DesktopUpdateInstaller,
}))

function createCandidate(): DesktopUpdateCandidate {
  return {
    info: {
      version: '1.2.3',
      releaseName: 'Cradle 1.2.3',
      releaseNotes: null,
      releaseDate: '2026-06-20T00:00:00.000Z',
      files: [
        {
          url: 'https://updates.example.com/cradle/macos/Cradle-1.2.3-universal.zip',
          size: 10,
          sha512: null,
        },
      ],
    },
    artifact: {
      url: 'https://updates.example.com/cradle/macos/Cradle-1.2.3-universal.zip',
      size: 10,
      sha256: 'a'.repeat(64),
      platform: 'darwin',
      arch: 'universal',
    },
  }
}

describe('DesktopUpdateManager', () => {
  const originalPlatform = process.platform

  beforeEach(() => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'darwin',
    })
    electronMocks.app.getVersion.mockReturnValue('1.2.2')
    updateSourceMocks.state.candidate = createCandidate()
    updateSourceMocks.state.instances.length = 0
    updateSourceMocks.state.readUpdateFeedUrl.mockReturnValue('https://updates.example.com/cradle')
    updateDownloaderMocks.state.instances.length = 0
    updateInstallerMocks.state.instances.length = 0
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: originalPlatform,
    })
  })

  it('checks, downloads, prepares, launches, and requests quit in order', async () => {
    const quitEvents: string[] = []
    const { DesktopUpdateManager } = await import('./update-manager')
    const manager = new DesktopUpdateManager({
      updateFeedUrl: 'https://updates.example.com/cradle',
      requestQuitForUpdate: async () => {
        quitEvents.push('quit')
      },
    })

    await expect(manager.checkForUpdates()).resolves.toMatchObject({
      updateInfo: {
        version: '1.2.3',
      },
      updateDownloaded: false,
    })
    expect(updateDownloaderMocks.state.instances[0]?.download).not.toHaveBeenCalled()

    await expect(manager.downloadUpdate()).resolves.toMatchObject({
      downloadingProgress: 100,
      updateDownloaded: true,
      downloadedFilePath: '/tmp/Cradle-1.2.3-universal.zip',
    })
    expect(updateDownloaderMocks.state.instances[0]?.download).toHaveBeenCalledWith(
      updateSourceMocks.state.candidate,
      expect.any(Function),
    )
    expect(updateInstallerMocks.state.instances[0]?.prepare).toHaveBeenCalledWith(
      updateDownloaderMocks.state.download,
      '1.2.3',
    )

    await manager.applyUpdate()

    expect(updateInstallerMocks.state.instances[0]?.launch).toHaveBeenCalledWith(updateInstallerMocks.state.plan)
    expect(quitEvents).toEqual(['quit'])
  })

  it('reports an apply error when no prepared update is available', async () => {
    const { DesktopUpdateManager } = await import('./update-manager')
    const manager = new DesktopUpdateManager({
      updateFeedUrl: 'https://updates.example.com/cradle',
      requestQuitForUpdate: vi.fn(),
    })

    await manager.applyUpdate()

    expect(manager.status.errorMessage).toBe('No prepared desktop update is available')
    expect(updateInstallerMocks.state.instances[0]?.launch).not.toHaveBeenCalled()
  })
})
