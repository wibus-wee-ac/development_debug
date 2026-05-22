#!/usr/bin/env node
// Verifies whether preview artifacts are ready for signed and notarized macOS distribution.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, normalize, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(scriptDir, '..')
const repoRoot = resolve(desktopRoot, '../..')
const DEFAULT_RELEASE_DIR = resolve(desktopRoot, 'release/preview')
const DEFAULT_ELECTRON_OUTPUT_DIR = resolve(desktopRoot, 'release/electron-unpacked')
const DEFAULT_RELEASE_NOTES = resolve(repoRoot, 'docs/for-users/preview-release-notes.md')
const DEFAULT_CHANNEL = 'preview'

function printHelp() {
  console.log(`Usage: pnpm --filter @cradle/desktop verify:preview-distribution -- [options]

Options:
  --release-dir <dir>             Velopack release directory. Defaults to release/preview.
  --electron-output <dir>         electron-builder --dir output. Defaults to release/electron-unpacked.
  --app-path <path>               Packaged .app path to verify.
  --setup-pkg <path>              Additional macOS setup .pkg path to verify.
  --release-notes <path>          Preview release notes path. Defaults to docs/for-users/preview-release-notes.md.
  --installer-smoke <path>        JSON evidence from a real /Applications installer smoke test.
  --update-url <url>              Published Velopack feed URL. Defaults to CRADLE_DESKTOP_UPDATE_URL.
  --version <version>             Preview version expected in release notes and smoke evidence. Defaults to latest feed version.
  --channel <name>                Velopack channel used to find the default latest version. Defaults to preview.
  --help                          Show this help text.

This gate is intentionally stricter than local preview validation. It fails
when Velopack release artifacts are incomplete, the runtime delta verifier
cannot see an adjacent-version delta update, setup package payloads do not match
their corresponding full packages, the app or setup payload app is ad-hoc
signed, any published setup package is unsigned, notarization is not stapled,
release notes are missing, or the real installer smoke evidence is missing.
Passing this script is required before calling the preview release
distribution-ready.`)
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

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: desktopRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  }
}

