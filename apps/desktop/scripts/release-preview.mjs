#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { access, chmod, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(scriptDir, '..')
const repoRoot = resolve(desktopRoot, '../..')
const DEFAULT_ELECTRON_OUTPUT_DIR = resolve(desktopRoot, 'release/electron-unpacked')
const DEFAULT_RELEASE_OUTPUT_DIR = resolve(desktopRoot, 'release/preview')
const DEFAULT_CHANNEL = 'preview'

function printHelp() {
  console.log(`Usage: pnpm --filter @cradle/desktop release:preview -- [options]

Options:
  --version <version>             Release version. Defaults to apps/desktop/package.json version.
  --channel <name>                Velopack channel. Defaults to preview.
  --output <dir>                  Velopack output directory. Defaults to release/preview.
  --electron-output <dir>         electron-builder --dir output. Defaults to release/electron-unpacked.
  --pack-id <id>                  Velopack package id. Defaults to electron-builder appId.
  --pack-title <name>             Friendly app name. Defaults to electron-builder productName.
  --release-notes <path>          Markdown release notes file for vpk.
  --update-url <url>              Velopack feed URL embedded into the packaged app. Defaults to CRADLE_DESKTOP_UPDATE_URL.
  --mac-app-sign <identity>       Developer ID Application identity passed to Electron Builder and credential preflight.
  --mac-installer-sign <identity> Developer ID Installer identity used to sign the post-processed macOS setup pkg.
  --mac-notary-profile <profile>  notarytool keychain profile used to notarize the signed macOS setup pkg.
  --mac-app-notarize              Submit a zipped copy of the signed macOS .app to Apple notarization before Velopack packaging.
  --mac-app-staple                Staple the notarization ticket to the macOS .app before Velopack packaging.
  --mac-notarize                  Submit the signed macOS setup pkg to Apple notarization and wait for completion.
  --mac-staple                    Staple the notarization ticket to the macOS setup pkg after notarization.
  --require-mac-app-signature     Fail if the macOS .app is not Developer ID signed before Velopack packaging.
  --skip-build                    Reuse existing electron-vite build output.
  --skip-electron-package         Reuse existing electron-builder unpacked output.
  --help                          Show this help text.

The script intentionally keeps --output contents so Velopack can see previous
full packages and create delta packages for adjacent preview releases.`)
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

function assertUpdateUrl(updateUrl) {
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

function readYamlScalar(raw, key, fallback) {
  const match = raw.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? fallback
}

function parseCommand(value) {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) {
    throw new Error('VPK_COMMAND is empty')
  }
  return { command: parts[0], argsPrefix: parts.slice(1) }
}

function commandWorks(command, args) {
  const result = spawnSync(command, args, {
    cwd: desktopRoot,
    stdio: 'ignore',
    shell: false,
  })
  return result.status === 0
}

function runCapture(command, args) {
  return spawnSync(command, args, {
    cwd: desktopRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })
}

function resolveVpkRunner(velopackVersion) {
  if (process.env.VPK_COMMAND) {
    return parseCommand(process.env.VPK_COMMAND)
  }
  if (commandWorks('vpk', ['--help'])) {
    return { command: 'vpk', argsPrefix: [] }
  }
  if (commandWorks('dnx', ['--help'])) {
    return { command: 'dnx', argsPrefix: ['vpk', '--version', velopackVersion, '--'] }
  }
  throw new Error([
    'Velopack CLI was not found.',
    'Install it with `dotnet tool install -g vpk`, use `dnx`, or set VPK_COMMAND.',
    `Expected CLI version compatible with velopack ${velopackVersion}.`,
  ].join('\n'))
}

async function run(command, args, options = {}) {
  console.log(`$ ${[command, ...args].join(' ')}`)
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? desktopRoot,
      env: { ...process.env, ...options.env },
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

async function runMacDistributionCredentialPreflight({
  shouldCheckAppSigning,
  shouldCheckInstallerSigning,
  shouldCheckNotaryProfile,
  shouldCheckStapler,
  macAppSignIdentity,
  macInstallerSignIdentity,
  macNotaryProfile,
}) {
  const args = [resolve(scriptDir, 'verify-macos-distribution-credentials.mjs')]
  if (shouldCheckAppSigning) {
    args.push('--check-app-signing')
  }
  if (shouldCheckInstallerSigning) {
    args.push('--check-installer-signing')
  }
  if (shouldCheckNotaryProfile) {
    args.push('--check-notary-profile')
  }
  if (shouldCheckStapler) {
    args.push('--check-stapler')
  }
  if (macAppSignIdentity) {
    args.push('--mac-app-sign', macAppSignIdentity)
  }
  if (macInstallerSignIdentity) {
    args.push('--mac-installer-sign', macInstallerSignIdentity)
  }
  if (macNotaryProfile) {
    args.push('--mac-notary-profile', macNotaryProfile)
  }

  await run(process.execPath, args)
}

function findDirectories(root, predicate, maxDepth = 5, depth = 0) {
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
    if (!stats.isDirectory()) {
      continue
    }
    if (predicate(fullPath, entry)) {
      matches.push(fullPath)
    }
    matches.push(...findDirectories(fullPath, predicate, maxDepth, depth + 1))
  }
  return matches
}

function findFiles(root, predicate, maxDepth = 3, depth = 0) {
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

function isExecutable(stats) {
  return (stats.mode & 0o111) !== 0
}

function readMacExecutableName(appBundlePath, productName) {
  const executableDir = resolve(appBundlePath, 'Contents/MacOS')
  const executables = findFiles(
    executableDir,
    (_fullPath, _entry, stats) => stats.isFile() && isExecutable(stats),
    1,
  )
  const preferred = executables.find(file => file.endsWith(`/${productName}`))
  const selected = preferred ?? executables[0]
  if (!selected) {
    throw new Error(`No executable found in ${executableDir}`)
  }
  return selected.split('/').at(-1)
}

function readRootExecutableName(packDir, productName) {
  const executableNames = findFiles(
    packDir,
    (_fullPath, entry, stats) => stats.isFile() && isExecutable(stats) && !entry.endsWith('.so'),
    1,
  ).map(file => file.split('/').at(-1))

  const preferred = executableNames.find(name => name === productName || name === productName.toLowerCase())
  const selected = preferred ?? executableNames[0]
  if (!selected) {
    throw new Error(`No executable found in ${packDir}`)
  }
  return selected
}

function resolvePackInput(electronOutputDir, productName) {
  if (process.platform === 'darwin') {
    const apps = findDirectories(electronOutputDir, (_fullPath, entry) => entry.endsWith('.app'))
    const preferred = apps.find(path => path.endsWith(`/${productName}.app`))
    const packDir = preferred ?? apps[0]
    if (!packDir) {
      throw new Error(`No .app bundle found under ${electronOutputDir}`)
    }
    return { packDir, mainExe: readMacExecutableName(packDir, productName) }
  }

  if (process.platform === 'win32') {
    const unpackedDirs = findDirectories(electronOutputDir, (_fullPath, entry) => entry.endsWith('win-unpacked'))
    const packDir = unpackedDirs[0]
    if (!packDir) {
      throw new Error(`No win-unpacked directory found under ${electronOutputDir}`)
    }
    const executable = resolve(packDir, `${productName}.exe`)
    return { packDir, mainExe: existsSync(executable) ? `${productName}.exe` : readRootExecutableName(packDir, productName) }
  }

  const linuxDirs = findDirectories(electronOutputDir, (_fullPath, entry) => entry.endsWith('linux-unpacked'))
  const packDir = linuxDirs[0]
  if (!packDir) {
    throw new Error(`No linux-unpacked directory found under ${electronOutputDir}`)
  }
  return { packDir, mainExe: readRootExecutableName(packDir, productName) }
}

function assertMacAppDistributionSignature(appBundlePath) {
  const verify = runCapture('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appBundlePath])
  if (verify.status !== 0) {
    throw new Error([
      'macOS app code signature verification failed.',
      `App bundle: ${appBundlePath}`,
      `${verify.stdout ?? ''}${verify.stderr ?? ''}`.trim(),
    ].filter(Boolean).join('\n'))
  }

  const metadata = runCapture('codesign', ['-dv', '--verbose=4', appBundlePath])
  const output = `${metadata.stdout ?? ''}${metadata.stderr ?? ''}`
  const signature = output.match(/^Signature=(.+)$/m)?.[1]?.trim() ?? ''
  const teamIdentifier = output.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim() ?? ''
  const isAdHoc = signature === 'adhoc'
  const hasTeam = teamIdentifier !== '' && teamIdentifier !== 'not set'

  if (metadata.status !== 0 || isAdHoc || !hasTeam) {
    throw new Error([
      'macOS distribution packaging requires the .app to be Developer ID signed before Velopack packaging.',
      `App bundle: ${appBundlePath}`,
      `Signature=${signature || '(missing)'}`,
      `TeamIdentifier=${teamIdentifier || '(missing)'}`,
      'Configure Electron Builder mac signing credentials, rebuild the unpacked app, then rerun release:preview.',
    ].join('\n'))
  }

  console.log([
    'Verified macOS app distribution signature.',
    `App bundle: ${appBundlePath}`,
    `Signature: ${signature}`,
    `TeamIdentifier: ${teamIdentifier}`,
  ].join('\n'))
}

function assertMacAppUpdateUrl(appBundlePath, updateUrl) {
  const appAsarPath = resolve(appBundlePath, 'Contents/Resources/app.asar')
  if (!existsSync(appAsarPath)) {
    throw new Error(`Packaged app.asar was not found: ${appAsarPath}`)
  }

  const appAsar = readFileSync(appAsarPath)
  if (!appAsar.includes(Buffer.from(updateUrl))) {
    throw new Error([
      'macOS distribution packaging requires the packaged .app to embed the published update URL before Velopack packaging.',
      `App bundle: ${appBundlePath}`,
      `app.asar: ${appAsarPath}`,
      `Expected update URL: ${updateUrl}`,
      'Rebuild without --skip-build and --skip-electron-package, or reuse only artifacts built with the same CRADLE_DESKTOP_UPDATE_URL.',
    ].join('\n'))
  }
}

function validateVersion(version) {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Z.-]+)?$/i.test(version)) {
    throw new Error(`Velopack requires a SemVer2-compatible version, got: ${version}`)
  }
  if (/^\d+\.\d+\.\d+\.\d+/.test(version)) {
    throw new Error(`Velopack does not support four-part versions, got: ${version}`)
  }
}

