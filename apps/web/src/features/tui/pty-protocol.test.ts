// Input: Vitest, PTY WebSocket protocol parser
// Output: Regression coverage for renderer-side PTY server event parsing
// Position: TUI feature unit tests for WebSocket message boundary handling

import { describe, expect, it } from 'vitest'

import { parsePtyServerEvent } from './pty-protocol'

describe('parsePtyServerEvent', () => {
  it('parses snapshot, output, pong, and error events', () => {
    expect(parsePtyServerEvent(JSON.stringify({
      type: 'snapshot',
      seq: 7,
      buffer: 'ready',
      running: true,
    }))).toEqual({
      type: 'snapshot',
      seq: 7,
      buffer: 'ready',
      running: true,
    })

    expect(parsePtyServerEvent(JSON.stringify({
      type: 'output',
      seq: 8,
      data: 'hello',
    }))).toEqual({
      type: 'output',
      seq: 8,
      data: 'hello',
    })

    expect(parsePtyServerEvent(JSON.stringify({ type: 'pong' }))).toEqual({ type: 'pong' })

    expect(parsePtyServerEvent(JSON.stringify({
      type: 'error',
      code: 'terminal_not_found',
      message: 'Terminal not found',
    }))).toEqual({
      type: 'error',
      code: 'terminal_not_found',
      message: 'Terminal not found',
    })
  })

  it('parses exit events with concrete and nullable exit fields', () => {
    expect(parsePtyServerEvent(JSON.stringify({
      type: 'exit',
      seq: 9,
      exitCode: 0,
      signal: 'SIGTERM',
    }))).toEqual({
      type: 'exit',
      seq: 9,
      exitCode: 0,
      signal: 'SIGTERM',
    })

    expect(parsePtyServerEvent(JSON.stringify({
      type: 'exit',
      seq: 10,
      exitCode: null,
      signal: null,
    }))).toEqual({
      type: 'exit',
      seq: 10,
      exitCode: null,
      signal: null,
    })
  })

  it('returns null for invalid JSON, unknown event types, and invalid required fields', () => {
    expect(parsePtyServerEvent('{')).toBeNull()
    expect(parsePtyServerEvent(JSON.stringify(null))).toBeNull()
    expect(parsePtyServerEvent(JSON.stringify({ type: 'unknown' }))).toBeNull()
    expect(parsePtyServerEvent(JSON.stringify({ type: 'snapshot', seq: 1, buffer: 'ready' }))).toBeNull()
    expect(parsePtyServerEvent(JSON.stringify({ type: 'snapshot', seq: 1, buffer: 123, running: true }))).toBeNull()
    expect(parsePtyServerEvent(JSON.stringify({ type: 'snapshot', seq: 1, buffer: 'ready', running: 'yes' }))).toBeNull()
    expect(parsePtyServerEvent(JSON.stringify({ type: 'output', seq: '1', data: 'ready' }))).toBeNull()
    expect(parsePtyServerEvent(JSON.stringify({ type: 'output', seq: 1, data: 123 }))).toBeNull()
    expect(parsePtyServerEvent(JSON.stringify({ type: 'exit', exitCode: 0, signal: null }))).toBeNull()
    expect(parsePtyServerEvent(JSON.stringify({ type: 'exit', seq: '1', exitCode: 0, signal: null }))).toBeNull()
    expect(parsePtyServerEvent(JSON.stringify({ type: 'exit', seq: 1, exitCode: '0', signal: null }))).toBeNull()
    expect(parsePtyServerEvent(JSON.stringify({ type: 'exit', seq: 1, exitCode: 0, signal: 15 }))).toBeNull()
    expect(parsePtyServerEvent(JSON.stringify({ type: 'exit', seq: 1 }))).toBeNull()
    expect(parsePtyServerEvent(JSON.stringify({ type: 'error', code: 'x' }))).toBeNull()
    expect(parsePtyServerEvent(JSON.stringify({ type: 'error', code: 123, message: 'failed' }))).toBeNull()
  })
})
