// Input: node-pty pseudo-terminal processes
// Output: session-owned terminal runtime manager with buffer replay and SSE subscribers
// Position: apps/server/src/modules/pty/pty.manager.ts

import * as pty from 'node-pty'

const MAX_BUFFER_BYTES = 512 * 1024

export type TerminalStreamEvent
  = | { type: 'terminal.buffer', data: string }
    | { type: 'terminal.data', data: string }
    | { type: 'terminal.exit', exitCode: number | null, signal: string | null }

interface TerminalRecord {
  process: pty.IPty | null
  buffer: string
  exit: { exitCode: number | null, signal: string | null } | null
  cols: number
  rows: number
  destroyed: boolean
}

type TerminalSubscriber = (event: TerminalStreamEvent, terminal: boolean) => void

export class PtySessionManager {
  private readonly sessions = new Map<string, TerminalRecord>()
  private readonly subscribers = new Map<string, Set<TerminalSubscriber>>()

  startOrAttach(input: {
    sessionId: string
    executable: string
    args: string[]
    cwd: string
    cols: number
    rows: number
    env?: Record<string, string>
  }): void {
    const existing = this.sessions.get(input.sessionId)
    if (existing?.process) {
      existing.cols = input.cols
      existing.rows = input.rows
      existing.process.resize(input.cols, input.rows)
      return
    }

    const record: TerminalRecord = {
      process: null,
      buffer: '',
      exit: null,
      cols: input.cols,
      rows: input.rows,
      destroyed: false,
    }
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
      record.buffer = trimBuffer(record.buffer + data)
      this.publish(input.sessionId, { type: 'terminal.data', data }, false)
    })

    child.onExit(({ exitCode, signal }) => {
      record.process = null
      record.exit = { exitCode, signal: signal !== undefined ? String(signal) : null }
      this.publish(input.sessionId, { type: 'terminal.exit', exitCode, signal: signal !== undefined ? String(signal) : null }, true)
      if (record.destroyed) {
        this.sessions.delete(input.sessionId)
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

  openStream(sessionId: string): ReadableStream<Uint8Array> {
    const record = this.sessions.get(sessionId)
    if (!record) {
      throw new Error(`Terminal session not found: ${sessionId}`)
    }

    const encoder = new TextEncoder()
    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        let unsubscribe = () => {}
        let initialBufferDelivered = false
        const emit = (event: TerminalStreamEvent, terminal: boolean) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          if (terminal) {
            unsubscribe()
            controller.close()
          }
        }

        if (record.buffer.length > 0) {
          emit({ type: 'terminal.buffer', data: record.buffer }, false)
          initialBufferDelivered = true
        }

        if (record.exit) {
          emit({ type: 'terminal.exit', exitCode: record.exit.exitCode, signal: record.exit.signal }, true)
          return
        }

        const bucket = this.subscribers.get(sessionId) ?? new Set<TerminalSubscriber>()
        const subscriber: TerminalSubscriber = (event, terminal) => {
          if (!initialBufferDelivered && event.type === 'terminal.data') {
            initialBufferDelivered = true
            emit({ type: 'terminal.buffer', data: record.buffer || event.data }, false)
            return
          }
          emit(event, terminal)
        }
        bucket.add(subscriber)
        this.subscribers.set(sessionId, bucket)
        unsubscribe = () => {
          const current = this.subscribers.get(sessionId)
          if (!current) {
            return
          }
          current.delete(subscriber)
          if (current.size === 0) {
            this.subscribers.delete(sessionId)
          }
        }
      },
    })
  }

  private publish(sessionId: string, event: TerminalStreamEvent, terminal: boolean): void {
    const bucket = this.subscribers.get(sessionId)
    if (!bucket) {
      return
    }
    for (const subscriber of bucket) {
      subscriber(event, terminal)
    }
    if (terminal) {
      this.subscribers.delete(sessionId)
    }
  }
}

/** Module-level singleton for the PTY session manager. */
export const ptyManager = new PtySessionManager()

function trimBuffer(value: string): string {
  if (value.length <= MAX_BUFFER_BYTES) {
    return value
  }
  return value.slice(value.length - MAX_BUFFER_BYTES)
}