function runBuffer(command, args) {
  const result = spawnSync(command, args, {
    cwd: desktopRoot,
    encoding: 'buffer',
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: result.stderr ?? Buffer.alloc(0),
    output: Buffer.concat([
      result.stdout ?? Buffer.alloc(0),
      result.stderr ?? Buffer.alloc(0),
    ]).toString('utf8').trim(),
  }
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

function findDefaultAppPath(electronOutputDir) {
  const apps = findDirectories(electronOutputDir, (_fullPath, entry) => entry === 'Cradle.app')
  return apps[0] ?? null
}

function readText(path) {
  return readFileSync(path, 'utf8')
}

function readJson(path) {
  return JSON.parse(readText(path))
}

function compareVersions(left, right) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
}

function readLatestFeedVersion(releaseDir, channel) {
  const feedPath = resolve(releaseDir, `releases.${channel}.json`)
  if (!existsSync(feedPath)) {
    return null
  }
  const feed = readJson(feedPath)
  const versions = [...new Set((feed.Assets ?? []).map(asset => asset.Version).filter(Boolean))]
  return versions.sort(compareVersions).at(-1) ?? null
}

function summarizeOutput(output) {
  const lines = output.split('\n').map(line => line.trim()).filter(Boolean)
  return lines.slice(0, 8).join('\n')
}

function checkCodeSignature(appPath) {
  if (!appPath || !existsSync(appPath)) {
    return {
      name: 'macOS app exists',
      pass: false,
      detail: appPath ? `App bundle not found: ${appPath}` : 'No app bundle path was provided or discovered.',
    }
  }

  const metadata = run('codesign', ['-dv', '--verbose=4', appPath])
  const output = metadata.output
  const signature = output.match(/^Signature=(.+)$/m)?.[1]?.trim() ?? ''
  const teamIdentifier = output.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim() ?? ''
  const isAdHoc = signature === 'adhoc'
  const hasTeam = teamIdentifier !== '' && teamIdentifier !== 'not set'

  if (isAdHoc || !hasTeam) {
    return {
      name: 'macOS app uses Developer ID signature',
      pass: false,
      detail: `Signature=${signature || '(missing)'}; TeamIdentifier=${teamIdentifier || '(missing)'}`,
    }
  }

  const verify = run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
  if (verify.status !== 0) {
    return {
      name: 'macOS app code signature verifies',
      pass: false,
      detail: summarizeOutput(verify.output),
    }
  }

  return {
    name: 'macOS app uses Developer ID signature',
    pass: true,
    detail: `Signature=${signature}; TeamIdentifier=${teamIdentifier}`,
  }
}

function checkPackageSignature(setupPkg) {
  if (!setupPkg || !existsSync(setupPkg)) {
    return {
      name: 'macOS setup package exists',
      pass: false,
      detail: setupPkg ? `Setup package not found: ${setupPkg}` : 'No setup package path was provided.',
    }
  }

  const result = run('pkgutil', ['--check-signature', setupPkg])
  const output = result.output
  const signed = result.status === 0 && !/Status:\s*no signature/i.test(output)
  const developerIdInstaller = /Developer ID Installer/i.test(output)
  if (!signed || !developerIdInstaller) {
    return {
      name: 'macOS setup package uses Developer ID Installer signature',
      pass: false,
      detail: summarizeOutput(output),
    }
  }

  return {
    name: 'macOS setup package uses Developer ID Installer signature',
    pass: true,
    detail: summarizeOutput(output),
  }
}

function checkStapledTicket(path, label) {
  if (!path || !existsSync(path)) {
    return {
      name: `${label} notarization ticket is stapled`,
      pass: false,
      detail: path ? `Path not found: ${path}` : 'No path was provided.',
    }
  }

  const result = run('xcrun', ['stapler', 'validate', path])
  if (result.status !== 0) {
    return {
      name: `${label} notarization ticket is stapled`,
      pass: false,
      detail: summarizeOutput(result.output),
    }
  }
  return {
    name: `${label} notarization ticket is stapled`,
    pass: true,
    detail: summarizeOutput(result.output),
  }
}

function collectSetupPackages({ releaseDir, channel, version, setupPkg }) {
  const packages = []
  const addPackage = ({ path, label, setupVersion = null, fullPackageFileName = null, packageId = null }) => {
    if (!path) {
      return
    }
    if (packages.some(entry => entry.path === path)) {
      return
    }
    packages.push({ path, label, setupVersion, fullPackageFileName, packageId })
  }

  try {
    const feed = readJson(resolve(releaseDir, `releases.${channel}.json`))
    const versions = listVersions(feed)
    const targetVersion = version ?? versions.at(-1)
    const targetIndex = versions.indexOf(targetVersion)
    const previousVersion = targetIndex > 0 ? versions[targetIndex - 1] : null
    const latestFull = selectAsset(feed, targetVersion, 'Full')
    const previousFull = previousVersion ? selectAsset(feed, previousVersion, 'Full') : null
    const packageId = latestFull?.PackageId ?? previousFull?.PackageId ?? 'com.cradle.app'

    if (previousVersion) {
      addPackage({
        path: resolve(releaseDir, `${packageId}-${previousVersion}-${channel}-Setup.pkg`),
        label: `previous versioned setup package (${previousVersion})`,
        setupVersion: previousVersion,
        fullPackageFileName: previousFull?.FileName ?? null,
        packageId,
      })
    }
    addPackage({
      path: resolve(releaseDir, `${packageId}-${targetVersion}-${channel}-Setup.pkg`),
      label: `latest versioned setup package (${targetVersion})`,
      setupVersion: targetVersion,
      fullPackageFileName: latestFull?.FileName ?? null,
      packageId,
    })
    addPackage({
      path: resolve(releaseDir, `${packageId}-${channel}-Setup.pkg`),
      label: 'latest generic setup package',
      setupVersion: targetVersion,
      fullPackageFileName: latestFull?.FileName ?? null,
      packageId,
    })
  }
  catch {
    // Artifact completeness reports feed shape errors. Keep signature checks focused.
  }

  addPackage({ path: setupPkg, label: 'provided setup package' })
  return packages
}

function checkPackageSignatures(setupPackages) {
  const results = setupPackages.map(({ path, label }) => ({
    path,
    label,
    result: checkPackageSignature(path),
  }))
  const failed = results.filter(entry => !entry.result.pass)
  return {
    name: 'published macOS setup packages use Developer ID Installer signatures',
    pass: failed.length === 0,
    detail: results.map(entry => [
      `${entry.result.pass ? 'PASS' : 'FAIL'} ${entry.label}`,
      entry.path,
      entry.result.detail,
    ].filter(Boolean).join('\n')).join('\n\n'),
  }
}

function checkSetupPackageStapledTickets(setupPackages) {
  const results = setupPackages.map(({ path, label }) => ({
    path,
    label,
    result: checkStapledTicket(path, `macOS ${label}`),
  }))
  const failed = results.filter(entry => !entry.result.pass)
  return {
    name: 'published macOS setup packages notarization tickets are stapled',
    pass: failed.length === 0,
    detail: results.map(entry => [
      `${entry.result.pass ? 'PASS' : 'FAIL'} ${entry.label}`,
      entry.path,
      entry.result.detail,
    ].filter(Boolean).join('\n')).join('\n\n'),
  }
}

function checkSeededSetupPackage({ setupPackage, releaseDir }) {
  const {
    path,
    label,
    fullPackageFileName,
    packageId,
  } = setupPackage
  const failures = []
  if (!existsSync(path)) {
    return {
      label,
      path,
      pass: false,
      detail: `Setup package not found: ${path}`,
    }
  }
  if (!fullPackageFileName || !packageId) {
    return {
      label,
      path,
      pass: false,
      detail: 'Setup package was not derived from a release feed full package.',
    }
  }

  const fullPackagePath = resolve(releaseDir, fullPackageFileName)
  if (!existsSync(fullPackagePath)) {
    return {
      label,
      path,
      pass: false,
      detail: `Full package not found: ${fullPackagePath}`,
    }
  }

  const tempRoot = mkdtempSync(resolve(tmpdir(), 'cradle-setup-seed-'))
  const expandedPath = resolve(tempRoot, 'expanded')
  try {
    const expanded = run('pkgutil', ['--expand-full', path, expandedPath])
    if (expanded.status !== 0) {
      return {
        label,
        path,
        pass: false,
        detail: summarizeOutput(expanded.output) || `Could not expand setup package: ${path}`,
      }
    }

    const scriptsDir = resolve(expandedPath, '1.pkg/Scripts')
    const seededPackagePath = resolve(scriptsDir, fullPackageFileName)
    const postinstallPath = resolve(scriptsDir, 'postinstall')
    const payloadAppAsarPath = resolve(expandedPath, '1.pkg/Payload/Cradle.app/Contents/Resources/app.asar')

    if (!existsSync(seededPackagePath)) {
      failures.push(`missing seeded full package: ${seededPackagePath}`)
    }
    else {
      const comparison = run('cmp', ['-s', fullPackagePath, seededPackagePath])
      if (comparison.status !== 0) {
        const expectedSize = statSync(fullPackagePath).size
        const actualSize = statSync(seededPackagePath).size
        failures.push(`seeded full package bytes do not match release output: expectedSize=${expectedSize}; actualSize=${actualSize}`)
      }
    }

    if (!existsSync(postinstallPath)) {
      failures.push(`missing postinstall script: ${postinstallPath}`)
    }
    else {
      const syntax = run('sh', ['-n', postinstallPath])
      if (syntax.status !== 0) {
        failures.push(`postinstall shell syntax failed: ${summarizeOutput(syntax.output)}`)
      }
      const postinstall = readText(postinstallPath)
      const requiredSnippets = [
        fullPackageFileName,
        packageId,
        'Library/Caches/velopack',
        'PACKAGE_DIR="$CACHE_ROOT/packages"',
        'cp "$SEEDED_PACKAGE_PATH" "$PACKAGE_DIR/$SEEDED_PACKAGE"',
      ]
      const missingSnippets = requiredSnippets.filter(snippet => !postinstall.includes(snippet))
      if (missingSnippets.length > 0) {
        failures.push(`postinstall is missing required snippets: ${missingSnippets.join(', ')}`)
      }
    }

    if (!existsSync(payloadAppAsarPath)) {
      failures.push(`missing setup payload app.asar: ${payloadAppAsarPath}`)
    }
    else {
      const fullPackageAppAsar = runBuffer('unzip', ['-p', fullPackagePath, 'lib/app/Contents/Resources/app.asar'])
      if (fullPackageAppAsar.status !== 0) {
        failures.push(summarizeOutput(fullPackageAppAsar.output) || `Could not read app.asar from ${fullPackageFileName}`)
      }
      else {
        const payloadAppAsar = readFileSync(payloadAppAsarPath)
        if (!payloadAppAsar.equals(fullPackageAppAsar.stdout)) {
          const fullPackageAppAsarSha256 = createHash('sha256').update(fullPackageAppAsar.stdout).digest('hex').toUpperCase()
          const payloadAppAsarSha256 = createHash('sha256').update(payloadAppAsar).digest('hex').toUpperCase()
          failures.push(`setup payload app.asar does not match ${fullPackageFileName}: fullPackageSHA256=${fullPackageAppAsarSha256}; payloadSHA256=${payloadAppAsarSha256}`)
        }
      }
    }
  }
  finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }

  return {
    label,
    path,
    pass: failures.length === 0,
    detail: failures.length > 0
      ? failures.join('\n')
      : `${fullPackageFileName} seeds ${packageId} Velopack package cache and matches setup payload app.asar`,
  }
}

