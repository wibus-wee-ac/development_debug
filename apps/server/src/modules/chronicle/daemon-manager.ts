import type { ChildProcess } from 'node:child_process'
import { execSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { getServerConfig } from '../../infra'

let chronicleProcess: ChildProcess | null = null
let lastExitCode: number | null = null
let lastExitAt: number | null = null

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

export function isRunning(): boolean {
  return chronicleProcess !== null && chronicleProcess.exitCode === null
}

export function getDaemonInfo() {
  return {
    running: isRunning(),
    pid: chronicleProcess?.pid ?? null,
    lastExitCode,
    lastExitAt,
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

export function startDaemon(storageRoot: string): boolean {
  if (isRunning()) return true

  const binary = findChronicleBinary()
  const cradleUrl = process.env.CRADLE_URL ?? buildServerUrl()

  try {
    chronicleProcess = spawn(binary, ['--daemon', '--storage-root', storageRoot], {
      env: {
        ...process.env,
        CRADLE_URL: cradleUrl,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    })

    chronicleProcess.on('exit', (code) => {
      lastExitCode = code
      lastExitAt = Date.now()
      chronicleProcess = null
    })

    chronicleProcess.on('error', (err) => {
      console.error('[chronicle-daemon] spawn error:', err.message)
      chronicleProcess = null
    })

    chronicleProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[chronicle-daemon]', data.toString().trimEnd())
    })

    return true
  }
  catch (err) {
    console.error('[chronicle-daemon] failed to spawn:', err)
    return false
  }
}

export function stopDaemon(): void {
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
