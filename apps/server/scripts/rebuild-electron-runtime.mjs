#!/usr/bin/env node
/**
 * Output: Rebuilds bundled server native dependencies for Cradle desktop's Electron runtime.
 * Input: apps/server/dist/desktop-runtime plus the target Electron version from CRADLE_ELECTRON_VERSION or apps/desktop/package.json.
 * Position: Server-owned desktop runtime artifact preparation; desktop packaging consumes the artifact without mutating it.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const serverRoot = resolve(scriptDir, '..')
const repoRoot = resolve(serverRoot, '../..')
const serverRuntimeDir = resolve(serverRoot, 'dist/desktop-runtime')
const serverRuntimeNodeModules = join(serverRuntimeDir, 'node_modules')
const electronVersion = process.env.CRADLE_ELECTRON_VERSION ?? readDesktopElectronVersion()
const targetArch
  = process.env.CRADLE_ELECTRON_REBUILD_ARCH ?? process.env.npm_config_arch ?? process.arch

if (!existsSync(join(serverRuntimeDir, 'package.json')) || !existsSync(serverRuntimeNodeModules)) {
  throw new Error(
    `Server desktop runtime not found at ${serverRuntimeDir}. `
    + 'Run pnpm --filter @cradle/server build:desktop-runtime to prepare it.',
  )
}

const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const result = spawnSync(
  command,
  [
    'exec',
    'electron-rebuild',
    '--version',
    electronVersion,
    '--module-dir',
    serverRuntimeDir,
    '--arch',
    targetArch,
    '--force',
    '--build-from-source',
  ],
  {
    cwd: serverRoot,
    stdio: 'inherit',
  },
)

if (result.error) {
  throw result.error
}

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

writeElectronRuntimeTarget()

process.exit(0)

function readDesktopElectronVersion() {
  const desktopPackageJsonPath = resolve(repoRoot, 'apps/desktop/package.json')
  const packageJson = JSON.parse(readFileSync(desktopPackageJsonPath, 'utf8'))
  const versionRange = packageJson.devDependencies?.electron ?? packageJson.dependencies?.electron

  if (typeof versionRange !== 'string') {
    throw new Error(`Cannot find desktop Electron version in ${desktopPackageJsonPath}`)
  }

  const version = versionRange.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/)?.[0]
  if (!version) {
    throw new Error(`Cannot parse desktop Electron version "${versionRange}" from ${desktopPackageJsonPath}`)
  }
  return version
}

function writeElectronRuntimeTarget() {
  const manifestPath = join(serverRuntimeDir, 'desktop-runtime.json')
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8'))
    : {}

  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        ...manifest,
        electron: {
          version: electronVersion,
          arch: targetArch,
          platform: process.platform,
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
}
