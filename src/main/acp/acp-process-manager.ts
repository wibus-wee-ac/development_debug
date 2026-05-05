// Input: child_process spawn, Electron app lifecycle, ACP devtool store
// Output: AcpProcessManager singleton that spawns, tracks, and stops ACP subprocesses
// Position: ACP platform process supervisor shared by connection and IPC layers

import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { Writable } from 'node:stream'

import { app } from 'electron'

import { getAcpDevtoolStore } from '../devtools/acp-devtool-store'

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

interface LineCollector {
  consume: (text: string) => void
  flush: () => void
}

function createLineCollector(onLine: (line: string) => void): LineCollector {
  let carry = ''

  const pushLines = (input: string): void => {
    const normalized = input.replace(/\r/g, '')
    carry += normalized
    const lines = carry.split('\n')
    carry = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim()) {
        onLine(line)
      }
    }
  }

  return {
    consume: pushLines,
    flush: () => {
      if (carry.trim()) {
        onLine(carry)
      }
      carry = ''
    },
  }
}

/**
 * Convert a Node readable to a Web ReadableStream while mirroring raw chunks to
 * an observer callback.
 */
function createObservedReadable(
  nodeReadable: NodeJS.ReadableStream,
  onChunk: (chunk: Uint8Array) => void,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false

      const cleanup = (): void => {
        nodeReadable.removeListener('data', handleData)
        nodeReadable.removeListener('end', handleEnd)
        nodeReadable.removeListener('close', handleEnd)
        nodeReadable.removeListener('error', handleError)
      }

      const close = (): void => {
        if (closed) {
          return
        }
        closed = true
        cleanup()
        controller.close()
      }

      const handleData = (chunk: string | Buffer): void => {
        if (closed) {
          return
        }
        const bytes = chunk instanceof Uint8Array ? chunk : Buffer.from(chunk)
        onChunk(bytes)
        controller.enqueue(new Uint8Array(bytes))
      }

      const handleEnd = (): void => {
        close()
      }

      const handleError = (error: unknown): void => {
        if (closed) {
          return
        }
        closed = true
        cleanup()
        controller.error(error)
      }

      nodeReadable.on('data', handleData)
      nodeReadable.on('end', handleEnd)
      nodeReadable.on('close', handleEnd)
      nodeReadable.on('error', handleError)
      nodeReadable.resume?.()
    },
  })
}

// ── Manager ───────────────────────────────────────────────────────────────────

export class AcpProcessManager {
  private readonly processes = new Map<string, ProcessEntry>()
  private disposed = false

  constructor() {
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
        finalArgs = ['-y', opts.cmd, ...opts.args]
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
    const cwd = opts.cwd ?? app.getPath('home')

    const proc = spawn(command, finalArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: mergedEnv,
      cwd,
      // Don't let the child keep the app alive
      detached: false,
    })

    const devtoolStore = getAcpDevtoolStore()
    const stderrBuf: string[] = []
    const stdinWeb = toWebWritable(proc.stdin!)
    const stdoutCollector = createLineCollector((line) => {
      devtoolStore.record({
        id: `${opts.agentId}:${Date.now()}:stdout:${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        agentId: opts.agentId,
        pid: proc.pid ?? null,
        kind: 'output',
        stream: 'stdout',
        text: line,
        command,
        args: finalArgs,
        cwd,
        exitCode: null,
        signal: null,
      })
    })
    const stdoutWeb = createObservedReadable(proc.stdout!, (chunk) => {
      stdoutCollector.consume(Buffer.from(chunk).toString('utf-8'))
    })

    // Collect stderr for logging / Dev diagnostics
    proc.stderr?.setEncoding('utf-8')
    const stderrCollector = createLineCollector((line) => {
      pushStderr(stderrBuf, line)
      devtoolStore.record({
        id: `${opts.agentId}:${Date.now()}:stderr:${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        agentId: opts.agentId,
        pid: proc.pid ?? null,
        kind: 'output',
        stream: 'stderr',
        text: line,
        command,
        args: finalArgs,
        cwd,
        exitCode: null,
        signal: null,
      })
    })
    proc.stderr?.on('data', (chunk: string) => {
      stderrCollector.consume(chunk)
    })
    proc.stderr?.on('end', () => {
      stderrCollector.flush()
    })
    proc.stderr?.on('close', () => {
      stderrCollector.flush()
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
    devtoolStore.record({
      id: `${opts.agentId}:${Date.now()}:spawn`,
      timestamp: Date.now(),
      agentId: opts.agentId,
      pid: proc.pid ?? null,
      kind: 'spawn',
      stream: 'lifecycle',
      text: `${command} ${finalArgs.join(' ')}`.trim(),
      command,
      args: finalArgs,
      cwd,
      exitCode: null,
      signal: null,
    })

    // Auto-cleanup on unexpected exit
    proc.on('exit', (exitCode, signal) => {
      stdoutCollector.flush()
      stderrCollector.flush()
      this.processes.delete(opts.agentId)
      devtoolStore.record({
        id: `${opts.agentId}:${Date.now()}:exit`,
        timestamp: Date.now(),
        agentId: opts.agentId,
        pid: proc.pid ?? null,
        kind: 'exit',
        stream: 'lifecycle',
        text: `exit code=${exitCode ?? 'null'} signal=${signal ?? 'null'}`,
        command,
        args: finalArgs,
        cwd,
        exitCode,
        signal,
      })
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

export const acpProcessManager = new AcpProcessManager()
