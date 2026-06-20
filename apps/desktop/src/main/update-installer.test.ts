import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesktopUpdateDownload } from './update-types'

const electronMocks = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(() => '/unused'),
  },
}))

const childProcessMocks = vi.hoisted(() => {
  const execFile = vi.fn((
    _file: string,
    _args: string[],
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ) => {
    callback(null, '1.2.3\n', '')
  })
  const promisifiedExecFile = vi.fn(async () => ({
    stdout: '1.2.3\n',
    stderr: '',
  }))
  Object.defineProperty(execFile, Symbol.for('nodejs.util.promisify.custom'), {
    configurable: true,
    value: promisifiedExecFile,
  })

  return {
    execFile,
    promisifiedExecFile,
    spawn: vi.fn(() => ({
      unref: vi.fn(),
    })),
  }
})

const extractZipMocks = vi.hoisted(() => ({
  extractZip: vi.fn(async (_archivePath: string, options: { dir: string }) => {
    const appPath = join(options.dir, 'Cradle.app')
    await mkdir(join(appPath, 'Contents'), { recursive: true })
    await writeFile(join(appPath, 'Contents', 'Info.plist'), '')
  }),
}))

vi.mock('electron', () => electronMocks)
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  return {
    ...actual,
    execFile: childProcessMocks.execFile,
    spawn: childProcessMocks.spawn,
  }
})
vi.mock('extract-zip', () => ({
  default: extractZipMocks.extractZip,
}))

const tempRoots: string[] = []

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform,
  })
}

function setExecPath(execPath: string): void {
  Object.defineProperty(process, 'execPath', {
    configurable: true,
    value: execPath,
  })
}

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cradle-update-installer-'))
  tempRoots.push(root)
  return root
}

function createDownload(archivePath: string): DesktopUpdateDownload {
  return {
    archivePath,
    artifact: {
      url: 'https://updates.example.com/cradle/macos/Cradle-1.2.3-universal.zip',
      size: null,
      sha256: null,
      platform: 'darwin',
      arch: 'universal',
    },
  }
}

describe('DesktopUpdateInstaller', () => {
  const originalPlatform = process.platform
  const originalExecPath = process.execPath

  beforeEach(() => {
    setPlatform('darwin')
    childProcessMocks.execFile.mockClear()
    childProcessMocks.promisifiedExecFile.mockClear()
    childProcessMocks.promisifiedExecFile.mockResolvedValue({
      stdout: '1.2.3\n',
      stderr: '',
    })
    childProcessMocks.spawn.mockClear()
    extractZipMocks.extractZip.mockClear()
  })

  afterEach(async () => {
    setPlatform(originalPlatform)
    setExecPath(originalExecPath)
    await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  })

  it('prepares a staged app and detached installer script', async () => {
    const root = await createTempRoot()
    const currentAppPath = join(root, 'Applications', 'Cradle.app')
    const currentExecutablePath = join(currentAppPath, 'Contents', 'MacOS', 'Cradle')
    const archivePath = join(root, 'Cradle-1.2.3-universal.zip')
    const updatesDir = join(root, 'updates')
    await mkdir(join(currentAppPath, 'Contents', 'MacOS'), { recursive: true })
    await writeFile(currentExecutablePath, '')
    await writeFile(archivePath, 'zip-payload')
    setExecPath(currentExecutablePath)

    const { DesktopUpdateInstaller } = await import('./update-installer')
    const installer = new DesktopUpdateInstaller({ updatesDir })

    const plan = await installer.prepare(createDownload(archivePath), '1.2.3')
    const script = await readFile(plan.scriptPath, 'utf8')

    expect(extractZipMocks.extractZip).toHaveBeenCalledWith(archivePath, {
      dir: join(updatesDir, 'staging', '1.2.3'),
    })
    expect(childProcessMocks.promisifiedExecFile).toHaveBeenCalledWith('/usr/bin/plutil', [
      '-extract',
      'CFBundleShortVersionString',
      'raw',
      '-o',
      '-',
      join(plan.stagedAppPath, 'Contents', 'Info.plist'),
    ])
    expect(plan).toMatchObject({
      version: '1.2.3',
      archivePath,
      stagingRoot: join(updatesDir, 'staging', '1.2.3'),
      stagedAppPath: join(updatesDir, 'staging', '1.2.3', 'Cradle.app'),
      targetAppPath: currentAppPath,
      scriptPath: join(updatesDir, 'apply-1.2.3.sh'),
      resultPath: join(updatesDir, 'last-update-result.json'),
      usesAdministratorPrivileges: false,
    })
    expect(script).toContain(`TARGET_APP='${currentAppPath}'`)
    expect(script).toContain('wait_for_parent')
    expect(script).toContain('/usr/bin/open -n "$TARGET_APP"')
  })

  it('rejects a staged bundle with a mismatched version', async () => {
    childProcessMocks.promisifiedExecFile.mockResolvedValueOnce({
      stdout: '1.2.4\n',
      stderr: '',
    })
    const root = await createTempRoot()
    const currentAppPath = join(root, 'Applications', 'Cradle.app')
    const currentExecutablePath = join(currentAppPath, 'Contents', 'MacOS', 'Cradle')
    const archivePath = join(root, 'Cradle-1.2.3-universal.zip')
    await mkdir(join(currentAppPath, 'Contents', 'MacOS'), { recursive: true })
    await writeFile(currentExecutablePath, '')
    await writeFile(archivePath, 'zip-payload')
    setExecPath(currentExecutablePath)

    const { DesktopUpdateInstaller } = await import('./update-installer')
    const installer = new DesktopUpdateInstaller({ updatesDir: join(root, 'updates') })

    await expect(installer.prepare(createDownload(archivePath), '1.2.3')).rejects.toThrow('does not match manifest version')
  })
})
