import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { serverRuntimePackages } from '../runtime-packages.mjs'

const require = createRequire(import.meta.url)

const distRoot = fileURLToPath(new URL('../dist/', import.meta.url))
const distNodeModules = join(distRoot, 'node_modules')

rmSync(distNodeModules, { recursive: true, force: true })

const dependencies = Object.fromEntries(
  serverRuntimePackages.map(packageName => [packageName, readInstalledVersion(packageName)]),
)

writeFileSync(
  join(distRoot, 'package.json'),
  `${JSON.stringify(
    {
      name: '@cradle/server-runtime',
      private: true,
      type: 'module',
      dependencies,
    },
    null,
    2,
  )}\n`,
  'utf8',
)

const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const result = spawnSync(
  command,
  [
    'install',
    '--prod',
    '--no-lockfile',
    '--dir',
    distRoot,
    '--package-import-method',
    'copy',
    '--config.node-linker=hoisted',
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

function readInstalledVersion(packageName) {
  const packageJsonPath = findPackageJsonPath(packageName)
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  return packageJson.version
}

function findPackageJsonPath(packageName) {
  try {
    return require.resolve(`${packageName}/package.json`)
  }
 catch {
    let currentDir = dirname(require.resolve(packageName))

    while (currentDir !== dirname(currentDir)) {
      const candidate = join(currentDir, 'package.json')
      if (existsSync(candidate)) {
        const packageJson = JSON.parse(readFileSync(candidate, 'utf8'))
        if (packageJson.name === packageName) {
          return candidate
        }
      }
      currentDir = dirname(currentDir)
    }
  }

  throw new Error(`Cannot find package.json for ${packageName}`)
}
