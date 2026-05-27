import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { electronRebuildPackages } from '../../server/runtime-packages.mjs'

const electronVersion = process.env.CRADLE_ELECTRON_VERSION ?? '39.8.10'
const targetArch
  = process.env.CRADLE_ELECTRON_REBUILD_ARCH ?? process.env.npm_config_arch ?? process.arch
const serverRuntimeDir = '../server/dist'

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
    '--which-module',
    electronRebuildPackages.join(','),
    '--arch',
    targetArch,
  ],
  {
    stdio: 'inherit',
  },
)

if (result.error) {
  throw result.error
}

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

const betterSqliteRoot = join(serverRuntimeDir, 'node_modules/better-sqlite3')
const betterSqliteBinRoot = join(betterSqliteRoot, 'bin')
const betterSqliteBuildRelease = join(betterSqliteRoot, 'build/Release')
const betterSqliteDefaultBinding = join(betterSqliteBuildRelease, 'better_sqlite3.node')

if (existsSync(betterSqliteBinRoot)) {
  const binaryDir = readdirSync(betterSqliteBinRoot)
    .filter(entry => entry.startsWith(`${process.platform}-${targetArch}-`))
    .sort((left, right) => Number(left.split('-').at(-1)) - Number(right.split('-').at(-1)))
    .at(-1)
  const rebuiltBinding = binaryDir
    ? join(betterSqliteBinRoot, binaryDir, 'better-sqlite3.node')
    : null

  if (rebuiltBinding && existsSync(rebuiltBinding)) {
    mkdirSync(betterSqliteBuildRelease, { recursive: true })
    copyFileSync(rebuiltBinding, betterSqliteDefaultBinding)
    console.log(`Copied rebuilt better-sqlite3 binding to ${betterSqliteDefaultBinding}`)
  }
}

process.exit(0)
