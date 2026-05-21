import { spawnSync } from 'node:child_process'

const electronVersion = process.env.CRADLE_ELECTRON_VERSION ?? '39.8.10'
const targetArch = process.env.CRADLE_ELECTRON_REBUILD_ARCH ?? process.env.npm_config_arch ?? process.arch

const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const result = spawnSync(command, [
  'exec',
  'electron-rebuild',
  '--version',
  electronVersion,
  '--module-dir',
  '../server/dist',
  '--which-module',
  'better-sqlite3,node-pty',
  '--arch',
  targetArch,
], {
  stdio: 'inherit',
})

if (result.error) {
  throw result.error
}

process.exit(result.status ?? 1)
