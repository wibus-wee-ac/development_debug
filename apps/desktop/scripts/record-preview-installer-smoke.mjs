#!/usr/bin/env node
// Records machine-readable evidence from a real /Applications preview installer smoke test.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(scriptDir, '..')
const DEFAULT_RELEASE_DIR = resolve(desktopRoot, 'release/preview')
const DEFAULT_CHANNEL = 'preview'
const DEFAULT_INSTALLED_APP = '/Applications/Cradle.app'

function printHelp() {
  console.log(`Usage: pnpm --filter @cradle/desktop record:preview-installer-smoke -- [options]

Options:
  --release-dir <dir>                 Velopack release directory. Defaults to release/preview.
  --channel <name>                    Velopack channel. Defaults to preview.
  --setup-pkg <path>                  macOS setup .pkg path. Defaults to <release-dir>/com.cradle.app-preview-Setup.pkg.
  --installed-app <path>              Installed app path. Defaults to /Applications/Cradle.app.
  --version <version>                 Expected installed version. Defaults to latest feed version.
  --output <path>                     Smoke evidence path. Defaults to <release-dir>/installer-smoke.json.
  --first-run-evidence <path>         JSON evidence whose top-level passed field must be true.
  --delta-update-evidence <path>      JSON evidence whose top-level passed field must be true.
  --support-evidence <path>           JSON evidence whose top-level passed field must be true.
  --write-evidence-templates <dir>    Write first-run, delta-update, and support evidence templates, then exit.
  --install                           Run the macOS installer before recording evidence.
  --confirm-applications-write        Required with --install because installer writes to /Applications.
  --help                              Show this help text.

This script does not mark first-run or delta-update checks as passed by itself.
Provide explicit evidence JSON files for those checks, or the generated smoke
record remains non-passing and verify:preview-distribution will continue to fail.`)
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

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function readText(path) {
  return readFileSync(path, 'utf8')
}

function compareVersions(left, right) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
}

function readFeed(releaseDir, channel) {
  const feedPath = resolve(releaseDir, `releases.${channel}.json`)
  if (!existsSync(feedPath)) {
    throw new Error(`Release feed not found: ${feedPath}`)
  }
  return readJson(feedPath)
}

function readLatestFeedVersion(releaseDir, channel) {
  const feed = readFeed(releaseDir, channel)
  const versions = [...new Set((feed.Assets ?? []).map(asset => asset.Version).filter(Boolean))]
  const latest = versions.sort(compareVersions).at(-1)
  if (!latest) {
    throw new Error(`Release feed has no versions: ${releaseDir}`)
  }
  return latest
}

