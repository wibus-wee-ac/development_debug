#!/usr/bin/env node
// Runs the macOS preview distribution pipeline up to the non-installing distribution gate.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(scriptDir, '..')
const repoRoot = resolve(desktopRoot, '../..')
const DEFAULT_RELEASE_OUTPUT_DIR = 'release/preview-seeded-base-package'
const DEFAULT_CHANNEL = 'preview'
const DEFAULT_RELEASE_NOTES = '../../docs/for-users/preview-release-notes.md'

function printHelp() {
  console.log(`Usage: pnpm --filter @cradle/desktop release:preview-distribution -- [options]

Options:
  --version <version>             Release version. Defaults to apps/desktop/package.json version.
  --channel <name>                Velopack channel. Defaults to preview.
  --output <dir>                  Velopack output directory. Defaults to release/preview-seeded-base-package.
  --electron-output <dir>         electron-builder --dir output. Defaults to release/electron-unpacked.
  --release-notes <path>          Markdown release notes file. Defaults to ../../docs/for-users/preview-release-notes.md.
  --mac-app-sign <identity>       Developer ID Application identity used by Electron Builder. Defaults to CSC_NAME.
  --mac-installer-sign <identity> Developer ID Installer identity used to sign the post-processed macOS setup pkg.
  --mac-notary-profile <profile>  notarytool keychain profile used for app and setup pkg notarization.
  --update-url <url>              Published Velopack feed URL. Defaults to CRADLE_DESKTOP_UPDATE_URL.
  --installer-smoke <path>        Existing real /Applications installer smoke evidence to pass into verify:preview-distribution.
  --skip-build                    Reuse existing electron-vite build output.
  --skip-electron-package         Reuse existing electron-builder unpacked output.
  --skip-release                  Reuse existing release artifacts and only run distribution verification.
  --help                          Show this help text.

This command does not install into /Applications. Run
record:preview-installer-smoke separately after installing the signed and
notarized setup package on a real release smoke machine.`)
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

function isLoopbackHostname(hostname) {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname === '[::1]'
}

function assertPublicUpdateUrl(updateUrl) {
  let parsedUrl
  try {
    parsedUrl = new URL(updateUrl)
  }
  catch {
    throw new Error(`--update-url must be a valid HTTP(S) URL: ${updateUrl}`)
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error(`--update-url must use HTTP(S): ${updateUrl}`)
  }
  if (parsedUrl.protocol === 'http:' && !isLoopbackHostname(parsedUrl.hostname)) {
    throw new Error('--update-url must use HTTPS for public distribution. Plain HTTP is only allowed for localhost loopback verification.')
  }
}

function run(command, args, envOverrides = {}) {
  console.log(`$ ${[command, ...args].join(' ')}`)
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: desktopRoot,
      env: { ...process.env, ...envOverrides },
      stdio: 'inherit',
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

async function main() {
  if (hasFlag('help')) {
    printHelp()
    return
  }
  if (process.platform !== 'darwin') {
    throw new Error('macOS preview distribution must run on macOS.')
  }

  const packageJson = JSON.parse(readFileSync(resolve(desktopRoot, 'package.json'), 'utf8'))
  const version = readOption('version', packageJson.version)
  const channel = readOption('channel', DEFAULT_CHANNEL)
  const releaseOutput = readOption('output', DEFAULT_RELEASE_OUTPUT_DIR)
  const electronOutput = readOption('electron-output', 'release/electron-unpacked')
  const releaseNotes = readOption('release-notes', DEFAULT_RELEASE_NOTES)
  const macAppSignIdentity = readOption('mac-app-sign', process.env.CSC_NAME ?? '')
  const macInstallerSignIdentity = readOption('mac-installer-sign')
  const macNotaryProfile = readOption('mac-notary-profile')
  const updateUrl = readOption('update-url', process.env.CRADLE_DESKTOP_UPDATE_URL ?? '')
  const installerSmoke = readOption('installer-smoke')
  const shouldRunRelease = !hasFlag('skip-release')

  if (!updateUrl) {
    throw new Error('--update-url <url> or CRADLE_DESKTOP_UPDATE_URL is required for macOS preview distribution.')
  }
  assertPublicUpdateUrl(updateUrl)
  if (shouldRunRelease && !macInstallerSignIdentity) {
    throw new Error('--mac-installer-sign <identity> is required for macOS preview distribution.')
  }
  if (shouldRunRelease && !macNotaryProfile) {
    throw new Error('--mac-notary-profile <profile> is required for macOS preview distribution.')
  }

  if (shouldRunRelease) {
    await run(process.execPath, [
      resolve(scriptDir, 'verify-macos-distribution-credentials.mjs'),
      '--check-app-signing',
      '--check-installer-signing',
      '--check-notary-profile',
      '--check-stapler',
      '--mac-installer-sign',
      macInstallerSignIdentity,
      '--mac-notary-profile',
      macNotaryProfile,
      ...(macAppSignIdentity ? ['--mac-app-sign', macAppSignIdentity] : []),
    ])
  }

  if (shouldRunRelease) {
    const releaseArgs = [
      resolve(scriptDir, 'release-preview.mjs'),
      '--version',
      version,
      '--channel',
      channel,
      '--output',
      releaseOutput,
      '--electron-output',
      electronOutput,
      '--release-notes',
      releaseNotes,
      '--update-url',
      updateUrl,
      '--require-mac-app-signature',
      '--mac-app-notarize',
      '--mac-app-staple',
      '--mac-installer-sign',
      macInstallerSignIdentity,
      '--mac-notary-profile',
      macNotaryProfile,
      '--mac-notarize',
      '--mac-staple',
    ]
    if (macAppSignIdentity) {
      releaseArgs.push('--mac-app-sign', macAppSignIdentity)
    }
    if (hasFlag('skip-build')) {
      releaseArgs.push('--skip-build')
    }
    if (hasFlag('skip-electron-package')) {
      releaseArgs.push('--skip-electron-package')
    }
    await run(process.execPath, releaseArgs, {
      CRADLE_DESKTOP_UPDATE_URL: updateUrl,
      ...(macAppSignIdentity ? { CSC_NAME: macAppSignIdentity } : {}),
    })
  }

  const verifyArgs = [
    resolve(scriptDir, 'verify-preview-distribution.mjs'),
    '--release-dir',
    releaseOutput,
    '--electron-output',
    electronOutput,
    '--release-notes',
    resolve(desktopRoot, releaseNotes),
    '--version',
    version,
    '--channel',
    channel,
    '--update-url',
    updateUrl,
  ]
  if (installerSmoke) {
    verifyArgs.push('--installer-smoke', resolve(desktopRoot, installerSmoke))
  }
  await run(process.execPath, verifyArgs, { CRADLE_DESKTOP_UPDATE_URL: updateUrl })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
