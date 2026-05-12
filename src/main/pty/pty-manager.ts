// Input: node-pty IPty instances, Electron WebContents subscribers
// Output: PtyManager singleton — starts/stops/writes/resizes PTY processes and fans out data to subscribers
// Position: Main-process lifecycle manager for cli-tui provider sessions

import type { IPty } from 'node-pty'
import * as pty from 'node-pty'

import type { SignalBroadcaster } from '../signal/broadcaster'

/**
 * Parse OSC 133;D command-finish sequences. Returns exit code (null if not found).
 * Format: ESC ] 133 ; D [; <exitcode>] BEL
 */
const SEMICOLON_PREFIX_RE = /^;/

function extractOsc133CommandFinish(data: string): number | null {
  const ESC = '\u001B'
  const BEL = '\u0007'
  for (const prefix of [`${ESC}]133;D;`, `${ESC}]133;D`]) {
    const start = data.indexOf(prefix)
    if (start === -1) {
      continue
    }
    const afterPrefix = start + prefix.length
    const belEnd = data.indexOf(BEL, afterPrefix)
    const stEnd = data.indexOf(`${ESC}\\`, afterPrefix)
    const end = belEnd === -1 ? stEnd : stEnd === -1 ? belEnd : Math.min(belEnd, stEnd)
    if (end === -1) {
      continue
    }
    const codeStr = data.slice(afterPrefix, end).replace(SEMICOLON_PREFIX_RE, '')
    const code = codeStr === '' ? 0 : Number.parseInt(codeStr, 10)
    return Number.isNaN(code) ? 0 : code
  }
  return null
}

/**
 * Parse OSC 9 notification escape sequences from a data chunk.
 * Format: ESC ] 9 ; <message> BEL   (Windows Terminal / ConEmu protocol)
 */
function extractOsc9Notification(data: string): string | null {
  const ESC = '\u001B'
  const BEL = '\u0007'
  const prefix = `${ESC}]9;`
  const start = data.indexOf(prefix)
  if (start === -1) {
    return null
  }
  const msgStart = start + prefix.length
  const belEnd = data.indexOf(BEL, msgStart)
  const stEnd = data.indexOf(`${ESC}\\`, msgStart)
  const end = belEnd === -1 ? stEnd : stEnd === -1 ? belEnd : Math.min(belEnd, stEnd)
  if (end === -1) {
    return null
  }
  return data.slice(msgStart, end)
}

/** Parse OSC 0 / OSC 2 title escape sequences from a data chunk. */
// Using string methods to avoid no-control-regex lint rule.
// OSC syntax: ESC (0x1B) + ']' + '0;' or '2;' + title + BEL (0x07) or ST (ESC + '\')
function extractOscTitle(data: string): string | null {
  const ESC = '\u001B'
  const BEL = '\u0007'
  for (const prefix of [`${ESC}]0;`, `${ESC}]2;`]) {
    const start = data.indexOf(prefix)
    if (start === -1) {
      continue
    }
    const titleStart = start + prefix.length
    const belEnd = data.indexOf(BEL, titleStart)
    const stEnd = data.indexOf(`${ESC}\\`, titleStart)
    const end = belEnd === -1
      ? stEnd
      : stEnd === -1
        ? belEnd
        : Math.min(belEnd, stEnd)
    if (end === -1) {
      continue
    }
    return data.slice(titleStart, end)
  }
  return null
}

export class PtyManager {
  private readonly sessions = new Map<string, IPty>()
  /** Rolling output buffer per session — capped at MAX_BUFFER_BYTES */
  private readonly buffers = new Map<string, string>()
  private broadcaster: SignalBroadcaster | null = null

  private static readonly MAX_BUFFER_BYTES = 512 * 1024 // 512 KB

  bindBroadcaster(broadcaster: SignalBroadcaster): void {
    this.broadcaster = broadcaster
  }

  start(
    sessionId: string,
    cmd: string,
    args: string[],
    cwd: string,
    cols: number,
    rows: number,
  ): void {
    if (this.sessions.has(sessionId)) {
      return
    }

    const instance = pty.spawn(cmd, args, {
      name: 'xterm-256color',
      cwd,
      cols,
      rows,
    })

    this.sessions.set(sessionId, instance)

    instance.onData((data) => {
      // Append to rolling buffer
      const prev = this.buffers.get(sessionId) ?? ''
      const next = prev + data
      this.buffers.set(
        sessionId,
        next.length > PtyManager.MAX_BUFFER_BYTES
          ? next.slice(next.length - PtyManager.MAX_BUFFER_BYTES)
          : next,
      )
      this.broadcaster?.broadcastGlobal('pty:data', { sessionId, data })
      const title = extractOscTitle(data)
      if (title !== null) {
        this.broadcaster?.broadcastGlobal('pty:title', { sessionId, title })
      }
      const notification = extractOsc9Notification(data)
      if (notification !== null) {
        this.broadcaster?.broadcastGlobal('pty:notification', { sessionId, message: notification })
      }
      const exitCode = extractOsc133CommandFinish(data)
      if (exitCode !== null) {
        this.broadcaster?.broadcastGlobal('pty:command-finish', { sessionId, exitCode })
      }
    })

    instance.onExit(({ exitCode, signal }) => {
      this.sessions.delete(sessionId)
      this.broadcaster?.broadcastGlobal('pty:exit', { sessionId, exitCode, signal: signal ?? null })
    })
  }

  stop(sessionId: string): void {
    const instance = this.sessions.get(sessionId)
    if (!instance) {
      return
    }
    try {
      instance.kill()
    }
    catch {
      // ignore — process may have already exited
    }
    this.sessions.delete(sessionId)
    this.buffers.delete(sessionId)
  }

  write(sessionId: string, data: string): void {
    const instance = this.sessions.get(sessionId)
    if (instance) {
      instance.write(data)
    }
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const instance = this.sessions.get(sessionId)
    if (instance) {
      instance.resize(cols, rows)
    }
  }

  isRunning(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  /** Return the accumulated output buffer for a session (for replay on reconnect). */
  getBuffer(sessionId: string): string {
    return this.buffers.get(sessionId) ?? ''
  }
}

export const ptyManager = new PtyManager()
