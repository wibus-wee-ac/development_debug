import type { ChildProcess } from 'node:child_process'
import { execSync, spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { getServerConfig } from '../../infra'

let chronicleProcess: ChildProcess | null = null
let lastExitCode: number | null = null
let lastExitAt: number | null = null
let currentOptions: ChronicleDaemonOptions | null = null
let pendingRestartOptions: ChronicleDaemonOptions | null = null

export interface ChronicleDaemonOptions {
  storageRoot: string
  audioCaptureEnabled: boolean
  audioSource: 'microphone' | 'system' | 'mixed'
  audioSegmentMs: number
  audioSegmentIntervalMs: number
  audioRmsThreshold: number
}

export function createDaemonArgs(options: ChronicleDaemonOptions): string[] {
  const args = ['--daemon', '--storage-root', options.storageRoot]
  if (options.audioCaptureEnabled) {
    args.push(
      '--audio-capture',
      '--audio-source',
      options.audioSource,
      '--audio-segment-ms',
      String(options.audioSegmentMs),
      '--audio-segment-interval-ms',
      String(options.audioSegmentIntervalMs),
      '--audio-rms-threshold',
      String(options.audioRmsThreshold),
    )
  }
  else {
    args.push('--no-audio-capture')
  }
  return args
}

function findChronicleBinary(): string {
  const candidates = [
    join(process.cwd(), '..', '..', 'chronicle', 'target', 'release', 'cradle-chronicle'),
    join(process.cwd(), '..', '..', 'chronicle', 'target', 'debug', 'cradle-chronicle'),
    join((process as { resourcesPath?: string }).resourcesPath ?? '', 'chronicle', 'cradle-chronicle'),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return 'cradle-chronicle'
}

export interface ChronicleEmbeddingBatch {
  modelId: string
  modelVersion: string
  dimensions: number
  embeddings: number[][]
}

export function runEmbeddingBatch(texts: string[], modelsRoot: string): ChronicleEmbeddingBatch {
  const binary = findChronicleBinary()
  const input = JSON.stringify({ texts })
  const result = spawnSync(binary, ['--embed-texts'], {
    input,
    encoding: 'utf8',
    env: {
      ...process.env,
      CRADLE_MODELS_DIR: modelsRoot,
    },
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `cradle-chronicle embedding exited with ${result.status}`)
  }
  const parsed = JSON.parse(result.stdout) as ChronicleEmbeddingBatch
  if (!Array.isArray(parsed.embeddings) || parsed.embeddings.length !== texts.length) {
    throw new Error('cradle-chronicle embedding response has an invalid embedding count')
  }
  return parsed
}

export function isRunning(): boolean {
  return chronicleProcess !== null && chronicleProcess.exitCode === null
}

export function getDaemonInfo() {
  return {
    running: isRunning(),
    pid: chronicleProcess?.pid ?? null,
    lastExitCode,
    lastExitAt,
    audioCaptureEnabled: isRunning() ? currentOptions?.audioCaptureEnabled ?? false : false,
    audioSource: isRunning() ? currentOptions?.audioSource ?? 'microphone' : 'microphone',
    restartPending: pendingRestartOptions !== null,
  }
}

export function getDaemonResources(): { running: boolean, pid: number | null, rssMB: number | null } {
  if (!isRunning() || !chronicleProcess?.pid) {
    return { running: false, pid: null, rssMB: null }
  }

  try {
    const output = execSync(`ps -o rss= -p ${chronicleProcess.pid}`, { encoding: 'utf8', timeout: 1000 })
    const rssKB = Number.parseInt(output.trim(), 10)
    return { running: true, pid: chronicleProcess.pid, rssMB: Number.isNaN(rssKB) ? null : rssKB / 1024 }
  }
  catch {
    return { running: true, pid: chronicleProcess.pid, rssMB: null }
  }
}

export function startDaemon(options: ChronicleDaemonOptions): boolean {
  if (isRunning()) return true

  const binary = findChronicleBinary()
  const cradleUrl = process.env.CRADLE_URL ?? buildServerUrl()
  const args = createDaemonArgs(options)

  try {
    chronicleProcess = spawn(binary, args, {
      env: {
        ...process.env,
        CRADLE_URL: cradleUrl,
        CRADLE_CHRONICLE_AUDIO_CAPTURE: options.audioCaptureEnabled ? '1' : '0',
        CRADLE_CHRONICLE_AUDIO_SOURCE: options.audioSource,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    })

    chronicleProcess.on('exit', (code) => {
      lastExitCode = code
      lastExitAt = Date.now()
      chronicleProcess = null
      currentOptions = null
      if (pendingRestartOptions) {
        const nextOptions = pendingRestartOptions
        pendingRestartOptions = null
        startDaemon(nextOptions)
      }
    })

    chronicleProcess.on('error', (err) => {
      console.error('[chronicle-daemon] spawn error:', err.message)
      chronicleProcess = null
      currentOptions = null
    })

    chronicleProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[chronicle-daemon]', data.toString().trimEnd())
    })

    currentOptions = options
    return true
  }
  catch (err) {
    console.error('[chronicle-daemon] failed to spawn:', err)
    return false
  }
}

export function restartDaemon(options: ChronicleDaemonOptions): boolean {
  if (!isRunning()) {
    return startDaemon(options)
  }
  pendingRestartOptions = options
  stopCurrentDaemon()
  return true
}

export function stopDaemon(): void {
  pendingRestartOptions = null
  stopCurrentDaemon()
}

function stopCurrentDaemon(): void {
  if (!chronicleProcess) return

  chronicleProcess.kill('SIGTERM')

  const pid = chronicleProcess.pid
  setTimeout(() => {
    if (chronicleProcess && chronicleProcess.pid === pid && chronicleProcess.exitCode === null) {
      chronicleProcess.kill('SIGKILL')
    }
  }, 5000)
}

export function cleanup(): void {
  stopDaemon()
}

function buildServerUrl(): string {
  const config = getServerConfig()
  const host = config.host.includes(':') && !config.host.startsWith('[')
    ? `[${config.host}]`
    : config.host
  return `http://${host}:${config.port}`
}
