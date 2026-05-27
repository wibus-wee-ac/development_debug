#!/usr/bin/env node
// Verifies that a preview Velopack feed exposes a delta-backed update path.
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { UpdateManager } from 'velopack'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(scriptDir, '..')
const DEFAULT_RELEASE_DIR = resolve(desktopRoot, 'release/preview')
const DEFAULT_CHANNEL = 'preview'

function printHelp() {
  console.log(`Usage: pnpm --filter @cradle/desktop verify:preview-update -- [options]

Options:
  --from-version <version>       Installed/base version. Defaults to 0.0.1-preview.0.
  --to-version <version>         Target version. Defaults to latest version in the feed.
  --channel <name>               Velopack channel. Defaults to preview.
  --release-dir <dir>            Velopack release directory. Defaults to release/preview.
  --keep-temp                    Keep the temporary install simulation directory.
  --help                         Show this help text.

The script creates a temporary installed-app simulation from the base full
package, keeps the base full package in the simulated packages directory, and
then asks Velopack UpdateManager to check and download the target update.`)
}

function readOption(name, fallback = null) {
  const prefix = `--${name}=`
  for (let index = 0; index < process.argv.length; index++) {
    const value = process.argv[index]
    if (value === `--${name}`) {
      return process.argv[index + 1] ?? fallback
    }
    if (value?.startsWith(prefix)) {
      return value.slice(prefix.length)
    }
  }
  return fallback
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`)
}

function findFiles(root, predicate, maxDepth = 5, depth = 0) {
  if (!existsSync(root) || depth > maxDepth) {
    return []
  }

  const matches = []
  for (const entry of readdirSync(root)) {
    const fullPath = resolve(root, entry)
    let stats
    try {
      stats = statSync(fullPath)
    }
    catch {
      continue
    }
    if (stats.isDirectory()) {
      matches.push(...findFiles(fullPath, predicate, maxDepth, depth + 1))
      continue
    }
    if (predicate(fullPath, entry, stats)) {
      matches.push(fullPath)
    }
  }
  return matches
}

function readJsonFile(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

async function run(command, args, options = {}) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? desktopRoot,
      stdio: options.stdio ?? 'inherit',
      shell: false,
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      reject(new Error(`${command} exited with code ${code}`))
    })
  })
}

function readFeed(releaseDir, channel) {
  const feedPath = resolve(releaseDir, `releases.${channel}.json`)
  if (!existsSync(feedPath)) {
    throw new Error(`Release feed not found: ${feedPath}`)
  }
  return readJsonFile(feedPath)
}

function compareVersions(left, right) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
}

function selectAsset(feed, version, type) {
  const matches = feed.Assets.filter(asset => asset.Version === version && asset.Type === type)
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${type} asset for ${version}, found ${matches.length}`)
  }
  return matches[0]
}

function selectLatestVersion(feed) {
  const versions = [...new Set(feed.Assets.map(asset => asset.Version))]
  if (versions.length === 0) {
    throw new Error('Release feed has no assets')
  }
  return versions.sort(compareVersions).at(-1)
}

function readMacLocator(root, packageId) {
  const appRoot = resolve(root, 'unpacked/lib/app')
  const manifestPath = resolve(appRoot, 'Contents/Resources/sq.version')
  const executableDir = resolve(appRoot, 'Contents/MacOS')
  const executables = findFiles(
    executableDir,
    (_fullPath, entry, stats) => stats.isFile() && entry !== 'UpdateMac' && !entry.endsWith('.__symlink'),
    1,
  )
  const executable = executables.find(path => path.endsWith('/Cradle')) ?? executables[0]

  if (!existsSync(manifestPath)) {
    throw new Error(`Velopack manifest not found: ${manifestPath}`)
  }
  if (!executable) {
    throw new Error(`App executable not found under ${executableDir}`)
  }

  return {
    RootAppDir: appRoot,
    UpdateExePath: executable,
    PackagesDir: resolve(root, 'packages'),
    ManifestPath: manifestPath,
    CurrentBinaryDir: executableDir,
    IsPortable: true,
  }
}