function quoteForPostinstallScript(value) {
  return `'${String(value).replaceAll('\'', '\'\\\'\'')}'`
}

function resolveReleaseFile(releaseOutputDir, fileName) {
  const filePath = resolve(releaseOutputDir, fileName)
  if (existsSync(filePath)) {
    return filePath
  }
  const candidates = existsSync(releaseOutputDir) ? readdirSync(releaseOutputDir).sort() : []
  throw new Error([
    `Expected release artifact was not found: ${fileName}`,
    `Output directory: ${releaseOutputDir}`,
    `Available files: ${candidates.length > 0 ? candidates.join(', ') : '(none)'}`,
  ].join('\n'))
}

function createMacPostinstallScript({ packId, packageName }) {
  return `#!/bin/sh
set -eu

APP_ID=${quoteForPostinstallScript(packId)}
SEEDED_PACKAGE=${quoteForPostinstallScript(packageName)}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SEEDED_PACKAGE_PATH="$SCRIPT_DIR/$SEEDED_PACKAGE"

if [ ! -f "$SEEDED_PACKAGE_PATH" ]; then
  echo "Missing seeded Velopack package: $SEEDED_PACKAGE_PATH" >&2
  exit 1
fi

INSTALL_USER="\${USER:-}"
if [ -z "$INSTALL_USER" ] || [ "$INSTALL_USER" = "root" ]; then
  INSTALL_USER="$(stat -f '%Su' /dev/console 2>/dev/null || true)"
fi

rm -rf "/tmp/velopack/$APP_ID"

if [ -n "$INSTALL_USER" ] && [ "$INSTALL_USER" != "root" ]; then
  USER_HOME="$(dscl . -read "/Users/$INSTALL_USER" NFSHomeDirectory 2>/dev/null | sed 's/^NFSHomeDirectory: //' || true)"
  if [ -z "$USER_HOME" ]; then
    USER_HOME="/Users/$INSTALL_USER"
  fi

  CACHE_ROOT="$USER_HOME/Library/Caches/velopack/$APP_ID"
  PACKAGE_DIR="$CACHE_ROOT/packages"
  rm -rf "$CACHE_ROOT"
  mkdir -p "$PACKAGE_DIR"
  cp "$SEEDED_PACKAGE_PATH" "$PACKAGE_DIR/$SEEDED_PACKAGE"
  chown -R "$INSTALL_USER" "$CACHE_ROOT"
  sudo -u "$INSTALL_USER" env HOME="$USER_HOME" VELOPACK_FIRSTRUN=1 open "$2/Cradle.app/"
else
  CACHE_ROOT="\${HOME:-/var/root}/Library/Caches/velopack/$APP_ID"
  PACKAGE_DIR="$CACHE_ROOT/packages"
  rm -rf "$CACHE_ROOT"
  mkdir -p "$PACKAGE_DIR"
  cp "$SEEDED_PACKAGE_PATH" "$PACKAGE_DIR/$SEEDED_PACKAGE"
  env VELOPACK_FIRSTRUN=1 open "$2/Cradle.app/"
fi

exit 0
`
}

