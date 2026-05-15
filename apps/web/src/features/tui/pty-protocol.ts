// Input: JSON payloads exchanged over the PTY WebSocket live channel
// Output: Shared PTY WebSocket protocol types and parsing helpers for tui views
// Position: Transport contract for apps/web/src/features/tui

export type PtyClientEvent =
  | { type: 'input', data: string }
  | { type: 'resize', cols: number, rows: number }
  | { type: 'ping' }

export type PtySnapshotEvent = {
  type: 'snapshot'
  seq: number
  buffer: string
  running: boolean
}

export type PtyOutputEvent = {
  type: 'output'
  seq: number
  data: string
}

export type PtyExitEvent = {
  type: 'exit'
  seq: number
  exitCode: number | null
  signal: string | null
}

export type PtyPongEvent = { type: 'pong' }

export type PtyErrorEvent = {
  type: 'error'
  code: string
  message: string
}

export type PtyServerEvent = PtySnapshotEvent | PtyOutputEvent | PtyExitEvent | PtyPongEvent | PtyErrorEvent

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function parsePtyServerEvent(raw: string): PtyServerEvent | null {
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  }
  catch {
    return null
  }

  if (!isRecord(parsed) || typeof parsed.type !== 'string') {
    return null
  }

  switch (parsed.type) {
    case 'snapshot':
      return typeof parsed.seq === 'number'
        && typeof parsed.buffer === 'string'
        && typeof parsed.running === 'boolean'
        ? {
            type: 'snapshot',
            seq: parsed.seq,
            buffer: parsed.buffer,
            running: parsed.running,
          }
        : null
    case 'output':
      return typeof parsed.seq === 'number' && typeof parsed.data === 'string'
        ? {
            type: 'output',
            seq: parsed.seq,
            data: parsed.data,
          }
        : null
    case 'exit':
      return typeof parsed.seq === 'number'
        ? {
            type: 'exit',
            seq: parsed.seq,
            exitCode: typeof parsed.exitCode === 'number' ? parsed.exitCode : null,
            signal: asNullableString(parsed.signal),
          }
        : null
    case 'pong':
      return { type: 'pong' }
    case 'error':
      return typeof parsed.code === 'string' && typeof parsed.message === 'string'
        ? {
            type: 'error',
            code: parsed.code,
            message: parsed.message,
          }
        : null
    default:
      return null
  }
}