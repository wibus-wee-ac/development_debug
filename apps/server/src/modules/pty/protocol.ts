// Input: PTY live-channel client/server message definitions
// Output: transport-neutral TypeScript protocol types for PTY WebSocket channels
// Position: apps/server/src/modules/pty shared protocol contract between runtime, timeline, and socket adapters

export interface PtyExitState {
  exitCode: number | null
  signal: string | null
}

export type PtyClientEvent
  = | { type: 'input', data: string }
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

export type PtyTimelineEvent = PtyOutputEvent | PtyExitEvent

export type PtyServerEvent
  = | PtySnapshotEvent
    | PtyOutputEvent
    | PtyExitEvent
    | { type: 'pong' }
    | { type: 'error', code: string, message: string }
