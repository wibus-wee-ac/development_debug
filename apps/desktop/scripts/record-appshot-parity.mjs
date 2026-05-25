/*
 * Output: Manual Appshot parity evidence captured from Codex UI observation and Cradle native Appshot.
 * Input: A frontmost macOS window, optional user-triggered Codex UI Appshot, and the cradle-mac-bridge binary.
 * Position: Desktop scripts own local evidence collection for macOS native runtime parity work.
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(scriptDir, '..')
const workspaceRoot = resolve(desktopRoot, '../..')
const packageRoot = resolve(desktopRoot, 'native/macos/mac-bridge')
const codexResearchResourceRoot = resolve(workspaceRoot, '../safe-research/codex-app-resources-20260525')
const codexTmpRoot = resolve(tmpdir(), 'com.openai.sky.CUAService')
const maxAssetBytes = 25 * 1024 * 1024
const codexAppshotSoundCandidates = [
  '/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/Codex Computer Use.app/Contents/Resources/Package_Appshot.bundle/Contents/Resources/Appshot.wav',
  '/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/Codex Computer Use.app/Contents/SharedSupport/CUALockScreenGuardian.app/Contents/Resources/Package_Appshot.bundle/Contents/Resources/Appshot.wav',
  resolve(codexResearchResourceRoot, 'Resources/plugins/openai-bundled/plugins/computer-use/Codex Computer Use.app/Contents/Resources/Package_Appshot.bundle/Contents/Resources/Appshot.wav'),
  resolve(codexResearchResourceRoot, 'Resources/plugins/openai-bundled/plugins/computer-use/Codex Computer Use.app/Contents/SharedSupport/CUALockScreenGuardian.app/Contents/Resources/Package_Appshot.bundle/Contents/Resources/Appshot.wav'),
]
const defaultAppshotAnimationDurationSeconds = 0.88

function parseArgs(argv) {
  const options = {
    binaryPath: null,
    outputDir: null,
    destinationFrame: null,
    extractFrames: false,
    frameRate: 30,
    analyzeVideo: false,
    codexSource: 'observe',
    observeSeconds: 8,
    observePollIntervalMs: 250,
    alignmentConsecutiveFrameCount: 2,
    alignmentSsimThreshold: 0.985,
    recordingBackend: 'auto',
    recordVideo: false,
    recordingSeconds: 3,
    requireProvenParity: false,
    requestId: `cradle-appshot-parity-${Date.now()}`,
    soundEnabled: true,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--') {
      continue
    }
    if (arg === '--binary') {
      options.binaryPath = readRequiredArg(arg, next)
      index += 1
    }
    else if (arg === '--output') {
      options.outputDir = readRequiredArg(arg, next)
      index += 1
    }
    else if (arg === '--destination-frame') {
      options.destinationFrame = parseRectArg(readRequiredArg(arg, next))
      index += 1
    }
    else if (arg === '--codex-source') {
      options.codexSource = readRequiredArg(arg, next)
      index += 1
    }
    else if (arg === '--observe-seconds') {
      options.observeSeconds = Number.parseFloat(readRequiredArg(arg, next))
      index += 1
    }
    else if (arg === '--observe-poll-interval-ms') {
      options.observePollIntervalMs = Number.parseInt(readRequiredArg(arg, next), 10)
      index += 1
    }
    else if (arg === '--alignment-ssim-threshold') {
      options.alignmentSsimThreshold = Number.parseFloat(readRequiredArg(arg, next))
      index += 1
    }
    else if (arg === '--alignment-consecutive-frame-count') {
      options.alignmentConsecutiveFrameCount = Number.parseInt(readRequiredArg(arg, next), 10)
      index += 1
    }
    else if (arg === '--extract-frames') {
      options.extractFrames = true
    }
    else if (arg === '--analyze-video') {
      options.analyzeVideo = true
    }
    else if (arg === '--frame-rate') {
      options.frameRate = Number.parseFloat(readRequiredArg(arg, next))
      index += 1
    }
    else if (arg === '--record-video') {
      options.recordVideo = true
    }
    else if (arg === '--recording-backend') {
      options.recordingBackend = readRequiredArg(arg, next)
      index += 1
    }
    else if (arg === '--recording-seconds') {
      options.recordingSeconds = Number.parseFloat(readRequiredArg(arg, next))
      index += 1
    }
    else if (arg === '--require-proven-parity') {
      options.requireProvenParity = true
    }
    else if (arg === '--request-id') {
      options.requestId = readRequiredArg(arg, next)
      index += 1
    }
    else if (arg === '--no-sound') {
      options.soundEnabled = false
    }
    else if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    }
    else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (options.codexSource !== 'observe') {
    throw new Error('--codex-source only supports observe. The direct Codex private Apple Event adapter has been removed from Mac Bridge.')
  }
  if (!Number.isFinite(options.observeSeconds) || options.observeSeconds <= 0) {
    throw new Error('--observe-seconds must be a positive number.')
  }
  if (!Number.isInteger(options.observePollIntervalMs) || options.observePollIntervalMs < 50) {
    throw new Error('--observe-poll-interval-ms must be an integer greater than or equal to 50.')
  }
  if (!Number.isFinite(options.alignmentSsimThreshold) || options.alignmentSsimThreshold <= 0 || options.alignmentSsimThreshold >= 1) {
    throw new Error('--alignment-ssim-threshold must be greater than 0 and less than 1.')
  }
  if (!Number.isInteger(options.alignmentConsecutiveFrameCount) || options.alignmentConsecutiveFrameCount <= 0) {
    throw new Error('--alignment-consecutive-frame-count must be a positive integer.')
  }
  if (!Number.isFinite(options.recordingSeconds) || options.recordingSeconds <= 0) {
    throw new Error('--recording-seconds must be a positive number.')
  }
  if (!Number.isFinite(options.frameRate) || options.frameRate <= 0) {
    throw new Error('--frame-rate must be a positive number.')
  }
  if (!['auto', 'screen-capture-kit-window', 'core-graphics-window-polling', 'screen-capture-kit-display', 'screencapture', 'ffmpeg-avfoundation'].includes(options.recordingBackend)) {
    throw new Error('--recording-backend must be auto, screen-capture-kit-window, core-graphics-window-polling, screen-capture-kit-display, screencapture, or ffmpeg-avfoundation.')
  }
  return options
}

function readRequiredArg(name, value) {
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value.`)
  }
  return value
}

function printUsage() {
  console.log([
    'Usage: pnpm --filter @cradle/desktop record:appshot-parity -- [options]',
    '',
    'Options:',
    '  --binary <path>       Use a specific cradle-mac-bridge binary.',
    '  --output <dir>        Write the parity report into this directory.',
    '  --destination-frame <x,y,width,height>',
    '                        Override the synthetic composer destination frame.',
    '  --request-id <id>     Use a deterministic report request id.',
    '  --codex-source <mode>  observe only. Default: observe.',
    '  --observe-seconds <seconds>',
    '                        Window for observing Codex temp assets. Default: 8.',
    '  --observe-poll-interval-ms <ms>',
    '                        Poll interval for stopping observe after Codex temp assets appear. Default: 250.',
    '  --alignment-ssim-threshold <number>',
    '                        SSIM threshold for detecting transition onset from extracted frames. Default: 0.985.',
    '  --alignment-consecutive-frame-count <number>',
    '                        Consecutive changed frames required for transition onset. Default: 2.',
    '  --record-video        Record whole-screen .mov evidence around each transition.',
    '  --recording-backend <backend>',
    '                        auto, screen-capture-kit-window, core-graphics-window-polling, screen-capture-kit-display, screencapture, or ffmpeg-avfoundation. Default: auto.',
    '  --recording-seconds <seconds>',
    '                        Video duration for each transition. Default: 3.',
    '  --require-proven-parity',
    '                        Exit non-zero after writing the report unless all parity gates pass.',
    '  --extract-frames      Extract PNG frames from recorded videos with ffmpeg.',
    '  --analyze-video       Run ffmpeg SSIM/PSNR comparison between recorded videos.',
    '  --frame-rate <fps>    Frame extraction rate. Default: 30.',
    '  --no-sound           Disable the Cradle native Appshot sound during capture.',
  ].join('\n'))
}

function parseRectArg(value) {
  const parts = value.split(',').map(part => Number.parseFloat(part.trim()))
  if (parts.length !== 4 || parts.some(part => !Number.isFinite(part)) || parts[2] <= 0 || parts[3] <= 0) {
    throw new Error('--destination-frame must be x,y,width,height with positive width and height.')
  }
  return {
    x: parts[0],
    y: parts[1],
    width: parts[2],
    height: parts[3],
  }
}

function readDefaultOutputDir() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return resolve(workspaceRoot, 'docs/manual-reports', `${stamp}-appshot-parity`)
}

async function readExistingBridgeBinary(explicitPath) {
  if (explicitPath) {
    return resolve(explicitPath)
  }
  const candidates = [
    resolve(packageRoot, '.build/cradle-dist/cradle-mac-bridge'),
    resolve(packageRoot, '.build/release/cradle-mac-bridge'),
    resolve(packageRoot, '.build/debug/cradle-mac-bridge'),
  ]
  for (const candidate of candidates) {
    if (await isExecutableFile(candidate)) {
      return candidate
    }
  }
  return candidates[0]
}

async function isExecutableFile(filePath) {
  try {
    const metadata = await stat(filePath)
    return metadata.isFile()
  }
  catch {
    return false
  }
}

class BridgeClient {
  constructor(binaryPath) {
    this.binaryPath = binaryPath
    this.nextId = 1
    this.pending = new Map()
    this.events = []
    this.child = null
    this.stdout = null
  }

  start() {
    this.child = spawn(this.binaryPath, [], {
      cwd: workspaceRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.stdout = createInterface({ input: this.child.stdout })
    this.stdout.on('line', line => this.handleLine(line))
    this.child.stderr.on('data', data => process.stderr.write(`[mac-bridge] ${data.toString()}`))
    this.child.once('exit', (code, signal) => {
      const error = new Error(`cradle-mac-bridge exited with code=${code} signal=${signal}`)
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer)
        pending.reject(error)
      }
      this.pending.clear()
    })
  }

  async stop() {
    if (!this.child) {
      return
    }
    const child = this.child
    this.child = null
    this.stdout?.close()
    if (child.exitCode !== null || child.signalCode !== null) {
      return
    }
    await new Promise((resolveStop) => {
      const timer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL')
        }
        resolveStop()
      }, 2_000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolveStop()
      })
      child.kill('SIGTERM')
    })
  }

  request(method, params = {}, timeoutMs = 30_000) {
    if (!this.child?.stdin.writable) {
      throw new Error('cradle-mac-bridge is not running.')
    }
    const id = String(this.nextId)
    this.nextId += 1
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        rejectRequest(new Error(`Mac Bridge request timed out: ${method}`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: resolveRequest,
        reject: rejectRequest,
        timer,
      })
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
    })
  }

  handleLine(line) {
    if (!line.trim()) {
      return
    }
    let payload
    try {
      payload = JSON.parse(line)
    }
    catch {
      return
    }
    if (payload.id && this.pending.has(payload.id)) {
      const pending = this.pending.get(payload.id)
      this.pending.delete(payload.id)
      clearTimeout(pending.timer)
      if (payload.error) {
        const error = new Error(payload.error.message ?? 'Mac Bridge request failed.')
        error.code = payload.error.code
        error.details = payload.error.details
        pending.reject(error)
        return
      }
      pending.resolve(payload.result)
      return
    }
    if (payload.method) {
      this.events.push(payload)
    }
  }
}

async function copyCodexAssetPath(sourcePath, reportDir, label) {
  const resolvedSourcePath = await realpath(sourcePath)
  const resolvedRootPath = await realpath(codexTmpRoot)
  const unsafeRelativePath = relative(resolvedRootPath, resolvedSourcePath)
  if (unsafeRelativePath.startsWith('..') || isAbsolute(unsafeRelativePath)) {
    throw new Error(`Refusing to read Codex asset outside ${codexTmpRoot}: ${sourcePath}`)
  }
  const metadata = await stat(resolvedSourcePath)
  if (!metadata.isFile()) {
    throw new Error(`Codex asset is not a file: ${sourcePath}`)
  }
  if (metadata.size > maxAssetBytes) {
    throw new Error(`Codex asset is too large: ${sourcePath}`)
  }
  const extension = readImageExtension(resolvedSourcePath)
  const outputPath = resolve(reportDir, 'assets', `${label}${extension}`)
  await mkdir(dirname(outputPath), { recursive: true })
  await copyFile(resolvedSourcePath, outputPath)
  const fileEvidence = await readFileEvidence(outputPath)
  return {
    sourcePath: resolvedSourcePath,
    copiedPath: outputPath,
    relativePath: relative(reportDir, outputPath),
    size: metadata.size,
    ...fileEvidence,
  }
}

async function copyCradleAsset(sourcePath, reportDir, label) {
  const resolvedSourcePath = await realpath(sourcePath)
  const metadata = await stat(resolvedSourcePath)
  if (!metadata.isFile()) {
    throw new Error(`Cradle asset is not a file: ${sourcePath}`)
  }
  const extension = readImageExtension(resolvedSourcePath)
  const outputPath = resolve(reportDir, 'assets', `${label}${extension}`)
  await mkdir(dirname(outputPath), { recursive: true })
  await copyFile(resolvedSourcePath, outputPath)
  const fileEvidence = await readFileEvidence(outputPath)
  return {
    sourcePath: resolvedSourcePath,
    copiedPath: outputPath,
    relativePath: relative(reportDir, outputPath),
    size: metadata.size,
    ...fileEvidence,
  }
}

async function copyBinaryEvidenceAsset(sourcePath, reportDir, label) {
  const resolvedSourcePath = await realpath(sourcePath)
  const metadata = await stat(resolvedSourcePath)
  if (!metadata.isFile()) {
    throw new Error(`Evidence asset is not a file: ${sourcePath}`)
  }
  if (metadata.size > maxAssetBytes) {
    throw new Error(`Evidence asset is too large: ${sourcePath}`)
  }
  const extension = extname(resolvedSourcePath).toLowerCase() || '.bin'
  const outputPath = resolve(reportDir, 'assets', `${label}${extension}`)
  await mkdir(dirname(outputPath), { recursive: true })
  await copyFile(resolvedSourcePath, outputPath)
  const fileEvidence = await readFileEvidence(outputPath)
  return {
    sourcePath: resolvedSourcePath,
    copiedPath: outputPath,
    relativePath: relative(reportDir, outputPath),
    size: metadata.size,
    ...fileEvidence,
  }
}

async function readFileEvidence(filePath) {
  const data = await readFile(filePath)
  const image = readImageDimensions(data, filePath)
  return {
    sha256: createHash('sha256').update(data).digest('hex'),
    image,
  }
}

function readImageDimensions(data, filePath) {
  const extension = extname(filePath).toLowerCase()
  if (extension === '.png' && data.length >= 24 && data.toString('ascii', 1, 4) === 'PNG') {
    return {
      format: 'png',
      width: data.readUInt32BE(16),
      height: data.readUInt32BE(20),
    }
  }
  if ((extension === '.jpg' || extension === '.jpeg') && data.length >= 4) {
    const dimensions = readJpegDimensions(data)
    if (dimensions) {
      return dimensions
    }
  }
  return null
}

async function readAppshotSoundEvidence(reportDir, binaryPath) {
  const codexPath = await readFirstExistingFile(codexAppshotSoundCandidates)
  const cradlePath = await readFirstExistingFile(readCradleAppshotSoundCandidates(binaryPath))
  const codex = codexPath ? await copyAudioEvidence(codexPath, reportDir, 'codex-appshot-sound') : null
  const cradle = cradlePath ? await copyAudioEvidence(cradlePath, reportDir, 'cradle-appshot-sound') : null
  return {
    codex,
    cradle,
    byteIdentical: Boolean(codex && cradle && codex.sha256 === cradle.sha256 && codex.size === cradle.size),
    metadataComparable: Boolean(codex?.audio && cradle?.audio),
    metadataIdentical: Boolean(codex?.audio && cradle?.audio && areSameAudioMetadata(codex.audio, cradle.audio)),
  }
}

async function readAppshotVisibilityProbeEvidence(rawProbe, reportDir) {
  if (!rawProbe) {
    return null
  }
  const samples = []
  for (const sample of rawProbe.samples ?? []) {
    let imageEvidence = null
    if (typeof sample.imagePath === 'string' && sample.imagePath) {
      try {
        const resolvedImagePath = await realpath(sample.imagePath)
        const resolvedReportDir = await realpath(reportDir)
        const unsafeRelativePath = relative(resolvedReportDir, resolvedImagePath)
        if (!unsafeRelativePath.startsWith('..') && !isAbsolute(unsafeRelativePath)) {
          const metadata = await stat(resolvedImagePath)
          imageEvidence = {
            path: resolvedImagePath,
            relativePath: unsafeRelativePath,
            size: metadata.size,
            ...await readFileEvidence(resolvedImagePath),
          }
        }
      }
      catch (error) {
        imageEvidence = {
          error: serializeError(error),
        }
      }
    }
    samples.push({
      ...sample,
      imageEvidence,
    })
  }
  return {
    ...rawProbe,
    samples,
    summary: summarizeVisibilityProbeSamples(samples),
  }
}

async function readAppshotPresentationProbeEvidence(rawProbe, reportDir) {
  if (!rawProbe) {
    return null
  }
  const samples = []
  for (const sample of rawProbe.samples ?? []) {
    samples.push({
      ...sample,
      imageEvidence: await readSafeProbeImageEvidence(sample.imagePath, reportDir),
    })
  }
  return {
    ...rawProbe,
    samples,
    summary: summarizePresentationProbeSamples(samples),
  }
}

async function readSafeProbeImageEvidence(imagePath, reportDir) {
  if (typeof imagePath !== 'string' || !imagePath) {
    return null
  }
  try {
    const resolvedImagePath = await realpath(imagePath)
    const resolvedReportDir = await realpath(reportDir)
    const unsafeRelativePath = relative(resolvedReportDir, resolvedImagePath)
    if (unsafeRelativePath.startsWith('..') || isAbsolute(unsafeRelativePath)) {
      return {
        error: {
          message: 'Probe image path is outside the report directory.',
          code: 'probe-image-outside-report',
          details: {
            imagePath: resolvedImagePath,
            reportDir: resolvedReportDir,
          },
        },
      }
    }
    const metadata = await stat(resolvedImagePath)
    return {
      path: resolvedImagePath,
      relativePath: unsafeRelativePath,
      size: metadata.size,
      ...await readFileEvidence(resolvedImagePath),
    }
  }
  catch (error) {
    return {
      error: serializeError(error),
    }
  }
}

function summarizeVisibilityProbeSamples(samples) {
  const hashes = new Set(samples.map(sample => sample.imageEvidence?.sha256).filter(Boolean))
  return {
    sampleCount: samples.length,
    panelFoundCount: samples.filter(sample => sample.panelFoundInCoreGraphicsWindowList).length,
    imageWrittenCount: samples.filter(sample => sample.imageStatus === 'written').length,
    uniqueImageHashCount: hashes.size,
    firstImageHash: samples.find(sample => sample.imageEvidence?.sha256)?.imageEvidence?.sha256 ?? null,
    lastImageHash: [...samples].reverse().find(sample => sample.imageEvidence?.sha256)?.imageEvidence?.sha256 ?? null,
  }
}

function summarizePresentationProbeSamples(samples) {
  const hashes = new Set(samples.map(sample => sample.imageEvidence?.sha256).filter(Boolean))
  const snapshotFrames = samples
    .map(sample => sample.snapshotFrame)
    .filter(Boolean)
  const firstSnapshotFrame = snapshotFrames[0] ?? null
  const lastSnapshotFrame = snapshotFrames[snapshotFrames.length - 1] ?? null
  const changedSnapshotFrameCount = snapshotFrames.filter(frame => !areSameRect(frame, firstSnapshotFrame)).length
  const shadowFrameChangeCounts = {
    shadow: countChangedRects(samples.map(sample => sample.shadowFrame).filter(Boolean)),
    destination: countChangedRects(samples.map(sample => sample.destinationShadowFrame).filter(Boolean)),
    key: countChangedRects(samples.map(sample => sample.keyShadowFrame).filter(Boolean)),
    ambient: countChangedRects(samples.map(sample => sample.ambientShadowFrame).filter(Boolean)),
  }
  const whiteLayerEvidence = summarizeWhiteLayerEvidence(samples)
  const nativeGeometryEvidence = summarizeNativePresentationGeometryEvidence(samples)
  const snapshotContentEvidence = summarizeSnapshotContentEvidence(samples)
  const opacitySamples = samples.map(sample => ({
    transitionBackgroundOpacity: readFiniteProbeNumber(sample.transitionBackgroundOpacity),
    shutterOpacity: readFiniteProbeNumber(sample.shutterOpacity),
    snapshotImageOpacity: readFiniteProbeNumber(sample.snapshotImageOpacity),
    appIconOpacity: readFiniteProbeNumber(sample.appIconOpacity),
    titleOpacity: readFiniteProbeNumber(sample.titleOpacity),
  }))
  const opacityKeys = [
    'transitionBackgroundOpacity',
    'shutterOpacity',
    'snapshotImageOpacity',
    'appIconOpacity',
    'titleOpacity',
  ]
  const changedOpacityKeys = opacityKeys.filter((key) => {
    const values = opacitySamples.map(sample => sample[key]).filter(value => value !== null)
    if (values.length <= 1) {
      return false
    }
    const first = values[0]
    return values.some(value => Math.abs(value - first) > 0.0001)
  })
  return {
    sampleCount: samples.length,
    imageWrittenCount: samples.filter(sample => sample.imageStatus === 'written').length,
    uniqueImageHashCount: hashes.size,
    firstImageHash: samples.find(sample => sample.imageEvidence?.sha256)?.imageEvidence?.sha256 ?? null,
    lastImageHash: [...samples].reverse().find(sample => sample.imageEvidence?.sha256)?.imageEvidence?.sha256 ?? null,
    changedSnapshotFrameCount,
    shadowFrameChangeCounts,
    whiteLayerEvidence,
    nativeGeometryEvidence,
    snapshotContentEvidence,
    changedOpacityKeys,
    motionDetected: hashes.size > 1
      || changedSnapshotFrameCount > 0
      || Object.values(shadowFrameChangeCounts).some(count => count > 0)
      || changedOpacityKeys.length > 0,
    firstSnapshotFrame,
    lastSnapshotFrame,
  }
}

function summarizeNativePresentationGeometryEvidence(samples) {
  const first = samples[0] ?? null
  const last = samples[samples.length - 1] ?? null
  const expectedEndBounds = last?.expectedEndFrame
    ? {
        x: 0,
        y: 0,
        width: last.expectedEndFrame.width,
        height: last.expectedEndFrame.height,
      }
    : null
  return {
    firstShutterMatchesSourceContentBounds: areSameRect(first?.shutterFrame, first?.expectedStartContentBounds),
    firstShadowMatchesSourceContentFrame: areSameRect(first?.shadowFrame, first?.expectedStartContentFrame),
    firstSnapshotImageMatchesCaptureFrame: areSameRect(first?.snapshotImageFrame, first?.expectedSnapshotImageStartFrame),
    lastShutterMatchesDestinationBounds: areSameRect(last?.shutterFrame, expectedEndBounds),
    lastSnapshotMatchesDestinationBounds: areSameRect(last?.snapshotFrame, expectedEndBounds),
    lastShadowMatchesDestinationFrame: areSameRect(last?.shadowFrame, last?.expectedEndFrame),
    firstShutterFrame: first?.shutterFrame ?? null,
    firstExpectedStartContentBounds: first?.expectedStartContentBounds ?? null,
    firstShadowFrame: first?.shadowFrame ?? null,
    firstExpectedStartContentFrame: first?.expectedStartContentFrame ?? null,
    firstSnapshotImageFrame: first?.snapshotImageFrame ?? null,
    firstExpectedSnapshotImageStartFrame: first?.expectedSnapshotImageStartFrame ?? null,
    lastShutterFrame: last?.shutterFrame ?? null,
    lastSnapshotFrame: last?.snapshotFrame ?? null,
    lastShadowFrame: last?.shadowFrame ?? null,
    lastExpectedEndFrame: last?.expectedEndFrame ?? null,
  }
}

function summarizeWhiteLayerEvidence(samples) {
  const visibleSamples = samples.filter(sample =>
    readFiniteProbeNumber(sample.coverOpacity) !== null
    || readFiniteProbeNumber(sample.shutterOpacity) !== null,
  )
  const firstVisible = visibleSamples[0] ?? null
  const coverOpacityValues = visibleSamples
    .map(sample => readFiniteProbeNumber(sample.coverOpacity))
    .filter(value => value !== null)
  const shutterOpacityValues = visibleSamples
    .map(sample => readFiniteProbeNumber(sample.shutterOpacity))
    .filter(value => value !== null)
  const coverCornerRadii = samples
    .map(sample => readFiniteProbeNumber(sample.coverCornerRadius))
    .filter(value => value !== null)
  const shutterCornerRadii = samples
    .map(sample => readFiniteProbeNumber(sample.shutterCornerRadius))
    .filter(value => value !== null)
  const maxCoverOpacity = maxProbeValue(coverOpacityValues)
  const maxShutterOpacity = maxProbeValue(shutterOpacityValues)
  return {
    sampleCount: visibleSamples.length,
    startsVisible: readFiniteProbeNumber(firstVisible?.coverOpacity) === 1
      && readFiniteProbeNumber(firstVisible?.shutterOpacity) === 1,
    fadesInVisible: (maxCoverOpacity ?? 0) >= 0.95 && (maxShutterOpacity ?? 0) >= 0.95,
    coverOpacityChanges: valuesChange(coverOpacityValues),
    shutterOpacityChanges: valuesChange(shutterOpacityValues),
    maxCoverOpacity,
    maxShutterOpacity,
    coverIsWhite: samples.some(sample => isOpaqueWhiteColor(sample.coverBackgroundColor)),
    shutterIsWhite: samples.some(sample => isOpaqueWhiteColor(sample.shutterBackgroundColor)),
    coverHasRoundedCorners: coverCornerRadii.some(value => value > 0),
    shutterHasRoundedCorners: shutterCornerRadii.some(value => value > 0),
    firstCoverCornerRadius: coverCornerRadii[0] ?? null,
    firstShutterCornerRadius: shutterCornerRadii[0] ?? null,
  }
}

function summarizeSnapshotContentEvidence(samples) {
  const scaleValues = samples
    .map(sample => readFiniteProbeNumber(sample.snapshotImageContentsScale))
    .filter(value => value !== null)
  return {
    hasContents: samples.some(sample => sample.snapshotImageHasContents === true),
    contentsScale: scaleValues[0] ?? null,
    backgroundIsWhite: samples.some(sample => isOpaqueWhiteColor(sample.snapshotBackgroundColor)),
  }
}

function isOpaqueWhiteColor(value) {
  if (!value || typeof value !== 'object') {
    return false
  }
  return ['red', 'green', 'blue', 'alpha'].every((key) => {
    const channel = readFiniteProbeNumber(value[key])
    if (channel === null) {
      return false
    }
    return Math.abs(channel - 1) < 0.001
  })
}

function readFiniteProbeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function maxProbeValue(values) {
  if (values.length === 0) {
    return null
  }
  return Math.max(...values)
}

function valuesChange(values) {
  if (values.length <= 1) {
    return false
  }
  const first = values[0]
  return values.some(value => Math.abs(value - first) > 0.0001)
}

function areSameRect(left, right) {
  if (!left || !right) {
    return false
  }
  return ['x', 'y', 'width', 'height'].every(key => Math.abs((left[key] ?? 0) - (right[key] ?? 0)) < 0.0001)
}

function countChangedRects(rects) {
  const first = rects[0] ?? null
  if (!first) {
    return 0
  }
  return rects.filter(rect => !areSameRect(rect, first)).length
}

async function copyAudioEvidence(sourcePath, reportDir, label) {
  const asset = await copyBinaryEvidenceAsset(sourcePath, reportDir, label)
  return {
    ...asset,
    audio: await readAudioEvidence(asset.copiedPath),
  }
}

async function readAudioEvidence(filePath) {
  try {
    const stdout = await runProcessWithOutput('ffprobe', [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ])
    const parsed = JSON.parse(stdout)
    const audioStream = Array.isArray(parsed.streams)
      ? parsed.streams.find(stream => stream.codec_type === 'audio')
      : null
    return {
      durationSeconds: readNumber(audioStream?.duration) ?? readNumber(parsed.format?.duration) ?? null,
      sampleRate: readInteger(audioStream?.sample_rate),
      channels: readInteger(audioStream?.channels),
      codecName: typeof audioStream?.codec_name === 'string' ? audioStream.codec_name : null,
      bitRate: readInteger(audioStream?.bit_rate) ?? readInteger(parsed.format?.bit_rate),
    }
  }
  catch (error) {
    return {
      error: serializeError(error),
    }
  }
}

function readCradleAppshotSoundCandidates(binaryPath) {
  return [
    resolve(dirname(binaryPath), 'resources', 'Appshot.wav'),
    resolve(packageRoot, 'Resources', 'Appshot.wav'),
  ]
}

async function readFirstExistingFile(candidates) {
  for (const candidate of candidates) {
    try {
      const metadata = await stat(candidate)
      if (metadata.isFile()) {
        return candidate
      }
    }
    catch {
      // Candidate does not exist on this machine.
    }
  }
  return null
}

function areSameAudioMetadata(left, right) {
  return left.codecName === right.codecName
    && left.sampleRate === right.sampleRate
    && left.channels === right.channels
    && left.durationSeconds === right.durationSeconds
    && left.bitRate === right.bitRate
}

function readParityStatus({
  sound,
  imageComparisons,
  frameComparison,
  videoComparison,
  codexAppshotEvidence,
  cradleAppshotEvidence,
  targetLock,
  transitionFrameAlignment,
}) {
  const missingEvidence = []
  if (!codexAppshotEvidence?.occurred) {
    missingEvidence.push('Codex AppShot must be proven to have occurred during the Codex recording window.')
  }
  if (!targetLock?.matched) {
    missingEvidence.push('Codex and Cradle native AppShot must capture the same locked source window.')
  }
  if (transitionFrameAlignment && transitionFrameAlignment.status !== 'aligned') {
    missingEvidence.push('Codex and Cradle transition frames must be aligned before frame hash equality is used as proof.')
  }
  if (!cradleAppshotEvidence?.nativePresentationEvidence?.motionDetected) {
    missingEvidence.push('Cradle native AppShot presentation frames must prove that the native overlay moved during capture.')
  }
  const whiteLayerEvidence = cradleAppshotEvidence?.nativePresentationEvidence?.whiteLayerEvidence
  if (!whiteLayerEvidence?.startsVisible && !whiteLayerEvidence?.fadesInVisible) {
    missingEvidence.push('Cradle native AppShot must show a visible white shutter layer during the shutter fade-in window.')
  }
  if (!whiteLayerEvidence?.coverOpacityChanges || !whiteLayerEvidence?.shutterOpacityChanges) {
    missingEvidence.push('Cradle native AppShot white shutter opacity must animate for fade-in/fade-out parity.')
  }
  if (!whiteLayerEvidence?.coverIsWhite || !whiteLayerEvidence?.shutterIsWhite) {
    missingEvidence.push('Cradle native AppShot white shutter layer must be opaque white.')
  }
  if (!whiteLayerEvidence?.coverHasRoundedCorners || !whiteLayerEvidence?.shutterHasRoundedCorners) {
    missingEvidence.push('Cradle native AppShot white shutter layer must have rounded corners.')
  }
  const nativeGeometryEvidence = cradleAppshotEvidence?.nativePresentationEvidence?.nativeGeometryEvidence
  if (!nativeGeometryEvidence?.firstShutterMatchesSourceContentBounds) {
    missingEvidence.push('Cradle native AppShot white shutter must start on the source window content bounds, including title bar and traffic lights but excluding capture shadow padding.')
  }
  if (!nativeGeometryEvidence?.firstShadowMatchesSourceContentFrame) {
    missingEvidence.push('Cradle native AppShot shadow must start on the source window content frame.')
  }
  if (!nativeGeometryEvidence?.firstSnapshotImageMatchesCaptureFrame) {
    missingEvidence.push('Cradle native AppShot snapshot image layer must start on the captured PNG frame so screenshot shadow padding stays inside the source-content container.')
  }
  if (!nativeGeometryEvidence?.lastShutterMatchesDestinationBounds || !nativeGeometryEvidence?.lastSnapshotMatchesDestinationBounds || !nativeGeometryEvidence?.lastShadowMatchesDestinationFrame) {
    missingEvidence.push('Cradle native AppShot shutter, snapshot, and shadow must finish on the composer destination slot.')
  }
  const snapshotContentEvidence = cradleAppshotEvidence?.nativePresentationEvidence?.snapshotContentEvidence
  if (!snapshotContentEvidence?.hasContents) {
    missingEvidence.push('Cradle native AppShot snapshot layer must contain the captured window image.')
  }
  const sourceFrameEvidence = cradleAppshotEvidence?.sourceFrameEvidence
  if (!sourceFrameEvidence?.matchesCaptureImageSize) {
    missingEvidence.push('Cradle native AppShot source frame must match the captured image point size.')
  }
  if (!cradleAppshotEvidence?.videoTransitionEvidence?.detected) {
    missingEvidence.push('Cradle native AppShot transition must be visible in the Cradle recording before recorder output can prove visual parity.')
  }

  if (!sound.codex || !sound.cradle) {
    missingEvidence.push('Codex and Cradle Appshot sound resources must both be available.')
  }
  else if (!sound.byteIdentical) {
    missingEvidence.push('Codex and Cradle Appshot sound resources must be byte-identical.')
  }

  if (imageComparisons.length === 0) {
    missingEvidence.push('Codex and Cradle image assets must be available for static pixel comparison.')
  }
  else if (!imageComparisons.some(comparison => comparison.exactHashMatch)) {
    missingEvidence.push('At least one Codex image asset and Cradle image asset pair must be an exact hash match, or the report must document an accepted geometry transform.')
  }

  if (!frameComparison || frameComparison.comparedFrameCount === 0) {
    missingEvidence.push('Same-scene high-frame-rate recordings for Codex Appshot and Cradle native Appshot must be extracted into paired frames.')
  }
  else {
    if (frameComparison.unmatchedFrameCount !== 0) {
      missingEvidence.push('Codex and Cradle frame sequences must have the same frame count.')
    }
    if (frameComparison.summary.dimensionMismatchCount !== 0) {
      missingEvidence.push('Codex and Cradle paired frames must have matching dimensions.')
    }
    if (frameComparison.summary.metricFailureCount !== 0) {
      missingEvidence.push('Every paired frame comparison must produce SSIM/PSNR metrics.')
    }
    if (frameComparison.summary.exactHashMatchCount !== frameComparison.comparedFrameCount) {
      missingEvidence.push('Every paired Codex/Cradle frame must be an exact hash match before declaring 100% same.')
    }
    if (transitionFrameAlignment?.requiredFrameCount && frameComparison.comparedFrameCount < transitionFrameAlignment.requiredFrameCount) {
      missingEvidence.push('Aligned Codex/Cradle frame comparison must cover the full expected transition duration.')
    }
  }

  if (!videoComparison) {
    missingEvidence.push('Whole-transition video SSIM/PSNR comparison must be available.')
  }
  else if (!videoComparison.ssim || !videoComparison.psnr) {
    missingEvidence.push('Whole-transition video SSIM/PSNR diagnostic comparison must produce metrics.')
  }

  return {
    provenPixelPerfect: missingEvidence.length === 0,
    missingEvidence,
  }
}

function readCaptureTargetWindow(context) {
  const window = context.window
  return {
    windowId: window.windowId,
    processId: window.processId,
    ...(window.bundleId ? { bundleId: window.bundleId } : {}),
  }
}

function readTargetLockEvidence(context, targetWindow, capture) {
  const capturedWindow = capture?.window ?? null
  const matched = Boolean(
    capturedWindow
      && capturedWindow.windowId === targetWindow.windowId
      && capturedWindow.processId === targetWindow.processId
      && (!targetWindow.bundleId || capturedWindow.bundleId === targetWindow.bundleId),
  )
  return {
    matched,
    requested: targetWindow,
    initialWindow: context.window,
    capturedWindow,
  }
}

function readPositiveFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function formatFfmpegNumber(value) {
  return Number.parseFloat(value.toFixed(6)).toString()
}

function readRecordingComparisonWindow(leftRecording, rightRecording) {
  if (!hasUsableRecording(leftRecording) || !hasUsableRecording(rightRecording)) {
    return null
  }
  const leftDurationSeconds = readPositiveFiniteNumber(leftRecording.media?.durationSeconds)
  const rightDurationSeconds = readPositiveFiniteNumber(rightRecording.media?.durationSeconds)
  if (!leftDurationSeconds || !rightDurationSeconds) {
    return null
  }
  return {
    source: 'minimum-recording-duration',
    durationSeconds: Number.parseFloat(Math.min(leftDurationSeconds, rightDurationSeconds).toFixed(6)),
    codexDurationSeconds: leftDurationSeconds,
    cradleDurationSeconds: rightDurationSeconds,
  }
}

function readJpegDimensions(data) {
  if (data[0] !== 0xff || data[1] !== 0xd8) {
    return null
  }

  let offset = 2
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = data[offset + 1]
    const length = data.readUInt16BE(offset + 2)
    if (length < 2) {
      return null
    }
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        format: 'jpeg',
        width: data.readUInt16BE(offset + 7),
        height: data.readUInt16BE(offset + 5),
      }
    }
    offset += 2 + length
  }
  return null
}

function readFilePath(rawPathOrUrl) {
  if (!rawPathOrUrl || typeof rawPathOrUrl !== 'string') {
    return null
  }
  try {
    const url = new URL(rawPathOrUrl)
    if (url.protocol !== 'file:') {
      return null
    }
    return fileURLToPath(url)
  }
  catch {
    return isAbsolute(rawPathOrUrl) ? rawPathOrUrl : null
  }
}

function readImageExtension(filePath) {
  const extension = extname(filePath).toLowerCase()
  if (extension === '.png' || extension === '.jpg' || extension === '.jpeg') {
    return extension
  }
  return '.png'
}

function isSupportedImagePath(filePath) {
  const extension = extname(filePath).toLowerCase()
  return extension === '.png' || extension === '.jpg' || extension === '.jpeg'
}

function readPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function logStage(stage, details = {}) {
  const suffix = Object.keys(details).length > 0
    ? ` ${JSON.stringify(details)}`
    : ''
  console.log(`[appshot-parity ${new Date().toISOString()}] ${stage}${suffix}`)
}

function formatError(error) {
  if (!(error instanceof Error)) {
    return String(error)
  }
  const lines = [error.message]
  if (error.code) {
    lines.push(`code: ${error.code}`)
  }
  if (error.details) {
    lines.push(`details: ${JSON.stringify(error.details, null, 2)}`)
  }
  return lines.join('\n')
}

function serializeError(error) {
  if (!(error instanceof Error)) {
    return {
      message: String(error),
    }
  }
  return {
    message: error.message,
    code: typeof error.code === 'string' ? error.code : null,
    details: error.details ?? null,
  }
}

function summarizeCodexImageComparisonEvidence(imageComparisons) {
  return {
    comparisonCount: imageComparisons.length,
    exactHashMatchCount: imageComparisons.filter(comparison => comparison.exactHashMatch).length,
    dimensionMatchCount: imageComparisons.filter(comparison => comparison.dimensionsMatch).length,
    computedMetricCount: imageComparisons.filter(comparison => comparison.metricStatus === 'computed' || comparison.metricStatus === 'exact-match').length,
    metricFailureCount: imageComparisons.filter(comparison => comparison.metricStatus.startsWith('failed:')).length,
  }
}

function readVideoTransitionEvidence(start) {
  const detected = start?.status === 'detected' && start.index !== null
  return {
    detected,
    status: start?.status ?? 'not-evaluated',
    startIndex: start?.index ?? null,
    trigger: start?.trigger ?? null,
    transitionCount: start?.transitions?.length ?? 0,
  }
}

function readCodexVideoTransitionEvidence(transitionFrameAlignment) {
  return readVideoTransitionEvidence(transitionFrameAlignment?.codexStart)
}

function readCradleAppshotEvidence({ capture, recording, transitionFrameAlignment, presentationProbe }) {
  return {
    captured: Boolean(capture?.filePath),
    captureBackend: capture?.captureBackend ?? null,
    captureImageSize: capture?.captureImageSize ?? null,
    sourceFrameEvidence: readCaptureSourceFrameEvidence(capture),
    recordingBackend: recording?.recordingBackend ?? null,
    recordingError: recording?.recordingError ?? null,
    triggerError: recording?.triggerError ?? null,
    videoTransitionEvidence: readVideoTransitionEvidence(transitionFrameAlignment?.cradleStart),
    nativePresentationEvidence: {
      motionDetected: Boolean(presentationProbe?.summary?.motionDetected),
      sampleCount: presentationProbe?.summary?.sampleCount ?? 0,
      imageWrittenCount: presentationProbe?.summary?.imageWrittenCount ?? 0,
      uniqueImageHashCount: presentationProbe?.summary?.uniqueImageHashCount ?? 0,
      changedSnapshotFrameCount: presentationProbe?.summary?.changedSnapshotFrameCount ?? 0,
      shadowFrameChangeCounts: presentationProbe?.summary?.shadowFrameChangeCounts ?? {
        shadow: 0,
        destination: 0,
        key: 0,
        ambient: 0,
      },
      whiteLayerEvidence: presentationProbe?.summary?.whiteLayerEvidence ?? null,
      nativeGeometryEvidence: presentationProbe?.summary?.nativeGeometryEvidence ?? null,
      snapshotContentEvidence: presentationProbe?.summary?.snapshotContentEvidence ?? null,
      changedOpacityKeys: presentationProbe?.summary?.changedOpacityKeys ?? [],
    },
  }
}

function readCaptureSourceFrameEvidence(capture) {
  const imageSize = capture?.captureImageSize
  const geometry = capture?.appshot?.transitionGeometry
  const sourceFrame = geometry?.sourceWindowFrame
  const sourceScale = readPositiveFiniteNumber(geometry?.sourceDisplayMapping?.scaleFactor)
    ?? readPositiveFiniteNumber(geometry?.displayMapping?.scaleFactor)
    ?? readPositiveFiniteNumber(geometry?.displayScaleFactor)
  if (!imageSize || !sourceFrame || !sourceScale) {
    return {
      available: false,
      matchesCaptureImageSize: false,
      capturePointSize: null,
      sourceFrame: sourceFrame ?? null,
      sourceScale: sourceScale ?? null,
    }
  }
  const capturePointSize = {
    width: imageSize.pixelWidth / sourceScale,
    height: imageSize.pixelHeight / sourceScale,
  }
  const widthDelta = Math.abs(capturePointSize.width - sourceFrame.width)
  const heightDelta = Math.abs(capturePointSize.height - sourceFrame.height)
  return {
    available: true,
    matchesCaptureImageSize: widthDelta < 0.75 && heightDelta < 0.75,
    capturePointSize,
    sourceFrame,
    sourceScale,
    widthDelta,
    heightDelta,
  }
}

function readCodexAppshotEvidence({
  source,
  direct,
  start,
  updates,
  assets,
  observedAssets,
  imageComparisons,
  transitionFrameAlignment,
}) {
  const sources = []
  const updateTypes = updates.map(update => update.type)
  const imageComparisonEvidence = summarizeCodexImageComparisonEvidence(imageComparisons)
  const videoTransitionEvidence = readCodexVideoTransitionEvidence(transitionFrameAlignment)
  if (direct.status === 'succeeded' && start) {
    sources.push('direct-start-succeeded')
  }
  if (updateTypes.includes('screenshot')) {
    sources.push('direct-screenshot-update')
  }
  if (updateTypes.includes('completed')) {
    sources.push('direct-completed-update')
  }
  if (assets.length > 0) {
    sources.push('direct-copied-assets')
  }
  if (observedAssets.length > 0) {
    sources.push('observed-codex-temp-assets')
  }
  if (imageComparisonEvidence.exactHashMatchCount > 0) {
    sources.push('static-image-exact-match')
  }
  else if (imageComparisonEvidence.computedMetricCount > 0) {
    sources.push('static-image-metrics-computed')
  }
  if (videoTransitionEvidence.detected) {
    sources.push('observed-codex-video-transition')
  }

  return {
    occurred: sources.length > 0,
    source,
    sources,
    directStatus: direct.status,
    directUpdateTypes: updateTypes,
    directAssetCount: assets.length,
    observedAssetCount: observedAssets.length,
    imageComparisonEvidence,
    videoTransitionEvidence,
  }
}

function sleep(ms) {
  return new Promise(resolveSleep => setTimeout(resolveSleep, ms))
}

async function readCodexTmpAssetInventory() {
  const inventory = new Map()
  let rootPath
  try {
    rootPath = await realpath(codexTmpRoot)
  }
  catch {
    return inventory
  }
  const files = await listImageFiles(rootPath)
  await Promise.all(files.map(async (filePath) => {
    try {
      const metadata = await stat(filePath)
      if (!metadata.isFile() || metadata.size > maxAssetBytes) {
        return
      }
      inventory.set(filePath, {
        mtimeMs: metadata.mtimeMs,
        size: metadata.size,
      })
    }
    catch {
      // The Codex service can rotate temp files while we observe them.
    }
  }))
  return inventory
}

async function listImageFiles(rootPath) {
  const entries = []
  async function visit(directory) {
    let children
    try {
      children = await readdir(directory, { withFileTypes: true })
    }
    catch {
      return
    }
    await Promise.all(children.map(async (child) => {
      const childPath = resolve(directory, child.name)
      if (child.isDirectory()) {
        await visit(childPath)
        return
      }
      if (child.isFile() && isSupportedImagePath(childPath)) {
        entries.push(childPath)
      }
    }))
  }
  await visit(rootPath)
  return entries
}

async function collectObservedCodexAssets({ baseline, reportDir, startedAtMs }) {
  const current = await readCodexTmpAssetInventory()
  const candidates = []
  for (const [filePath, metadata] of current.entries()) {
    const previous = baseline.get(filePath)
    if (previous && previous.mtimeMs === metadata.mtimeMs && previous.size === metadata.size) {
      continue
    }
    if (!previous && metadata.mtimeMs < startedAtMs - 500) {
      continue
    }
    candidates.push({
      filePath,
      ...metadata,
    })
  }
  candidates.sort((left, right) => left.mtimeMs - right.mtimeMs || left.filePath.localeCompare(right.filePath))

  const assets = []
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]
    const copied = await copyCodexAssetPath(
      candidate.filePath,
      reportDir,
      `codex-observed-${String(index + 1).padStart(2, '0')}`,
    )
    if (copied) {
      assets.push({
        kind: 'observedTempAsset',
        observedIndex: index,
        observedMtimeMs: candidate.mtimeMs,
        ...copied,
      })
    }
  }
  return assets
}

async function waitForObservedCodexAssets({ baseline, startedAtMs, timeoutMs, pollIntervalMs }) {
  const deadlineMs = Date.now() + timeoutMs
  while (Date.now() < deadlineMs) {
    const current = await readCodexTmpAssetInventory()
    const changedCount = countNewOrChangedCodexAssets({ baseline, current, startedAtMs })
    if (changedCount > 0) {
      return {
        reason: 'asset-detected',
        changedCount,
        waitedMs: timeoutMs - Math.max(0, deadlineMs - Date.now()),
      }
    }
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadlineMs - Date.now())))
  }
  return {
    reason: 'timeout',
    changedCount: 0,
    waitedMs: timeoutMs,
  }
}

function countNewOrChangedCodexAssets({ baseline, current, startedAtMs }) {
  let count = 0
  for (const [filePath, metadata] of current.entries()) {
    const previous = baseline.get(filePath)
    if (previous && previous.mtimeMs === metadata.mtimeMs && previous.size === metadata.size) {
      continue
    }
    if (!previous && metadata.mtimeMs < startedAtMs - 500) {
      continue
    }
    count += 1
  }
  return count
}

async function recordTransitionVideo(outputPath, seconds, trigger, recordingBackend, client, options = {}) {
  await mkdir(dirname(outputPath), { recursive: true })
  const attempts = []
  for (const backend of readRecordingBackendOrder(recordingBackend)) {
    const attempt = await recordTransitionVideoWithBackend(outputPath, seconds, trigger, backend, client, options)
    attempts.push(...attempt.recordingAttempts)
    if (attempt.recordingError && (!attempt.triggered || options.retryAfterTriggeredRecordingFailure)) {
      continue
    }
    return {
      ...attempt,
      recordingAttempts: attempts,
    }
  }
  const recordingError = new Error('No requested screen recording backend could produce Appshot transition video evidence.')
  recordingError.details = { recordingBackend, attempts }
  return {
    path: outputPath,
    relativePath: null,
    size: 0,
    media: null,
    triggerError: null,
    recordingError: serializeError(recordingError),
    recordingBackend: null,
    recordingAttempts: attempts,
    triggered: false,
  }
}

async function recordTransitionVideoWithBackend(outputPath, seconds, trigger, backend, client, options) {
  const attempt = {
    backend,
    command: null,
    args: [],
    input: null,
    status: 'pending',
    stderr: '',
    error: null,
  }
  if (backend === 'screen-capture-kit-display' || backend === 'screen-capture-kit-window' || backend === 'core-graphics-window-polling') {
    return recordTransitionVideoWithMacBridge(outputPath, seconds, trigger, attempt, client, options)
  }
  let prepared
  try {
    prepared = await prepareRecordingBackend(backend, outputPath, seconds)
  }
  catch (error) {
    attempt.status = 'unavailable'
    attempt.error = serializeError(error)
    return readFailedRecording(outputPath, backend, attempt, null, false)
  }

  attempt.command = prepared.command
  attempt.args = prepared.args
  attempt.input = prepared.input ?? null
  const recording = spawn(prepared.command, prepared.args, {
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  recording.stderr.on('data', data => {
    stderr += data.toString()
  })
  const recordingFinished = readRecordingFinished(recording, backend, () => stderr)
  const startResult = await Promise.race([
    sleep(250).then(() => ({ started: true, result: null })),
    recordingFinished.then(result => ({ started: false, result })),
  ])
  if (!startResult.started) {
    attempt.status = 'failed-before-trigger'
    attempt.stderr = startResult.result?.stderr ?? stderr
    attempt.error = serializeError(startResult.result?.error ?? new Error(`${backend} exited before the Appshot trigger.`))
    return readFailedRecording(outputPath, backend, attempt, null, false)
  }

  attempt.status = 'recording'
  let triggerError = null
  try {
    await trigger()
  }
  catch (error) {
    triggerError = error
  }
  const recordingResult = await recordingFinished
  attempt.stderr = recordingResult.stderr
  if (recordingResult.error) {
    attempt.status = 'failed-after-trigger'
    attempt.error = serializeError(recordingResult.error)
    return readFailedRecording(outputPath, backend, attempt, triggerError, true)
  }
  const metadata = await stat(outputPath)
  const media = await readVideoEvidence(outputPath)
  attempt.status = 'succeeded'
  return {
    path: outputPath,
    relativePath: null,
    size: metadata.size,
    media,
    triggerError: triggerError ? serializeError(triggerError) : null,
    recordingError: null,
    recordingBackend: backend,
    recordingAttempts: [attempt],
    triggered: true,
  }
}

function readRecordingBackendOrder(recordingBackend) {
  if (recordingBackend === 'auto') {
    return ['screen-capture-kit-window', 'core-graphics-window-polling', 'screen-capture-kit-display', 'screencapture', 'ffmpeg-avfoundation']
  }
  return [recordingBackend]
}

function readCodexWindowRecordingTarget(animationTarget, seconds) {
  return readWindowRecordingTarget({
    bundleIdentifier: 'com.openai.sky.CUAService',
    animationTarget,
    discoveryTimeoutSeconds: Math.max(seconds, 2),
  })
}

function readCradleWindowRecordingTarget(bridge, animationTarget, seconds) {
  return readWindowRecordingTarget({
    processId: bridge?.pid,
    animationTarget,
    discoveryTimeoutSeconds: Math.max(seconds + 8, 10),
  })
}

function readWindowRecordingTarget({ bundleIdentifier, processId, animationTarget, discoveryTimeoutSeconds }) {
  const displayBounds = animationTarget?.codexDisplay?.bounds
  return {
    ...(Number.isInteger(processId) && processId > 0 ? { processId } : {}),
    ...(bundleIdentifier ? { bundleIdentifier } : {}),
    ...(displayBounds ? { displayBounds } : {}),
    discoveryTimeoutSeconds,
    discoveryPollIntervalSeconds: 0.025,
    captureSecondsAfterDiscovery: 1.35,
  }
}

async function recordTransitionVideoWithMacBridge(outputPath, seconds, trigger, attempt, client, options) {
  if (!client) {
    attempt.status = 'unavailable'
    attempt.error = serializeError(new Error(`${attempt.backend} requires a running Mac Bridge client.`))
    return readFailedRecording(outputPath, attempt.backend, attempt, null, false)
  }
  const recordingId = `parity-recording-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const isWindowRecording = attempt.backend === 'screen-capture-kit-window' || attempt.backend === 'core-graphics-window-polling'
  attempt.command = isWindowRecording ? 'mac.recording.startWindow' : 'mac.recording.startDisplay'
  attempt.args = [isWindowRecording
    ? readWindowRecordingStartArgs(recordingId, outputPath, attempt.backend, options)
    : {
        recordingId,
        outputPath,
        frameRate: 30,
      }]
  let start
  try {
    start = await client.request(attempt.command, attempt.args[0], 12_000)
  }
  catch (error) {
    attempt.status = 'unavailable'
    attempt.error = serializeError(error)
    return readFailedRecording(outputPath, attempt.backend, attempt, null, false)
  }

  attempt.input = start
  attempt.status = 'recording'
  await sleep(250)
  let triggerError = null
  try {
    await trigger()
  }
  catch (error) {
    triggerError = error
  }
  const postTriggerDelayMs = typeof options.postTriggerDelayMs === 'function'
    ? options.postTriggerDelayMs()
    : options.postTriggerDelayMs
  await sleep(postTriggerDelayMs ?? Math.max(seconds * 1000 - 250, 0))

  let finish
  const finishCommand = isWindowRecording ? 'mac.recording.finishWindow' : 'mac.recording.finishDisplay'
  try {
    finish = await client.request(finishCommand, { recordingId }, 12_000)
  }
  catch (error) {
    attempt.status = 'failed-after-trigger'
    attempt.error = serializeError(error)
    return readFailedRecording(outputPath, attempt.backend, attempt, triggerError, true)
  }

  const metadata = await stat(outputPath)
  const media = await readVideoEvidence(outputPath)
  attempt.status = 'succeeded'
  attempt.input = {
    start,
    finish,
  }
  return {
    path: outputPath,
    relativePath: null,
    size: metadata.size,
    media,
    triggerError: triggerError ? serializeError(triggerError) : null,
    recordingError: null,
    recordingBackend: finish?.backend ?? start?.backend ?? attempt.backend,
    recordingAttempts: [attempt],
    triggered: true,
  }
}

function readWindowRecordingStartArgs(recordingId, outputPath, backend, options) {
  const target = options.windowRecordingTarget
  if (!target) {
    throw new Error('screen-capture-kit-window requires windowRecordingTarget.')
  }
  return {
    recordingId,
    outputPath,
    frameRate: 30,
    recordingBackend: backend,
    ...target,
  }
}

async function prepareRecordingBackend(backend, outputPath, seconds) {
  if (backend === 'screencapture') {
    return {
      command: '/usr/sbin/screencapture',
      args: ['-v', `-V${seconds}`, '-x', outputPath],
    }
  }
  if (backend === 'ffmpeg-avfoundation') {
    const input = await readAvfoundationScreenInput()
    return {
      command: 'ffmpeg',
      input,
      args: [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'avfoundation',
        '-framerate',
        '30',
        '-capture_cursor',
        '1',
        '-i',
        `${input}:none`,
        '-t',
        String(seconds),
        '-pix_fmt',
        'yuv420p',
        outputPath,
      ],
    }
  }
  throw new Error(`Unsupported recording backend: ${backend}`)
}

async function readAvfoundationScreenInput() {
  const result = await runProcessCapture('ffmpeg', [
    '-hide_banner',
    '-f',
    'avfoundation',
    '-list_devices',
    'true',
    '-i',
    '',
  ])
  const devices = parseAvfoundationVideoDevices(`${result.stdout}\n${result.stderr}`)
  if (devices.length === 0 && result.error) {
    const error = new Error(`ffmpeg avfoundation device probe failed: ${result.error.message}`)
    error.details = result
    throw error
  }
  const screen = devices.find(device => /capture screen|screen|display/i.test(device.name))
  if (!screen) {
    const error = new Error('ffmpeg avfoundation did not expose a screen capture device.')
    error.details = { devices, probeError: result.error, stderr: result.stderr }
    throw error
  }
  return screen.index
}

function parseAvfoundationVideoDevices(output) {
  const devices = []
  let readingVideoDevices = false
  for (const line of output.split('\n')) {
    if (line.includes('AVFoundation video devices:')) {
      readingVideoDevices = true
      continue
    }
    if (line.includes('AVFoundation audio devices:')) {
      readingVideoDevices = false
      continue
    }
    if (!readingVideoDevices) {
      continue
    }
    const match = line.match(/\[(\d+)]\s+(.+)$/)
    if (match) {
      devices.push({
        index: match[1],
        name: match[2].trim(),
      })
    }
  }
  return devices
}

function readRecordingFinished(recording, backend, readStderr) {
  return new Promise((resolveRecording) => {
    let settled = false
    const finish = (result) => {
      if (settled) {
        return
      }
      settled = true
      resolveRecording(result)
    }
    recording.once('error', error => finish({
      error,
      stderr: readStderr(),
    }))
    recording.once('exit', (code, signal) => {
      const stderr = readStderr()
      if (code === 0) {
        finish({ error: null, stderr })
        return
      }
      finish({
        error: new Error(`${backend} video failed with code=${code} signal=${signal}: ${stderr.trim()}`),
        stderr,
      })
    })
  })
}

function readFailedRecording(outputPath, backend, attempt, triggerError, triggered) {
  return {
    path: outputPath,
    relativePath: null,
    size: 0,
    media: null,
    triggerError: triggerError ? serializeError(triggerError) : null,
    recordingError: attempt.error,
    recordingBackend: backend,
    recordingAttempts: [attempt],
    triggered,
  }
}

async function extractVideoFrames(videoPath, outputDir, frameRate, comparisonWindow = null) {
  await mkdir(outputDir, { recursive: true })
  const pattern = resolve(outputDir, 'frame-%04d.png')
  const durationSeconds = readPositiveFiniteNumber(comparisonWindow?.durationSeconds)
  await runProcess('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    videoPath,
    ...(durationSeconds ? ['-t', formatFfmpegNumber(durationSeconds)] : []),
    '-vf',
    `fps=${frameRate}`,
    pattern,
  ])
  return {
    directory: outputDir,
    relativePath: null,
    frameRate,
    comparisonWindow,
    ...(await readFrameDirectoryEvidence(outputDir)),
  }
}

async function compareVideos(codexVideoPath, cradleVideoPath, comparisonWindow = null) {
  const durationSeconds = readPositiveFiniteNumber(comparisonWindow?.durationSeconds)
  const codexFilter = durationSeconds
    ? `[0:v]trim=duration=${formatFfmpegNumber(durationSeconds)},setpts=PTS-STARTPTS,format=yuv420p[codex]`
    : '[0:v]setpts=PTS-STARTPTS,format=yuv420p[codex]'
  const cradleFilter = durationSeconds
    ? `[1:v]trim=duration=${formatFfmpegNumber(durationSeconds)},setpts=PTS-STARTPTS,format=yuv420p[cradle]`
    : '[1:v]setpts=PTS-STARTPTS,format=yuv420p[cradle]'
  const comparisonFilter = `${codexFilter};${cradleFilter};[codex][cradle]`
  const ssimOutput = await runProcessWithOutput('ffmpeg', [
    '-hide_banner',
    '-nostats',
    '-i',
    codexVideoPath,
    '-i',
    cradleVideoPath,
    '-lavfi',
    `${comparisonFilter}ssim`,
    '-f',
    'null',
    '-',
  ])
  const psnrOutput = await runProcessWithOutput('ffmpeg', [
    '-hide_banner',
    '-nostats',
    '-i',
    codexVideoPath,
    '-i',
    cradleVideoPath,
    '-lavfi',
    `${comparisonFilter}psnr`,
    '-f',
    'null',
    '-',
  ])
  return {
    comparisonWindow,
    ssim: parseSsimOutput(ssimOutput),
    psnr: parsePsnrOutput(psnrOutput),
  }
}

async function writeImageDiff(codexImagePath, cradleImagePath, outputPath) {
  await mkdir(dirname(outputPath), { recursive: true })
  await runProcess('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    codexImagePath,
    '-i',
    cradleImagePath,
    '-lavfi',
    '[0:v]format=rgba[codex];[1:v]format=rgba[cradle];[codex][cradle]blend=all_mode=difference,format=rgba',
    '-frames:v',
    '1',
    outputPath,
  ])
  const metadata = await stat(outputPath)
  return {
    path: outputPath,
    relativePath: null,
    size: metadata.size,
    ...(await readFileEvidence(outputPath)),
  }
}

async function compareImages(codexImagePath, cradleImagePath) {
  const ssimOutput = await runProcessWithOutput('ffmpeg', [
    '-hide_banner',
    '-nostats',
    '-i',
    codexImagePath,
    '-i',
    cradleImagePath,
    '-lavfi',
    '[0:v]format=rgba[codex];[1:v]format=rgba[cradle];[codex][cradle]ssim',
    '-frames:v',
    '1',
    '-f',
    'null',
    '-',
  ])
  const psnrOutput = await runProcessWithOutput('ffmpeg', [
    '-hide_banner',
    '-nostats',
    '-i',
    codexImagePath,
    '-i',
    cradleImagePath,
    '-lavfi',
    '[0:v]format=rgba[codex];[1:v]format=rgba[cradle];[codex][cradle]psnr',
    '-frames:v',
    '1',
    '-f',
    'null',
    '-',
  ])
  return {
    ssim: parseSsimOutput(ssimOutput),
    psnr: parsePsnrOutput(psnrOutput),
  }
}

function runProcess(command, args) {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', data => stderr += data.toString())
    child.once('error', rejectProcess)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolveProcess()
        return
      }
      rejectProcess(new Error(`${command} failed with code=${code} signal=${signal}: ${stderr.trim()}`))
    })
  })
}

function runProcessWithOutput(command, args) {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', data => stdout += data.toString())
    child.stderr.on('data', data => stderr += data.toString())
    child.once('error', rejectProcess)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolveProcess(`${stdout}\n${stderr}`)
        return
      }
      rejectProcess(new Error(`${command} failed with code=${code} signal=${signal}: ${stderr.trim()}`))
    })
  })
}

function runProcessCapture(command, args) {
  return new Promise((resolveProcess) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', data => stdout += data.toString())
    child.stderr.on('data', data => stderr += data.toString())
    child.once('error', error => resolveProcess({
      command,
      args,
      stdout,
      stderr,
      error: serializeError(error),
    }))
    child.once('exit', (code, signal) => resolveProcess({
      command,
      args,
      code,
      signal,
      stdout,
      stderr,
      error: code === 0
        ? null
        : serializeError(new Error(`${command} failed with code=${code} signal=${signal}: ${stderr.trim()}`)),
    }))
  })
}

function parseSsimOutput(output) {
  const matches = [...output.matchAll(/All:([0-9.]+|inf)\s+\(([0-9.+-]+|inf)\)/g)]
  const match = matches.at(-1)
  if (!match) {
    return null
  }
  return {
    all: match[1] === 'inf' ? 'inf' : Number.parseFloat(match[1]),
    db: match[2] === 'inf' ? 'inf' : Number.parseFloat(match[2]),
  }
}

function parsePsnrOutput(output) {
  const matches = [...output.matchAll(/average:([0-9.inf+-]+)/g)]
  const match = matches.at(-1)
  if (!match) {
    return null
  }
  const rawAverage = match[1]
  return {
    average: rawAverage === 'inf' ? 'inf' : Number.parseFloat(rawAverage),
  }
}

async function readVideoEvidence(videoPath) {
  const stdout = await runProcessWithOutput('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    videoPath,
  ])
  const parsed = JSON.parse(stdout)
  const videoStream = Array.isArray(parsed.streams)
    ? parsed.streams.find(stream => stream.codec_type === 'video')
    : null
  return {
    durationSeconds: readNumber(videoStream?.duration) ?? readNumber(parsed.format?.duration) ?? null,
    frameCount: readInteger(videoStream?.nb_frames),
    averageFrameRate: parseFrameRate(videoStream?.avg_frame_rate),
    width: readInteger(videoStream?.width),
    height: readInteger(videoStream?.height),
    codecName: typeof videoStream?.codec_name === 'string' ? videoStream.codec_name : null,
  }
}

async function readFrameDirectoryEvidence(directory) {
  const entries = (await readdir(directory))
    .filter(entry => entry.toLowerCase().endsWith('.png'))
    .sort()
  const first = entries[0] ? await readFrameEvidence(resolve(directory, entries[0])) : null
  const last = entries.length > 0 ? await readFrameEvidence(resolve(directory, entries[entries.length - 1])) : null
  return {
    frameCount: entries.length,
    frames: await Promise.all(entries.map(async (entry, index) => ({
      index,
      name: entry,
      relativePath: entry,
      ...(await readFrameEvidence(resolve(directory, entry))),
    }))),
    firstFrame: first,
    lastFrame: last,
  }
}

function readPresentationProbeFrameInput(presentationProbe, frameRate, reportDir) {
  const samples = presentationProbe?.samples ?? []
  const frames = samples
    .filter(sample => sample.imageStatus === 'written' && sample.imageEvidence?.path)
    .map((sample, index) => ({
      index,
      name: `presentation-sample-${String(sample.index).padStart(4, '0')}.png`,
      relativePath: sample.imageEvidence.relativePath,
      path: sample.imageEvidence.path,
      size: sample.imageEvidence.size,
      sha256: sample.imageEvidence.sha256,
      image: sample.imageEvidence.image,
      presentationSampleIndex: sample.index,
      snapshotFrame: sample.snapshotFrame ?? null,
      destinationShadowFrame: sample.destinationShadowFrame ?? null,
      keyShadowFrame: sample.keyShadowFrame ?? null,
      ambientShadowFrame: sample.ambientShadowFrame ?? null,
    }))
  if (frames.length === 0) {
    return null
  }
  return {
    source: 'cradle-native-presentation-probe',
    directory: presentationProbe.samples
      .find(sample => sample.imageEvidence?.path)
      ?.imageEvidence
      ?.path
      ?.replace(/\/appshot-presentation-sample-\d+\.png$/, '') ?? null,
    relativePath: dirname(frames[0].relativePath),
    frameRate,
    comparisonWindow: null,
    frameCount: frames.length,
    frames,
    firstFrame: frames[0] ?? null,
    lastFrame: frames.at(-1) ?? null,
  }
}

async function readFrameEvidence(filePath) {
  const metadata = await stat(filePath)
  const fileEvidence = await readFileEvidence(filePath)
  return {
    path: filePath,
    size: metadata.size,
    ...fileEvidence,
  }
}

function readNumber(value) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

function readInteger(value) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10)
  return Number.isInteger(parsed) ? parsed : null
}

function parseFrameRate(value) {
  if (typeof value !== 'string' || value === '0/0') {
    return null
  }
  const [numerator, denominator] = value.split('/').map(part => Number.parseFloat(part))
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null
  }
  return numerator / denominator
}

function readAppliedCalibration(start) {
  const calibration = {}
  if (!start) {
    return calibration
  }
  const animationDuration = readPositiveNumber(start.animationDuration)
  const transitionSnapshotHeight = readPositiveNumber(start.transitionSnapshotHeight)
  const transitionSpringDampingFraction = readPositiveNumber(start.transitionSpringDampingFraction)
  const transitionSpringResponse = readPositiveNumber(start.transitionSpringResponse)
  if (animationDuration !== undefined) {
    calibration.animationDuration = animationDuration
  }
  if (transitionSnapshotHeight !== undefined) {
    calibration.transitionSnapshotHeight = transitionSnapshotHeight
  }
  if (transitionSpringDampingFraction !== undefined) {
    calibration.transitionSpringDampingFraction = transitionSpringDampingFraction
  }
  if (transitionSpringResponse !== undefined) {
    calibration.transitionSpringResponse = transitionSpringResponse
  }
  return calibration
}

function hasUsableRecording(recording) {
  return Boolean(
    recording
      && !recording.recordingError
      && recording.path
      && recording.size > 0,
  )
}

async function readTransitionFrameAlignment(codexFrames, cradleFrames, options, appliedCalibration) {
  if (!codexFrames || !cradleFrames) {
    return {
      status: 'missing-frame-inputs',
      codexStartIndex: null,
      cradleStartIndex: null,
      comparedFrameCount: 0,
      requiredFrameCount: null,
      options: readAlignmentOptions(options),
    }
  }
  const codexStart = await detectTransitionStartFrame(codexFrames, options)
  const cradleStart = await detectTransitionStartFrame(cradleFrames, options)
  const requiredFrameCount = readExpectedTransitionFrameCount(options, appliedCalibration)
  const comparedFrameCount = Math.min(
    Math.max(0, codexFrames.frames.length - (codexStart.index ?? codexFrames.frames.length)),
    Math.max(0, cradleFrames.frames.length - (cradleStart.index ?? cradleFrames.frames.length)),
    requiredFrameCount ?? Number.POSITIVE_INFINITY,
  )
  const status = codexStart.index === null || cradleStart.index === null
    ? 'transition-start-not-detected'
    : comparedFrameCount <= 0
      ? 'empty-aligned-window'
      : 'aligned'
  return {
    status,
    codexStartIndex: codexStart.index,
    cradleStartIndex: cradleStart.index,
    frameOffset: codexStart.index !== null && cradleStart.index !== null
      ? codexStart.index - cradleStart.index
      : null,
    comparedFrameCount,
    requiredFrameCount,
    options: readAlignmentOptions(options),
    codexStart,
    cradleStart,
  }
}

function readAlignmentOptions(options) {
  return {
    frameRate: options.frameRate,
    ssimThreshold: options.alignmentSsimThreshold,
    consecutiveFrameCount: options.alignmentConsecutiveFrameCount,
  }
}

function readExpectedTransitionFrameCount(options, appliedCalibration) {
  const duration = readPositiveFiniteNumber(appliedCalibration.animationDuration) ?? defaultAppshotAnimationDurationSeconds
  if (!readPositiveFiniteNumber(duration) || !readPositiveFiniteNumber(options.frameRate)) {
    return null
  }
  return Math.max(1, Math.ceil(duration * options.frameRate))
}

async function detectTransitionStartFrame(frameInput, options) {
  const threshold = options.alignmentSsimThreshold
  const consecutiveFrameCount = options.alignmentConsecutiveFrameCount
  const transitions = []
  let changedRun = 0
  for (let index = 1; index < frameInput.frames.length; index += 1) {
    const previous = frameInput.frames[index - 1]
    const current = frameInput.frames[index]
    const transition = await compareAdjacentFrameChange(previous, current)
    transitions.push(transition)
    const ssimAll = readMetricNumber(transition.ssimAll)
    const changed = transition.status === 'computed'
      && ssimAll !== null
      && ssimAll < threshold
    changedRun = changed ? changedRun + 1 : 0
    if (changedRun >= consecutiveFrameCount) {
      const startIndex = index - consecutiveFrameCount + 1
      return {
        status: 'detected',
        index: startIndex,
        threshold,
        consecutiveFrameCount,
        trigger: transition,
        transitions,
      }
    }
  }
  return {
    status: 'not-detected',
    index: null,
    threshold,
    consecutiveFrameCount,
    trigger: null,
    transitions,
  }
}

async function compareAdjacentFrameChange(previousFrame, currentFrame) {
  const dimensionsMatch = areSameImageDimensions(previousFrame.image, currentFrame.image)
  if (!dimensionsMatch) {
    return {
      index: currentFrame.index,
      previousIndex: previousFrame.index,
      status: 'dimension-mismatch',
      ssimAll: null,
      psnrAverage: null,
    }
  }
  if (previousFrame.sha256 === currentFrame.sha256) {
    return {
      index: currentFrame.index,
      previousIndex: previousFrame.index,
      status: 'exact-match',
      ssimAll: 1,
      psnrAverage: 'inf',
    }
  }
  try {
    const metrics = await compareImages(previousFrame.path, currentFrame.path)
    return {
      index: currentFrame.index,
      previousIndex: previousFrame.index,
      status: 'computed',
      ssimAll: metrics?.ssim?.all ?? null,
      psnrAverage: metrics?.psnr?.average ?? null,
    }
  }
  catch (error) {
    return {
      index: currentFrame.index,
      previousIndex: previousFrame.index,
      status: `failed: ${error instanceof Error ? error.message : String(error)}`,
      ssimAll: null,
      psnrAverage: null,
    }
  }
}

function readAlignedFrameInputs(codexFrames, cradleFrames, alignment) {
  if (!codexFrames || !cradleFrames || alignment?.status !== 'aligned') {
    return {
      codex: null,
      cradle: null,
    }
  }
  return {
    codex: readFrameInputSlice(codexFrames, alignment.codexStartIndex, alignment.comparedFrameCount),
    cradle: readFrameInputSlice(cradleFrames, alignment.cradleStartIndex, alignment.comparedFrameCount),
  }
}

function readFrameInputSlice(frameInput, startIndex, frameCount) {
  const frames = frameInput.frames.slice(startIndex, startIndex + frameCount)
  return {
    ...frameInput,
    alignmentSlice: {
      startIndex,
      frameCount,
    },
    frameCount: frames.length,
    frames,
    firstFrame: frames[0] ?? null,
    lastFrame: frames.at(-1) ?? null,
  }
}

async function compareImageAssets(codexAssets, cradleAssets) {
  const comparisons = []
  for (const codexAsset of codexAssets) {
    for (const cradleAsset of cradleAssets) {
      const dimensionsMatch = areSameImageDimensions(codexAsset.image, cradleAsset.image)
      const exactHashMatch = codexAsset.sha256 === cradleAsset.sha256
      let metrics = null
      let metricStatus = 'skipped-dimension-mismatch'
      if (dimensionsMatch && codexAsset.copiedPath && cradleAsset.copiedPath) {
        try {
          metrics = await compareImages(codexAsset.copiedPath, cradleAsset.copiedPath)
          metricStatus = 'computed'
        }
        catch (error) {
          metricStatus = `failed: ${error instanceof Error ? error.message : String(error)}`
        }
      }
      comparisons.push({
        codex: {
          kind: codexAsset.kind,
          relativePath: codexAsset.relativePath,
          sha256: codexAsset.sha256,
          image: codexAsset.image,
        },
        cradle: {
          kind: cradleAsset.kind,
          relativePath: cradleAsset.relativePath,
          sha256: cradleAsset.sha256,
          image: cradleAsset.image,
        },
        dimensionsMatch,
        exactHashMatch,
        metricStatus,
        metrics,
      })
    }
  }
  return comparisons
}

async function compareFrameInputs(codexFrames, cradleFrames, diffDir = null, reportDir = null) {
  if (!codexFrames || !cradleFrames) {
    return null
  }

  const frameCount = Math.min(codexFrames.frames.length, cradleFrames.frames.length)
  const frames = []
  for (let index = 0; index < frameCount; index += 1) {
    const diffOutputPath = diffDir
      ? resolve(diffDir, `frame-${String(index + 1).padStart(4, '0')}-diff.png`)
      : null
    frames.push(await compareFramePair(
      codexFrames.frames[index],
      cradleFrames.frames[index],
      diffOutputPath,
      reportDir,
    ))
  }
  return {
    codexFrameCount: codexFrames.frames.length,
    cradleFrameCount: cradleFrames.frames.length,
    comparedFrameCount: frameCount,
    unmatchedFrameCount: Math.abs(codexFrames.frames.length - cradleFrames.frames.length),
    summary: summarizeFrameComparisons(frames),
    diffCount: frames.filter(frame => frame.diff).length,
    frames,
  }
}

async function compareFramePair(codexFrame, cradleFrame, diffOutputPath = null, reportDir = null) {
  const dimensionsMatch = areSameImageDimensions(codexFrame.image, cradleFrame.image)
  const exactHashMatch = codexFrame.sha256 === cradleFrame.sha256
  let metrics = null
  let metricStatus = 'skipped-dimension-mismatch'
  let diff = null
  if (dimensionsMatch && exactHashMatch) {
    metricStatus = 'exact-match'
    metrics = {
      ssim: { all: 1, db: 'inf' },
      psnr: { average: 'inf' },
    }
  }
  else if (dimensionsMatch) {
    try {
      metrics = await compareImages(codexFrame.path, cradleFrame.path)
      metricStatus = 'computed'
      if (diffOutputPath) {
        diff = await writeImageDiff(codexFrame.path, cradleFrame.path, diffOutputPath)
        if (reportDir) {
          diff.relativePath = relative(reportDir, diff.path)
        }
      }
    }
    catch (error) {
      metricStatus = `failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }
  return {
    index: codexFrame.index,
    codex: {
      name: codexFrame.name,
      sha256: codexFrame.sha256,
      image: codexFrame.image,
      size: codexFrame.size,
    },
    cradle: {
      name: cradleFrame.name,
      sha256: cradleFrame.sha256,
      image: cradleFrame.image,
      size: cradleFrame.size,
    },
    dimensionsMatch,
    exactHashMatch,
    metricStatus,
    metrics,
    diff,
  }
}

function summarizeFrameComparisons(frames) {
  const numericSsimFrames = frames
    .map(frame => ({
      index: frame.index,
      value: readMetricNumber(frame.metrics?.ssim?.all),
    }))
    .filter(frame => frame.value !== null)
  const numericPsnrFrames = frames
    .map(frame => ({
      index: frame.index,
      value: readMetricNumber(frame.metrics?.psnr?.average),
    }))
    .filter(frame => frame.value !== null)
  return {
    exactHashMatchCount: frames.filter(frame => frame.exactHashMatch).length,
    dimensionMismatchCount: frames.filter(frame => !frame.dimensionsMatch).length,
    metricFailureCount: frames.filter(frame => frame.metricStatus.startsWith('failed:')).length,
    meanSsimAll: readMeanMetric(numericSsimFrames),
    worstSsimAll: readWorstMetric(numericSsimFrames),
    meanPsnrAverage: readMeanMetric(numericPsnrFrames),
    worstPsnrAverage: readWorstMetric(numericPsnrFrames),
  }
}

function readMetricNumber(value) {
  if (value === 'inf') {
    return Number.POSITIVE_INFINITY
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readMeanMetric(values) {
  if (values.length === 0) {
    return null
  }
  if (values.every(value => value.value === Number.POSITIVE_INFINITY)) {
    return 'inf'
  }
  const finiteValues = values
    .map(value => value.value)
    .filter(value => Number.isFinite(value))
  if (finiteValues.length === 0) {
    return null
  }
  return finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length
}

function readWorstMetric(values) {
  if (values.length === 0) {
    return null
  }
  return values.reduce((worst, value) => {
    if (!worst) {
      return value
    }
    if (value.value < worst.value) {
      return value
    }
    return worst
  }, null)
}

function areSameImageDimensions(left, right) {
  return Boolean(
    left
      && right
      && left.width === right.width
      && left.height === right.height
      && left.format === right.format,
  )
}

function createParityAnimationTarget(context, destinationFrameOverride) {
  const baseTarget = context.animationTarget
  const workArea = baseTarget.codexDisplay.workArea
  const scaleFactor = baseTarget.codexDisplay.scaleFactor
  const geometryScale = baseTarget.coordinateSpace === 'pixels' || baseTarget.coordinateSpace === 'viewportPixels'
    ? scaleFactor
    : 1
  const destinationFrame = destinationFrameOverride ?? readDefaultComposerDestinationFrame(workArea, geometryScale)
  return {
    ...baseTarget,
    destinationBackgroundColor: '#ffffff',
    destinationCornerRadius: 0,
    destinationFrame,
    destinationPrimaryTextColor: '#111111',
    transitionSnapshotScale: scaleFactor,
  }
}

function readDefaultComposerDestinationFrame(workArea, scaleFactor) {
  const width = 232 * scaleFactor
  const height = 140 * scaleFactor
  return {
    x: workArea.x + (workArea.width - width) / 2,
    y: workArea.y + workArea.height - height - 36,
    width,
    height,
  }
}

function formatMarkdownReport(report) {
  const formatImage = image => image ? `${image.width}x${image.height} ${image.format}` : 'unknown image'
  const formatHash = value => value ? ` sha256=${value.slice(0, 16)}...` : ''
  const formatAsset = asset => `- ${asset.kind}: \`${asset.relativePath}\` (${asset.size} bytes, ${formatImage(asset.image)},${formatHash(asset.sha256)})`
  const formatRecording = recording => {
    if (!recording) {
      return null
    }
    const media = recording.media
    const details = media
      ? `, ${media.width ?? '?'}x${media.height ?? '?'}, ${media.durationSeconds ?? '?'}s, ${media.averageFrameRate ?? '?'} fps, codec=${media.codecName ?? 'unknown'}`
      : ''
    const errors = [
      recording.recordingError ? `recordingError=${recording.recordingError.message}` : null,
      recording.triggerError ? `triggerError=${recording.triggerError.message}` : null,
    ].filter(Boolean)
    const backend = recording.recordingBackend ? `, backend=${recording.recordingBackend}` : ''
    const attempts = Array.isArray(recording.recordingAttempts) && recording.recordingAttempts.length > 0
      ? `, attempts=${recording.recordingAttempts.map(attempt => `${attempt.backend}:${attempt.status}`).join('|')}`
      : ''
    const errorSuffix = errors.length > 0 ? `, ${errors.join(', ')}` : ''
    return `\`${recording.relativePath}\` (${recording.size} bytes${details}${backend}${attempts}${errorSuffix})`
  }
  const formatFrames = frames => {
    if (!frames) {
      return null
    }
    const windowSuffix = frames.comparisonWindow
      ? `, window=${frames.comparisonWindow.durationSeconds}s`
      : ''
    return `\`${frames.relativePath}\` (${frames.frameCount} frames at ${frames.frameRate} fps${windowSuffix}, first=${frames.firstFrame?.sha256?.slice(0, 16) ?? 'none'}, last=${frames.lastFrame?.sha256?.slice(0, 16) ?? 'none'})`
  }
  const formatComparisonWindow = window => {
    if (!window) {
      return '- Not available'
    }
    return [
      `- Source: ${window.source}`,
      `- Duration: ${window.durationSeconds}s`,
      `- Codex raw duration: ${window.codexDurationSeconds}s`,
      `- Cradle raw duration: ${window.cradleDurationSeconds}s`,
    ].join('\n')
  }
  const targetLock = report.targetLock
    ? [
        `- Matched: ${report.targetLock.matched}`,
        `- Requested window id: ${report.targetLock.requested.windowId}`,
        `- Requested process id: ${report.targetLock.requested.processId}`,
        `- Captured window id: ${report.targetLock.capturedWindow?.windowId ?? 'none'}`,
        `- Captured process id: ${report.targetLock.capturedWindow?.processId ?? 'none'}`,
      ].join('\n')
    : '- Not recorded'
  const screenCaptureKit = report.screenCaptureKit
    ? [
        `- Status: ${report.screenCaptureKit.status}`,
        `- Supported: ${report.screenCaptureKit.supported}`,
        `- Display count: ${report.screenCaptureKit.displayCount ?? 'unknown'}`,
        `- Window count: ${report.screenCaptureKit.windowCount ?? 'unknown'}`,
        `- Application count: ${report.screenCaptureKit.applicationCount ?? 'unknown'}`,
        `- Error: ${report.screenCaptureKit.error?.message ?? 'none'}`,
      ].join('\n')
    : '- Not recorded'
  const codexAssets = report.codex.assets
    .map(formatAsset)
    .join('\n') || '- None'
  const observedCodexAssets = report.codex.observedAssets
    .map(formatAsset)
    .join('\n') || '- None'
  const cradleAssets = report.cradle.assets
    .map(formatAsset)
    .join('\n') || '- None'
  const recordings = report.recordings.enabled
    ? [
        report.recordings.codex ? `- Codex: ${formatRecording(report.recordings.codex)}` : '- Codex: missing',
        report.recordings.cradle ? `- Cradle: ${formatRecording(report.recordings.cradle)}` : '- Cradle: missing',
      ].join('\n')
    : '- Disabled for this run'
  const frameInputs = report.frameInputs.enabled
    ? [
        report.frameInputs.codex ? `- Codex frames: ${formatFrames(report.frameInputs.codex)}` : '- Codex frames: missing',
        report.frameInputs.cradle ? `- Cradle frames: ${formatFrames(report.frameInputs.cradle)}` : '- Cradle frames: missing',
      ].join('\n')
    : '- Disabled for this run'
  const presentationFrameInputs = report.presentationFrameInputs?.enabled
    ? [
        report.presentationFrameInputs.codex ? `- Codex frames: ${formatFrames(report.presentationFrameInputs.codex)}` : '- Codex frames: missing',
        report.presentationFrameInputs.cradle ? `- Cradle presentation frames: ${formatFrames(report.presentationFrameInputs.cradle)}` : '- Cradle presentation frames: missing',
      ].join('\n')
    : '- No Cradle native presentation frame inputs were available.'
  const videoComparison = report.videoComparison.enabled
    ? report.videoComparison.result
      ? [
          `- Window: ${report.videoComparison.result.comparisonWindow?.durationSeconds ?? 'untrimmed'}s`,
          `- SSIM all: ${report.videoComparison.result.ssim?.all ?? 'missing'} (${report.videoComparison.result.ssim?.db ?? 'missing'} dB)`,
          `- PSNR average: ${report.videoComparison.result.psnr?.average ?? 'missing'}`,
        ].join('\n')
      : '- Missing comparison result'
    : '- Disabled for this run'
  const directTranscripts = report.codex.direct.transcripts.length > 0
    ? report.codex.direct.transcripts
        .map((entry) => {
          const label = [
            entry.phase,
            entry.index !== undefined ? `#${entry.index + 1}` : null,
            entry.type ? `type=${entry.type}` : null,
            entry.transcript?.status ? `status=${entry.transcript.status}` : null,
          ].filter(Boolean).join(' ')
          return [
            `- ${label}`,
            '',
            '```json',
            JSON.stringify(entry.transcript, null, 2),
            '```',
          ].join('\n')
        })
        .join('\n\n')
    : '- None'
  const codexAppshotEvidence = report.codex.appshotEvidence
    ? [
        `- Occurred: ${report.codex.appshotEvidence.occurred}`,
        `- Sources: ${report.codex.appshotEvidence.sources.join(', ') || 'none'}`,
        `- Direct status: ${report.codex.appshotEvidence.directStatus}`,
        `- Direct update types: ${report.codex.appshotEvidence.directUpdateTypes.join(', ') || 'none'}`,
        `- Direct asset count: ${report.codex.appshotEvidence.directAssetCount}`,
        `- Observed asset count: ${report.codex.appshotEvidence.observedAssetCount}`,
        `- Static image comparisons: ${report.codex.appshotEvidence.imageComparisonEvidence?.comparisonCount ?? 0}`,
        `- Static exact hash matches: ${report.codex.appshotEvidence.imageComparisonEvidence?.exactHashMatchCount ?? 0}`,
        `- Static dimension matches: ${report.codex.appshotEvidence.imageComparisonEvidence?.dimensionMatchCount ?? 0}`,
        `- Static metrics computed: ${report.codex.appshotEvidence.imageComparisonEvidence?.computedMetricCount ?? 0}`,
        `- Video transition detected: ${report.codex.appshotEvidence.videoTransitionEvidence?.detected ?? false}`,
        `- Video transition start index: ${report.codex.appshotEvidence.videoTransitionEvidence?.startIndex ?? 'none'}`,
        `- Video transition detection status: ${report.codex.appshotEvidence.videoTransitionEvidence?.status ?? 'not-evaluated'}`,
      ].join('\n')
    : '- Not evaluated'
  const cradleAppshotEvidence = report.cradle.appshotEvidence
    ? [
        `- Captured: ${report.cradle.appshotEvidence.captured}`,
        `- Capture backend: ${report.cradle.appshotEvidence.captureBackend ?? 'none'}`,
        `- Capture image size: ${formatCaptureImageSize(report.cradle.appshotEvidence.captureImageSize)}`,
        `- Source frame evidence: ${formatSourceFrameEvidence(report.cradle.appshotEvidence.sourceFrameEvidence)}`,
        `- Recording backend: ${report.cradle.appshotEvidence.recordingBackend ?? 'none'}`,
        `- Recording error: ${report.cradle.appshotEvidence.recordingError?.message ?? 'none'}`,
        `- Trigger error: ${report.cradle.appshotEvidence.triggerError?.message ?? 'none'}`,
        `- Video transition detected: ${report.cradle.appshotEvidence.videoTransitionEvidence?.detected ?? false}`,
        `- Video transition start index: ${report.cradle.appshotEvidence.videoTransitionEvidence?.startIndex ?? 'none'}`,
        `- Video transition detection status: ${report.cradle.appshotEvidence.videoTransitionEvidence?.status ?? 'not-evaluated'}`,
        `- Native presentation motion detected: ${report.cradle.appshotEvidence.nativePresentationEvidence?.motionDetected ?? false}`,
        `- Native presentation samples: ${report.cradle.appshotEvidence.nativePresentationEvidence?.sampleCount ?? 0}`,
        `- Native presentation image hashes: ${report.cradle.appshotEvidence.nativePresentationEvidence?.uniqueImageHashCount ?? 0}`,
        `- Native presentation geometry changes: ${report.cradle.appshotEvidence.nativePresentationEvidence?.changedSnapshotFrameCount ?? 0}`,
        `- Native presentation shadow changes: ${formatShadowFrameChangeCounts(report.cradle.appshotEvidence.nativePresentationEvidence?.shadowFrameChangeCounts)}`,
        `- Native white layer: ${formatWhiteLayerEvidence(report.cradle.appshotEvidence.nativePresentationEvidence?.whiteLayerEvidence)}`,
        `- Native AppShot geometry: ${formatNativeGeometryEvidence(report.cradle.appshotEvidence.nativePresentationEvidence?.nativeGeometryEvidence)}`,
        `- Native snapshot contents: ${formatSnapshotContentEvidence(report.cradle.appshotEvidence.nativePresentationEvidence?.snapshotContentEvidence)}`,
        `- Native presentation opacity changes: ${report.cradle.appshotEvidence.nativePresentationEvidence?.changedOpacityKeys?.join(', ') || 'none'}`,
      ].join('\n')
    : '- Not evaluated'
  const appshotVisibilityProbe = report.cradle.visibilityProbe
    ? [
        `- Panel window number: ${report.cradle.visibilityProbe.panelWindowNumber ?? 'none'}`,
        `- Samples: ${report.cradle.visibilityProbe.summary?.sampleCount ?? 0}`,
        `- Panel found in CG window list: ${report.cradle.visibilityProbe.summary?.panelFoundCount ?? 0}`,
        `- Probe images written: ${report.cradle.visibilityProbe.summary?.imageWrittenCount ?? 0}`,
        `- Unique probe image hashes: ${report.cradle.visibilityProbe.summary?.uniqueImageHashCount ?? 0}`,
        `- First image hash: ${report.cradle.visibilityProbe.summary?.firstImageHash?.slice(0, 16) ?? 'none'}`,
        `- Last image hash: ${report.cradle.visibilityProbe.summary?.lastImageHash?.slice(0, 16) ?? 'none'}`,
      ].join('\n')
    : '- Not evaluated'
  const appshotPresentationProbe = report.cradle.presentationProbe
    ? [
        `- Panel window number: ${report.cradle.presentationProbe.panelWindowNumber ?? 'none'}`,
        `- Samples: ${report.cradle.presentationProbe.summary?.sampleCount ?? 0}`,
        `- Probe images written: ${report.cradle.presentationProbe.summary?.imageWrittenCount ?? 0}`,
        `- Unique probe image hashes: ${report.cradle.presentationProbe.summary?.uniqueImageHashCount ?? 0}`,
        `- Motion detected: ${report.cradle.presentationProbe.summary?.motionDetected ?? false}`,
        `- Snapshot frame changes: ${report.cradle.presentationProbe.summary?.changedSnapshotFrameCount ?? 0}`,
        `- Shadow frame changes: ${formatShadowFrameChangeCounts(report.cradle.presentationProbe.summary?.shadowFrameChangeCounts)}`,
        `- White layer: ${formatWhiteLayerEvidence(report.cradle.presentationProbe.summary?.whiteLayerEvidence)}`,
        `- AppShot geometry: ${formatNativeGeometryEvidence(report.cradle.presentationProbe.summary?.nativeGeometryEvidence)}`,
        `- Snapshot contents: ${formatSnapshotContentEvidence(report.cradle.presentationProbe.summary?.snapshotContentEvidence)}`,
        `- Opacity changes: ${report.cradle.presentationProbe.summary?.changedOpacityKeys?.join(', ') || 'none'}`,
        `- First image hash: ${report.cradle.presentationProbe.summary?.firstImageHash?.slice(0, 16) ?? 'none'}`,
        `- Last image hash: ${report.cradle.presentationProbe.summary?.lastImageHash?.slice(0, 16) ?? 'none'}`,
      ].join('\n')
    : '- Not evaluated'
  const codexObserve = report.codex.observe
    ? [
        `- Window: ${report.codex.observe.seconds}s`,
        `- Poll interval: ${report.codex.observe.pollIntervalMs}ms`,
        `- Wait reason: ${report.codex.observe.wait?.reason ?? 'not-run'}`,
        `- Changed assets detected: ${report.codex.observe.wait?.changedCount ?? 0}`,
        `- Waited: ${report.codex.observe.wait?.waitedMs ?? 0}ms`,
      ].join('\n')
    : '- Not used'
  const imageComparisons = report.imageComparisons.length > 0
    ? report.imageComparisons.map(formatImageComparison).join('\n')
    : '- No comparable Codex and Cradle image assets were available.'
  const frameComparison = report.frameComparison
    ? formatFrameComparison(report.frameComparison)
    : '- No paired Codex and Cradle frame inputs were available.'
  const rawFrameComparison = report.rawFrameComparison
    ? formatFrameComparison(report.rawFrameComparison)
    : '- No raw paired Codex and Cradle frame inputs were available.'
  const alignedFrameComparison = report.alignedFrameComparison
    ? formatFrameComparison(report.alignedFrameComparison)
    : '- No aligned paired Codex and Cradle frame inputs were available.'
  const presentationFrameComparison = report.presentationFrameComparison
    ? formatFrameComparison(report.presentationFrameComparison)
    : '- No paired Codex recording frames and Cradle native presentation frames were available.'
  const transitionFrameAlignment = formatTransitionFrameAlignment(report.transitionFrameAlignment)
  const soundComparison = formatSoundComparison(report.sound)
  const missingEvidence = report.parityStatus.missingEvidence
    .map(item => `- ${item}`)
    .join('\n') || '- None'

  return `# Appshot Parity Report

Generated at: ${report.generatedAt}

## Context

- Frontmost app: ${report.context.window.appName ?? 'Unknown'}
- Bundle identifier: ${report.context.bundleIdentifier ?? 'Unknown'}
- Window title: ${report.context.window.title ?? 'Unknown'}
- Window id: ${report.context.window.windowId}
- Request id: \`${report.requestId}\`
- Source window frame:

\`\`\`json
${JSON.stringify(report.context.window.bounds, null, 2)}
\`\`\`

- Animation destination frame:

\`\`\`json
${JSON.stringify(report.animationTarget.destinationFrame, null, 2)}
\`\`\`

## Source Window Lock

${targetLock}

## ScreenCaptureKit Diagnostics

${screenCaptureKit}

## Codex Private Capture

- Service running: ${report.codex.service.running}
- Service process id: ${report.codex.service.processIdentifier ?? 'None'}
- Source mode: ${report.codex.source}
- Direct Apple Event status: ${report.codex.direct.status}
- Direct Apple Event error:

\`\`\`json
${JSON.stringify(report.codex.direct.error, null, 2)}
\`\`\`

### Direct Apple Event Transcripts

${directTranscripts}

- Start calibration:

\`\`\`json
${JSON.stringify(report.codex.start ?? null, null, 2)}
\`\`\`

- Updates: ${report.codex.updates.map(update => update.type).join(', ')}

### Codex Assets

${codexAssets}

### Observed Codex Temp Assets

${observedCodexAssets}

### Codex Observe Window

${codexObserve}

### Codex AppShot Evidence

${codexAppshotEvidence}

## Cradle Native Capture

- Capture backend: ${report.cradle.capture?.captureBackend ?? 'Unknown'}
- Capture image size: ${formatCaptureImageSize(report.cradle.capture?.captureImageSize)}
- Source frame evidence: ${formatSourceFrameEvidence(report.cradle.appshotEvidence?.sourceFrameEvidence)}
- Captured image: ${report.cradle.capture?.filePath ? `\`${report.cradle.capture.filePath}\`` : 'None'}
- Metadata: ${report.cradle.capture?.metadataPath ? `\`${report.cradle.capture.metadataPath}\`` : 'None'}
- Applied calibration:

\`\`\`json
${JSON.stringify(report.appliedCalibration, null, 2)}
\`\`\`

### Cradle Assets

${cradleAssets}

### Cradle AppShot Evidence

${cradleAppshotEvidence}

### AppShot Visibility Probe

${appshotVisibilityProbe}

### AppShot Presentation Probe

${appshotPresentationProbe}

## Recordings

- Requested backend: ${report.recordings.backend}

${recordings}

## Comparison Window

${formatComparisonWindow(report.comparisonWindow)}

## Frame Inputs

${frameInputs}

## Presentation Frame Inputs

${presentationFrameInputs}

## Transition Frame Alignment

${transitionFrameAlignment}

## Video Comparison

${videoComparison}

## Image Comparisons

${imageComparisons}

## Frame Comparison

Gate comparison:

${frameComparison}

Raw frame comparison:

${rawFrameComparison}

Aligned frame comparison:

${alignedFrameComparison}

Native presentation frame diagnostic comparison:

${presentationFrameComparison}

## Sound Comparison

${soundComparison}

## Parity Status

- Proven 100% same: ${report.parityStatus.provenPixelPerfect}

Missing evidence before claiming 100% same:

${missingEvidence}
`
}

function formatImageComparison(comparison) {
  const left = `${comparison.codex.kind} -> ${comparison.cradle.kind}`
  const dimensionStatus = comparison.dimensionsMatch ? 'same dimensions' : 'different dimensions'
  const exactStatus = comparison.exactHashMatch ? 'exact hash match' : 'different hash'
  const metricStatus = comparison.metrics
    ? `SSIM=${comparison.metrics.ssim?.all ?? 'missing'}, PSNR=${comparison.metrics.psnr?.average ?? 'missing'}`
    : `metrics=${comparison.metricStatus}`
  return `- ${left}: ${dimensionStatus}, ${exactStatus}, ${metricStatus}`
}

function formatFrameComparison(comparison) {
  const summary = comparison.summary
  const diffFrames = comparison.frames
    .filter(frame => frame.diff)
    .slice(0, 8)
    .map(frame => `  - frame ${frame.index}: \`${frame.diff.relativePath}\``)
  const diffList = diffFrames.length > 0
    ? ['- Diff artifacts:', ...diffFrames].join('\n')
    : '- Diff artifacts: none'
  const worstSsim = summary.worstSsimAll
    ? `frame ${summary.worstSsimAll.index} = ${formatMetricValue(summary.worstSsimAll.value)}`
    : 'missing'
  const worstPsnr = summary.worstPsnrAverage
    ? `frame ${summary.worstPsnrAverage.index} = ${formatMetricValue(summary.worstPsnrAverage.value)}`
    : 'missing'
  return [
    `- Compared frames: ${comparison.comparedFrameCount}`,
    `- Unmatched frames: ${comparison.unmatchedFrameCount}`,
    `- Exact hash matches: ${summary.exactHashMatchCount}`,
    `- Diff artifacts written: ${comparison.diffCount ?? 0}`,
    `- Dimension mismatches: ${summary.dimensionMismatchCount}`,
    `- Metric failures: ${summary.metricFailureCount}`,
    `- Mean SSIM all: ${formatMetricValue(summary.meanSsimAll)}`,
    `- Worst SSIM all: ${worstSsim}`,
    `- Mean PSNR average: ${formatMetricValue(summary.meanPsnrAverage)}`,
    `- Worst PSNR average: ${worstPsnr}`,
    diffList,
  ].join('\n')
}

function formatTransitionFrameAlignment(alignment) {
  if (!alignment) {
    return '- Not evaluated'
  }
  const formatStart = start => start
    ? [
        `status=${start.status}`,
        `index=${start.index ?? 'none'}`,
        `trigger=${start.trigger ? `frame ${start.trigger.previousIndex}->${start.trigger.index}, SSIM=${formatMetricValue(start.trigger.ssimAll)}` : 'none'}`,
        `transitions=${start.transitions?.length ?? 0}`,
      ].join(', ')
    : 'missing'
  return [
    `- Status: ${alignment.status}`,
    `- Codex start index: ${alignment.codexStartIndex ?? 'none'}`,
    `- Cradle start index: ${alignment.cradleStartIndex ?? 'none'}`,
    `- Frame offset: ${alignment.frameOffset ?? 'none'}`,
    `- Compared aligned frames: ${alignment.comparedFrameCount}`,
    `- Required frames: ${alignment.requiredFrameCount ?? 'unknown'}`,
    `- Options: frameRate=${alignment.options?.frameRate ?? 'unknown'}, SSIM threshold=${alignment.options?.ssimThreshold ?? 'unknown'}, consecutive=${alignment.options?.consecutiveFrameCount ?? 'unknown'}`,
    `- Codex detection: ${formatStart(alignment.codexStart)}`,
    `- Cradle detection: ${formatStart(alignment.cradleStart)}`,
  ].join('\n')
}

function formatSoundComparison(sound) {
  const formatAudio = asset => {
    if (!asset) {
      return 'missing'
    }
    const audio = asset.audio?.error
      ? `audioError=${asset.audio.error.message}`
      : `codec=${asset.audio?.codecName ?? 'unknown'}, duration=${asset.audio?.durationSeconds ?? 'unknown'}s, sampleRate=${asset.audio?.sampleRate ?? 'unknown'}, channels=${asset.audio?.channels ?? 'unknown'}`
    return `\`${asset.relativePath}\` (${asset.size} bytes, sha256=${asset.sha256.slice(0, 16)}..., ${audio})`
  }
  return [
    `- Codex: ${formatAudio(sound.codex)}`,
    `- Cradle: ${formatAudio(sound.cradle)}`,
    `- Byte identical: ${sound.byteIdentical}`,
    `- Metadata identical: ${sound.metadataIdentical}`,
  ].join('\n')
}

function formatShadowFrameChangeCounts(counts) {
  if (!counts) {
    return 'none'
  }
  return [
    `shadow=${counts.shadow ?? 0}`,
    `destination=${counts.destination ?? 0}`,
    `key=${counts.key ?? 0}`,
    `ambient=${counts.ambient ?? 0}`,
  ].join(', ')
}

function formatCaptureImageSize(size) {
  if (!size) {
    return 'none'
  }
  return `${size.pixelWidth}x${size.pixelHeight}px`
}

function formatSourceFrameEvidence(evidence) {
  if (!evidence) {
    return 'none'
  }
  if (!evidence.available) {
    return `available=false, matches=false, scale=${evidence.sourceScale ?? 'none'}`
  }
  const captureSize = evidence.capturePointSize
    ? `${formatMetricValue(evidence.capturePointSize.width)}x${formatMetricValue(evidence.capturePointSize.height)}pt`
    : 'none'
  const sourceFrame = evidence.sourceFrame
    ? `${formatMetricValue(evidence.sourceFrame.width)}x${formatMetricValue(evidence.sourceFrame.height)}pt`
    : 'none'
  return [
    `available=${evidence.available}`,
    `matches=${evidence.matchesCaptureImageSize}`,
    `capture=${captureSize}`,
    `source=${sourceFrame}`,
    `scale=${evidence.sourceScale ?? 'none'}`,
    `delta=${formatMetricValue(evidence.widthDelta)}x${formatMetricValue(evidence.heightDelta)}`,
  ].join(', ')
}

function formatWhiteLayerEvidence(evidence) {
  if (!evidence) {
    return 'none'
  }
  return [
    `startsVisible=${evidence.startsVisible}`,
    `fadesInVisible=${evidence.fadesInVisible}`,
    `opacityChanges=${evidence.coverOpacityChanges && evidence.shutterOpacityChanges}`,
    `maxOpacity=${formatMetricValue(evidence.maxCoverOpacity)}/${formatMetricValue(evidence.maxShutterOpacity)}`,
    `coverWhite=${evidence.coverIsWhite}`,
    `shutterWhite=${evidence.shutterIsWhite}`,
    `coverRadius=${evidence.firstCoverCornerRadius ?? 'none'}`,
    `shutterRadius=${evidence.firstShutterCornerRadius ?? 'none'}`,
  ].join(', ')
}

function formatNativeGeometryEvidence(evidence) {
  if (!evidence) {
    return 'none'
  }
  return [
    `startShutterOnContent=${evidence.firstShutterMatchesSourceContentBounds}`,
    `startShadowOnContent=${evidence.firstShadowMatchesSourceContentFrame}`,
    `startSnapshotImageOnCapture=${evidence.firstSnapshotImageMatchesCaptureFrame}`,
    `endShutterOnSlot=${evidence.lastShutterMatchesDestinationBounds}`,
    `endSnapshotOnSlot=${evidence.lastSnapshotMatchesDestinationBounds}`,
    `endShadowOnSlot=${evidence.lastShadowMatchesDestinationFrame}`,
  ].join(', ')
}

function formatSnapshotContentEvidence(evidence) {
  if (!evidence) {
    return 'none'
  }
  return [
    `hasContents=${evidence.hasContents}`,
    `contentsScale=${evidence.contentsScale ?? 'none'}`,
    `backgroundWhite=${evidence.backgroundIsWhite}`,
  ].join(', ')
}

function formatMetricValue(value) {
  if (value === null || value === undefined) {
    return 'missing'
  }
  if (value === Number.POSITIVE_INFINITY || value === 'inf') {
    return 'inf'
  }
  return typeof value === 'number' ? String(value) : value
}

async function run() {
  const options = parseArgs(process.argv.slice(2))
  if (process.platform !== 'darwin') {
    throw new Error('Appshot parity recording is only available on macOS.')
  }

  const binaryPath = await readExistingBridgeBinary(options.binaryPath)
  if (!await isExecutableFile(binaryPath)) {
    throw new Error(`Mac Bridge binary is missing: ${binaryPath}. Run pnpm --filter @cradle/desktop build:mac-bridge first.`)
  }

  const outputDir = resolve(options.outputDir ?? readDefaultOutputDir())
  const artifactsDir = resolve(outputDir, 'artifacts')
  await mkdir(outputDir, { recursive: true })
  await mkdir(artifactsDir, { recursive: true })

  const client = new BridgeClient(binaryPath)
  client.start()
  try {
    logStage('bridge-status-begin', { binaryPath })
    const bridge = await client.request('bridge.status')
    logStage('bridge-status-end', { pid: bridge.pid })
    logStage('permissions-begin')
    const permissions = await client.request('mac.permissions.status')
    logStage('permissions-end', permissions)
    logStage('screen-capture-kit-diagnostics-begin')
    const screenCaptureKit = await client.request('mac.screenCaptureKit.diagnostics', {}, 12_000)
    logStage('screen-capture-kit-diagnostics-end', {
      status: screenCaptureKit.status,
      displayCount: screenCaptureKit.displayCount,
      windowCount: screenCaptureKit.windowCount,
      applicationCount: screenCaptureKit.applicationCount,
      error: screenCaptureKit.error?.message,
    })
    logStage('frontmost-context-begin')
    const context = await client.request('mac.appshot.frontmostContext')
    logStage('frontmost-context-end', {
      bundleIdentifier: context.bundleIdentifier,
      windowId: context.window?.windowId,
      appName: context.window?.appName,
    })
    const recordingDir = resolve(outputDir, 'recordings')
    const animationTarget = createParityAnimationTarget(context, options.destinationFrame)
    const targetWindow = readCaptureTargetWindow(context)
    const shouldObserve = true
    let codexBaseline = new Map()
    let codexObserveStartedAtMs = null
    let codexRecording = null
    let codexObserveWait = null
    const start = null
    let codex = { updates: [], assets: [] }
    const direct = {
      status: 'removed',
      error: null,
    }

    if (shouldObserve) {
      codexBaseline = await readCodexTmpAssetInventory()
      codexObserveStartedAtMs = Date.now()
      logStage('codex-observe-begin', {
        seconds: options.observeSeconds,
        baselineCount: codexBaseline.size,
      })
      const observeCodexAppshot = async () => {
        if (options.codexSource === 'observe') {
          console.log('Trigger Codex AppShot from the Codex UI now; Cradle will observe Codex temp assets and video.')
        }
        codexObserveWait = await waitForObservedCodexAssets({
          baseline: codexBaseline,
          startedAtMs: codexObserveStartedAtMs,
          timeoutMs: options.observeSeconds * 1000,
          pollIntervalMs: options.observePollIntervalMs,
        })
        logStage('codex-observe-wait-end', codexObserveWait)
      }
      if (options.recordVideo) {
        const recording = await recordTransitionVideo(
          resolve(recordingDir, 'codex-observed-appshot.mov'),
          options.observeSeconds,
          observeCodexAppshot,
          options.recordingBackend,
          client,
          {
            windowRecordingTarget: readCodexWindowRecordingTarget(animationTarget, options.observeSeconds),
            postTriggerDelayMs: () => Math.max(
              0,
              options.observeSeconds * 1000 - (codexObserveWait?.waitedMs ?? options.observeSeconds * 1000),
            ),
          },
        )
        codexRecording = {
          ...recording,
          relativePath: relative(outputDir, recording.path),
        }
        if (recording.recordingError) {
          logStage('codex-observe-recording-failed', recording.recordingError)
        }
        if (recording.triggerError) {
          logStage('codex-observe-trigger-failed', recording.triggerError)
        }
      }
      else {
        await observeCodexAppshot()
      }
    }

    const observedAssets = shouldObserve
      ? await collectObservedCodexAssets({
          baseline: codexBaseline,
          reportDir: outputDir,
          startedAtMs: codexObserveStartedAtMs,
        })
      : []
    if (shouldObserve) {
      logStage('codex-observe-end', { observedAssetCount: observedAssets.length })
    }

    const appliedCalibration = readAppliedCalibration(start)
    let cradleCapture
    const startCradleCapture = async () => {
      logStage('cradle-native-capture-begin')
      cradleCapture = await client.request('mac.appshot.captureFrontmostWindow', {
        outputDir: resolve(artifactsDir, 'cradle-native'),
        targetWindow,
        animationTarget,
        soundEnabled: options.soundEnabled,
        ...appliedCalibration,
      }, 30_000)
      logStage('cradle-native-capture-end', {
        filePath: cradleCapture.filePath,
        captureBackend: cradleCapture.captureBackend,
        windowId: cradleCapture.window?.windowId,
        processId: cradleCapture.window?.processId,
      })
    }
    let cradleRecording = null
    if (options.recordVideo) {
      const recording = await recordTransitionVideo(
        resolve(recordingDir, 'cradle-native-appshot.mov'),
        options.recordingSeconds,
        startCradleCapture,
        options.recordingBackend,
        client,
        {
          windowRecordingTarget: readCradleWindowRecordingTarget(bridge, animationTarget, options.recordingSeconds),
          retryAfterTriggeredRecordingFailure: true,
        },
      )
      cradleRecording = {
        ...recording,
        relativePath: relative(outputDir, recording.path),
      }
      if (recording.recordingError) {
        logStage('cradle-recording-failed', recording.recordingError)
      }
      if (!recording.triggered && recording.recordingError) {
        await startCradleCapture()
      }
      if (recording.triggerError) {
        throw new Error(`Cradle native Appshot trigger failed: ${JSON.stringify(recording.triggerError)}`)
      }
    }
    else {
      await startCradleCapture()
    }

    logStage('cradle-visibility-probe-begin')
    let cradleVisibilityProbe = null
    try {
      const rawVisibilityProbe = await client.request('mac.appshot.probeTransitionVisibility', {
        outputDir: resolve(artifactsDir, 'cradle-native-visibility-probe'),
        screenshotPath: cradleCapture.filePath,
        sourceWindow: cradleCapture.window,
        animationTarget,
        soundEnabled: false,
        sampleCount: 14,
        sampleIntervalSeconds: 0.12,
        animationDuration: Math.max(readPositiveFiniteNumber(appliedCalibration.animationDuration) ?? defaultAppshotAnimationDurationSeconds, 1.8),
        ...appliedCalibration,
      }, 30_000)
      cradleVisibilityProbe = await readAppshotVisibilityProbeEvidence(rawVisibilityProbe, outputDir)
      logStage('cradle-visibility-probe-end', cradleVisibilityProbe?.summary ?? {})
    }
    catch (error) {
      cradleVisibilityProbe = {
        error: serializeError(error),
        summary: null,
      }
      logStage('cradle-visibility-probe-failed', cradleVisibilityProbe.error)
    }

    logStage('cradle-presentation-probe-begin')
    let cradlePresentationProbe = null
    try {
      const rawPresentationProbe = await client.request('mac.appshot.probeTransitionPresentation', {
        outputDir: resolve(artifactsDir, 'cradle-native-presentation-probe'),
        screenshotPath: cradleCapture.filePath,
        sourceWindow: cradleCapture.window,
        animationTarget,
        soundEnabled: false,
        sampleCount: Math.max(Math.ceil(options.frameRate * Math.max(readPositiveFiniteNumber(appliedCalibration.animationDuration) ?? defaultAppshotAnimationDurationSeconds, 1.8)), 16),
        sampleIntervalSeconds: 1 / options.frameRate,
        animationDuration: Math.max(readPositiveFiniteNumber(appliedCalibration.animationDuration) ?? defaultAppshotAnimationDurationSeconds, 1.8),
        ...appliedCalibration,
      }, 30_000)
      cradlePresentationProbe = await readAppshotPresentationProbeEvidence(rawPresentationProbe, outputDir)
      logStage('cradle-presentation-probe-end', cradlePresentationProbe?.summary ?? {})
    }
    catch (error) {
      cradlePresentationProbe = {
        error: serializeError(error),
        summary: null,
      }
      logStage('cradle-presentation-probe-failed', cradlePresentationProbe.error)
    }

    let codexFrames = null
    let cradleFrames = null
    const comparisonWindow = readRecordingComparisonWindow(codexRecording, cradleRecording)
    if (options.extractFrames) {
      const frameDir = resolve(outputDir, 'frames')
      if (hasUsableRecording(codexRecording) || hasUsableRecording(cradleRecording)) {
        logStage('frames-extract-begin')
        if (hasUsableRecording(codexRecording)) {
          codexFrames = await extractVideoFrames(
            codexRecording.path,
            resolve(frameDir, 'codex'),
            options.frameRate,
            comparisonWindow,
          )
          codexFrames.relativePath = relative(outputDir, codexFrames.directory)
        }
        if (hasUsableRecording(cradleRecording)) {
          cradleFrames = await extractVideoFrames(
            cradleRecording.path,
            resolve(frameDir, 'cradle'),
            options.frameRate,
            comparisonWindow,
          )
          cradleFrames.relativePath = relative(outputDir, cradleFrames.directory)
        }
        logStage('frames-extract-end', {
          codexFrameCount: codexFrames?.frameCount ?? 0,
          cradleFrameCount: cradleFrames?.frameCount ?? 0,
        })
      }
      else {
        logStage('frames-extract-skipped', {
          reason: 'missing-recording',
          hasUsableCodexRecording: hasUsableRecording(codexRecording),
          hasUsableCradleRecording: hasUsableRecording(cradleRecording),
        })
      }
    }
    let videoComparison = null
    if (options.analyzeVideo) {
      if (hasUsableRecording(codexRecording) && hasUsableRecording(cradleRecording)) {
        logStage('video-analysis-begin')
        videoComparison = await compareVideos(codexRecording.path, cradleRecording.path, comparisonWindow)
        logStage('video-analysis-end', videoComparison)
      }
      else {
        logStage('video-analysis-skipped', {
          reason: 'missing-recording',
          hasUsableCodexRecording: hasUsableRecording(codexRecording),
          hasUsableCradleRecording: hasUsableRecording(cradleRecording),
        })
      }
    }
    const rawFrameComparison = await compareFrameInputs(
      codexFrames,
      cradleFrames,
      resolve(outputDir, 'frames', 'diff-raw'),
      outputDir,
    )
    const transitionFrameAlignment = await readTransitionFrameAlignment(
      codexFrames,
      cradleFrames,
      options,
      appliedCalibration,
    )
    const alignedFrameInputs = readAlignedFrameInputs(codexFrames, cradleFrames, transitionFrameAlignment)
    const alignedFrameComparison = await compareFrameInputs(
      alignedFrameInputs.codex,
      alignedFrameInputs.cradle,
      resolve(outputDir, 'frames', 'diff-aligned'),
      outputDir,
    )
    const frameComparison = alignedFrameComparison
    const cradlePresentationFrames = readPresentationProbeFrameInput(
      cradlePresentationProbe,
      options.frameRate,
      outputDir,
    )
    const presentationFrameComparison = await compareFrameInputs(
      codexFrames,
      cradlePresentationFrames,
      resolve(outputDir, 'frames', 'diff-presentation'),
      outputDir,
    )

    const cradleAssets = [
      { kind: 'capture', ...await copyCradleAsset(cradleCapture.filePath, outputDir, 'cradle-capture') },
    ]
    if (cradleCapture.appshot.transitionSnapshotPath) {
      cradleAssets.push({
        kind: 'transitionSnapshot',
        ...await copyCradleAsset(cradleCapture.appshot.transitionSnapshotPath, outputDir, 'cradle-transition-snapshot'),
      })
    }
    const imageComparisons = await compareImageAssets(
      [...codex.assets, ...observedAssets],
      cradleAssets,
    )
    const sound = await readAppshotSoundEvidence(outputDir, binaryPath)
    const targetLock = readTargetLockEvidence(context, targetWindow, cradleCapture)
    const codexAppshotEvidence = readCodexAppshotEvidence({
      source: options.codexSource,
      direct,
      start,
      updates: codex.updates,
      assets: codex.assets,
      observedAssets,
      imageComparisons,
      transitionFrameAlignment,
    })
    const cradleAppshotEvidence = readCradleAppshotEvidence({
      capture: cradleCapture,
      recording: cradleRecording,
      transitionFrameAlignment,
      presentationProbe: cradlePresentationProbe,
    })
    const parityStatus = readParityStatus({
      sound,
      imageComparisons,
      frameComparison,
      videoComparison,
      codexAppshotEvidence,
      cradleAppshotEvidence,
      targetLock,
      transitionFrameAlignment,
    })

    const report = {
      kind: 'cradle-appshot-parity-report',
      generatedAt: new Date().toISOString(),
      requestId: options.requestId,
      bridge,
      permissions,
      screenCaptureKit,
      binaryPath,
      context,
      targetLock,
      animationTarget,
      codex: {
        source: options.codexSource,
        service,
        direct: {
          ...direct,
          transcripts: readCodexTranscripts(start, codex.updates, direct.error),
        },
        start,
        updates: codex.updates,
        assets: codex.assets,
        observedAssets,
        appshotEvidence: codexAppshotEvidence,
        observe: shouldObserve
          ? {
              seconds: options.observeSeconds,
              pollIntervalMs: options.observePollIntervalMs,
              wait: codexObserveWait,
            }
          : null,
      },
      appliedCalibration,
      recordings: {
        enabled: options.recordVideo,
        seconds: options.recordingSeconds,
        backend: options.recordingBackend,
        codex: codexRecording,
        cradle: cradleRecording,
      },
      comparisonWindow,
      frameInputs: {
        enabled: options.extractFrames,
        frameRate: options.frameRate,
        codex: codexFrames,
        cradle: cradleFrames,
      },
      presentationFrameInputs: {
        enabled: Boolean(cradlePresentationFrames),
        frameRate: options.frameRate,
        codex: codexFrames,
        cradle: cradlePresentationFrames,
      },
      transitionFrameAlignment,
      presentationFrameComparison,
      videoComparison: {
        enabled: options.analyzeVideo,
        result: videoComparison,
      },
      imageComparisons,
      frameComparison,
      rawFrameComparison,
      alignedFrameComparison,
      sound,
      cradle: {
        capture: cradleCapture,
        assets: cradleAssets,
        appshotEvidence: cradleAppshotEvidence,
        visibilityProbe: cradleVisibilityProbe,
        presentationProbe: cradlePresentationProbe,
      },
      parityStatus,
    }

    await writeFile(resolve(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
    await writeFile(resolve(outputDir, 'README.md'), formatMarkdownReport(report))
    await writeFile(resolve(outputDir, 'frontmost-context.json'), `${JSON.stringify(context, null, 2)}\n`)
    logStage('report-written', { outputDir })
    console.log(`Wrote Appshot parity report to ${outputDir}`)
    console.log(`Open ${pathToFileURL(resolve(outputDir, 'README.md')).href}`)
    if (options.requireProvenParity && !parityStatus.provenPixelPerfect) {
      throw new Error(`Appshot parity is not proven. Missing evidence: ${parityStatus.missingEvidence.join(' | ')}`)
    }
  }
  finally {
    await client.stop()
  }
}

run().catch((error) => {
  console.error(formatError(error))
  process.exit(1)
})
