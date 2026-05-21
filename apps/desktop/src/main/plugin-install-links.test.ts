/* Verifies Cradle Marketplace plugin install link parsing and install receipts. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import * as tar from 'tar'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  collectPluginInstallUrls,
  createInstalledPluginPackageDirName,
  installPluginFromRequest,
  parsePluginInstallUrl,
  PluginInstallLinkError,
  resolveDesktopInstalledPluginsDir,
} from './plugin-install-links'

const tempRoots: string[] = []
const installUrl = 'cradle://plugins/install?source=github&repository=wibus-wee%2FCradle&path=plugins%2Fsystem-info&package=%40cradle%2Fsystem-info&version=0.0.1&channel=bundled'

async function createTempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  tempRoots.push(root)
  return root
}

async function writePluginPackage(
  root: string,
  relativePath: string,
  packageName = '@cradle/system-info',
  serverEntry = 'dist/server.mjs',
): Promise<string> {
  const packageDir = resolve(root, relativePath)
  await mkdir(packageDir, { recursive: true })
  await writeFile(
    resolve(packageDir, 'package.json'),
    `${JSON.stringify({
      name: packageName,
      version: '0.0.1',
      type: 'module',
      cradle: {
        apiVersion: '1',
        displayName: 'System Info',
        server: serverEntry,
      },
    }, null, 2)}\n`,
    'utf8',
  )
  await mkdir(resolve(packageDir, 'dist'), { recursive: true })
  await writeFile(resolve(packageDir, 'dist/server.mjs'), 'export function activate() {}\n', 'utf8')
  return packageDir
}

async function createRepositoryArchive(): Promise<Buffer> {
  const root = await createTempRoot('cradle-plugin-archive-')
  const repoRoot = resolve(root, 'wibus-wee-Cradle-testref')
  await writePluginPackage(repoRoot, 'plugins/system-info')
  const archivePath = resolve(root, 'repo.tar.gz')
  await tar.c(
    {
      cwd: root,
      file: archivePath,
      gzip: true,
    },
    ['wibus-wee-Cradle-testref'],
  )
  return readFile(archivePath)
}

afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

describe('parsePluginInstallUrl', () => {
  it('parses the documented first-party marketplace URL contract', () => {
    expect(parsePluginInstallUrl(installUrl)).toMatchObject({
      source: 'github',
      repository: 'wibus-wee/Cradle',
      path: 'plugins/system-info',
      packageName: '@cradle/system-info',
      version: '0.0.1',
      channel: 'bundled',
      ref: 'main',
    })
  })

  it('rejects duplicate, unknown, cross-repository, and traversal parameters', () => {
    expect(() => parsePluginInstallUrl(`${installUrl}&package=%40cradle%2Fother`)).toThrow(PluginInstallLinkError)
    expect(() => parsePluginInstallUrl(`${installUrl}&token=secret`)).toThrow(PluginInstallLinkError)
    expect(() => parsePluginInstallUrl(installUrl.replace('wibus-wee%2FCradle', 'other%2FCradle'))).toThrow(PluginInstallLinkError)
    expect(() => parsePluginInstallUrl(installUrl.replace('plugins%2Fsystem-info', 'plugins%2F..%2Fsystem-info'))).toThrow(PluginInstallLinkError)
  })
})

describe('collectPluginInstallUrls', () => {
  it('collects plugin install URLs from process argv values', () => {
    expect(collectPluginInstallUrls(['--flag', installUrl, 'https://example.com'])).toEqual([installUrl])
  })
})

describe('installPluginFromRequest', () => {
  it('records an install receipt when the bundled plugin is already available', async () => {
    const userDataPath = await createTempRoot('cradle-plugin-user-data-')
    const pluginsRoot = await createTempRoot('cradle-plugin-bundled-')
    const availablePackageDir = await writePluginPackage(pluginsRoot, 'system-info', '@cradle/system-info', 'src/server.ts')
    const fetchImpl = vi.fn<typeof fetch>()

    const result = await installPluginFromRequest(parsePluginInstallUrl(installUrl), {
      availablePluginsDir: pluginsRoot,
      fetchImpl,
      now: () => new Date('2026-05-21T10:00:00.000Z'),
      userDataPath,
    })

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      mode: 'alreadyAvailable',
      packageDir: availablePackageDir,
    })
    const receipt = JSON.parse(await readFile(result.receiptPath, 'utf8')) as Record<string, unknown>
    expect(receipt).toMatchObject({
      mode: 'alreadyAvailable',
      packageName: '@cradle/system-info',
      packageDir: availablePackageDir,
    })
  })

  it('downloads a plugin into the Cradle-owned installed plugin directory when it is not bundled', async () => {
    const userDataPath = await createTempRoot('cradle-plugin-user-data-')
    const archive = await createRepositoryArchive()
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new Uint8Array(archive)))

    const result = await installPluginFromRequest(parsePluginInstallUrl(`${installUrl}&ref=testref`), {
      fetchImpl,
      now: () => new Date('2026-05-21T10:00:00.000Z'),
      userDataPath,
    })

    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(result).toMatchObject({
      mode: 'downloaded',
      packageDir: resolve(
        resolveDesktopInstalledPluginsDir(userDataPath),
        createInstalledPluginPackageDirName('@cradle/system-info'),
      ),
    })
    const packageJson = JSON.parse(await readFile(resolve(result.packageDir, 'package.json'), 'utf8')) as Record<string, unknown>
    expect(packageJson).toMatchObject({
      name: '@cradle/system-info',
      version: '0.0.1',
    })
  })

  it('rejects source-only plugin entries before publishing the install', async () => {
    const userDataPath = await createTempRoot('cradle-plugin-user-data-')
    const root = await createTempRoot('cradle-plugin-source-archive-')
    const repoRoot = resolve(root, 'wibus-wee-Cradle-source')
    await writePluginPackage(repoRoot, 'plugins/system-info', '@cradle/system-info', 'src/server.ts')
    const archivePath = resolve(root, 'repo.tar.gz')
    await tar.c(
      {
        cwd: root,
        file: archivePath,
        gzip: true,
      },
      ['wibus-wee-Cradle-source'],
    )
    const archive = await readFile(archivePath)
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(new Uint8Array(archive)))

    await expect(installPluginFromRequest(parsePluginInstallUrl(`${installUrl}&ref=source`), {
      fetchImpl,
      userDataPath,
    })).rejects.toThrow('non-runnable server entry')
  })
})