async function signMacSetupPackage({ packagePath, identity }) {
  const signedPath = `${packagePath}.signed`
  await rm(signedPath, { force: true })
  await run('productsign', ['--sign', identity, packagePath, signedPath])
  await copyFile(signedPath, packagePath)
  await rm(signedPath, { force: true })
}

async function notarizeMacSetupPackage({ packagePath, keychainProfile }) {
  const args = ['notarytool', 'submit', packagePath, '--wait']
  if (keychainProfile) {
    args.push('--keychain-profile', keychainProfile)
  }
  await run('xcrun', args)
}

async function stapleMacSetupPackage(packagePath) {
  await run('xcrun', ['stapler', 'staple', packagePath])
  await run('xcrun', ['stapler', 'validate', packagePath])
}

async function notarizeMacAppBundle({ appBundlePath, keychainProfile }) {
  const tempRoot = await mkdtemp(resolve(tmpdir(), 'cradle-preview-app-notary.'))
  const archivePath = resolve(tempRoot, 'Cradle.app.zip')

  try {
    await run('ditto', ['-c', '-k', '--keepParent', appBundlePath, archivePath])
    const args = ['notarytool', 'submit', archivePath, '--wait']
    if (keychainProfile) {
      args.push('--keychain-profile', keychainProfile)
    }
    await run('xcrun', args)
  }
  finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

async function stapleMacAppBundle(appBundlePath) {
  await run('xcrun', ['stapler', 'staple', appBundlePath])
  await run('xcrun', ['stapler', 'validate', appBundlePath])
}

async function postprocessMacSetupPackage({
  releaseOutputDir,
  packId,
  version,
  channel,
  macInstallerSignIdentity,
  macNotaryProfile,
  shouldNotarize,
  shouldStaple,
}) {
  const fullPackageName = `${packId}-${version}-${channel}-full.nupkg`
  const setupPackageName = `${packId}-${channel}-Setup.pkg`
  const versionedSetupPackageName = `${packId}-${version}-${channel}-Setup.pkg`
  const fullPackagePath = resolveReleaseFile(releaseOutputDir, fullPackageName)
  const setupPackagePath = resolveReleaseFile(releaseOutputDir, setupPackageName)
  const versionedSetupPackagePath = resolve(releaseOutputDir, versionedSetupPackageName)
  const tempRoot = await mkdtemp(resolve(tmpdir(), 'cradle-preview-pkg.'))
  const expandedPath = resolve(tempRoot, 'expanded')
  const repackedPath = resolve(tempRoot, setupPackageName)

  try {
    await run('pkgutil', ['--expand-full', setupPackagePath, expandedPath])

    const postinstallPath = findFiles(
      expandedPath,
      (_fullPath, entry, stats) => stats.isFile() && entry === 'postinstall',
      5,
    )[0]
    if (!postinstallPath) {
      throw new Error(`Expanded setup package does not contain a postinstall script: ${setupPackagePath}`)
    }

    const scriptsDir = dirname(postinstallPath)
    await copyFile(fullPackagePath, resolve(scriptsDir, fullPackageName))
    await writeFile(postinstallPath, createMacPostinstallScript({ packId, packageName: fullPackageName }), 'utf8')
    await chmod(postinstallPath, 0o755)
    await run('pkgutil', ['--flatten', expandedPath, repackedPath])
    await copyFile(repackedPath, setupPackagePath)

    if (macInstallerSignIdentity) {
      await signMacSetupPackage({ packagePath: setupPackagePath, identity: macInstallerSignIdentity })
    }
    else if (shouldNotarize || shouldStaple) {
      throw new Error('macOS setup package notarization/stapling requires --mac-installer-sign <identity>')
    }

    if (shouldNotarize) {
      await notarizeMacSetupPackage({ packagePath: setupPackagePath, keychainProfile: macNotaryProfile })
    }
    if (shouldStaple) {
      await stapleMacSetupPackage(setupPackagePath)
    }

    await copyFile(setupPackagePath, versionedSetupPackagePath)

    console.log([
      'Seeded macOS setup package with the current full Velopack package.',
      `Setup package: ${setupPackagePath}`,
      `Versioned copy: ${versionedSetupPackagePath}`,
      `Seeded package: ${fullPackageName}`,
      macInstallerSignIdentity ? `Installer signature: ${macInstallerSignIdentity}` : 'Installer signature: not requested',
      shouldNotarize ? 'Installer notarization: submitted and accepted' : 'Installer notarization: not requested',
      shouldStaple ? 'Installer stapling: complete' : 'Installer stapling: not requested',
    ].join('\n'))
  }
  finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

async function main() {
  if (hasFlag('help')) {
    printHelp()
    return
  }

  const packageJson = JSON.parse(await readFile(resolve(desktopRoot, 'package.json'), 'utf8'))
  const builderConfigRaw = await readFile(resolve(desktopRoot, 'electron-builder.yml'), 'utf8')
  const productName = readOption('pack-title', readYamlScalar(builderConfigRaw, 'productName', 'Cradle'))
  const packId = readOption('pack-id', readYamlScalar(builderConfigRaw, 'appId', 'com.cradle.app'))
  const version = readOption('version', packageJson.version)
  const channel = readOption('channel', DEFAULT_CHANNEL)
  const releaseOutputDir = resolve(desktopRoot, readOption('output', DEFAULT_RELEASE_OUTPUT_DIR))
  const electronOutputDir = resolve(desktopRoot, readOption('electron-output', DEFAULT_ELECTRON_OUTPUT_DIR))
  const releaseNotes = readOption('release-notes')
  const updateUrl = readOption('update-url', process.env.CRADLE_DESKTOP_UPDATE_URL ?? '')
  const macAppSignIdentity = readOption('mac-app-sign', process.env.CSC_NAME ?? '')
  const macInstallerSignIdentity = readOption('mac-installer-sign')
  const macNotaryProfile = readOption('mac-notary-profile')
  const shouldNotarizeMacApp = hasFlag('mac-app-notarize')
  const shouldStapleMacApp = hasFlag('mac-app-staple')
  const shouldNotarize = hasFlag('mac-notarize')
  const shouldStaple = hasFlag('mac-staple')
  const shouldRequireMacAppSignature = hasFlag('require-mac-app-signature')
    || Boolean(macAppSignIdentity)
    || Boolean(macInstallerSignIdentity)
    || shouldNotarizeMacApp
    || shouldStapleMacApp
    || shouldNotarize
    || shouldStaple
  const velopackVersion = packageJson.dependencies?.velopack ?? packageJson.devDependencies?.velopack

  validateVersion(version)
  if (!velopackVersion) {
    throw new Error('apps/desktop/package.json does not declare velopack')
  }
  if (updateUrl) {
    assertUpdateUrl(updateUrl)
  }
  if (shouldRequireMacAppSignature && !updateUrl) {
    throw new Error('--update-url <url> or CRADLE_DESKTOP_UPDATE_URL is required for macOS preview distribution packaging.')
  }
  if ((shouldNotarizeMacApp || shouldNotarize) && !macNotaryProfile) {
    throw new Error('macOS notarization requires --mac-notary-profile <profile>')
  }
  if ((shouldNotarize || shouldStaple) && !macInstallerSignIdentity) {
    throw new Error('macOS setup package notarization/stapling requires --mac-installer-sign <identity>')
  }
  if (shouldStaple && !shouldNotarize) {
    throw new Error('macOS setup package stapling requires --mac-notarize in the same release-preview run')
  }
  if (process.platform === 'darwin') {
    const shouldCheckAppSigningCredentials = Boolean(macAppSignIdentity)
      || Boolean(macInstallerSignIdentity)
      || shouldNotarizeMacApp
      || shouldStapleMacApp
      || shouldNotarize
      || shouldStaple
    const shouldCheckInstallerSigningCredentials = Boolean(macInstallerSignIdentity) || shouldNotarize || shouldStaple
    const shouldCheckNotaryProfileCredentials = shouldNotarizeMacApp || shouldNotarize
    const shouldCheckStaplerTool = shouldStapleMacApp || shouldStaple

    if (shouldCheckAppSigningCredentials || shouldCheckInstallerSigningCredentials || shouldCheckNotaryProfileCredentials || shouldCheckStaplerTool) {
      await runMacDistributionCredentialPreflight({
        shouldCheckAppSigning: shouldCheckAppSigningCredentials,
        shouldCheckInstallerSigning: shouldCheckInstallerSigningCredentials,
        shouldCheckNotaryProfile: shouldCheckNotaryProfileCredentials,
        shouldCheckStapler: shouldCheckStaplerTool,
        macAppSignIdentity,
        macInstallerSignIdentity,
        macNotaryProfile,
      })
    }
  }

  if (!hasFlag('skip-build')) {
    await run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['build'], {
      env: {
        ...(updateUrl ? { CRADLE_DESKTOP_UPDATE_URL: updateUrl } : {}),
        ...(macAppSignIdentity ? { CSC_NAME: macAppSignIdentity } : {}),
      },
    })
  }

  if (!hasFlag('skip-electron-package')) {
    await run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', [
      'exec',
      'electron-builder',
      '--dir',
      `--config.directories.output=${electronOutputDir}`,
    ], {
      env: macAppSignIdentity ? { CSC_NAME: macAppSignIdentity } : {},
    })
  }

  const { packDir, mainExe } = resolvePackInput(electronOutputDir, productName)
  if (process.platform === 'darwin' && shouldRequireMacAppSignature) {
    assertMacAppUpdateUrl(packDir, updateUrl)
    assertMacAppDistributionSignature(packDir)
  }
  if (process.platform === 'darwin' && shouldNotarizeMacApp) {
    await notarizeMacAppBundle({ appBundlePath: packDir, keychainProfile: macNotaryProfile })
  }
  if (process.platform === 'darwin' && shouldStapleMacApp) {
    await stapleMacAppBundle(packDir)
  }

  const vpk = resolveVpkRunner(velopackVersion)
  const packArgs = [
    ...vpk.argsPrefix,
    'pack',
    '--packId',
    packId,
    '--packVersion',
    version,
    '--packDir',
    packDir,
    '--mainExe',
    mainExe,
    '--packTitle',
    productName,
    '--channel',
    channel,
    '--outputDir',
    releaseOutputDir,
    '--delta',
    'BestSpeed',
  ]

  if (process.platform === 'darwin') {
    packArgs.push('--bundleId', packId)
  }
  if (process.platform === 'linux') {
    const iconPath = resolve(repoRoot, 'build/icon.png')
    await access(iconPath)
    packArgs.push('--icon', iconPath)
  }
  if (releaseNotes) {
    packArgs.push('--releaseNotes', resolve(desktopRoot, releaseNotes))
  }

  await run(vpk.command, packArgs)

  if (process.platform === 'darwin') {
    await postprocessMacSetupPackage({
      releaseOutputDir,
      packId,
      version,
      channel,
      macInstallerSignIdentity,
      macNotaryProfile,
      shouldNotarize,
      shouldStaple,
    })
  }

  console.log([
    'Velopack preview release complete.',
    `Output: ${releaseOutputDir}`,
    `Channel: ${channel}`,
    `Version: ${version}`,
    `Pack dir: ${packDir}`,
    `Main executable: ${mainExe}`,
  ].join('\n'))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