function selectAsset(feed, version, type) {
  return (feed.Assets ?? []).find(asset => asset.Version === version && asset.Type === type) ?? null
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

function readInstalledVersion(installedApp) {
  const candidates = [
    resolve(installedApp, 'Contents/Resources/sq.version'),
    resolve(installedApp, 'Contents/MacOS/sq.version'),
    ...findFiles(installedApp, (_fullPath, entry) => entry === 'sq.version', 4),
  ]
  const versionFile = candidates.find(path => existsSync(path))
  if (!versionFile) {
    return { version: null, versionFile: null }
  }
  const raw = readText(versionFile)
  const version = raw.match(/<version>([^<]+)<\/version>/)?.[1] ?? null
  return { version, versionFile }
}

function buildEvidenceTemplates({ releaseDir, channel, setupPkg, installedApp, version }) {
  const base = {
    checkedAt: new Date().toISOString(),
    releaseDir,
    channel,
    setupPkg,
    installedApp,
    expectedVersion: version,
    passed: false,
  }

  return {
    'first-run-evidence.template.json': {
      ...base,
      kind: 'cradle-preview-first-run-evidence',
      summary: 'Replace every false value with evidence from a real /Applications first-run smoke test.',
      checks: {
        launchedFromApplications: false,
        cleanProfileUsed: false,
        homeHasNoFakeRows: false,
        missingWorkspaceGuidanceVisible: false,
        workspaceCreatedOrSelected: false,
        missingProviderGuidanceVisible: false,
        providerConfigured: false,
        mockProviderChatCompleted: false,
        chatExportCompleted: false,
      },
      notes: [],
    },
    'delta-update-evidence.template.json': {
      ...base,
      kind: 'cradle-preview-delta-update-evidence',
      summary: 'Replace every false value with evidence from a real /Applications update from the previous preview version to expectedVersion.',
      fromVersion: null,
      toVersion: version,
      checks: {
        updateUiFoundTargetVersion: false,
        runtimeReportedDeltaCount: false,
        deltaPackageDownloaded: false,
        fullPackageFallbackNotUsed: false,
        restartCompleted: false,
        installedVersionAfterRestartMatchesTarget: false,
      },
      metrics: {
        deltaCount: null,
        deltaBytes: null,
        fullBytes: null,
      },
      notes: [],
    },
    'support-evidence.template.json': {
      ...base,
      kind: 'cradle-preview-support-evidence',
      summary: 'Replace every false value with evidence from the installed /Applications app support, feedback, share, and uninstall surfaces.',
      checks: {
        supportSurfaceVisible: false,
        diagnosticsExportCompleted: false,
        feedbackPathVisible: false,
        localFirstCopyVisible: false,
        shareOrMarkdownExportCompleted: false,
        dataDirectoryRevealVisible: false,
        uninstallRetentionDocumented: false,
      },
      notes: [],
    },
  }
}

async function writeEvidenceTemplates({ outputDir, releaseDir, channel, setupPkg, installedApp, version }) {
  const templates = buildEvidenceTemplates({ releaseDir, channel, setupPkg, installedApp, version })
  await mkdir(outputDir, { recursive: true })
  for (const [fileName, template] of Object.entries(templates)) {
    await writeFile(resolve(outputDir, fileName), `${JSON.stringify(template, null, 2)}\n`, 'utf8')
  }
  console.log(JSON.stringify({
    outputDir,
    files: Object.keys(templates).map(fileName => resolve(outputDir, fileName)),
  }, null, 2))
}

const EVIDENCE_REQUIREMENTS = {
  firstRun: {
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
  deltaUpdate: {
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
  support: {
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

function validateTypedEvidence(data, type, version) {
  const requirements = EVIDENCE_REQUIREMENTS[type]
  const failures = []
  if (data.kind !== requirements.kind) {
    failures.push(`kind must be ${requirements.kind}`)
  }
  if (data.passed !== true) {
    failures.push('top-level passed must be true')
  }
  if (data.expectedVersion !== version) {
    failures.push(`expectedVersion must be ${version}`)
  }
  if (type === 'deltaUpdate' && data.toVersion !== version) {
    failures.push(`toVersion must be ${version}`)
  }
  for (const check of requirements.checks) {
    if (data.checks?.[check] !== true) {
      failures.push(`checks.${check} must be true`)
    }
  }
  if (type === 'deltaUpdate') {
    if (!(Number(data.metrics?.deltaCount) >= 1)) {
      failures.push('metrics.deltaCount must be >= 1')
    }
    if (!(Number(data.metrics?.deltaBytes) > 0)) {
      failures.push('metrics.deltaBytes must be > 0')
    }
    if (!(Number(data.metrics?.fullBytes) > Number(data.metrics?.deltaBytes))) {
      failures.push('metrics.fullBytes must be greater than metrics.deltaBytes')
    }
  }
  return failures
}

function readPassingEvidence(path, type, version) {
  if (!path) {
    return { passed: false, path: null, reason: 'not provided' }
  }
  const resolvedPath = resolve(path)
  if (!existsSync(resolvedPath)) {
    return { passed: false, path: resolvedPath, reason: 'not found' }
  }
  try {
    const data = readJson(resolvedPath)
    const failures = validateTypedEvidence(data, type, version)
    return {
      passed: failures.length === 0,
      path: resolvedPath,
      summary: data.summary ?? null,
      kind: data.kind ?? null,
      failures,
      reason: failures.length === 0 ? null : failures.join('; '),
    }
  }
  catch (error) {
    return {
      passed: false,
      path: resolvedPath,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: desktopRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed:\n${result.stdout ?? ''}${result.stderr ?? ''}`)
  }
}

async function main() {
  if (hasFlag('help')) {
    printHelp()
    return
  }

  const releaseDir = resolve(desktopRoot, readOption('release-dir', DEFAULT_RELEASE_DIR))
  const channel = readOption('channel', DEFAULT_CHANNEL)
  const setupPkg = resolve(desktopRoot, readOption('setup-pkg', resolve(releaseDir, 'com.cradle.app-preview-Setup.pkg')))
  const installedApp = readOption('installed-app', DEFAULT_INSTALLED_APP)
  const version = readOption('version', readLatestFeedVersion(releaseDir, channel))
  const outputPath = resolve(desktopRoot, readOption('output', resolve(releaseDir, 'installer-smoke.json')))
  const shouldInstall = hasFlag('install')
  const evidenceTemplateDir = readOption('write-evidence-templates')

  if (shouldInstall && !hasFlag('confirm-applications-write')) {
    throw new Error('--install writes to /Applications and requires --confirm-applications-write')
  }
  if (!existsSync(setupPkg)) {
    throw new Error(`Setup package not found: ${setupPkg}`)
  }
  if (evidenceTemplateDir) {
    await writeEvidenceTemplates({
      outputDir: resolve(desktopRoot, evidenceTemplateDir),
      releaseDir,
      channel,
      setupPkg,
      installedApp,
      version,
    })
    return
  }
  if (shouldInstall) {
    run('/usr/sbin/installer', ['-pkg', setupPkg, '-target', '/'])
  }

  const feed = readFeed(releaseDir, channel)
  const targetFull = selectAsset(feed, version, 'Full')
  const targetDelta = selectAsset(feed, version, 'Delta')
  const cachePackagePath = targetFull
    ? resolve(homedir(), 'Library/Caches/velopack/com.cradle.app/packages', targetFull.FileName)
    : null
  const cachePackageExists = cachePackagePath ? existsSync(cachePackagePath) : false
  const cachePackageSize = cachePackageExists ? statSync(cachePackagePath).size : null
  const installedAppExists = existsSync(installedApp)
  const { version: installedVersion, versionFile } = installedAppExists
    ? readInstalledVersion(installedApp)
    : { version: null, versionFile: null }

  const firstRunEvidence = readPassingEvidence(readOption('first-run-evidence'), 'firstRun', version)
  const deltaUpdateEvidence = readPassingEvidence(readOption('delta-update-evidence'), 'deltaUpdate', version)
  const supportEvidence = readPassingEvidence(readOption('support-evidence'), 'support', version)
  const uninstallPathDocumented = existsSync(resolve(desktopRoot, '../../docs/for-users/data-model-and-storage.md'))
    && existsSync(resolve(desktopRoot, '../../docs/for-users/troubleshooting.md'))

  const evidence = {
    checkedAt: new Date().toISOString(),
    installerPackage: setupPkg,
    installedApp,
    installedAppExists,
    installedVersion,
    expectedVersion: version,
    versionFile,
    firstRunPassed: firstRunEvidence.passed,
    deltaUpdatePassed: deltaUpdateEvidence.passed,
    supportLifecyclePassed: supportEvidence.passed,
    uninstallPathDocumented,
    seededBasePackage: {
      expectedFileName: targetFull?.FileName ?? null,
      expectedSize: targetFull?.Size ?? null,
      cachePackagePath,
      exists: cachePackageExists,
      size: cachePackageSize,
      sizeMatches: targetFull ? cachePackageSize === targetFull.Size : false,
    },
    feed: {
      releaseDir,
      channel,
      targetFull: targetFull
        ? { fileName: targetFull.FileName, size: targetFull.Size }
        : null,
      targetDelta: targetDelta
        ? { fileName: targetDelta.FileName, size: targetDelta.Size }
        : null,
    },
    firstRunEvidence,
    deltaUpdateEvidence,
    supportEvidence,
    passed: installedAppExists
      && installedVersion === version
      && firstRunEvidence.passed
      && deltaUpdateEvidence.passed
      && supportEvidence.passed
      && uninstallPathDocumented
      && cachePackageExists
      && (targetFull ? cachePackageSize === targetFull.Size : false),
  }

  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(evidence, null, 2))

  if (!evidence.passed) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
