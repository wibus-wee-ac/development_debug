// Input: child_process.spawn, ACP agent DB records
// Output: AcpProcessManager singleton — spawn, track, monitor, and kill
//         agent sub-processes; provides resource metrics for Dev mode
// Position: Main-process utility; consumed by acp-connection.ts and AcpService

import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'

import { app } from 'electron'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProcessMetrics {
  pid: number
  agentId: string
  startedAt: number
  uptimeMs: number
  stderrLines: string[]
}

export interface ProcessEntry {
  agentId: string
  proc: ChildProcess
  startedAt: number
  /** Most recent stderr lines (ring buffer, max 200). */
  stderrBuf: string[]
  /** Web WritableStream wrapping proc.stdin for ndJsonStream. */
  stdinWeb: WritableStream<Uint8Array>
  /** Web ReadableStream wrapping proc.stdout for ndJsonStream. */
  stdoutWeb: ReadableStream<Uint8Array>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STDERR_MAX = 200

function pushStderr(buf: string[], line: string): void {
  buf.push(line)
  if (buf.length > STDERR_MAX) {
    buf.shift()
  }
}

/** Convert Node Writable → Web WritableStream<Uint8Array>. */
function toWebWritable(nodeWritable: NodeJS.WritableStream): WritableStream<Uint8Array> {
  return Writable.toWeb(nodeWritable as Writable) as WritableStream<Uint8Array>
}

/** Convert Node Readable → Web ReadableStream<Uint8Array>. */
function toWebReadable(nodeReadable: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
  return Readable.toWeb(nodeReadable as Readable) as ReadableStream<Uint8Array>
}

// ── Manager ───────────────────────────────────────────────────────────────────

export class AcpProcessManager {
  private static instance: AcpProcessManager
  private readonly processes = new Map<string, ProcessEntry>()
  private disposed = false

  static getInstance(): AcpProcessManager {
    if (!AcpProcessManager.instance) {
      AcpProcessManager.instance = new AcpProcessManager()
    }
    return AcpProcessManager.instance
  }

  private constructor() {
    // Kill all managed processes when the Electron app quits.
    app.on('before-quit', () => this.disposeAll())
  }

  /**
   * Spawn an agent process. Returns a ProcessEntry whose Web streams can
   * be fed to `ndJsonStream()`.
   */
  spawn(opts: {
    agentId: string
    cmd: string
    args: string[]
    env: Record<string, string>
    /** binary: absolute installPath; npx/uvx: unused */
    cwd?: string
    distributionType: 'binary' | 'npx' | 'uvx'
    installPath?: string | null
  }): ProcessEntry {
    if (this.disposed) {
      throw new Error('AcpProcessManager has been disposed')
    }
    if (this.processes.has(opts.agentId)) {
      throw new Error(`Agent ${opts.agentId} is already running`)
    }

    let command: string
    let finalArgs: string[]

    switch (opts.distributionType) {
      case 'binary': {
        if (!opts.installPath) {
          throw new Error('installPath is required for binary agents')
        }
        command = join(opts.installPath, opts.cmd)
        finalArgs = opts.args
        break
      }
      case 'npx': {
        command = 'npx'
        finalArgs = [opts.cmd, ...opts.args]
        break
      }
      case 'uvx': {
        command = 'uvx'
        finalArgs = [opts.cmd, ...opts.args]
        break
      }
    }

    const mergedEnv: Record<string, string> = {
      ...process.env as Record<string, string>,
      ...opts.env,
    }

    const proc = spawn(command, finalArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: mergedEnv,
      cwd: opts.cwd ?? app.getPath('home'),
      // Don't let the child keep the app alive
      detached: false,
    })

    const stderrBuf: string[] = []
    const stdinWeb = toWebWritable(proc.stdin!)
    const stdoutWeb = toWebReadable(proc.stdout!)

    // Collect stderr for logging / Dev diagnostics
    proc.stderr?.setEncoding('utf-8')
    proc.stderr?.on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) {
        if (line.trim()) {
          pushStderr(stderrBuf, line)
        }
      }
    })

    const entry: ProcessEntry = {
      agentId: opts.agentId,
      proc,
      startedAt: Date.now(),
      stderrBuf,
      stdinWeb,
      stdoutWeb,
    }

    this.processes.set(opts.agentId, entry)

    // Auto-cleanup on unexpected exit
    proc.on('exit', () => {
      this.processes.delete(opts.agentId)
    })

    return entry
  }

  /** Graceful stop: SIGTERM → wait 5 s → SIGKILL. */
  async stop(agentId: string): Promise<void> {
    const entry = this.processes.get(agentId)
    if (!entry) {
      return
    }

    this.processes.delete(agentId)
    const { proc } = entry

    if (proc.exitCode !== null) {
      return // already exited
    }

    proc.kill('SIGTERM')

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (proc.exitCode === null) {
          proc.kill('SIGKILL')
        }
        resolve()
      }, 5_000)

      proc.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  /** Check if an agent process is currently running. */
  isRunning(agentId: string): boolean {
    return this.processes.has(agentId)
  }

  /** Get the process entry (if running). */
  get(agentId: string): ProcessEntry | undefined {
    return this.processes.get(agentId)
  }

  /** Return metrics for every running agent (used by Dev mode). */
  getMetrics(): ProcessMetrics[] {
    const now = Date.now()
    const result: ProcessMetrics[] = []
    for (const entry of this.processes.values()) {
      result.push({
        pid: entry.proc.pid ?? -1,
        agentId: entry.agentId,
        startedAt: entry.startedAt,
        uptimeMs: now - entry.startedAt,
        stderrLines: [...entry.stderrBuf],
      })
    }
    return result
  }

  /** Kill all managed processes — called on app quit. */
  disposeAll(): void {
    this.disposed = true
    for (const [agentId, entry] of this.processes.entries()) {
      this.processes.delete(agentId)
      if (entry.proc.exitCode === null) {
        entry.proc.kill('SIGKILL')
      }
    }
  }
}