function readLocator(root, packageId) {
  if (process.platform === 'darwin') {
    return readMacLocator(root, packageId)
  }
  throw new Error(`Preview update verification is not implemented for ${process.platform}`)
}

async function main() {
  if (hasFlag('help')) {
    printHelp()
    return
  }

  const channel = readOption('channel', DEFAULT_CHANNEL)
  const releaseDir = resolve(desktopRoot, readOption('release-dir', DEFAULT_RELEASE_DIR))
  const fromVersion = readOption('from-version', '0.0.1-preview.0')
  const keepTemp = hasFlag('keep-temp')
  const feed = readFeed(releaseDir, channel)
  const toVersion = readOption('to-version', selectLatestVersion(feed))
  const baseFull = selectAsset(feed, fromVersion, 'Full')
  const targetFull = selectAsset(feed, toVersion, 'Full')
  const targetDeltas = feed.Assets.filter(asset => asset.Version === toVersion && asset.Type === 'Delta')

  if (targetDeltas.length === 0) {
    throw new Error(`No delta assets found for target version ${toVersion}`)
  }

  const root = await mkdtemp(resolve(tmpdir(), 'cradle-preview-update-'))
  let shouldCleanup = !keepTemp

  try {
    const basePackagePath = resolve(releaseDir, baseFull.FileName)
    const targetPackageName = targetFull.FileName
    const packagesDir = resolve(root, 'packages')

    await run('unzip', ['-qq', basePackagePath, '-d', resolve(root, 'unpacked')])
    await mkdir(packagesDir, { recursive: true })
    await copyFile(basePackagePath, resolve(packagesDir, baseFull.FileName))

    const locator = readLocator(root, baseFull.PackageId)
    const updater = new UpdateManager(releaseDir, {
      AllowVersionDowngrade: false,
      ExplicitChannel: channel,
      MaximumDeltasBeforeFallback: 10,
    }, locator)
    const update = await updater.checkForUpdatesAsync()

    if (!update) {
      throw new Error(`No update found from ${fromVersion} to ${toVersion}`)
    }
    if (updater.getCurrentVersion() !== fromVersion) {
      throw new Error(`Current version mismatch: expected ${fromVersion}, got ${updater.getCurrentVersion()}`)
    }
    if (update.TargetFullRelease.Version !== toVersion) {
      throw new Error(`Target version mismatch: expected ${toVersion}, got ${update.TargetFullRelease.Version}`)
    }
    if (update.DeltasToTarget.length === 0) {
      throw new Error(`UpdateManager returned no DeltasToTarget for ${fromVersion} -> ${toVersion}`)
    }

    await updater.downloadUpdateAsync(update)

    const downloadedTarget = resolve(packagesDir, targetPackageName)
    if (!existsSync(downloadedTarget)) {
      throw new Error(`Downloaded target package not found: ${downloadedTarget}`)
    }

    console.log(JSON.stringify({
      currentVersion: updater.getCurrentVersion(),
      appId: updater.getAppId(),
      targetVersion: update.TargetFullRelease.Version,
      fullSize: update.TargetFullRelease.Size,
      deltaCount: update.DeltasToTarget.length,
      deltaFiles: update.DeltasToTarget.map(asset => ({
        version: asset.Version,
        type: asset.Type,
        fileName: asset.FileName,
        size: asset.Size,
      })),
      downloadedPackages: readdirSync(packagesDir).filter(entry => entry.endsWith('.nupkg')).sort(),
    }, null, 2))
  }
  catch (error) {
    if (keepTemp) {
      shouldCleanup = false
      console.error(`Temporary directory kept for debugging: ${root}`)
    }
    throw error
  }
  finally {
    if (shouldCleanup) {
      await rm(root, { recursive: true, force: true })
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