function checkSeededSetupPackages(setupPackages, releaseDir) {
  const feedDerivedPackages = setupPackages.filter(entry => entry.fullPackageFileName && entry.packageId)
  if (feedDerivedPackages.length === 0) {
    return {
      name: 'feed-derived macOS setup packages seed full packages',
      pass: false,
      detail: 'No feed-derived setup packages could be derived from the release feed.',
    }
  }

  const results = feedDerivedPackages.map(setupPackage => checkSeededSetupPackage({
    setupPackage,
    releaseDir,
  }))
  const failed = results.filter(entry => !entry.pass)
  return {
    name: 'feed-derived macOS setup packages seed full packages',
    pass: failed.length === 0,
    detail: results.map(entry => [
      `${entry.pass ? 'PASS' : 'FAIL'} ${entry.label}`,
      entry.path,
      entry.detail,
    ].filter(Boolean).join('\n')).join('\n\n'),
  }
}

function checkSetupPayloadAppDistribution(setupPackage) {
  const { path, label } = setupPackage
  if (!existsSync(path)) {
    return {
      label,
      path,
      pass: false,
      detail: `Setup package not found: ${path}`,
    }
  }

  const tempRoot = mkdtempSync(resolve(tmpdir(), 'cradle-setup-payload-'))
  const expandedPath = resolve(tempRoot, 'expanded')
  try {
    const expanded = run('pkgutil', ['--expand-full', path, expandedPath])
    if (expanded.status !== 0) {
      return {
        label,
        path,
        pass: false,
        detail: summarizeOutput(expanded.output) || `Could not expand setup package: ${path}`,
      }
    }

    const payloadAppPath = resolve(expandedPath, '1.pkg/Payload/Cradle.app')
    const signature = checkCodeSignature(payloadAppPath)
    const stapledTicket = checkStapledTicket(payloadAppPath, `macOS ${label} payload app`)
    const failures = [
      signature.pass ? null : signature.detail,
      stapledTicket.pass ? null : stapledTicket.detail,
    ].filter(Boolean)

    return {
      label,
      path,
      pass: failures.length === 0,
      detail: failures.length > 0
        ? failures.join('\n')
        : [
            signature.detail,
            stapledTicket.detail,
          ].filter(Boolean).join('\n'),
    }
  }
  finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

function checkSetupPayloadAppDistributions(setupPackages) {
  const results = setupPackages.map(setupPackage => checkSetupPayloadAppDistribution(setupPackage))
  const failed = results.filter(entry => !entry.pass)
  return {
    name: 'published macOS setup payload apps use Developer ID signatures and stapled tickets',
    pass: failed.length === 0,
    detail: results.map(entry => [
      `${entry.pass ? 'PASS' : 'FAIL'} ${entry.label}`,
      entry.path,
      entry.detail,
    ].filter(Boolean).join('\n')).join('\n\n'),
  }
}

function collectAppArchives({ releaseDir, channel, version }) {
  const archives = []
  const addArchive = ({ path, label, appAsarEntry }) => {
    if (!path || archives.some(entry => entry.path === path && entry.appAsarEntry === appAsarEntry)) {
      return
    }
    archives.push({ path, label, appAsarEntry })
  }

  try {
    const feed = readJson(resolve(releaseDir, `releases.${channel}.json`))
    const versions = listVersions(feed)
    const targetVersion = version ?? versions.at(-1)
    const targetIndex = versions.indexOf(targetVersion)
    const previousVersion = targetIndex > 0 ? versions[targetIndex - 1] : null
    const latestFull = selectAsset(feed, targetVersion, 'Full')
    const previousFull = previousVersion ? selectAsset(feed, previousVersion, 'Full') : null
    const packageId = latestFull?.PackageId ?? previousFull?.PackageId ?? 'com.cradle.app'

    for (const [asset, label] of [
      [previousFull, `previous full package (${previousVersion})`],
      [latestFull, `latest full package (${targetVersion})`],
    ]) {
      if (!asset) {
        continue
      }
      const fileNameFailure = checkRelativeAssetFileName(asset.FileName)
      if (fileNameFailure) {
        continue
      }
      addArchive({
        path: resolve(releaseDir, asset.FileName),
        label,
        appAsarEntry: 'lib/app/Contents/Resources/app.asar',
      })
    }

    addArchive({
      path: resolve(releaseDir, `${packageId}-${channel}-Portable.zip`),
      label: 'latest portable zip',
      appAsarEntry: 'Cradle.app/Contents/Resources/app.asar',
    })
  }
  catch {
    // Artifact completeness reports feed shape errors. Keep archive checks focused.
  }

  return archives
}

function checkArchiveUpdateUrls(appArchives, updateUrl) {
  if (!updateUrl) {
    return {
      name: 'published app archives embed update URL',
      pass: false,
      detail: 'Pass --update-url or set CRADLE_DESKTOP_UPDATE_URL before verifying public distribution.',
    }
  }
  if (appArchives.length === 0) {
    return {
      name: 'published app archives embed update URL',
      pass: false,
      detail: 'No full package or portable zip archives could be derived from the release feed.',
    }
  }

  const expected = Buffer.from(updateUrl)
  const results = appArchives.map(({ path, label, appAsarEntry }) => {
    if (!existsSync(path)) {
      return {
        label,
        path,
        pass: false,
        detail: `Archive not found: ${path}`,
      }
    }
    const entry = runBuffer('unzip', ['-p', path, appAsarEntry])
    if (entry.status !== 0) {
      return {
        label,
        path,
        pass: false,
        detail: summarizeOutput(entry.output) || `Could not read ${appAsarEntry}`,
      }
    }
    if (!entry.stdout.includes(expected)) {
      return {
        label,
        path,
        pass: false,
        detail: `${appAsarEntry} does not contain ${updateUrl}. Rebuild the app archives with CRADLE_DESKTOP_UPDATE_URL set to the same published feed URL passed to this verifier.`,
      }
    }
    return {
      label,
      path,
      pass: true,
      detail: appAsarEntry,
    }
  })
  const failed = results.filter(entry => !entry.pass)
  return {
    name: 'published app archives embed update URL',
    pass: failed.length === 0,
    detail: results.map(entry => [
      `${entry.pass ? 'PASS' : 'FAIL'} ${entry.label}`,
      entry.path,
      entry.detail,
    ].filter(Boolean).join('\n')).join('\n\n'),
  }
}

function checkReleaseNotes(releaseNotesPath, version) {
  if (!releaseNotesPath || !existsSync(releaseNotesPath)) {
    return {
      name: 'preview release notes exist',
      pass: false,
      detail: releaseNotesPath ? `Release notes not found: ${releaseNotesPath}` : 'No release notes path was provided.',
    }
  }

  const text = readText(releaseNotesPath)
  const requiredPhrases = [
    version,
    'local-first',
    'incremental update',
    'diagnostics',
    'uninstall',
    'Cradle-owned',
  ]
  const missing = requiredPhrases.filter(phrase => !text.includes(phrase))
  if (missing.length > 0) {
    return {
      name: 'preview release notes cover release boundaries',
      pass: false,
      detail: `Missing phrases: ${missing.join(', ')}`,
    }
  }

  return {
    name: 'preview release notes cover release boundaries',
    pass: true,
    detail: releaseNotesPath,
  }
}

function selectAsset(feed, version, type) {
  return (feed.Assets ?? []).find(asset => asset.Version === version && asset.Type === type) ?? null
}

function listVersions(feed) {
  return [...new Set((feed.Assets ?? []).map(asset => asset.Version).filter(Boolean))]
    .sort(compareVersions)
}

function checkFileMatchesAsset(releaseDir, asset) {
  if (!asset?.FileName) {
    return 'asset is missing FileName'
  }
  const fileNameFailure = checkRelativeAssetFileName(asset.FileName)
  if (fileNameFailure) {
    return fileNameFailure
  }
  const filePath = resolve(releaseDir, asset.FileName)
  if (!existsSync(filePath)) {
    return `missing file: ${filePath}`
  }
  const file = readFileSync(filePath)
  const size = statSync(filePath).size
  if (size !== asset.Size) {
    return `size mismatch for ${asset.FileName}: file=${size}; feed=${asset.Size}`
  }
  const sha1 = createHash('sha1').update(file).digest('hex').toUpperCase()
  const sha256 = createHash('sha256').update(file).digest('hex').toUpperCase()
  if (asset.SHA1 && sha1 !== asset.SHA1) {
    return `SHA1 mismatch for ${asset.FileName}: file=${sha1}; feed=${asset.SHA1}`
  }
  if (asset.SHA256 && sha256 !== asset.SHA256) {
    return `SHA256 mismatch for ${asset.FileName}: file=${sha256}; feed=${asset.SHA256}`
  }
  return null
}

function checkArtifactExists(path, label) {
  if (!existsSync(path)) {
    return `missing ${label}: ${path}`
  }
  const size = statSync(path).size
  if (size <= 0) {
    return `${label} is empty: ${path}`
  }
  return null
}

function checkRelativeAssetFileName(fileName) {
  if (!fileName || typeof fileName !== 'string') {
    return 'asset RelativeFileName is missing'
  }
  const normalized = normalize(fileName)
  if (isAbsolute(fileName) || normalized.startsWith('..') || normalized.includes('/../')) {
    return `asset RelativeFileName must stay inside the release directory: ${fileName}`
  }
  return null
}

function checkAssetsFeedEntries({ assets, releaseDir, expectedEntries }) {
  if (!Array.isArray(assets)) {
    return ['assets feed must be a JSON array']
  }

  const failures = []
  const entries = assets.map((asset) => ({
    fileName: asset?.RelativeFileName,
    type: asset?.Type,
  }))

  for (const entry of entries) {
    const fileNameFailure = checkRelativeAssetFileName(entry.fileName)
    if (fileNameFailure) {
      failures.push(fileNameFailure)
      continue
    }
    const filePath = resolve(releaseDir, entry.fileName)
    const existsFailure = checkArtifactExists(filePath, `assets feed ${entry.type ?? '(missing type)'} entry`)
    if (existsFailure) {
      failures.push(existsFailure)
    }
  }

  for (const expected of expectedEntries) {
    const match = entries.find(entry => entry.fileName === expected.fileName && entry.type === expected.type)
    if (!match) {
      failures.push(`assets feed is missing ${expected.type} entry for ${expected.fileName}`)
    }
  }

  return failures
}

function checkReleaseArtifacts(releaseDir, channel, version) {
  const feedPath = resolve(releaseDir, `releases.${channel}.json`)
  const assetsPath = resolve(releaseDir, `assets.${channel}.json`)
  const releasesPath = resolve(releaseDir, `RELEASES-${channel}`)
  if (!existsSync(feedPath)) {
    return {
      name: 'Velopack preview release feed exists',
      pass: false,
      detail: `Missing feed: ${feedPath}`,
    }
  }
  if (!existsSync(assetsPath)) {
    return {
      name: 'Velopack preview assets feed exists',
      pass: false,
      detail: `Missing assets feed: ${assetsPath}`,
    }
  }
  if (!existsSync(releasesPath)) {
    return {
      name: 'Velopack preview RELEASES file exists',
      pass: false,
      detail: `Missing RELEASES file: ${releasesPath}`,
    }
  }

  const feed = readJson(feedPath)
  const assets = readJson(assetsPath)
  const versions = listVersions(feed)
  const latestVersion = versions.at(-1)
  const targetVersion = version ?? latestVersion
  const targetIndex = versions.indexOf(targetVersion)
  const previousVersion = targetIndex > 0 ? versions[targetIndex - 1] : null
  const latestFull = selectAsset(feed, targetVersion, 'Full')
  const latestDelta = selectAsset(feed, targetVersion, 'Delta')
  const previousFull = previousVersion ? selectAsset(feed, previousVersion, 'Full') : null
  const missing = []

  if (targetIndex === -1) {
    missing.push(`target version is not present in feed: ${targetVersion}`)
  }
  if (!latestFull) {
    missing.push(`Full asset for ${targetVersion}`)
  }
  if (!latestDelta) {
    missing.push(`Delta asset for ${targetVersion}`)
  }
  if (!previousFull) {
    missing.push('previous Full asset')
  }
  for (const asset of [latestFull, latestDelta, previousFull].filter(Boolean)) {
    const mismatch = checkFileMatchesAsset(releaseDir, asset)
    if (mismatch) {
      missing.push(mismatch)
    }
  }

  const packageId = latestFull?.PackageId ?? previousFull?.PackageId ?? 'com.cradle.app'
  const previousSetup = previousVersion
    ? resolve(releaseDir, `${packageId}-${previousVersion}-${channel}-Setup.pkg`)
    : null
  const versionedSetup = resolve(releaseDir, `${packageId}-${targetVersion}-${channel}-Setup.pkg`)
  const genericSetup = resolve(releaseDir, `${packageId}-${channel}-Setup.pkg`)
  const portableZip = resolve(releaseDir, `${packageId}-${channel}-Portable.zip`)
  const assetsFeedFailures = checkAssetsFeedEntries({
    assets,
    releaseDir,
    expectedEntries: [
      latestFull ? { fileName: latestFull.FileName, type: 'Full' } : null,
      latestDelta ? { fileName: latestDelta.FileName, type: 'Delta' } : null,
      { fileName: `${packageId}-${channel}-Setup.pkg`, type: 'Installer' },
      { fileName: `${packageId}-${channel}-Portable.zip`, type: 'Portable' },
    ].filter(Boolean),
  })
  missing.push(...assetsFeedFailures)

  for (const [artifact, label] of [
    [releasesPath, 'RELEASES file'],
    [previousSetup, 'previous versioned setup package'],
    [versionedSetup, 'latest versioned setup package'],
    [genericSetup, 'latest generic setup package'],
    [portableZip, 'latest portable zip'],
  ]) {
    if (!artifact) {
      continue
    }
    const mismatch = checkArtifactExists(artifact, label)
    if (mismatch) {
      missing.push(mismatch)
    }
  }
  if (existsSync(versionedSetup) && existsSync(genericSetup)) {
    const versionedSetupSize = statSync(versionedSetup).size
    const genericSetupSize = statSync(genericSetup).size
    if (versionedSetupSize !== genericSetupSize) {
      missing.push(`latest generic setup package size does not match versioned setup: generic=${genericSetupSize}; versioned=${versionedSetupSize}`)
    }
  }

  if (missing.length > 0) {
    return {
      name: 'Velopack preview release artifacts are complete',
      pass: false,
      detail: missing.join('\n'),
    }
  }

  return {
    name: 'Velopack preview release artifacts are complete',
    pass: true,
    detail: [
      `latest=${targetVersion}`,
      `previous=${previousVersion}`,
      `full=${latestFull.FileName} (${latestFull.Size})`,
      `delta=${latestDelta.FileName} (${latestDelta.Size})`,
      `setup=${versionedSetup.split('/').at(-1)} (${statSync(versionedSetup).size})`,
    ].join('\n'),
  }
}

function checkRuntimeDeltaGate(releaseDir, channel, version) {
  const feed = readJson(resolve(releaseDir, `releases.${channel}.json`))
  const versions = listVersions(feed)
  const targetVersion = version ?? versions.at(-1)
  const targetIndex = versions.indexOf(targetVersion)
  const fromVersion = targetIndex > 0 ? versions[targetIndex - 1] : null
  if (!fromVersion) {
    return {
      name: 'runtime delta gate has a previous version',
      pass: false,
      detail: `Feed does not contain an adjacent previous version for ${targetVersion}.`,
    }
  }

  const releaseArg = releaseDir.startsWith(desktopRoot)
    ? releaseDir.slice(desktopRoot.length + 1)
    : releaseDir
  const result = run(process.execPath, [
    resolve(desktopRoot, 'scripts/verify-preview-update.mjs'),
    '--from-version',
    fromVersion,
    '--to-version',
    targetVersion,
    '--channel',
    channel,
    '--release-dir',
    releaseArg,
  ])
  if (result.status !== 0) {
    return {
      name: 'runtime delta gate passes',
      pass: false,
      detail: summarizeOutput(result.output),
    }
  }

  let output
  try {
    output = JSON.parse(result.stdout)
  }
  catch {
    output = null
  }
  if (!output || output.deltaCount < 1) {
    return {
      name: 'runtime delta gate passes',
      pass: false,
      detail: result.stdout || 'verify-preview-update did not return JSON evidence with deltaCount >= 1.',
    }
  }

  return {
    name: 'runtime delta gate passes',
    pass: true,
    detail: `from=${fromVersion}; to=${targetVersion}; deltaCount=${output.deltaCount}`,
  }
}

function joinUrl(baseUrl, path) {
  return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString()
}

function isLoopbackHostname(hostname) {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname === '[::1]'
}

async function fetchText(url) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`)
  }
  return response.text()
}

async function readRemoteSize(url) {
  const head = await fetch(url, { method: 'HEAD', redirect: 'follow' })
  if (head.ok) {
    const contentLength = head.headers.get('content-length')
    if (contentLength && Number.isFinite(Number(contentLength))) {
      return Number(contentLength)
    }
  }

  const range = await fetch(url, {
    headers: { range: 'bytes=0-0' },
    redirect: 'follow',
  })
  if (!range.ok && range.status !== 206) {
    throw new Error(`${url} returned HTTP ${range.status}`)
  }
  const contentRange = range.headers.get('content-range')
  const total = contentRange?.match(/\/(\d+)$/)?.[1]
  if (total && Number.isFinite(Number(total))) {
    return Number(total)
  }
  const contentLength = range.headers.get('content-length')
  if (contentLength && Number.isFinite(Number(contentLength))) {
    return Number(contentLength)
  }
  throw new Error(`${url} did not expose a verifiable content length`)
}

async function readRemoteEvidence(url) {
  const size = await readRemoteSize(url)
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`)
  }
  if (!response.body) {
    throw new Error(`${url} did not return a readable response body`)
  }

  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk)
    bytes += buffer.length
    hash.update(buffer)
  }
  if (bytes !== size) {
    throw new Error(`${url} body size changed while hashing: body=${bytes}; advertised=${size}`)
  }

  return {
    size,
    sha256: hash.digest('hex').toUpperCase(),
  }
}

