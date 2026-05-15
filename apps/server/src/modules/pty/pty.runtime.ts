// Input: node-pty pseudo-terminal spawn configuration and lifecycle actions
// Output: transport-neutral PTY runtime registry with output/exit hooks
// Position: apps/server/src/modules/pty runtime owner for session/shell PTYs

import * as pty from 'node-pty'

import type { PtyExitState } from './protocol'

interface RuntimeRecord {
  process: pty.IPty | null
  cols: number
  rows: number
  destroyed: boolean
}

interface RuntimeHooks {
  onOutput: (sessionId: string, data: string) => void
  onExit: (sessionId: string, exit: PtyExitState) => void
  onRelease: (sessionId: string) => void
}

export interface EnsurePtyRuntimeInput {
  sessionId: string
  executable: string
  args: string[]
  cwd: string
  cols: number
  rows: number
  env?: Record<string, string>
}

export class PtyRuntimeRegistry {
  private readonly sessions = new Map<string, RuntimeRecord>()

  constructor(private readonly hooks: RuntimeHooks) {}

  ensureSession(input: EnsurePtyRuntimeInput): void {
    const existing = this.sessions.get(input.sessionId)
    if (existing?.process) {
      existing.cols = input.cols
      existing.rows = input.rows
      existing.destroyed = false
      existing.process.resize(input.cols, input.rows)
      return
    }

    const record = existing ?? {
      process: null,
      cols: input.cols,
      rows: input.rows,
      destroyed: false,
    }

    record.cols = input.cols
    record.rows = input.rows
    record.destroyed = false
    this.sessions.set(input.sessionId, record)

    const child = pty.spawn(input.executable, input.args, {
      name: 'xterm-256color',
      cols: input.cols,
      rows: input.rows,
      cwd: input.cwd,
      env: input.env ? { ...process.env, ...input.env } as Record<string, string> : process.env as Record<string, string>,
    })

    record.process = child

    child.onData((data: string) => {
      this.hooks.onOutput(input.sessionId, data)
    })

    child.onExit(({ exitCode, signal }) => {
      record.process = null
      const exit: PtyExitState = {
        exitCode,
        signal: signal !== undefined ? String(signal) : null,
      }
      this.hooks.onExit(input.sessionId, exit)

      if (record.destroyed) {
        this.sessions.delete(input.sessionId)
        this.hooks.onRelease(input.sessionId)
      }
    })
  }

  destroy(sessionId: string): void {
    const record = this.sessions.get(sessionId)
    if (!record) {
      return
    }

    record.destroyed = true
    if (record.process) {
      record.process.kill()
      return
    }

    this.sessions.delete(sessionId)
    this.hooks.onRelease(sessionId)
  }

  destroyAll(): void {
    for (const sessionId of Array.from(this.sessions.keys())) {
      this.destroy(sessionId)
    }
  }

  write(sessionId: string, data: string): boolean {
    const record = this.sessions.get(sessionId)
    if (!record?.process) {
      return false
    }
    record.process.write(data)
    return true
  }

  resize(sessionId: string, cols: number, rows: number): boolean {
    const record = this.sessions.get(sessionId)
    if (!record?.process) {
      return false
    }

    record.cols = cols
    record.rows = rows
    record.process.resize(cols, rows)
    return true
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  isRunning(sessionId: string): boolean {
    return !!this.sessions.get(sessionId)?.process
  }
}
