#!/usr/bin/env node
/**
 * Output: Creates apps/server/dist/desktop-runtime as the server-owned artifact consumed by Cradle desktop packaging.
 * Input: apps/server/dist from Vite, apps/server/package.json, and the workspace pnpm lockfile.
 * Position: Server runtime packaging boundary; desktop includes this artifact without installing or copying server internals.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
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
const desktopRuntimeExternalsPath = join(serverRoot, 'desktop-runtime.externals.json')
const desktopRuntimeExternals = JSON.parse(readFileSync(desktopRuntimeExternalsPath, 'utf8'))
const externalRuntimePackages = desktopRuntimeExternals.packages ?? []
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

pruneExternalRuntimeDependencies()
pruneDeployMetadata()
writeFileSync(
  join(tempDeployDir, 'desktop-runtime.json'),
  `${JSON.stringify(
    {
      kind: 'cradle.desktop-server-runtime',
      package: serverPackageJson.name,
      version: serverPackageJson.version,
      entry: runtimeEntry,
      bundling: {
        externalPackages: externalRuntimePackages,
      },
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
        dependencies: Object.fromEntries(
          externalRuntimePackages
            .map(packageName => [packageName, serverPackageJson.dependencies?.[packageName]])
            .filter((entry) => {
              const [, version] = entry
              return typeof version === 'string'
            }),
        ),
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
}

function pruneExternalRuntimeDependencies() {
  const nodeModulesDir = join(tempDeployDir, 'node_modules')
  const pnpmDir = join(nodeModulesDir, '.pnpm')
  if (!existsSync(nodeModulesDir) || !existsSync(pnpmDir)) {
    return
  }

  const reachablePackageRoots = new Set()
  const reachablePnpmEntries = new Set()
  const stack = []

  for (const packageName of externalRuntimePackages) {
    const packagePath = joinPackagePath(nodeModulesDir, packageName)
    if (!existsSync(packagePath)) {
      console.warn(`[desktop-runtime] External package ${packageName} was not deployed; skipping.`)
      continue
    }
    stack.push(realpathSync(packagePath))
  }

  while (stack.length > 0) {
    const packageRoot = stack.pop()
    if (!packageRoot || reachablePackageRoots.has(packageRoot)) {
      continue
    }
    reachablePackageRoots.add(packageRoot)
    const pnpmEntry = readPnpmEntryName(pnpmDir, packageRoot)
    if (pnpmEntry) {
      reachablePnpmEntries.add(pnpmEntry)
    }

    const dependenciesDir = pnpmEntry
      ? join(pnpmDir, pnpmEntry, 'node_modules')
      : join(packageRoot, 'node_modules')
    if (!existsSync(dependenciesDir)) {
      continue
    }
    for (const dependencyPath of listPackageEntries(dependenciesDir)) {
      if (!existsSync(dependencyPath)) {
        continue
      }
      const resolvedDependencyPath = realpathSync(dependencyPath)
      if (resolvedDependencyPath.startsWith(`${pnpmDir}/`)) {
        stack.push(resolvedDependencyPath)
      }
    }
  }

  pruneTopLevelNodeModules(nodeModulesDir)
  prunePnpmStore(pnpmDir, reachablePnpmEntries)
}

function joinPackagePath(root, packageName) {
  const parts = packageName.split('/')
  return join(root, ...parts)
}

function listPackageEntries(root) {
  const entries = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = join(root, entry.name)
    if (entry.name.startsWith('.')) {
      continue
    }
    if (entry.isDirectory() && entry.name.startsWith('@')) {
      for (const scopedEntry of readdirSync(entryPath, { withFileTypes: true })) {
        if (scopedEntry.isDirectory() || scopedEntry.isSymbolicLink()) {
          entries.push(join(entryPath, scopedEntry.name))
        }
      }
      continue
    }
    if (entry.isDirectory() || entry.isSymbolicLink()) {
      entries.push(entryPath)
    }
  }
  return entries
}

function readPnpmEntryName(pnpmDir, packageRoot) {
  const relativePackageRoot = relative(pnpmDir, packageRoot)
  if (relativePackageRoot.startsWith('..')) {
    return null
  }
  const [entryName] = relativePackageRoot.split(/[\\/]/)
  return entryName || null
}

function pruneTopLevelNodeModules(nodeModulesDir) {
  const allowedTopLevelPackages = new Set(externalRuntimePackages)
  for (const entry of readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (entry.name === '.pnpm') {
      continue
    }

    const entryPath = join(nodeModulesDir, entry.name)
    if (entry.name === '.bin') {
      removePath(entryPath)
      continue
    }

    if (entry.name.startsWith('@') && entry.isDirectory()) {
      for (const scopedEntry of readdirSync(entryPath, { withFileTypes: true })) {
        const packageName = `${entry.name}/${scopedEntry.name}`
        if (!allowedTopLevelPackages.has(packageName)) {
          removePath(join(entryPath, scopedEntry.name))
        }
      }
      if (readdirSync(entryPath).length === 0) {
        removePath(entryPath)
      }
      continue
    }

    if (!allowedTopLevelPackages.has(entry.name)) {
      removePath(entryPath)
    }
  }
}

function prunePnpmStore(pnpmDir, reachablePnpmEntries) {
  for (const entry of readdirSync(pnpmDir, { withFileTypes: true })) {
    const entryPath = join(pnpmDir, entry.name)
    if (entry.isFile() && entry.name === 'lock.yaml') {
      removePath(entryPath)
      continue
    }
    if (!entry.isDirectory()) {
      continue
    }
    if (!reachablePnpmEntries.has(entry.name)) {
      removePath(entryPath)
    }
  }
}

function removePath(pathToRemove) {
  if (!existsSync(pathToRemove)) {
    return
  }
  const stat = lstatSync(pathToRemove)
  rmSync(pathToRemove, {
    recursive: stat.isDirectory() && !stat.isSymbolicLink(),
    force: true,
  })
}
