#!/usr/bin/env node
/**
 * Output: Creates apps/server/dist/desktop-runtime as the server-owned artifact consumed by Cradle desktop packaging.
 * Input: apps/server/dist from Vite, apps/server/package.json, and the workspace pnpm lockfile.
 * Position: Server runtime packaging boundary; desktop includes this artifact without installing or copying server internals.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const serverRoot = resolve(scriptDir, '..')
const repoRoot = resolve(serverRoot, '../..')
const distRoot = join(serverRoot, 'dist')
const runtimeDir = join(distRoot, 'desktop-runtime')
const tempDeployDir = join(repoRoot, 'tmp', `server-desktop-runtime-${process.pid}`)
const serverPackageJsonPath = join(serverRoot, 'package.json')
const serverPackageJson = JSON.parse(readFileSync(serverPackageJsonPath, 'utf8'))
const runtimeEntry = 'dist/main.js'

if (!existsSync(join(distRoot, 'main.js'))) {
  throw new Error(`Server bundle not found at ${join(distRoot, 'main.js')}. Run pnpm --filter @cradle/server build first.`)
}

rmSync(join(distRoot, 'node_modules'), { recursive: true, force: true })
rmSync(join(distRoot, 'package.json'), { force: true })
rmSync(tempDeployDir, { recursive: true, force: true })
rmSync(runtimeDir, { recursive: true, force: true })
mkdirSync(dirname(tempDeployDir), { recursive: true })
mkdirSync(dirname(runtimeDir), { recursive: true })

const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const result = spawnSync(
  command,
  [
    '--config.inject-workspace-packages=true',
    '--filter',
    '@cradle/server',
    'deploy',
    '--prod',
    tempDeployDir,
  ],
  {
    cwd: repoRoot,
    stdio: 'inherit',
  },
)

if (result.error) {
  throw result.error
}

if (result.status !== 0) {
  rmSync(tempDeployDir, { recursive: true, force: true })
  process.exit(result.status ?? 1)
}

if (!existsSync(join(tempDeployDir, 'node_modules'))) {
  rmSync(tempDeployDir, { recursive: true, force: true })
  throw new Error(`pnpm deploy did not create ${join(tempDeployDir, 'node_modules')}`)
}

pruneDeployMetadata()
writeFileSync(
  join(tempDeployDir, 'desktop-runtime.json'),
  `${JSON.stringify(
    {
      kind: 'cradle.desktop-server-runtime',
      package: serverPackageJson.name,
      version: serverPackageJson.version,
      entry: runtimeEntry,
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
  'utf8',
)

renameSync(tempDeployDir, runtimeDir)
console.log(`Prepared desktop server runtime at ${relative(repoRoot, runtimeDir)}`)

function pruneDeployMetadata() {
  for (const entry of [
    'README.md',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'src',
  ]) {
    rmSync(join(tempDeployDir, entry), { recursive: true, force: true })
  }

  writeFileSync(
    join(tempDeployDir, 'package.json'),
    `${JSON.stringify(
      {
        name: '@cradle/server-desktop-runtime',
        private: true,
        type: 'module',
        version: serverPackageJson.version,
        main: runtimeEntry,
        dependencies: serverPackageJson.dependencies ?? {},
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
}