function readLocalArtifactEvidence(releaseDir, fileName) {
  const filePath = resolve(releaseDir, fileName)
  const file = readFileSync(filePath)
  return {
    size: file.length,
    sha256: createHash('sha256').update(file).digest('hex').toUpperCase(),
  }
}

async function checkPublishedFeed({ updateUrl, releaseDir, channel, version }) {
  if (!updateUrl) {
    return {
      name: 'published update feed URL is configured',
      pass: false,
      detail: 'Pass --update-url or set CRADLE_DESKTOP_UPDATE_URL before verifying public distribution.',
    }
  }

  let parsedUrl
  try {
    parsedUrl = new URL(updateUrl)
  }
  catch {
    return {
      name: 'published update feed URL is valid',
      pass: false,
      detail: updateUrl,
    }
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return {
      name: 'published update feed URL is HTTP(S)',
      pass: false,
      detail: updateUrl,
    }
  }
  if (parsedUrl.protocol === 'http:' && !isLoopbackHostname(parsedUrl.hostname)) {
    return {
      name: 'published update feed URL uses HTTPS for public distribution',
      pass: false,
      detail: `${updateUrl} uses plain HTTP. Only localhost loopback feeds may use HTTP for local verification.`,
    }
  }

  try {
    const localFeed = readJson(resolve(releaseDir, `releases.${channel}.json`))
    const localAssets = readJson(resolve(releaseDir, `assets.${channel}.json`))
    const remoteFeedUrl = joinUrl(updateUrl, `releases.${channel}.json`)
    const remoteAssetsUrl = joinUrl(updateUrl, `assets.${channel}.json`)
    const remoteFeed = JSON.parse(await fetchText(remoteFeedUrl))
    const remoteAssets = JSON.parse(await fetchText(remoteAssetsUrl))
    const localFeedText = JSON.stringify(localFeed)
    const remoteFeedText = JSON.stringify(remoteFeed)
    const localAssetsText = JSON.stringify(localAssets)
    const remoteAssetsText = JSON.stringify(remoteAssets)

    if (localFeedText !== remoteFeedText || localAssetsText !== remoteAssetsText) {
      return {
        name: 'published update feed matches local release feed',
        pass: false,
        detail: [
          localFeedText !== remoteFeedText ? `${remoteFeedUrl} does not match local releases.${channel}.json` : null,
          localAssetsText !== remoteAssetsText ? `${remoteAssetsUrl} does not match local assets.${channel}.json` : null,
        ].filter(Boolean).join('\n'),
      }
    }

    const latestFull = selectAsset(localFeed, version, 'Full')
    const latestDelta = selectAsset(localFeed, version, 'Delta')
    const versions = listVersions(localFeed)
    const targetIndex = versions.indexOf(version)
    const previousVersion = targetIndex > 0 ? versions[targetIndex - 1] : null
    const previousFull = previousVersion ? selectAsset(localFeed, previousVersion, 'Full') : null
    const packageId = latestFull?.PackageId ?? previousFull?.PackageId ?? 'com.cradle.app'
    const artifacts = [
      latestFull,
      latestDelta,
      previousFull,
      {
        FileName: `RELEASES-${channel}`,
        Size: statSync(resolve(releaseDir, `RELEASES-${channel}`)).size,
      },
      previousVersion
        ? {
            FileName: `${packageId}-${previousVersion}-${channel}-Setup.pkg`,
            Size: statSync(resolve(releaseDir, `${packageId}-${previousVersion}-${channel}-Setup.pkg`)).size,
          }
        : null,
      {
        FileName: `${packageId}-${version}-${channel}-Setup.pkg`,
        Size: statSync(resolve(releaseDir, `${packageId}-${version}-${channel}-Setup.pkg`)).size,
      },
      {
        FileName: `${packageId}-${channel}-Setup.pkg`,
        Size: statSync(resolve(releaseDir, `${packageId}-${channel}-Setup.pkg`)).size,
      },
      {
        FileName: `${packageId}-${channel}-Portable.zip`,
        Size: statSync(resolve(releaseDir, `${packageId}-${channel}-Portable.zip`)).size,
      },
    ].filter(Boolean)

    const mismatches = []
    for (const artifact of artifacts) {
      const localEvidence = readLocalArtifactEvidence(releaseDir, artifact.FileName)
      const remoteEvidence = await readRemoteEvidence(joinUrl(updateUrl, artifact.FileName))
      if (remoteEvidence.size !== artifact.Size || localEvidence.size !== artifact.Size) {
        mismatches.push(`${artifact.FileName}: remoteSize=${remoteEvidence.size}; localSize=${localEvidence.size}; expected=${artifact.Size}`)
        continue
      }
      if (remoteEvidence.sha256 !== localEvidence.sha256) {
        mismatches.push(`${artifact.FileName}: remoteSHA256=${remoteEvidence.sha256}; localSHA256=${localEvidence.sha256}`)
      }
    }
    if (mismatches.length > 0) {
      return {
        name: 'published update artifacts match local release bytes',
        pass: false,
        detail: mismatches.join('\n'),
      }
    }

    return {
      name: 'published update feed and artifacts are reachable',
      pass: true,
      detail: updateUrl,
    }
  }
  catch (error) {
    return {
      name: 'published update feed and artifacts are reachable',
      pass: false,
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

function checkPackagedUpdateUrl(appPath, updateUrl) {
  if (!updateUrl) {
    return {
      name: 'packaged app update URL is configured',
      pass: false,
      detail: 'Pass --update-url or set CRADLE_DESKTOP_UPDATE_URL before verifying public distribution.',
    }
  }
  if (!appPath || !existsSync(appPath)) {
    return {
      name: 'packaged app embeds published update URL',
      pass: false,
      detail: appPath ? `App bundle not found: ${appPath}` : 'No app bundle path was provided or discovered.',
    }
  }

  const appAsar = resolve(appPath, 'Contents/Resources/app.asar')
  if (!existsSync(appAsar)) {
    return {
      name: 'packaged app embeds published update URL',
      pass: false,
      detail: `app.asar not found: ${appAsar}`,
    }
  }

  const archive = readFileSync(appAsar)
  if (!archive.includes(Buffer.from(updateUrl))) {
    return {
      name: 'packaged app embeds published update URL',
      pass: false,
      detail: `${appAsar} does not contain ${updateUrl}. Rebuild the app with CRADLE_DESKTOP_UPDATE_URL set to the same published feed URL passed to this verifier.`,
    }
  }

  return {
    name: 'packaged app embeds published update URL',
    pass: true,
    detail: updateUrl,
  }
}

const SMOKE_EVIDENCE_REQUIREMENTS = {
  firstRunEvidence: {
    kind: 'cradle-preview-first-run-evidence',
    checks: [
      'launchedFromApplications',
      'cleanProfileUsed',
      'homeHasNoFakeRows',
      'missingWorkspaceGuidanceVisible',
      'workspaceCreatedOrSelected',
      'missingProviderGuidanceVisible',
      'providerConfigured',
      'mockProviderChatCompleted',
      'chatExportCompleted',
    ],
  },
  deltaUpdateEvidence: {
    kind: 'cradle-preview-delta-update-evidence',
    checks: [
      'updateUiFoundTargetVersion',
      'runtimeReportedDeltaCount',
      'deltaPackageDownloaded',
      'fullPackageFallbackNotUsed',
      'restartCompleted',
      'installedVersionAfterRestartMatchesTarget',
    ],
  },
  supportEvidence: {
    kind: 'cradle-preview-support-evidence',
    checks: [
      'supportSurfaceVisible',
      'diagnosticsExportCompleted',
      'feedbackPathVisible',
      'localFirstCopyVisible',
      'shareOrMarkdownExportCompleted',
      'dataDirectoryRevealVisible',
      'uninstallRetentionDocumented',
    ],
  },
}

function checkTypedSmokeEvidence(evidence, field, version) {
  const nested = evidence[field]
  const requirements = SMOKE_EVIDENCE_REQUIREMENTS[field]
  const failures = []
  if (!nested || typeof nested !== 'object') {
    return [`${field} is missing`]
  }
  if (nested.kind !== requirements.kind) {
    failures.push(`${field}.kind must be ${requirements.kind}`)
  }
  if (nested.passed !== true) {
    failures.push(`${field}.passed must be true`)
  }
  if (nested.expectedVersion !== version) {
    failures.push(`${field}.expectedVersion must be ${version}`)
  }
  if (field === 'deltaUpdateEvidence' && nested.toVersion !== version) {
    failures.push(`${field}.toVersion must be ${version}`)
  }
  for (const check of requirements.checks) {
    if (nested.checks?.[check] !== true) {
      failures.push(`${field}.checks.${check} must be true`)
    }
  }
  if (field === 'deltaUpdateEvidence') {
    if (!(Number(nested.metrics?.deltaCount) >= 1)) {
      failures.push(`${field}.metrics.deltaCount must be >= 1`)
    }
    if (!(Number(nested.metrics?.deltaBytes) > 0)) {
      failures.push(`${field}.metrics.deltaBytes must be > 0`)
    }
    if (!(Number(nested.metrics?.fullBytes) > Number(nested.metrics?.deltaBytes))) {
      failures.push(`${field}.metrics.fullBytes must be greater than metrics.deltaBytes`)
    }
  }
  return failures
}

function checkInstallerSmokeEvidence(installerSmokePath, version) {
  if (!installerSmokePath || !existsSync(installerSmokePath)) {
    return {
      name: 'real /Applications installer smoke evidence exists',
      pass: false,
      detail: installerSmokePath
        ? `Installer smoke evidence not found: ${installerSmokePath}`
        : 'Pass --installer-smoke with a JSON evidence file from a real /Applications install.',
    }
  }

  let evidence
  try {
    evidence = readJson(installerSmokePath)
  }
  catch (error) {
    return {
      name: 'real /Applications installer smoke evidence parses',
      pass: false,
      detail: error instanceof Error ? error.message : String(error),
    }
  }

  const requiredFields = [
    'checkedAt',
    'installerPackage',
    'installedApp',
    'installedAppExists',
    'installedVersion',
    'expectedVersion',
    'firstRunPassed',
    'deltaUpdatePassed',
    'supportLifecyclePassed',
    'uninstallPathDocumented',
    'seededBasePackage',
    'firstRunEvidence',
    'deltaUpdateEvidence',
    'supportEvidence',
    'passed',
  ]
  const missing = requiredFields.filter(field => !(field in evidence))
  const wrongVersion = evidence.installedVersion !== version
  const failedBooleans = [
    'installedAppExists',
    'firstRunPassed',
    'deltaUpdatePassed',
    'supportLifecyclePassed',
    'uninstallPathDocumented',
    'passed',
  ]
    .filter(field => evidence[field] !== true)
  const wrongExpectedVersion = evidence.expectedVersion && evidence.expectedVersion !== version
  const missingSeededBase = evidence.seededBasePackage?.exists !== true
    || evidence.seededBasePackage?.sizeMatches !== true
  const nestedEvidenceFailures = [
    ...checkTypedSmokeEvidence(evidence, 'firstRunEvidence', version),
    ...checkTypedSmokeEvidence(evidence, 'deltaUpdateEvidence', version),
    ...checkTypedSmokeEvidence(evidence, 'supportEvidence', version),
  ]

  if (
    missing.length > 0
    || wrongVersion
    || wrongExpectedVersion
    || failedBooleans.length > 0
    || missingSeededBase
    || nestedEvidenceFailures.length > 0
  ) {
    return {
      name: 'real /Applications installer smoke evidence passes',
      pass: false,
      detail: [
        missing.length > 0 ? `Missing fields: ${missing.join(', ')}` : null,
        wrongVersion ? `installedVersion=${evidence.installedVersion}; expected ${version}` : null,
        wrongExpectedVersion ? `expectedVersion=${evidence.expectedVersion}; expected ${version}` : null,
        failedBooleans.length > 0 ? `Non-passing fields: ${failedBooleans.join(', ')}` : null,
        missingSeededBase ? 'seededBasePackage does not prove the installed full package exists in the Velopack cache with matching size' : null,
        nestedEvidenceFailures.length > 0 ? `Nested evidence failures: ${nestedEvidenceFailures.join('; ')}` : null,
      ].filter(Boolean).join('\n'),
    }
  }

  return {
    name: 'real /Applications installer smoke evidence passes',
    pass: true,
    detail: installerSmokePath,
  }
}

async function main() {
  if (hasFlag('help')) {
    printHelp()
    return
  }

  const releaseDir = resolve(desktopRoot, readOption('release-dir', DEFAULT_RELEASE_DIR))
  const channel = readOption('channel', DEFAULT_CHANNEL)
  const packageJson = readJson(resolve(desktopRoot, 'package.json'))
  const version = readOption('version', readLatestFeedVersion(releaseDir, channel) ?? packageJson.version)
  const electronOutputDir = resolve(desktopRoot, readOption('electron-output', DEFAULT_ELECTRON_OUTPUT_DIR))
  const appPath = readOption('app-path', findDefaultAppPath(electronOutputDir))
  const setupPkg = resolve(desktopRoot, readOption('setup-pkg', resolve(releaseDir, 'com.cradle.app-preview-Setup.pkg')))
  const releaseNotes = resolve(repoRoot, readOption('release-notes', DEFAULT_RELEASE_NOTES))
  const updateUrl = readOption('update-url', process.env.CRADLE_DESKTOP_UPDATE_URL ?? '')
  const installerSmoke = readOption('installer-smoke')
    ? resolve(repoRoot, readOption('installer-smoke'))
    : resolve(releaseDir, 'installer-smoke.json')
  const setupPackages = collectSetupPackages({ releaseDir, channel, version, setupPkg })
  const appArchives = collectAppArchives({ releaseDir, channel, version })

  const checks = [
    checkReleaseArtifacts(releaseDir, channel, version),
    checkRuntimeDeltaGate(releaseDir, channel, version),
    await checkPublishedFeed({ updateUrl, releaseDir, channel, version }),
    checkPackagedUpdateUrl(appPath, updateUrl),
    checkArchiveUpdateUrls(appArchives, updateUrl),
    checkSeededSetupPackages(setupPackages, releaseDir),
    checkCodeSignature(appPath),
    checkSetupPayloadAppDistributions(setupPackages),
    checkPackageSignatures(setupPackages),
    checkStapledTicket(appPath, 'macOS app'),
    checkSetupPackageStapledTickets(setupPackages),
    checkReleaseNotes(releaseNotes, version),
    checkInstallerSmokeEvidence(installerSmoke, version),
  ]

  const failed = checks.filter(check => !check.pass)
  console.log(JSON.stringify({
    releaseDir,
    appPath,
    setupPkg,
    setupPackages,
    appArchives,
    releaseNotes,
    updateUrl,
    installerSmoke,
    checks,
  }, null, 2))

  if (failed.length > 0) {
    console.error(`Preview distribution gate failed: ${failed.length}/${checks.length} checks failed.`)
    process.exitCode = 1
    return
  }

  console.log('Preview distribution gate passed.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
